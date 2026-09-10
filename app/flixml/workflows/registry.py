"""Workflow Registry — loads workflow JSON files with template variables.

Workflows are ComfyUI API JSON files with {{variable}} placeholders.
At runtime, variables are substituted and the workflow is submitted to ComfyUI.

Usage:
    from workflows.registry import init_registry, get_registry
    
    init_registry("/path/to/workflows")
    registry = get_registry()
    
    # Build workflow with variables substituted
    workflow_json = registry.build_workflow("flux2_lora", {
        "prompt": "a beautiful sunset",
        "seed": 42,
        "width": 1248,
        "height": 832,
    })

Template Variables:
    - {{prompt}}, {{negative_prompt}} — text prompts
    - {{seed}}, {{width}}, {{height}} — generation params
    - {{steps}}, {{cfg}}, {{sampler}}, {{scheduler}}
    - {{filename_prefix}} — output path
    - {{lora_name}}, {{lora_strength}} — LoRA params
    - {{checkpoint}}, {{unet}}, {{clip}}, {{vae}} — model paths
    - Any additional params passed to build_workflow()
"""

from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import Any, Callable


class WorkflowMetadata:
    """Metadata for a single workflow."""
    
    def __init__(self, data: dict[str, Any]):
        self.id = data["id"]
        self.name = data.get("name", self.id)
        self.description = data.get("description", "")
        self.task = data.get("task", "unknown")
        self.output_type = data.get("output_type", "image")
        self.requirements = data.get("requirements", {})
        self.params = data.get("params", {})
        self.compatible_providers = data.get("compatible_providers", [])
        self.examples = data.get("examples", [])
    
    def to_dict(self) -> dict[str, Any]:
        """Return metadata as dict (for API responses)."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "task": self.task,
            "output_type": self.output_type,
            "requirements": self.requirements,
            "params": self.params,
            "compatible_providers": self.compatible_providers,
            "examples": self.examples,
        }


class WorkflowRegistry:
    """Loads workflow JSON files and applies template variable substitution.
    
    Scans a directory for:
    - *.json — workflow templates (ComfyUI API format with {{variables}})
    - *.meta.json — workflow metadata (optional, for params schema, requirements)
    
    Workflows are built by loading the JSON template and substituting variables.
    """
    
    def __init__(self, workflows_dir: str | Path):
        self.workflows_dir = Path(workflows_dir)
        self._workflows: dict[str, WorkflowMetadata] = {}
        self._templates: dict[str, dict[str, Any]] = {}
    
    def load(self) -> None:
        """Load all workflow metadata and templates.

        Scans the main workflows dir, then the ``local/`` subdir for
        user-provided workflows that are loaded at runtime but kept out of the
        repo (git-ignored). Local workflows with the same id override the
        shipped ones.
        """
        if not self.workflows_dir.exists():
            raise FileNotFoundError(f"Workflows directory not found: {self.workflows_dir}")

        for source_dir in (self.workflows_dir, self.workflows_dir / "local"):
            if not source_dir.exists():
                continue

            # Load metadata files (optional)
            for meta_file in source_dir.glob("*.meta.json"):
                self._load_meta_file(meta_file)

            # Load workflow JSON templates
            for json_file in source_dir.glob("*.json"):
                if json_file.name.endswith(".meta.json") or json_file.name.startswith("."):
                    continue
                self._load_template_file(json_file)
    
    def _load_meta_file(self, meta_file: Path) -> None:
        """Load a .meta.json metadata file."""
        with open(meta_file) as f:
            data = json.load(f)

        workflow_id = data.get("id")
        if not workflow_id:
            raise ValueError(f"Metadata file {meta_file.name} missing required 'id' field")

        self._workflows[workflow_id] = WorkflowMetadata(data)

    def _load_template_file(self, json_file: Path) -> None:
        """Load a workflow JSON template."""
        with open(json_file) as f:
            workflow_json = json.load(f)

        workflow_id = json_file.stem
        self._templates[workflow_id] = workflow_json

        if workflow_id not in self._workflows:
            self._workflows[workflow_id] = WorkflowMetadata({"id": workflow_id})
    
    def get(self, workflow_id: str) -> WorkflowMetadata | None:
        """Get workflow metadata by ID."""
        return self._workflows.get(workflow_id)
    
    def list_workflows(
        self,
        task: str | None = None,
        output_type: str | None = None,
        compatible_provider: str | None = None,
    ) -> list[WorkflowMetadata]:
        """List workflows filtered by criteria."""
        results = list(self._workflows.values())
        
        if task:
            results = [w for w in results if w.task == task]
        
        if output_type:
            results = [w for w in results if w.output_type == output_type]
        
        if compatible_provider:
            results = [
                w for w in results
                if not w.compatible_providers or compatible_provider in w.compatible_providers
            ]
        
        return results
    
    def has_template(self, workflow_id: str) -> bool:
        """Check if a workflow template JSON exists."""
        return workflow_id in self._templates
    
    def validate_params(self, workflow_id: str, params: dict[str, Any]) -> list[str]:
        """Validate params against workflow's declared interface.
        
        Returns list of error messages (empty if valid).
        """
        errors = []
        metadata = self._workflows.get(workflow_id)
        if not metadata or not metadata.params:
            # No schema declared — can't validate
            return errors
        
        for param_name, param_schema in metadata.params.items():
            required = param_schema.get("required", False)
            has_default = "default" in param_schema
            provided = param_name in params and params[param_name] is not None
            
            if required and not has_default and not provided:
                errors.append(f"Missing required param: {param_name}")
        
        return errors
    
    def build_workflow(self, workflow_id: str, params: dict[str, Any]) -> dict[str, Any] | None:
        """Load workflow JSON and apply template variable substitution.

        Merges meta.json param defaults with provided params (provided overrides).

        Args:
            workflow_id: Workflow ID (matches JSON filename)
            params: Variables to substitute in the template

        Returns:
            Workflow JSON with variables substituted, or None if not found
        """
        template = self._templates.get(workflow_id)
        if not template:
            return None

        merged: dict[str, Any] = {}
        metadata = self._workflows.get(workflow_id)
        if metadata and metadata.params:
            for name, schema in metadata.params.items():
                if isinstance(schema, dict) and "default" in schema:
                    merged[name] = schema["default"]
        merged.update(params)

        workflow = json.loads(json.dumps(template))
        self._substitute(workflow, merged)

        return workflow
    
    def _substitute(self, obj: Any, params: dict[str, Any]) -> None:
        """Recursively substitute template variables in a JSON object."""
        if isinstance(obj, dict):
            for key, value in list(obj.items()):
                if isinstance(value, str):
                    obj[key] = self._substitute_string(value, params)
                elif isinstance(value, (dict, list)):
                    self._substitute(value, params)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                if isinstance(item, str):
                    obj[i] = self._substitute_string(item, params)
                elif isinstance(item, (dict, list)):
                    self._substitute(item, params)
    
    def _substitute_string(self, text: str, params: dict[str, Any]) -> Any:
        """Substitute template variables in a string.
        
        Handles two cases:
        1. "{{var}}" alone — replaced with the actual value (preserves type)
        2. "...{{var}}..." — replaced as string interpolation
        """
        import re
        pattern = r'\{\{(\w+)\}\}'
        
        # Check if the entire string is a single variable
        match = re.fullmatch(pattern, text.strip())
        if match:
            var_name = match.group(1)
            if var_name in params:
                return params[var_name]
            return text
        
        # Otherwise, do string interpolation
        def replace_var(m: re.Match) -> str:
            var_name = m.group(1)
            value = params.get(var_name)
            if value is None:
                return m.group(0)
            if isinstance(value, (dict, list)):
                return json.dumps(value)
            return str(value)
        
        return re.sub(pattern, replace_var, text)
    
    def get_requirements(self, workflow_id: str) -> dict[str, Any] | None:
        """Get GPU requirements for a workflow."""
        metadata = self._workflows.get(workflow_id)
        return metadata.requirements if metadata else None


# Global registry instance (loaded at startup)
_registry: WorkflowRegistry | None = None


def get_registry() -> WorkflowRegistry:
    """Get the global workflow registry."""
    if _registry is None:
        raise RuntimeError("Workflow registry not initialized. Call init_registry() first.")
    return _registry


def init_registry(workflows_dir: str | Path) -> WorkflowRegistry:
    """Initialize the global workflow registry."""
    global _registry
    _registry = WorkflowRegistry(workflows_dir)
    _registry.load()
    return _registry
