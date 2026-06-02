"""Generation Service

Centralized generation orchestration layer. All image/video generation flows through here.
Handles provider selection, workflow building, job submission, and DB persistence.

Design principle: Common params are explicit. Workflow-specific params go in workflow_params dict.
"""

from __future__ import annotations

import logging
import random
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import db
from ..config import get_settings
from ..providers import (
    GPUProvider,
    GPURequirements,
    JobHandle,
    ProviderError,
    get_provider,
)
from ..workflows.registry import get_registry, WorkflowMetadata


logger = logging.getLogger("nemoflix.generation")


class GenerationError(Exception):
    """Generation failed."""
    pass


class ProviderNotFoundError(GenerationError):
    """Requested provider not found."""
    pass


class ProviderRoutingError(GenerationError):
    """Requested provider is not allowed for the selected workflow/output role."""
    pass


class WorkflowNotFoundError(GenerationError):
    """Requested workflow not found."""
    pass


# -------------------------------------------------------------------------
# Generation Service
# -------------------------------------------------------------------------

class GenerationService:
    """Centralized generation orchestration.
    
    All image/video generation flows through this service:
    1. Select provider (explicit or auto-routing)
    2. Build workflow (load JSON template + apply variable substitution)
    3. Submit job
    4. Persist to DB
    
    Common params (prompt, width, height, seed, filename_prefix) are explicit.
    Workflow-specific params go in workflow_params dict.
    """
    
    def __init__(self):
        self._output_dir = Path(get_settings().output_dir)
    
    # -------------------------------------------------------------------------
    # Unified Generate Method
    # -------------------------------------------------------------------------
    
    async def generate(
        self,
        workflow: str,
        prompt: str,
        provider: str,
        # Common params (all workflows support these)
        width: int | None = None,
        height: int | None = None,
        seed: int | None = None,
        filename_prefix: str | None = None,
        # Workflow-specific params (passed directly to builder)
        workflow_params: dict[str, Any] | None = None,
        # Metadata
        owner_id: str | None = None,
        session_id: str | None = None,
        extra_metadata: dict[str, Any] | None = None,
        # Advanced
        submit: bool = True,
    ) -> JobHandle | dict[str, Any]:
        """Generate media (image or video).
        
        Args:
            workflow: Workflow name from registry (see GET /api/workflows)
            prompt: Text prompt
            provider: Provider id (see GET /api/providers). Required.
            width, height: Output resolution (workflow decides defaults if None)
            seed: Random seed (workflow decides if None)
            filename_prefix: Output filename prefix (workflow decides if None)
            workflow_params: Workflow-specific params passed to builder.
                Examples:
                - flux2_lora: {"loras": [...], "guidance": 4.0, "steps": 20, "cfg": 4.0}
                - wan22_i2v: {"image": "...", "steps_high": 2, "cfg_high": 1.0}
            owner_id, session_id: Tracking metadata
            extra_metadata: Additional metadata to store in DB
            submit: If False, return workflow JSON without submitting
        
        Returns:
            JobHandle if submitted, or dict with workflow JSON if submit=False
        
        Raises:
            WorkflowNotFoundError: If workflow not in registry
            ProviderNotFoundError: If provider not available
            GenerationError: If generation fails
        """
        started_at = time.perf_counter()
        logger.info(
            "generation requested",
            extra={
                "event": "generation.requested",
                "workflow": workflow,
                "provider": provider,
                "width": width,
                "height": height,
                "seed": seed,
                "owner_id": owner_id,
                "session_id": session_id,
                "submit": submit,
            },
        )

        # Get workflow from registry
        registry = get_registry()
        workflow_meta = registry.get(workflow)
        if not workflow_meta:
            available = [w.id for w in registry.list_workflows()]
            logger.error(
                "workflow not found",
                extra={
                    "event": "generation.workflow_missing",
                    "workflow": workflow,
                    "available": available,
                },
            )
            raise WorkflowNotFoundError(
                f"Unknown workflow: {workflow}. Available: {available}"
            )

        # Check if workflow has a JSON template
        if not registry.has_template(workflow):
            logger.error(
                "workflow template missing",
                extra={
                    "event": "generation.template_missing",
                    "workflow": workflow,
                },
            )
            raise WorkflowNotFoundError(
                f"Workflow '{workflow}' has no JSON template. "
                f"Available: {[w.id for w in registry.list_workflows() if registry.has_template(w.id)]}"
            )

        # Convert metadata requirements to GPURequirements
        req = workflow_meta.requirements
        requirements = GPURequirements(
            vram_gb=req.get("vram_gb", 8),
            models=req.get("models", []),
            workflow_type=req.get("workflow_type", "unknown"),
            supports_lora=req.get("supports_lora", False),
        )

        gpu_provider = get_provider(provider)

        # Hard routing guard: a caller may choose a provider, but it must be
        # compatible with the workflow and its output role. This prevents video
        # workloads from accidentally landing on image/default-only nodes.
        compatible_providers = workflow_meta.compatible_providers or []
        provider_family = gpu_provider.provider_id.split("-", 1)[0]
        if compatible_providers and not (
            gpu_provider.provider_id in compatible_providers
            or provider in compatible_providers
            or provider_family in compatible_providers
            or gpu_provider.provider_type.value in compatible_providers
        ):
            raise ProviderRoutingError(
                f"Provider '{gpu_provider.provider_id}' is not compatible with workflow "
                f"'{workflow}'. Compatible providers: {compatible_providers}"
            )

        provider_roles = set(getattr(gpu_provider, "roles", []) or [])
        if workflow_meta.output_type == "video" and provider_roles and "video" not in provider_roles:
            raise ProviderRoutingError(
                f"Provider '{gpu_provider.provider_id}' does not support video workloads. "
                f"Provider roles: {sorted(provider_roles)}"
            )

        logger.info(
            "provider selected",
            extra={
                "event": "generation.provider_selected",
                "workflow": workflow,
                "provider": gpu_provider.provider_id,
                "provider_roles": sorted(provider_roles),
                "vram_gb": requirements.vram_gb,
                "workflow_type": requirements.workflow_type,
            },
        )
        
        # Build workflow params for template substitution
        template_params: dict[str, Any] = {}
        
        # Common params
        if width is not None:
            template_params["width"] = width
        if height is not None:
            template_params["height"] = height
        template_params["seed"] = seed if seed is not None else random.randint(0, 2**32 - 1)
        if filename_prefix is not None:
            template_params["filename_prefix"] = filename_prefix
        
        # Prompt is always passed
        template_params["prompt"] = prompt
        
        # Workflow-specific params
        if workflow_params:
            template_params.update(workflow_params)
        
        # Compute derived values for templates
        if "steps_high" in template_params and "steps_low" in template_params:
            template_params["total_steps"] = template_params["steps_high"] + template_params["steps_low"]
        
        # Build workflow by loading JSON template and applying substitution
        try:
            workflow_json = registry.build_workflow(workflow, template_params)
        except Exception as e:
            logger.exception(
                "template substitution failed",
                extra={
                    "event": "generation.template_error",
                    "workflow": workflow,
                    "provider": gpu_provider.provider_id,
                    "template_params": {k: v for k, v in template_params.items() if k != "prompt"},
                },
            )
            raise GenerationError(f"Workflow template substitution failed: {e}")

        if workflow_json is None:
            raise WorkflowNotFoundError(f"Workflow template '{workflow}' not found")

        logger.info(
            "workflow built",
            extra={
                "event": "generation.workflow_built",
                "workflow": workflow,
                "provider": gpu_provider.provider_id,
                "node_count": len(workflow_json) if isinstance(workflow_json, dict) else None,
                "template_params": {k: v for k, v in template_params.items() if k != "prompt"},
            },
        )

        # Return workflow JSON without submitting
        if not submit:
            return {"workflow": workflow_json, "provider": gpu_provider.provider_id}

        # Submit job to provider first
        try:
            job_handle = await gpu_provider.submit_job(
                workflow=workflow_json,
                requirements=requirements,
            )
        except ProviderError as e:
            logger.exception(
                "provider submit failed",
                extra={
                    "event": "generation.submit_error",
                    "workflow": workflow,
                    "provider": gpu_provider.provider_id,
                },
            )
            # Save failed job so user can see what happened
            metadata = {
                "workflow": workflow,
                "prompt": prompt,
                "width": width,
                "height": height,
                "seed": seed,
                "filename_prefix": filename_prefix,
                "workflow_params": workflow_params,
                "owner_id": owner_id,
                "session_id": session_id,
                "provider": gpu_provider.provider_id,
                "output_type": workflow_meta.output_type,
                **(extra_metadata or {}),
            }
            await db.save_job(
                prompt_id=str(uuid.uuid4()),
                job_type=f"{workflow}_{workflow_meta.output_type}",
                status="failed",
                prompt=prompt,
                width=width or 0,
                height=height or 0,
                workflow_json=workflow_json,
                metadata=metadata,
                error=str(e),
            )
            raise GenerationError(f"Failed to submit job to {gpu_provider.provider_id}: {e}")
        
        # Save successful job to DB
        metadata = {
            "workflow": workflow,
            "prompt": prompt,
            "width": width,
            "height": height,
            "seed": seed,
            "filename_prefix": filename_prefix,
            "workflow_params": workflow_params,
            "owner_id": owner_id,
            "session_id": session_id,
            "provider": gpu_provider.provider_id,
            "output_type": workflow_meta.output_type,
            **(extra_metadata or {}),
        }
        
        await db.save_job(
            prompt_id=job_handle.job_id,
            job_type=f"{workflow}_{workflow_meta.output_type}",
            status="pending",
            prompt=prompt,
            width=width or 0,
            height=height or 0,
            workflow_json=workflow_json,
            metadata=metadata,
        )

        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        logger.info(
            "generation queued",
            extra={
                "event": "generation.queued",
                "workflow": workflow,
                "provider": gpu_provider.provider_id,
                "prompt_id": job_handle.job_id,
                "output_type": workflow_meta.output_type,
                "duration_ms": duration_ms,
            },
        )

        return job_handle
    
    # -------------------------------------------------------------------------
    # Convenience Methods (optional wrappers for common workflows)
    # -------------------------------------------------------------------------
    
    async def generate_image(
        self,
        workflow: str,
        prompt: str,
        provider: str,
        width: int = 1248,
        height: int = 832,
        seed: int | None = None,
        workflow_params: dict[str, Any] | None = None,
        owner_id: str | None = None,
        session_id: str | None = None,
        extra_metadata: dict[str, Any] | None = None,
        submit: bool = True,
    ) -> JobHandle | dict[str, Any]:
        """Generate an image. Convenience wrapper around generate()."""
        return await self.generate(
            workflow=workflow,
            prompt=prompt,
            provider=provider,
            width=width,
            height=height,
            seed=seed,
            workflow_params=workflow_params,
            owner_id=owner_id,
            session_id=session_id,
            extra_metadata=extra_metadata,
            submit=submit,
        )
    
    async def generate_video(
        self,
        workflow: str,
        prompt: str,
        provider: str,
        width: int = 640,
        height: int = 640,
        seed: int | None = None,
        workflow_params: dict[str, Any] | None = None,
        owner_id: str | None = None,
        session_id: str | None = None,
        extra_metadata: dict[str, Any] | None = None,
        submit: bool = True,
    ) -> JobHandle | dict[str, Any]:
        """Generate a video. Convenience wrapper around generate()."""
        return await self.generate(
            workflow=workflow,
            prompt=prompt,
            provider=provider,
            width=width,
            height=height,
            seed=seed,
            workflow_params=workflow_params,
            owner_id=owner_id,
            session_id=session_id,
            extra_metadata=extra_metadata,
            submit=submit,
        )
    
