"""RunPod Serverless Provider

Integration with RunPod's Serverless platform for cloud GPU compute.
Pay-per-second pricing, auto-scaling, no infrastructure management.

API Reference:
- POST /v2/{endpoint_id}/run — Submit async job
- GET /v2/{endpoint_id}/status/{job_id} — Poll for status
- Response retention: 30 minutes (download immediately!)

Usage:
    provider = RunPodServerlessProvider(
        api_key="your-api-key",
        endpoint_id="your-endpoint-id",
        gpu_type="RTX4090",  # Optional: specify GPU type
    )
"""

from __future__ import annotations

import asyncio
import base64
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx

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
from ..config import get_settings


# RunPod API base URL
RUNPOD_API_BASE = "https://api.runpod.ai/v2"


class RunPodServerlessProvider(GPUProvider):
    """Provider for RunPod Serverless endpoints.
    
    Submits ComfyUI workflows to RunPod's serverless platform.
    Jobs are billed per-second, auto-scale based on demand.
    
    IMPORTANT: RunPod deletes outputs after 30 minutes.
    Always download outputs immediately via get_outputs().
    """
    
    def __init__(
        self,
        api_key: str,
        endpoint_id: str,
        gpu_type: str | None = None,
        version: str | None = None,
        timeout_sec: float = 600.0,
    ):
        """
        Args:
            api_key: RunPod API key (from user settings)
            endpoint_id: Serverless endpoint ID (e.g., "32vgrms732dkwi")
            gpu_type: Optional GPU type filter (e.g., "RTX4090", "H100")
            version: Optional endpoint version
            timeout_sec: HTTP request timeout (generation can take minutes)
        """
        self.api_key = api_key
        self.endpoint_id = endpoint_id
        self.gpu_type = gpu_type
        self.version = version
        self.timeout_sec = timeout_sec
        
        self._http_client: httpx.AsyncClient | None = None
    
    @property
    def provider_id(self) -> str:
        return f"runpod-{self.endpoint_id}"
    
    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.CLOUD_SERVERLESS
    
    @property
    def is_local(self) -> bool:
        return False
    
    # -------------------------------------------------------------------------
    # Lifecycle
    # -------------------------------------------------------------------------
    
    async def initialize(self) -> None:
        """Initialize HTTP client with auth headers."""
        self._http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout_sec),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            base_url=RUNPOD_API_BASE,
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
        """Submit workflow to RunPod Serverless endpoint.
        
        Uses /run endpoint for async job submission.
        Returns immediately with job ID for polling.
        
        Args:
            workflow: ComfyUI workflow JSON (must match endpoint's model)
            requirements: GPU requirements (used for endpoint selection)
            priority: Job priority (affects pricing on some endpoints)
        """
        client = await self._get_client()
        
        # RunPod expects workflow wrapped in "input" object
        payload = {
            "input": {
                "workflow": workflow,
            },
        }
        
        # Add GPU type filter if specified
        if self.gpu_type:
            payload["gpu_ids"] = [self.gpu_type]
        
        try:
            resp = await client.post(
                f"/{self.endpoint_id}/run",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            
            job_id = data.get("id")
            status = data.get("status", "IN_QUEUE")
            
            if not job_id:
                raise ProviderUnavailableError(f"RunPod did not return job_id: {data}")
            
            return JobHandle(
                job_id=job_id,
                provider_id=self.provider_id,
                submitted_at=datetime.now(timezone.utc),
                workflow_type=requirements.workflow_type if requirements else None,
                provider_metadata={
                    "endpoint_id": self.endpoint_id,
                    "initial_status": status,
                },
            )
            
        except httpx.ConnectError as e:
            raise ProviderUnavailableError(f"Cannot connect to RunPod API: {e}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise ProviderAuthError(f"Invalid RunPod API key")
            elif e.response.status_code == 402:
                raise ProviderCapacityError(f"RunPod account has insufficient credits")
            elif e.response.status_code == 503:
                raise ProviderCapacityError(f"RunPod endpoint unavailable (no GPUs)")
            else:
                raise ProviderError(f"RunPod API error: {e.response.status_code} - {e.response.text}")
    
    # -------------------------------------------------------------------------
    # Job Status & Results
    # -------------------------------------------------------------------------
    
    async def get_status(self, job_handle: JobHandle) -> JobStatusResponse:
        """Poll job status via RunPod /status endpoint.
        
        Maps RunPod statuses to our JobStatus enum:
        - IN_QUEUE, IN_PROGRESS → RUNNING
        - COMPLETED → COMPLETED
        - FAILED, TIMED_OUT → FAILED
        """
        client = await self._get_client()
        job_id = job_handle.job_id
        
        try:
            resp = await client.get(f"/{self.endpoint_id}/status/{job_id}")
            resp.raise_for_status()
            data = resp.json()
            
            runpod_status = data.get("status", "UNKNOWN")
            
            # Map RunPod status to our enum
            status_map = {
                "IN_QUEUE": JobStatus.QUEUED,
                "IN_PROGRESS": JobStatus.RUNNING,
                "COMPLETED": JobStatus.COMPLETED,
                "FAILED": JobStatus.FAILED,
                "TIMED_OUT": JobStatus.FAILED,
                "CANCELLED": JobStatus.CANCELLED,
            }
            
            status = status_map.get(runpod_status, JobStatus.PENDING)
            
            # Extract timing info
            delay_time_ms = data.get("delayTime")
            execution_time_ms = data.get("executionTime")
            
            # Calculate progress (rough estimate)
            progress = None
            if status == JobStatus.RUNNING:
                progress = 50.0  # No progress info from RunPod
            elif status == JobStatus.COMPLETED:
                progress = 100.0
            
            return JobStatusResponse(
                job_id=job_id,
                status=status,
                progress_percent=progress,
                delay_time_ms=delay_time_ms,
                execution_time_ms=execution_time_ms,
                provider_metadata=data,
            )
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise JobNotFoundError(f"Job {job_id} not found on RunPod")
            else:
                raise ProviderError(f"RunPod status check failed: {e.response.status_code}")
    
    async def get_outputs(self, job_handle: JobHandle) -> list[OutputFile]:
        """Retrieve outputs from completed job.
        
        IMPORTANT: RunPod deletes outputs after 30 minutes!
        This method downloads immediately and saves to local storage.
        Returns our local URLs, not base64 data.
        """
        # Check status first
        status = await self.get_status(job_handle)
        
        if status.status == JobStatus.FAILED:
            error_msg = status.provider_metadata.get("error", "Unknown error")
            raise JobFailedError(job_handle.job_id, str(error_msg))
        
        if status.status != JobStatus.COMPLETED:
            raise JobNotCompletedError(
                f"Job {job_handle.job_id} is {status.status.value}, not completed"
            )
        
        # Extract outputs from status response
        output_data = status.provider_metadata.get("output", {})
        
        if not output_data:
            raise ProviderError(f"No output data for job {job_handle.job_id}")
        
        result_files: list[OutputFile] = []
        
        # Try new format first (images array)
        images = output_data.get("images", [])
        if images and isinstance(images, list):
            for idx, img in enumerate(images):
                if not isinstance(img, dict):
                    continue
                
                base64_data = img.get("data")
                if not base64_data:
                    continue
                
                # Remove data URI prefix if present
                if "," in base64_data:
                    _, base64_data = base64_data.split(",", 1)
                
                # Decode to bytes
                try:
                    decoded = base64.b64decode(base64_data)
                except Exception as e:
                    raise ProviderError(f"Failed to decode image data: {e}")
                
                # Determine type from filename
                filename = img.get("name", f"output_{idx}.png")
                if filename.endswith((".mp4", ".webm", ".gif")):
                    file_type = "video"
                    mime_type = "video/mp4" if filename.endswith(".mp4") else "video/webm"
                elif filename.endswith((".wav", ".mp3")):
                    file_type = "audio"
                    mime_type = "audio/wav" if filename.endswith(".wav") else "audio/mpeg"
                else:
                    file_type = "image"
                    mime_type = "image/png" if filename.endswith(".png") else "image/jpeg"
                
                # Save to local storage IMMEDIATELY (RunPod deletes after 30 min)
                local_path = await self._save_to_storage(decoded, filename)
                
                result_files.append(OutputFile(
                    filename=filename,
                    type=file_type,  # type: ignore
                    mime_type=mime_type,
                    size_bytes=len(decoded),
                    url=f"/media/{local_path}",  # Our URL, not base64
                    data_base64=None,  # Don't store base64
                    metadata={
                        "prompt_id": job_handle.job_id,
                        "endpoint_id": self.endpoint_id,
                    },
                ))
        
        # Fallback: try message field (old format)
        if not result_files:
            message = output_data.get("message", "")
            if message.startswith("data:"):
                try:
                    header, base64_data = message.split(",", 1)
                    mime_type = header.split(":")[1].split(";")[0]
                    
                    if "video" in mime_type:
                        file_type = "video"
                    elif "audio" in mime_type:
                        file_type = "audio"
                    else:
                        file_type = "image"
                    
                    decoded = base64.b64decode(base64_data)
                    filename = f"output_{job_handle.job_id[:8]}.{mime_type.split('/')[-1]}"
                    
                    # Save to local storage
                    local_path = await self._save_to_storage(decoded, filename)
                    
                    result_files.append(OutputFile(
                        filename=filename,
                        type=file_type,  # type: ignore
                        mime_type=mime_type,
                        size_bytes=len(decoded),
                        url=f"/media/{local_path}",
                        data_base64=None,
                        metadata={"prompt_id": job_handle.job_id},
                    ))
                except Exception as e:
                    raise ProviderError(f"Failed to parse output message: {e}")
        
        if not result_files:
            raise ProviderError(f"No outputs found in RunPod response for job {job_handle.job_id}")
        
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
        """List models available on this endpoint.
        
        Note: RunPod endpoints are pre-configured with specific models.
        This returns what the endpoint was deployed with.
        """
        # We can't query models dynamically from RunPod API
        # Return based on endpoint configuration (would need to be set at init)
        
        # For now, return empty - models are determined by the Docker image used
        # to deploy the endpoint (e.g., -flux1-dev, -sdxl, -base)
        return []
    
    async def estimate_cost(
        self,
        workflow: dict[str, Any],
        requirements: GPURequirements | None = None,
    ) -> PricingEstimate:
        """Estimate cost based on workflow complexity and GPU type.
        
        RunPod pricing (Community Cloud, spot pricing as of 2026):
        - RTX 4090: ~$0.34-0.70/hour
        - A100: ~$1.50-2.50/hour
        - H100: ~$2.50-4.00/hour
        
        Rough estimate: $0.02-0.10 per image depending on GPU and steps.
        """
        # Count KSampler nodes and steps
        sampler_count = sum(1 for node in workflow.values() if node.get("class_type") == "KSampler")
        steps = sum(
            node.get("inputs", {}).get("steps", 20)
            for node in workflow.values()
            if node.get("class_type") == "KSampler"
        )
        
        # Estimate time (seconds per step varies by GPU)
        # RTX 4090: ~2-3 sec/step for SDXL, ~4-6 sec/step for FLUX
        sec_per_step = 4.0 if requirements and "flux" in (requirements.workflow_type or "").lower() else 2.5
        estimated_time = steps * sec_per_step * sampler_count
        
        # Pricing (RTX 4090 @ $0.50/hour = $0.00014/second)
        gpu_hourly_rate = 0.50  # Default to RTX 4090
        if self.gpu_type and "H100" in self.gpu_type:
            gpu_hourly_rate = 3.0
        elif self.gpu_type and "A100" in self.gpu_type:
            gpu_hourly_rate = 2.0
        
        cost_per_second = gpu_hourly_rate / 3600.0
        estimated_cost = estimated_time * cost_per_second
        
        return PricingEstimate(
            estimated_cost_usd=estimated_cost,
            estimated_time_sec=estimated_time,
            pricing_model="per_second",
            notes=f"Based on {self.gpu_type or 'RTX4090'} @ ${gpu_hourly_rate}/hr. Actual cost varies with queue wait time.",
        )
    
    # -------------------------------------------------------------------------
    # Health & Monitoring
    # -------------------------------------------------------------------------
    
    async def health_check(self) -> ProviderHealth:
        """Check if RunPod endpoint is available."""
        client = await self._get_client()
        
        try:
            # Try to hit the health endpoint
            resp = await client.get(f"/{self.endpoint_id}/health", timeout=10.0)
            resp.raise_for_status()
            
            return ProviderHealth(
                healthy=True,
                online=True,
                queue_length=None,  # RunPod doesn't expose this
                avg_wait_time_sec=None,
            )
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return ProviderHealth(
                    healthy=False,
                    online=False,
                    error=f"Endpoint {self.endpoint_id} not found",
                )
            elif e.response.status_code == 401:
                return ProviderHealth(
                    healthy=False,
                    online=False,
                    error="Invalid API key",
                )
            elif e.response.status_code == 503:
                return ProviderHealth(
                    healthy=False,
                    online=True,  # API is up, but endpoint unavailable
                    error="Endpoint unavailable (no GPUs)",
                )
            else:
                return ProviderHealth(
                    healthy=False,
                    online=False,
                    error=f"Health check failed: {e.response.status_code}",
                )
        except httpx.ConnectError:
            return ProviderHealth(
                healthy=False,
                online=False,
                error="Cannot connect to RunPod API",
            )
    
    # -------------------------------------------------------------------------
    # Convenience Methods
    # -------------------------------------------------------------------------
    
    @classmethod
    def from_env(cls) -> "RunPodServerlessProvider":
        """Create provider from environment variables.
        
        Requires:
        - RUNPOD_API_KEY
        - RUNPOD_ENDPOINT_ID
        - RUNPOD_GPU_TYPE (optional)
        """
        import os
        
        api_key = os.environ.get("RUNPOD_API_KEY")
        endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID")
        gpu_type = os.environ.get("RUNPOD_GPU_TYPE")
        
        if not api_key or not endpoint_id:
            raise ValueError("RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID must be set")
        
        return cls(
            api_key=api_key,
            endpoint_id=endpoint_id,
            gpu_type=gpu_type,
        )
