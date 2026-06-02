"""Local ComfyUI Provider

Direct integration with local/self-hosted ComfyUI instances.
No cloud costs, full control, immediate output access.

Usage:
    provider = LocalComfyUIProvider(
        node_id="gpu0",
        base_url="http://127.0.0.1:8188",
        roles=["image", "default"],
    )
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx

from ..config import GpuNode, get_settings


logger = logging.getLogger("nemoflix.provider.local")
from .base import (
    GPUProvider,
    GPURequirements,
    JobHandle,
    JobNotFoundError,
    JobNotCompletedError,
    JobStatus,
    JobStatusResponse,
    ModelInfo,
    OutputFile,
    PricingEstimate,
    ProviderError,
    ProviderHealth,
    ProviderType,
    ProviderUnavailableError,
)


class LocalComfyUIProvider(GPUProvider):
    """Provider for local/self-hosted ComfyUI instances.
    
    Communicates directly with ComfyUI's HTTP API over the local network.
    No intermediary, no cloud costs, outputs land directly on local storage.
    """
    
    def __init__(
        self,
        node_id: str,
        base_url: str,
        roles: list[str] | None = None,
        client_id: str | None = None,
        timeout_sec: float = 300.0,
    ):
        """
        Args:
            node_id: Unique identifier (e.g., "gpu0", "local")
            base_url: ComfyUI HTTP API URL (e.g., "http://127.0.0.1:8188")
            roles: Supported roles (e.g., ["image", "video", "default"])
            client_id: ComfyUI client ID for queue tracking (default: auto-generated)
            timeout_sec: HTTP request timeout
        """
        self.node_id = node_id
        self.base_url = base_url.rstrip("/")
        self.roles = roles or ["default"]
        self.client_id = client_id or f"nemoflix-local-{node_id}-{int(time.time())}"
        self.timeout_sec = timeout_sec
        
        self._http_client: httpx.AsyncClient | None = None
    
    @property
    def provider_id(self) -> str:
        return f"local-{self.node_id}"
    
    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.LOCAL
    
    @property
    def is_local(self) -> bool:
        return True
    
    # -------------------------------------------------------------------------
    # Lifecycle
    # -------------------------------------------------------------------------
    
    async def initialize(self) -> None:
        """Initialize HTTP client."""
        self._http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout_sec),
            headers={"Content-Type": "application/json"},
        )
    
    async def shutdown(self) -> None:
        """Cleanup HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if not self._http_client:
            await self.initialize()
        return self._http_client  # type: ignore
    
    # -------------------------------------------------------------------------
    # Job Submission
    # -------------------------------------------------------------------------
    
    async def submit_job(
        self,
        workflow: dict[str, Any],
        requirements: GPURequirements | None = None,
        priority: Literal["low", "normal", "high"] = "normal",
    ) -> JobHandle:
        """Submit workflow to local ComfyUI instance.
        
        ComfyUI's /prompt endpoint returns immediately with prompt_id.
        We track execution via /queue and /history endpoints.
        """
        client = await self._get_client()

        try:
            # Submit workflow
            payload = {
                "prompt": workflow,
                "client_id": self.client_id,
            }
            started = time.perf_counter()
            resp = await client.post(f"{self.base_url}/prompt", json=payload)
            resp.raise_for_status()
            data = resp.json()

            prompt_id = data.get("prompt_id")
            if not prompt_id:
                logger.error(
                    "comfy missing prompt_id",
                    extra={
                        "event": "comfy.submit.bad_response",
                        "provider": self.provider_id,
                        "response": data,
                    },
                )
                raise ProviderUnavailableError(f"ComfyUI did not return prompt_id: {data}")

            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            logger.info(
                "comfy submit ok",
                extra={
                    "event": "comfy.submit.ok",
                    "provider": self.provider_id,
                    "prompt_id": prompt_id,
                    "node_count": len(workflow) if isinstance(workflow, dict) else None,
                    "queue_number": data.get("number"),
                    "duration_ms": duration_ms,
                },
            )

            return JobHandle(
                job_id=prompt_id,
                provider_id=self.provider_id,
                workflow_type=requirements.workflow_type if requirements else None,
                provider_metadata={"client_id": self.client_id},
            )

        except httpx.ConnectError as e:
            logger.error(
                "comfy unreachable",
                extra={
                    "event": "comfy.submit.unreachable",
                    "provider": self.provider_id,
                    "base_url": self.base_url,
                    "error": str(e),
                },
            )
            raise ProviderUnavailableError(f"Cannot connect to ComfyUI at {self.base_url}: {e}")
        except httpx.HTTPStatusError as e:
            logger.error(
                "comfy api error",
                extra={
                    "event": "comfy.submit.http_error",
                    "provider": self.provider_id,
                    "status": e.response.status_code,
                    "body": e.response.text[:2000],
                },
            )
            raise ProviderError(f"ComfyUI API error: {e.response.status_code} - {e.response.text}")
    
    # -------------------------------------------------------------------------
    # Job Status & Results
    # -------------------------------------------------------------------------
    
    async def get_status(self, job_handle: JobHandle) -> JobStatusResponse:
        """Check job status via ComfyUI /history endpoint.
        
        ComfyUI doesn't have a native "status" endpoint, so we:
        1. Check /queue to see if still pending/running
        2. Check /history/{prompt_id} for completed results
        """
        client = await self._get_client()
        prompt_id = job_handle.job_id
        
        # Check history first (completed jobs)
        try:
            resp = await client.get(f"{self.base_url}/history/{prompt_id}")
            resp.raise_for_status()
            history = resp.json()
            
            if prompt_id in history:
                # Job completed
                job_info = history[prompt_id]
                return JobStatusResponse(
                    job_id=prompt_id,
                    status=JobStatus.COMPLETED,
                    progress_percent=100.0,
                    provider_metadata={"history": job_info},
                )
        except httpx.HTTPStatusError:
            pass  # Not in history yet
        
        # Check queue (pending/running jobs)
        try:
            resp = await client.get(f"{self.base_url}/queue")
            resp.raise_for_status()
            queue_data = resp.json()
            
            running = queue_data.get("queue_running", [])
            pending = queue_data.get("queue_running", [])
            
            for item in running + pending:
                if isinstance(item, list) and len(item) > 1 and item[1] == prompt_id:
                    return JobStatusResponse(
                        job_id=prompt_id,
                        status=JobStatus.RUNNING,
                        progress_percent=50.0,  # No progress info from queue
                        provider_metadata={"queue_position": len(pending)},
                    )
        except httpx.HTTPStatusError as e:
            raise ProviderUnavailableError(f"Cannot check queue status: {e}")
        
        # Not in queue or history - may not exist or already cleaned up
        raise JobNotFoundError(f"Job {prompt_id} not found in queue or history")
    
    async def get_outputs(self, job_handle: JobHandle) -> list[OutputFile]:
        """Retrieve outputs from completed job.
        
        Fetches from ComfyUI /history, downloads files via /view endpoint,
        saves to local storage, and returns our local URLs (not ComfyUI URLs).
        """
        # First get status to ensure completion
        status = await self.get_status(job_handle)
        if status.status != JobStatus.COMPLETED:
            raise JobNotCompletedError(f"Job {job_handle.job_id} is {status.status.value}, not completed")
        
        client = await self._get_client()
        prompt_id = job_handle.job_id
        
        # Fetch full history entry
        resp = await client.get(f"{self.base_url}/history/{prompt_id}")
        resp.raise_for_status()
        history = resp.json()
        
        if prompt_id not in history:
            raise JobNotFoundError(f"Job {prompt_id} not found in history")
        
        job_info = history[prompt_id]
        outputs = job_info.get("outputs", {})
        
        result_files: list[OutputFile] = []
        
        # ComfyUI outputs structure: {node_id: {"images": [...], "videos": [...]}}
        for node_id, node_outputs in outputs.items():
            if not isinstance(node_outputs, dict):
                continue
            
            # Handle images
            for img in node_outputs.get("images", []):
                if not isinstance(img, dict):
                    continue
                
                filename = img.get("filename")
                subfolder = img.get("subfolder", "")
                img_type = img.get("type", "output")
                
                if not filename:
                    continue
                
                # Build view URL for download
                params = {"filename": filename, "subfolder": subfolder, "type": img_type}
                view_url = f"{self.base_url}/view?{'&'.join(f'{k}={v}' for k, v in params.items())}"
                
                # Download file
                resp = await client.get(view_url)
                resp.raise_for_status()
                content = resp.content
                
                # Determine type
                content_type = resp.headers.get("content-type", "image/png")
                if "video" in content_type or filename.endswith((".mp4", ".webm", ".gif")):
                    file_type = "video"
                elif "audio" in content_type or filename.endswith((".wav", ".mp3")):
                    file_type = "audio"
                else:
                    file_type = "image"
                
                # Save to local storage immediately
                local_path = await self._save_to_storage(content, filename)
                
                result_files.append(OutputFile(
                    filename=filename,
                    type=file_type,  # type: ignore
                    mime_type=content_type,
                    size_bytes=len(content),
                    url=f"/media/{local_path}",  # Our URL, not ComfyUI's
                    data_base64=None,  # Don't store base64 - just URL
                    metadata={"node_id": node_id, "prompt_id": prompt_id},
                ))
        
        if not result_files:
            raise ProviderError(f"No outputs found for job {prompt_id}")
        
        return result_files
    
    async def _save_to_storage(self, content: bytes, filename: str) -> str:
        """Save file to local storage and return relative path."""
        # Create output directory if needed
        output_dir = Path(get_settings().output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate unique filename if needed
        safe_name = Path(filename).name
        local_path = output_dir / safe_name
        
        # Handle collisions
        counter = 1
        while local_path.exists():
            stem = Path(filename).stem
            suffix = Path(filename).suffix
            local_path = output_dir / f"{stem}_{counter}{suffix}"
            counter += 1
        
        # Save file
        local_path.write_bytes(content)
        
        # Return relative path
        return str(local_path.relative_to(output_dir.parent))
    
    # -------------------------------------------------------------------------
    # Discovery & Capabilities
    # -------------------------------------------------------------------------
    
    async def list_available_models(self) -> list[ModelInfo]:
        """List models available on this ComfyUI instance."""
        client = await self._get_client()
        models: list[ModelInfo] = []
        
        # Fetch model types
        try:
            resp = await client.get(f"{self.base_url}/models")
            resp.raise_for_status()
            model_types = resp.json()
            
            for model_type in model_types:
                resp = await client.get(f"{self.base_url}/models/{model_type}")
                resp.raise_for_status()
                model_list = resp.json()
                
                for model_name in model_list:
                    models.append(ModelInfo(
                        name=model_name,
                        type=self._map_model_type(model_type),  # type: ignore
                        provider_specific={"model_type": model_type},
                    ))
        except httpx.HTTPStatusError:
            pass  # Return empty list if endpoint not available
        
        return models
    
    def _map_model_type(self, comfy_type: str) -> Literal["checkpoint", "lora", "vae", "clip", "unet"]:
        """Map ComfyUI folder names to our model types."""
        mapping = {
            "checkpoints": "checkpoint",
            "loras": "lora",
            "vae": "vae",
            "clip": "clip",
            "unet": "unet",
            "diffusion_models": "unet",
            "clip_vision": "clip",
        }
        return mapping.get(comfy_type, "checkpoint")  # type: ignore
    
    async def estimate_cost(
        self,
        workflow: dict[str, Any],
        requirements: GPURequirements | None = None,
    ) -> PricingEstimate:
        """Estimate cost (always $0 for local) and time."""
        # Rough estimate based on workflow complexity
        # Count KSampler nodes as a proxy for generation steps
        sampler_count = sum(1 for node in workflow.values() if node.get("class_type") == "KSampler")
        steps = sum(
            node.get("inputs", {}).get("steps", 20)
            for node in workflow.values()
            if node.get("class_type") == "KSampler"
        )
        
        # Very rough: ~2-5 seconds per step on modern GPU
        estimated_time = steps * 3.0 * sampler_count
        
        return PricingEstimate(
            estimated_cost_usd=0.0,
            estimated_time_sec=estimated_time,
            pricing_model="per_job",
            notes="Local generation - no cloud costs. Time estimate is approximate.",
        )
    
    # -------------------------------------------------------------------------
    # Health & Monitoring
    # -------------------------------------------------------------------------
    
    async def health_check(self) -> ProviderHealth:
        """Check if ComfyUI instance is reachable and responsive."""
        client = await self._get_client()
        
        try:
            # Try system_stats endpoint
            resp = await client.get(f"{self.base_url}/system_stats", timeout=10.0)
            resp.raise_for_status()
            stats = resp.json()
            
            # Check queue length
            queue_resp = await client.get(f"{self.base_url}/queue", timeout=10.0)
            queue_resp.raise_for_status()
            queue_data = queue_resp.json()
            
            queue_length = len(queue_data.get("queue_running", [])) + len(queue_data.get("queue_pending", []))
            
            return ProviderHealth(
                healthy=True,
                online=True,
                queue_length=queue_length,
                avg_wait_time_sec=queue_length * 10.0,  # Rough estimate
            )
            
        except httpx.ConnectError:
            return ProviderHealth(
                healthy=False,
                online=False,
                error=f"Cannot connect to {self.base_url}",
            )
        except httpx.HTTPStatusError as e:
            return ProviderHealth(
                healthy=False,
                online=True,  # Server is up, but API error
                error=f"API error: {e.response.status_code}",
            )
        except Exception as e:
            return ProviderHealth(
                healthy=False,
                online=False,
                error=str(e),
            )
    
    # -------------------------------------------------------------------------
    # Convenience Methods
    # -------------------------------------------------------------------------
    
    @classmethod
    def from_config_node(cls, node: GpuNode) -> "LocalComfyUIProvider":
        """Create provider from GpuNode config."""
        if not node.comfyui:
            raise ValueError(f"Node {node.id} has no ComfyUI configuration")
        
        return cls(
            node_id=node.id,
            base_url=node.comfyui.url,
            roles=node.roles,
            client_id=node.comfyui.client_id,
        )
