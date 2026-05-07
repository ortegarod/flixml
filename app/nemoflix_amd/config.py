import json
from functools import lru_cache
from typing import Any, Literal

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

NodeRole = Literal["image", "video", "training", "default"]


class ComfyRuntime(BaseModel):
    url: str
    client_id: str | None = None

    @property
    def normalized_url(self) -> str:
        return self.url.rstrip("/")


class AiToolkitRuntime(BaseModel):
    toolkit_dir: str = "/root/ai-toolkit"
    venv: str = "/root/ai-toolkit-venv"
    training_dir: str = "/root/nemoflix-training"
    runner: str = "/root/nemoflix-training/run-ai-toolkit.sh"
    status: Literal["local_cli", "remote_cli", "manual", "unknown"] = "local_cli"


class GpuNode(BaseModel):
    """Configured GPU worker and the runtimes available on it."""

    id: str
    name: str | None = None
    roles: list[NodeRole] = Field(default_factory=lambda: ["default"])
    enabled: bool = True
    comfyui: ComfyRuntime | None = None
    ai_toolkit: AiToolkitRuntime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def label(self) -> str:
        return self.name or self.id

    @property
    def comfy_client_id(self) -> str:
        if self.comfyui and self.comfyui.client_id:
            return self.comfyui.client_id
        return f"nemoflix-{self.id}"


# Backward-compatible alias for existing API code type hints.
ComfyNode = GpuNode


class Settings(BaseSettings):
    """Runtime settings for the agent-native API wrapper."""

    comfy_url: str = Field(default="http://127.0.0.1:8188", validation_alias="COMFY_URL")
    gpu_nodes_json: str | None = Field(default=None, validation_alias="NEMOFLIX_GPU_NODES")
    comfy_nodes_json: str | None = Field(default=None, validation_alias="NEMOFLIX_COMFY_NODES")
    request_timeout_seconds: float = Field(default=120.0, validation_alias="REQUEST_TIMEOUT_SECONDS")
    database_url: str = Field(default="postgresql:///nemoflix_amd", validation_alias="DATABASE_URL")
    output_dir: str = Field(default="/root/ComfyUI/output", validation_alias="NEMOFLIX_OUTPUT_DIR")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    def gpu_nodes(self) -> list[GpuNode]:
        """Return enabled GPU nodes. Prefer generic GPU config; accept old Comfy-only config."""
        raw_nodes: list[dict[str, Any]] = []
        if self.gpu_nodes_json:
            parsed = json.loads(self.gpu_nodes_json)
            if not isinstance(parsed, list):
                raise ValueError("NEMOFLIX_GPU_NODES must be a JSON array")
            raw_nodes = parsed
        elif self.comfy_nodes_json:
            parsed = json.loads(self.comfy_nodes_json)
            if not isinstance(parsed, list):
                raise ValueError("NEMOFLIX_COMFY_NODES must be a JSON array")
            # Legacy compatibility: map Comfy-only records into GPU nodes.
            raw_nodes = [
                {
                    "id": raw.get("id", f"node{index}"),
                    "name": raw.get("name"),
                    "roles": [role for role in raw.get("roles", ["default", "image", "video"]) if role != "training"],
                    "enabled": raw.get("enabled", True),
                    "comfyui": {"url": raw.get("url"), "client_id": raw.get("client_id")},
                    "metadata": raw.get("metadata", {}),
                }
                for index, raw in enumerate(parsed)
                if isinstance(raw, dict)
            ]
        else:
            raw_nodes = [{
                "id": "default",
                "name": "Default GPU",
                "roles": ["default", "image", "video"],
                "comfyui": {"url": self.comfy_url},
            }]

        nodes: list[GpuNode] = []
        seen_ids: set[str] = set()
        for index, raw in enumerate(raw_nodes):
            node = GpuNode.model_validate({"id": f"node{index}", **raw})
            if not node.enabled or node.id in seen_ids:
                continue
            seen_ids.add(node.id)
            nodes.append(node)
        if not nodes:
            nodes.append(GpuNode(id="default", name="Default GPU", roles=["default", "image", "video"], comfyui=ComfyRuntime(url=self.comfy_url)))
        return nodes

    def comfy_nodes(self) -> list[GpuNode]:
        return [node for node in self.gpu_nodes() if node.comfyui]

    def comfy_node_for_role(self, role: Literal["image", "video", "default"] = "default") -> GpuNode:
        nodes = self.comfy_nodes()
        for node in nodes:
            if role in node.roles:
                return node
        for node in nodes:
            if "default" in node.roles:
                return node
        if nodes:
            return nodes[0]
        raise ValueError(f"No ComfyUI node configured for role: {role}")


@lru_cache
def get_settings() -> Settings:
    return Settings()
