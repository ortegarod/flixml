"""GPU Provider Package

Provider abstraction layer for multi-GPU, multi-cloud orchestration.

Usage:
    from nemoflix.providers import LocalComfyUIProvider, RunPodServerlessProvider
    
    # Local provider (your own GPUs)
    local = LocalComfyUIProvider(base_url="http://127.0.0.1:8188", node_id="gpu0")
    
    # RunPod provider (cloud serverless)
    runpod = RunPodServerlessProvider(api_key="...", endpoint_id="...")
    
    # Both implement GPUProvider interface
    provider: GPUProvider = local  # or runpod
    job = await provider.submit_job(workflow)
"""

from .base import (
    GPUProvider,
    GPURequirements,
    JobHandle,
    JobStatus,
    JobStatusResponse,
    JobNotFoundError,
    JobNotCompletedError,
    JobFailedError,
    ModelInfo,
    OutputFile,
    PricingEstimate,
    ProviderError,
    ProviderHealth,
    ProviderType,
    ProviderUnavailableError,
    ProviderCapacityError,
    ProviderAuthError,
)
from .local import LocalComfyUIProvider
from .runpod import RunPodServerlessProvider
from .factory import get_provider, list_providers, register_provider, init_default_providers

__all__ = [
    "GPUProvider",
    "GPURequirements",
    "JobHandle",
    "JobStatus",
    "JobStatusResponse",
    "JobNotFoundError",
    "JobNotCompletedError",
    "JobFailedError",
    "ModelInfo",
    "OutputFile",
    "PricingEstimate",
    "ProviderError",
    "ProviderHealth",
    "ProviderType",
    "ProviderUnavailableError",
    "ProviderCapacityError",
    "ProviderAuthError",
    "LocalComfyUIProvider",
    "RunPodServerlessProvider",
    "get_provider",
    "list_providers",
    "register_provider",
    "init_default_providers",
]
