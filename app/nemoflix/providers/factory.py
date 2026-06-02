"""Provider Factory

Simple factory to get providers by name or role. No smart routing - user explicitly chooses,
or auto-select by role (image/video/default).
"""

import logging
import os
from .base import GPUProvider
from .local import LocalComfyUIProvider
from .runpod import RunPodServerlessProvider


logger = logging.getLogger("nemoflix.providers")


# Provider registry - add new providers here
PROVIDERS: dict[str, GPUProvider] = {}


def register_provider(name: str, provider: GPUProvider) -> None:
    """Register a provider instance."""
    PROVIDERS[name] = provider


def get_provider(name: str) -> GPUProvider:
    """Get provider by name. Raises KeyError if not found."""
    if name not in PROVIDERS:
        available = ", ".join(PROVIDERS.keys())
        raise KeyError(f"Unknown provider: {name}. Available: {available}")
    return PROVIDERS[name]



def list_providers() -> list[dict]:
    """List all registered providers with basic info."""
    return [
        {
            "id": name,
            "type": provider.provider_type.value,
            "is_local": provider.is_local,
            "provider_id": provider.provider_id,
            "roles": list(getattr(provider, "roles", []) or []),
        }
        for name, provider in PROVIDERS.items()
    ]


def init_default_providers() -> None:
    """Register providers from config.

    Local ComfyUI nodes come from config.json (gpu_nodes). An optional RunPod
    serverless provider is registered when RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID
    are present in the environment.
    """
    from ..config import get_settings

    for node in get_settings().comfy_nodes():
        provider = LocalComfyUIProvider.from_config_node(node)
        register_provider(provider.provider_id, provider)
        logger.info(
            "provider registered",
            extra={
                "event": "provider.registered",
                "provider": provider.provider_id,
                "base_url": provider.base_url,
                "roles": provider.roles,
            },
        )

    runpod_api_key = os.environ.get("RUNPOD_API_KEY")
    runpod_endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID")
    runpod_gpu_type = os.environ.get("RUNPOD_GPU_TYPE", "RTX4090")

    if runpod_api_key and runpod_endpoint_id:
        provider = RunPodServerlessProvider(
            api_key=runpod_api_key,
            endpoint_id=runpod_endpoint_id,
            gpu_type=runpod_gpu_type,
        )
        register_provider(provider.provider_id, provider)
        logger.info(
            "provider registered",
            extra={
                "event": "provider.registered",
                "provider": provider.provider_id,
                "endpoint_id": runpod_endpoint_id,
            },
        )
