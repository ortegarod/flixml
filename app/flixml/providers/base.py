"""GPU Provider Abstraction Layer

Defines the contract for GPU compute providers (local ComfyUI, RunPod Serverless, Vast.ai, etc.).
All providers implement this interface, allowing the routing layer to swap providers transparently.

Reference: RunPod Serverless API
- POST /v2/{endpoint_id}/run — Submit async job
- GET /v2/{endpoint_id}/status/{job_id} — Poll for status
- Response: {id, status, delayTime, executionTime, output: {images: [{data: base64}]}}
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Literal


class JobStatus(Enum):
    """Job lifecycle states."""
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ProviderType(Enum):
    """Provider categories."""
    LOCAL = "local"
    CLOUD_SERVERLESS = "cloud_serverless"  # RunPod, Modal
    CLOUD_DEDICATED = "cloud_dedicated"  # Lambda Labs, CoreWeave
    CLOUD_MARKETPLACE = "cloud_marketplace"  # Vast.ai


@dataclass
class GPURequirements:
    """Hardware/software requirements for a workflow."""
    vram_gb: int = 8
    models: list[str] = field(default_factory=list)  # Required checkpoint/model filenames
    workflow_type: str | None = None  # "sdxl", "flux2", "wan22", etc.
    min_gpu_name: str | None = None  # e.g., "RTX 4090", "H100"
    supports_lora: bool = True
    max_concurrent_jobs: int = 1


@dataclass
class PricingEstimate:
    """Cost estimate for a job."""
    estimated_cost_usd: float
    estimated_time_sec: float
    pricing_model: Literal["per_second", "per_job", "hourly"]
    currency: str = "USD"
    notes: str | None = None


@dataclass
class ModelInfo:
    """Information about an available model."""
    name: str
    type: Literal["checkpoint", "lora", "vae", "clip", "unet"]
    size_mb: float | None = None
    compatible_workflows: list[str] = field(default_factory=list)
    provider_specific: dict[str, Any] = field(default_factory=dict)


@dataclass
class OutputFile:
    """Generated output from a job."""
    filename: str
    type: Literal["image", "video", "audio"]
    mime_type: str
    size_bytes: int | None = None
    width: int | None = None
    height: int | None = None
    duration_sec: float | None = None
    # Either base64 data or a URL (S3, local path, etc.)
    data_base64: str | None = None
    url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class JobHandle:
    """Reference to a submitted job."""
    job_id: str
    provider_id: str  # Which provider submitted this
    submitted_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    workflow_type: str | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class JobStatusResponse:
    """Current status of a job."""
    job_id: str
    status: JobStatus
    progress_percent: float | None = None
    delay_time_ms: int | None = None  # Time spent in queue
    execution_time_ms: int | None = None  # Time spent executing
    error: str | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class ProviderHealth:
    """Health status of a provider."""
    healthy: bool
    online: bool
    queue_length: int | None = None
    avg_wait_time_sec: float | None = None
    last_checked: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    error: str | None = None


class GPUProvider(ABC):
    """Abstract base class for GPU compute providers.
    
    All provider implementations (local, RunPod, Vast, Lambda, etc.) must implement
    this interface. The routing layer uses this contract to swap providers transparently.
    
    Lifecycle:
    1. Provider is instantiated with config (API keys, endpoints, etc.)
    2. Routing layer calls health_check() to verify availability
    3. Routing layer calls submit_job() to start generation
    4. Poll get_status() until COMPLETED or FAILED
    5. Call get_outputs() to retrieve generated files
    """
    
    @property
    @abstractmethod
    def provider_id(self) -> str:
        """Unique identifier for this provider instance.
        
        Examples: "local-gpu0", "runpod-<endpoint_id>"
        """
        pass
    
    @property
    @abstractmethod
    def provider_type(self) -> ProviderType:
        """Category of provider (local, cloud serverless, etc.)."""
        pass
    
    @property
    @abstractmethod
    def is_local(self) -> bool:
        """True if this provider runs on local hardware (no cloud costs)."""
        pass
    
    # -------------------------------------------------------------------------
    # Job Submission
    # -------------------------------------------------------------------------
    
    @abstractmethod
    async def submit_job(
        self,
        workflow: dict[str, Any],
        requirements: GPURequirements | None = None,
        priority: Literal["low", "normal", "high"] = "normal",
    ) -> JobHandle:
        """Submit a workflow for execution.
        
        Args:
            workflow: ComfyUI workflow JSON (the full graph)
            requirements: Optional GPU requirements (used for provider selection)
            priority: Job priority (may affect queue ordering or pricing)
        
        Returns:
            JobHandle with job_id for tracking
        
        Raises:
            ProviderError: If submission fails (queue full, auth error, etc.)
        """
        pass
    
    # -------------------------------------------------------------------------
    # Job Status & Results
    # -------------------------------------------------------------------------
    
    @abstractmethod
    async def get_status(self, job_handle: JobHandle) -> JobStatusResponse:
        """Get current status of a submitted job.
        
        Args:
            job_handle: JobHandle from submit_job()
        
        Returns:
            JobStatusResponse with current state
        
        Raises:
            JobNotFoundError: If job_id is invalid or expired
            ProviderError: If status check fails
        """
        pass
    
    @abstractmethod
    async def get_outputs(self, job_handle: JobHandle) -> list[OutputFile]:
        """Retrieve generated outputs for a completed job.
        
        Args:
            job_handle: JobHandle from submit_job()
        
        Returns:
            List of OutputFile objects (images, videos, etc.)
        
        Raises:
            JobNotFoundError: If job_id is invalid
            JobNotCompletedError: If job is not yet COMPLETED
            ProviderError: If retrieval fails
        """
        pass
    
    # -------------------------------------------------------------------------
    # Discovery & Capabilities
    # -------------------------------------------------------------------------
    
    @abstractmethod
    async def list_available_models(self) -> list[ModelInfo]:
        """List models available on this provider.
        
        Returns:
            List of ModelInfo with checkpoint/LoRA/VAE details
        """
        pass
    
    @abstractmethod
    async def estimate_cost(
        self,
        workflow: dict[str, Any],
        requirements: GPURequirements | None = None,
    ) -> PricingEstimate:
        """Estimate cost and time for a workflow.
        
        Args:
            workflow: ComfyUI workflow JSON
            requirements: Optional GPU requirements
        
        Returns:
            PricingEstimate with cost and time estimates
        """
        pass
    
    # -------------------------------------------------------------------------
    # Health & Monitoring
    # -------------------------------------------------------------------------
    
    @abstractmethod
    async def health_check(self) -> ProviderHealth:
        """Check if provider is available and healthy.
        
        Returns:
            ProviderHealth with status and metrics
        """
        pass
    
    # -------------------------------------------------------------------------
    # Lifecycle
    # -------------------------------------------------------------------------
    
    async def initialize(self) -> None:
        """Initialize provider (called once at startup).
        
        Override to perform setup (API auth checks, model discovery, etc.).
        Default implementation does nothing.
        """
        pass
    
    async def shutdown(self) -> None:
        """Cleanup provider resources (called on shutdown).
        
        Override to cleanup connections, cancel pending jobs, etc.
        Default implementation does nothing.
        """
        pass


# -------------------------------------------------------------------------
# Exceptions
# -------------------------------------------------------------------------

class ProviderError(Exception):
    """Base exception for provider-related errors."""
    pass


class ProviderUnavailableError(ProviderError):
    """Provider is offline or unreachable."""
    pass


class ProviderCapacityError(ProviderError):
    """Provider has no available capacity (queue full, no GPUs, etc.)."""
    pass


class ProviderAuthError(ProviderError):
    """Authentication/authorization failed."""
    pass


class JobNotFoundError(ProviderError):
    """Job ID not found (invalid or expired)."""
    pass


class JobNotCompletedError(ProviderError):
    """Job is not yet completed (still running or queued)."""
    pass


class JobFailedError(ProviderError):
    """Job failed during execution."""
    def __init__(self, job_id: str, error: str):
        super().__init__(f"Job {job_id} failed: {error}")
        self.job_id = job_id
        self.error = error
