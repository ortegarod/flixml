from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import shutil
import subprocess
import tempfile
import uuid
import wave
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import httpx

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi import Response
from pydantic import BaseModel, ConfigDict, Field

from .auth import SESSION_COOKIE, Agent, agent_for_key, authorize, can_read_file, current_agent, generate_key, hash_key, owner_scope, owns
from .comfy import ComfyClient
from .config import ComfyNode, get_settings
from . import db
from .db import close_db, delete_character, delete_media_rows, delete_project, delete_project_render_row, delete_project_scene, delete_project_shot, delete_project_shot_versions_by_files, get_character, get_job, get_latest_training_job, get_project, get_project_render, get_project_scene, get_project_shot, get_project_shot_version, get_project_shot_version_by_prompt, get_training_job, init_db, list_active_jobs, list_characters, list_datasets, list_jobs, list_jobs_by_character, list_media, list_project_renders, list_project_scenes, list_project_shot_versions, list_project_shots, list_projects, list_training_jobs, media_catalog_fingerprints, media_count, next_render_number, next_shot_version_number, save_job, save_training_job, update_job_run_times, update_job_status, update_training_job_status, upsert_character, upsert_dataset, upsert_media, upsert_project, upsert_project_render, upsert_project_scene, upsert_project_shot, upsert_project_shot_version, utc_from_timestamp, workflow_run_times
from .workflows.registry import init_registry, get_registry
from .providers import init_default_providers, list_providers
from .services import GenerationService, GenerationError, WorkflowNotFoundError


async def _generate_tts(
    text: str,
    output_path: Path,
    voice_id: str | None = None,
    voice_settings: dict[str, Any] | None = None,
    output_format: str = "pcm_24000",
) -> tuple[bool, float | None]:
    """Generate TTS audio via ElevenLabs with-timestamps endpoint.

    `output_format` is passed straight to ElevenLabs. A `pcm_*` format comes back
    as headerless 16-bit mono samples and is wrapped into a wav container here,
    because that is what ComfyUI's LoadAudio (InfiniteTalk lip-sync) reads; any
    other format is written through untouched.

    Returns (success, speech_end_seconds) where speech_end_seconds is the exact
    moment the last character is spoken, or None if unavailable.
    """
    settings = get_settings()
    api_key = settings.elevenlabs_api_key
    if not api_key:
        return False, None
    resolved_voice_id = voice_id or settings.elevenlabs_voice_id
    if not resolved_voice_id:
        return False, None
    payload: dict[str, Any] = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
    }
    vs = voice_settings or {}
    payload["voice_settings"] = {
        "stability": vs.get("stability", 0.6),
        "similarity_boost": vs.get("similarity_boost", 0.8),
        "style": vs.get("style", 0.2),
        "use_speaker_boost": vs.get("use_speaker_boost", True),
    }
    import base64
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{resolved_voice_id}/with-timestamps",
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            params={"output_format": output_format},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        audio_bytes = base64.b64decode(data["audio_base64"])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_format.startswith("pcm_"):
            with wave.open(str(output_path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(int(output_format.split("_")[1]))
                wav.writeframes(audio_bytes)
        else:
            output_path.write_bytes(audio_bytes)
        alignment = data["alignment"]
        end_times = alignment["character_end_times_seconds"]
        speech_end = float(end_times[-1])
        return True, speech_end


async def _tts_voices() -> list[dict[str, Any]]:
    """List available ElevenLabs voices."""
    settings = get_settings()
    api_key = settings.elevenlabs_api_key
    if not api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": api_key},
            )
            resp.raise_for_status()
            data = resp.json()
            return [
                {
                    "voice_id": v.get("voice_id"),
                    "name": v.get("name"),
                    "category": v.get("category"),
                    "labels": v.get("labels", {}),
                    "description": v.get("description"),
                }
                for v in data.get("voices", [])
            ]
    except Exception:
        return []


_GUIDE_HTML: str | None = None


def _load_guide_html() -> str:
    global _GUIDE_HTML
    if _GUIDE_HTML is not None:
        return _GUIDE_HTML
    # Resolve SKILL.md relative to the project root. This file is
    # <root>/app/flixml/api.py, so the root is parents[2].
    project_root = Path(__file__).resolve().parents[2]
    skill_path = project_root / "SKILL.md"
    md = skill_path.read_text(encoding="utf-8") if skill_path.is_file() else "# FlixML Skill\n\nSKILL.md not found."
    _GUIDE_HTML = md
    return _GUIDE_HTML


API_DESCRIPTION = """Agent-native API for driving ComfyUI image and video generation.

**Agent guide:** read `SKILL.md` or `GET /api/guide` for the full agent workflow.

Core surfaces:
- **Studio** — generate single images or clips (`/api/image/generate`, `/api/video/generate`).
- **Projects** — structured stories: projects → scenes → shots → images → videos → final render.
- **Characters** — reusable identities with base prompts, LoRAs, and voices (`/api/characters`).
- **LoRA training** — train and manage custom models: datasets, start/status, checkpoints, samples (`/api/lora-training/*`).

Workflows and providers are discovered live (`GET /api/workflows`, `GET /api/providers`).

**Agent identity:** send `Authorization: Bearer <key>` (keys come from
`scripts/manage_agent_keys.py`). An admin key sees everything. Any other key sees only the
jobs, media and projects it created, and only the characters in its allowlist; it can also
be limited to certain workflows and capped on concurrent jobs. `config.json`
`security.require_api_key` (default false) decides whether a request with no key is rejected
or served unrestricted. A key that is sent but unknown or revoked is always rejected.
"""

app = FastAPI(
    title="FlixML API",
    description=API_DESCRIPTION,
    version="0.1.0",
    dependencies=[Depends(authorize)],
)


class SessionRequest(BaseModel):
    key: str = Field(min_length=1)


@app.get("/api/session")
async def session(request: Request) -> dict[str, Any]:
    """Who the caller is. 401 when a key is required and none (or a revoked one) was sent."""
    agent = current_agent(request)
    require_key = get_settings().security_config().require_api_key
    if agent is None and (require_key or request.cookies.get(SESSION_COOKIE)):
        raise HTTPException(status_code=401, detail="Sign in with an API key")
    return {"agent": agent.to_dict() if agent else None, "require_api_key": require_key}


@app.post("/api/session")
async def sign_in(body: SessionRequest, response: Response) -> dict[str, Any]:
    """Sign the browser in: check the key, then keep it in an HttpOnly cookie."""
    agent = await agent_for_key(body.key.strip())
    if agent is None:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    response.set_cookie(SESSION_COOKIE, body.key.strip(), max_age=365 * 24 * 3600, httponly=True, samesite="lax")
    return {"agent": agent.to_dict()}


@app.delete("/api/session")
async def sign_out(response: Response) -> dict[str, Any]:
    """Forget the browser's key."""
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


_AGENT_ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,63}$"


class AgentRecord(BaseModel):
    """An API key's identity and scope. The key itself is never stored or returned again."""

    id: str
    name: str
    enabled: bool
    is_admin: bool
    allowed_characters: list[str]
    allowed_workflows: list[str]
    max_concurrent_jobs: int | None
    created_at: datetime
    last_used_at: datetime | None


class AgentCreateRequest(BaseModel):
    id: str = Field(pattern=_AGENT_ID_PATTERN, description="Slug: lowercase letters, digits, - and _")
    name: str = Field(min_length=1, max_length=100)
    is_admin: bool = False
    allowed_characters: list[str] = Field(default_factory=list, description="Empty allows every character")
    allowed_workflows: list[str] = Field(default_factory=list, description="Empty allows every workflow")
    max_concurrent_jobs: int | None = Field(default=None, ge=1)


class AgentUpdateRequest(BaseModel):
    """Only the fields sent change."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    enabled: bool | None = None
    is_admin: bool | None = None
    allowed_characters: list[str] | None = None
    allowed_workflows: list[str] | None = None
    max_concurrent_jobs: int | None = Field(default=None, ge=1)


class AgentKeyResponse(BaseModel):
    agent: AgentRecord
    key: str = Field(description="Shown once. Only its hash is stored.")


def _agent_record(row: dict[str, Any]) -> AgentRecord:
    return AgentRecord(**{name: row.get(name) for name in AgentRecord.model_fields})


async def _existing_agent(agent_id: str) -> dict[str, Any]:
    row = await db.get_agent(agent_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return row


def _refuse_self_lockout(caller: Agent | None, agent_id: str, action: str) -> None:
    """Keep the key making the request from removing its own access."""
    if caller is not None and caller.id == agent_id:
        raise HTTPException(status_code=400, detail=f"You can't {action} the key you're signed in with")


@app.get("/api/agents", response_model=list[AgentRecord])
async def list_agent_keys() -> list[AgentRecord]:
    """List API keys and their scopes. Admin keys only."""
    return [_agent_record(row) for row in await db.list_agents()]


@app.post("/api/agents", response_model=AgentKeyResponse)
async def create_agent_key(body: AgentCreateRequest) -> AgentKeyResponse:
    """Create an agent and its API key. The key is in this response only. Admin keys only."""
    if await db.get_agent(body.id):
        raise HTTPException(status_code=409, detail=f"Agent '{body.id}' already exists")
    raw_key = generate_key()
    row = await db.create_agent(
        id=body.id,
        name=body.name,
        key_hash=hash_key(raw_key),
        allowed_characters=body.allowed_characters,
        allowed_workflows=body.allowed_workflows,
        max_concurrent_jobs=body.max_concurrent_jobs,
        is_admin=body.is_admin,
    )
    return AgentKeyResponse(agent=_agent_record(row), key=raw_key)


@app.patch("/api/agents/{agent_id}", response_model=AgentRecord)
async def update_agent_key(agent_id: str, body: AgentUpdateRequest, request: Request) -> AgentRecord:
    """Change an agent's name, scope, admin flag, or revoke/re-enable its key. Admin keys only."""
    await _existing_agent(agent_id)
    fields = body.model_dump(exclude_unset=True)
    if fields.get("enabled") is False:
        _refuse_self_lockout(current_agent(request), agent_id, "revoke")
    if fields.get("is_admin") is False:
        _refuse_self_lockout(current_agent(request), agent_id, "remove admin from")
    for list_field in ("allowed_characters", "allowed_workflows"):
        if list_field in fields:
            fields[list_field] = fields[list_field] or None
    await db.update_agent(agent_id, fields)
    return _agent_record(await _existing_agent(agent_id))


@app.post("/api/agents/{agent_id}/rotate", response_model=AgentKeyResponse)
async def rotate_agent_key(agent_id: str, request: Request) -> AgentKeyResponse:
    """Replace an agent's key. The old key stops working now; the new one is shown once. Admin keys only."""
    await _existing_agent(agent_id)
    _refuse_self_lockout(current_agent(request), agent_id, "rotate")
    raw_key = generate_key()
    await db.set_agent_key_hash(agent_id, hash_key(raw_key))
    return AgentKeyResponse(agent=_agent_record(await _existing_agent(agent_id)), key=raw_key)


@app.delete("/api/agents/{agent_id}")
async def delete_agent_key(agent_id: str, request: Request) -> dict[str, Any]:
    """Delete an agent and its key. What it made stays, visible to admin keys. Admin keys only."""
    await _existing_agent(agent_id)
    _refuse_self_lockout(current_agent(request), agent_id, "delete")
    await db.delete_agent(agent_id)
    return {"ok": True, "id": agent_id}


async def _require_readable(agent: Agent | None, filename: str | None) -> None:
    """Reject a request that points a job at an output file the caller can't see."""
    if not filename or owner_scope(agent) is None:
        return
    source = _resolve_output_file(filename)
    if source is None:
        return  # not an output file; a ComfyUI input name or URL, resolved by the node
    rel = source.resolve().relative_to(_OUTPUT_DIR.resolve()).as_posix()
    if not await can_read_file(agent, rel):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")


@app.get("/api/guide")
async def guide() -> Response:
    """Return SKILL.md as raw plain text for AI agents."""
    md = _load_guide_html()
    return Response(content=md, media_type="text/markdown; charset=utf-8")


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi
    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    openapi_schema["security"] = [{"bearerAuth": []}]
    app.openapi_schema = openapi_schema
    return openapi_schema


app.openapi = custom_openapi

class CharacterBinding(BaseModel):
    id: str = Field(min_length=1)
    role: str | None = None
    reference_image: str | None = None
    lora_strength: float | None = None


class CharacterLoraBinding(BaseModel):
    workflow: str
    name: str
    strength: float = 1.0
    base_model: str | None = None


class VoiceConfig(BaseModel):
    """TTS voice configuration for a character or narrator."""
    provider: str = "elevenlabs"
    voice_id: str
    name: str | None = None
    settings: dict[str, Any] = Field(default_factory=dict)


class CharacterDefaults(BaseModel):
    """Known preset fields a character's `defaults` blob can carry.

    Stored as a freeform dict in the DB (characters.defaults JSONB) so new keys
    don't require a migration, but this model gives the fields we actually
    consume in /api/image/generate real names, types, and API-doc visibility
    instead of them being silent dead weight. Unknown extra keys are preserved
    but not read by the API.
    """
    model_config = ConfigDict(extra="allow")

    preferred_checkpoint: str | None = None
    image_workflow: str | None = None
    provider: str | None = None
    cfg: float | None = None
    steps: int | None = None
    sampler: str | None = None
    scheduler: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    negative_prompt: str | None = None
    reference_image: str | None = None


class CharacterRecord(BaseModel):
    id: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1)
    kind: Literal["human", "agent"] | None = None
    trigger: str | None = None
    description: str | None = None
    base_prompt: str | None = None
    source_images: list[str] = Field(default_factory=list)
    loras: list[CharacterLoraBinding] = Field(default_factory=list)
    voice: VoiceConfig | None = None
    defaults: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProjectRecord(BaseModel):
    id: str | None = None
    title: str = Field(min_length=1)
    description: str | None = None
    aspect_ratio: str = "9:16"
    duration_seconds: int | None = None
    status: str = "draft"
    characters: list[str] = Field(default_factory=list)
    narrator_voice: VoiceConfig | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SceneRecord(BaseModel):
    id: str | None = None
    project_id: str | None = None
    scene_number: int = Field(ge=1)
    title: str | None = None
    setting: str = "interior"
    weather: str = "clear"
    summary: str | None = None
    location: str | None = None
    time_of_day: str | None = None
    characters: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ShotVersionRecord(BaseModel):
    id: str | None = None
    project_id: str | None = None
    scene_id: str | None = None
    shot_id: str | None = None
    version_number: int | None = None
    kind: Literal["image", "video"]
    status: str = "pending"
    prompt: str | None = None
    file: str | None = None
    prompt_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ShotRecord(BaseModel):
    id: str | None = None
    project_id: str | None = None
    scene_id: str | None = None
    shot_number: int = Field(ge=1)
    text: str | None = None
    description: str | None = None
    subtitle: str | None = None
    speaker: str | None = None
    image_prompt: str | None = None
    motion_prompt: str | None = None
    characters: list[str] = Field(default_factory=list)
    duration_seconds: int = 5
    status: str = "draft"
    image_file: str | None = None
    video_file: str | None = None
    image_prompt_id: str | None = None
    video_prompt_id: str | None = None
    workflow: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class VideoGenerateRequest(BaseModel):
    mode: Literal["t2v", "i2v", "v2v"] | None = Field(
        default=None,
        description="t2v/i2v/v2v. Optional: derived from the workflow's task when omitted. v2v (e.g. InfiniteTalk motion+lip-sync) takes a driving video instead of a still image.",
        json_schema_extra={"examples": ["i2v"]},
    )
    workflow: str = Field(
        min_length=1,
        description="Workflow id to run (e.g. from GET /api/workflows)",
        json_schema_extra={"examples": ["wan2.2_i2v_14b_fp8"]},
    )
    prompt: str = Field(
        min_length=1,
        description="Motion/prompt for the video. In i2v mode the source image carries identity.",
        json_schema_extra={"examples": ["a woman turning to face the camera, soft natural light, cinematic"]},
    )
    character: str | None = Field(default=None, description="Shortcut for one character binding")
    characters: list[CharacterBinding] = Field(default_factory=list, description="Optional explicit character bindings")
    image: str | None = Field(
        default=None,
        description="ComfyUI input filename for image-to-video (i2v).",
        json_schema_extra={"examples": ["projects/prj-xxx/scene-01-sht-xxx-image-v01_0001.png"]},
    )
    audio: str | None = Field(
        default=None,
        description="ComfyUI input filename for audio-driven workflows (e.g. InfiniteTalk lip-sync). Staged to the run node like image.",
        json_schema_extra={"examples": ["voice/line-01.wav"]},
    )
    video: str | None = Field(
        default=None,
        description="ComfyUI input filename for video-driven workflows (e.g. InfiniteTalk v2v). Driving motion clip, staged to the run node like image/audio.",
        json_schema_extra={"examples": ["videos/motion-01.mp4"]},
    )
    negative: str | None = Field(default=None, json_schema_extra={"examples": ["blurry, low quality"]})
    # All generation knobs below default to None → the workflow's meta.json default applies.
    # The workflow meta.json is the SINGLE SOURCE OF TRUTH for per-workflow defaults — do not
    # reintroduce hardcoded numbers here. Only values the caller explicitly sets override the meta.
    width: int | None = None
    height: int | None = None
    length: int | None = Field(default=None, description="Frame count, not seconds. None → workflow meta default.")
    fps: int | None = None
    seed: int | None = None
    filename_prefix: str | None = Field(default=None, json_schema_extra={"examples": ["videos/my_clip"]})
    steps_high: int | None = None
    steps_low: int | None = None
    cfg_high: float | None = None
    cfg_low: float | None = None
    shift: float | None = None
    sampler: str | None = None
    scheduler: str | None = None
    workflow_params: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Passthrough for workflow-specific params (e.g. high_lora, low_lora, "
            "high_lora_strength). Overrides built-in defaults and workflow meta. "
            "Set a Lightning LoRA strength to 0 to restore full motion at the cost of speed."
        ),
    )

    provider: str = Field(description="Provider id (see GET /api/providers)", json_schema_extra={"examples": ["local-gpu-1"]})
    submit: bool = Field(default=True, description="false returns workflow JSON without queueing")


class VideoGenerateResponse(BaseModel):
    ok: bool
    mode: str
    prompt_id: str | None = None
    number: int | None = None
    node_errors: dict[str, Any] | None = None
    workflow: dict[str, Any] | None = None


class TTSGenerateRequest(BaseModel):
    text: str = Field(
        min_length=1,
        description="The line to speak.",
        json_schema_extra={"examples": ["You were supposed to wait for my signal."]},
    )
    character: str | None = Field(
        default=None,
        description="Character id. Speaks in that character's stored voice (characters.voice).",
    )
    project: str | None = Field(
        default=None,
        description="Project id. Falls back to its narrator_voice when the character has none.",
    )
    voice_id: str | None = Field(
        default=None,
        description="ElevenLabs voice id (see GET /api/tts/voices). Overrides the character and project voices.",
    )
    voice_settings: dict[str, Any] | None = Field(
        default=None,
        description="ElevenLabs voice settings: stability, similarity_boost, style, use_speaker_boost.",
        json_schema_extra={"examples": [{"stability": 0.4, "style": 0.5}]},
    )
    filename_prefix: str | None = Field(
        default=None,
        description="Output path for the wav, with no `.wav` suffix. None → a random name under voice/.",
        json_schema_extra={"examples": ["voice/line-01"]},
    )


class TTSGenerateResponse(BaseModel):
    ok: bool
    audio: str = Field(description="Output path to pass as `audio` to POST /api/video/generate")
    audio_url: str
    duration: float | None = Field(default=None, description="Seconds until the last character is spoken")
    voice_id: str


class ShotGenerateRequest(BaseModel):
    workflow: str = Field(description="Workflow id to run (see GET /api/workflows)")
    provider: str = Field(description="Provider id (see GET /api/providers)")


class ImageGenerateRequest(BaseModel):
    workflow: str = Field(
        min_length=1,
        description="Workflow id to run (e.g. from GET /api/workflows)",
        json_schema_extra={"examples": ["flux_gguf_q4_1024"]},
    )
    character: str | None = Field(default=None, description="Shortcut for one character binding")
    characters: list[CharacterBinding] = Field(default_factory=list, description="Optional explicit character bindings")
    lora_checkpoint: str | None = Field(
        default=None,
        description="Trained LoRA checkpoint filename, path under the LoRA output dir, or 'latest'",
        json_schema_extra={"examples": ["latest"]},
    )
    prompt: str = Field(
        min_length=1,
        description="Positive prompt. Character triggers are auto-injected if missing.",
        json_schema_extra={"examples": ["portrait of a woman, natural window light, sharp focus"]},
    )
    negative: str | None = Field(default=None, json_schema_extra={"examples": ["blurry, low quality, watermark"]})
    width: int | None = Field(default=None, description="Falls back to character defaults, then workflow defaults, if unset.")
    height: int | None = Field(default=None, description="Falls back to character defaults, then workflow defaults, if unset.")
    seed: int | None = None
    filename_prefix: str | None = Field(default=None, json_schema_extra={"examples": ["images/character_portrait"]})
    steps: int | None = Field(default=None, description="Falls back to character defaults, then workflow defaults, if unset.")
    cfg: float | None = Field(default=None, description="Falls back to character defaults, then workflow defaults, if unset.")
    sampler: str | None = Field(default=None, description="Falls back to character defaults, then workflow defaults, if unset.")
    scheduler: str | None = Field(default=None, description="Falls back to character defaults, then workflow defaults, if unset.")
    guidance: float = 4.0
    unet: str | None = None  # Workflow-specific, set by service
    clip: str | None = None  # Workflow-specific, set by service
    vae: str | None = None  # Workflow-specific, set by service
    lora_strength: float = 1.0
    image: str | None = Field(
        default=None,
        description="Source image filename or Studio output path for img2img / face-reference workflows.",
        json_schema_extra={"examples": ["images/source.png"]},
    )
    denoise: float | None = Field(
        default=None,
        description="Denoise strength for img2img workflows (0.0 preserves source, 1.0 ignores it).",
    )
    checkpoint: str | None = Field(
        default=None,
        description="Base model filename for workflows with a `checkpoint` param (list: GET /api/comfy/models/checkpoints).",
        json_schema_extra={"examples": ["sd_xl_base_1.0.safetensors"]},
    )
    workflow_params: dict[str, Any] | None = Field(
        default=None,
        description="Passthrough for workflow-specific params (e.g. faceid_weight, denoise, scheduler). Overrides built-in defaults.",
    )
    provider: str = Field(description="Provider id (see GET /api/providers)", json_schema_extra={"examples": ["local-gpu-1"]})
    submit: bool = Field(default=True, description="false returns workflow JSON without queueing")


class ImageGenerateResponse(BaseModel):
    ok: bool
    workflow: str
    checkpoint: str | None = None
    lora_name: str | None = None
    prompt_id: str | None = None
    number: int | None = None
    node_errors: dict[str, Any] | None = None
    graph: dict[str, Any] | None = None


class JobOutput(BaseModel):
    type: str
    filename: str
    subfolder: str = ""
    folder_type: str = "output"
    url: str


class JobStatusResponse(BaseModel):
    """Status, outputs, and what made them.

    The provenance fields let an agent answer "do that again but ..." from a bare
    prompt_id, without asking its human for the workflow, model, seed or params.
    They are null while a job is still queued on a node that never accepted it.
    """

    ok: bool
    prompt_id: str
    status: str
    progress: float | None = None
    queue_position: int | None = None
    outputs_count: int | None = None
    outputs: list[JobOutput] = []
    raw: dict[str, Any] | None = None

    workflow: str | None = None
    provider: str | None = None
    prompt: str | None = None
    negative_prompt: str | None = None
    image: str | None = None
    models: list[str] = []
    loras: list[str] = []
    seed: int | None = None
    width: int | None = None
    height: int | None = None
    workflow_params: dict[str, Any] | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class LoraTrainingStatus(BaseModel):
    ok: bool
    status: str
    job_name: str | None = None
    current_step: int = 0
    total_steps: int = 0
    progress_percent: float | None = None
    loss: float | None = None
    lr: float | None = None
    elapsed: str | None = None
    eta: str | None = None
    seconds_per_step: float | None = None
    gpu_util: float | None = None
    vram_percent: float | None = None
    info: str | None = None
    speed_string: str | None = None
    log_path: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    total_duration_seconds: float | None = None
    updated_at: str
    error: str | None = None


class LoraCheckpoint(BaseModel):
    name: str
    step: int | None = None
    path: str
    size_bytes: int
    modified_at: str


class LoraCheckpointsResponse(BaseModel):
    ok: bool
    job_name: str
    checkpoints: list[LoraCheckpoint]
    count: int
    updated_at: str


class LoraTrainingStartRequest(BaseModel):
    # -- Job ------------------------------------------------------------------
    job_name: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9_-]+$", json_schema_extra={"examples": ["mycharacter_flux2_v1"]})
    trigger_word: str = Field(min_length=1, json_schema_extra={"examples": ["mycharacter"]})
    base_config: str = Field(default="flux2_identity", description="Training template name; resolves to <name>_template.yaml in the training dir", json_schema_extra={"examples": ["flux2_identity"]})
    dataset: str = Field(min_length=1, description="Dataset folder name on the droplet under /root/flixml-training/datasets/", json_schema_extra={"examples": ["mycharacter_dataset_v1"]})

    # -- Model -----------------------------------------------------------------
    model: str = Field(default="flux2_dev", description="Base model label, stored with the job", json_schema_extra={"examples": ["flux2_dev"]})
    model_name_or_path: str = Field(default="black-forest-labs/FLUX.2-dev", description="Hugging Face repo id for the base checkpoint", json_schema_extra={"examples": ["black-forest-labs/FLUX.2-dev"]})
    low_vram: bool = Field(default=False, description="Enable Low VRAM mode (Tier A 16-24 GB)")
    layer_offloading: bool = Field(default=False, description="Stream layers from CPU RAM (Tier A only)")
    transformer_quantization: Literal["qfloat8", "uint4", "none"] = Field(default="qfloat8")
    te_quantization: Literal["qfloat8", "uint4", "none"] = Field(default="qfloat8")

    # -- Target (LoRA network) -------------------------------------------------
    lora_rank: int = Field(default=32, ge=4, le=128)

    # -- Training --------------------------------------------------------------
    steps: int = Field(default=1800, ge=100, le=10000)
    learning_rate: float = Field(default=1e-4, ge=1e-6, le=1e-2)
    batch_size: int = Field(default=1, ge=1, le=8)
    gradient_accumulation: int = Field(default=1, ge=1, le=16)
    optimizer: Literal["adamw8bit", "adamw", "sgd"] = Field(default="adamw8bit")
    weight_decay: float = Field(default=1e-4, ge=0, le=1e-1)
    timestep_type: Literal["weighted", "sigmoid"] = Field(default="weighted")
    loss_type: Literal["mse", "l1", "huber"] = Field(default="mse")
    cache_text_embeddings: bool | None = Field(default=None, description="Auto: true unless DOP enabled. Encode captions once to save VRAM; incompatible with DOP or caption dropout.")
    unload_text_encoder: bool = Field(default=False, description="Unload TE after caching embeddings (VRAM saver)")

    # -- Dataset ---------------------------------------------------------------
    resolution: list[int] = Field(default=[768, 896, 1024], description="Resolution buckets for training")
    caption_dropout_rate: float = Field(default=0.0, ge=0.0, le=1.0, description="Dropout rate for captions; set 0 when cache_text_embeddings is on")
    cache_latents: bool = Field(default=True, description="Cache VAE latents to disk to save VRAM")

    # -- Regularization --------------------------------------------------------
    dop_enabled: bool = Field(default=False, description="Differential Output Preservation - keep base model behaviour outside your trigger")
    preservation_class: str = Field(default="photo", description="Neutral class word for DOP non-trigger path")

    # -- Advanced --------------------------------------------------------------
    differential_guidance: bool = Field(default=False, description="Exaggerate the gap toward target for faster detail lock-in")
    differential_guidance_scale: float = Field(default=3.0, ge=1.0, le=10.0)

    # -- Sampling --------------------------------------------------------------
    sample_every: int = Field(default=250, ge=50, le=5000)
    sample_steps: int = Field(default=25, ge=10, le=100)
    sample_width: int = Field(default=1024, ge=512, le=2048)
    sample_height: int = Field(default=1024, ge=512, le=2048)
    sample_guidance_scale: float = Field(default=1.0, ge=0.0, le=10.0)
    sample_seed: int = Field(default=42)
    sample_prompts: list[str] = Field(default_factory=lambda: [
        "a person sitting at a cafe, holding a coffee cup, morning light through the window",
        "a person walking down a busy city street, candid shot, afternoon sun",
        "a person in a garden, surrounded by flowers, soft natural light, portrait",
    ])


class LoraTrainingStartResponse(BaseModel):
    ok: bool
    job_name: str
    status: str
    config_path: str
    output_dir: str
    error: str | None = None


def comfy(node: ComfyNode | None = None) -> ComfyClient:
    settings = get_settings()
    target = node or settings.comfy_node_for_role("default")
    return ComfyClient(target.comfyui.normalized_url, settings.request_timeout_seconds)


def comfy_for_role(role: str) -> tuple[ComfyClient, ComfyNode]:
    settings = get_settings()
    node = settings.comfy_node_for_role(role)  # type: ignore[arg-type]
    return ComfyClient(node.comfyui.normalized_url, settings.request_timeout_seconds), node


def comfy_node_for_provider(provider: str | None) -> ComfyNode | None:
    """Resolve the ComfyUI node a provider maps to (provider id is `local-<node.id>`)."""
    if not provider:
        return None
    return next(
        (n for n in get_settings().comfy_nodes() if provider in (n.id, f"local-{n.id}")),
        None,
    )


logger = logging.getLogger("flixml.reconcile")

_RECONCILE_TASK: asyncio.Task | None = None
_RECONCILE_INTERVAL_SECONDS = 3.0
# How long a job may be unknown to its node before we call it abandoned. Covers the
# window between our DB insert and the node registering the prompt.
_ABANDON_AFTER_SECONDS = 600
# Node statuses that mean the GPU is on this job right now, as opposed to holding it
# in the queue behind another one.
_RUNNING_STATUSES = {"running", "in_progress"}


async def _reconcile_job(prompt_id: str, provider: str | None) -> dict[str, Any]:
    """Bring one job's DB row in line with its ComfyUI node.

    The single reconciliation path in the app: both the polling loop and
    GET /api/jobs/{prompt_id} go through here, so a job's status can only ever be
    decided in one place.
    """
    client = comfy(comfy_node_for_provider(provider))
    error: str | None = None
    comfy_job = await client.get_optional(f"/api/jobs/{prompt_id}")
    if comfy_job is not None:
        raw = comfy_job
        outputs = _extract_outputs_from_comfy_job(comfy_job, client)
        status = comfy_job.get("status", "unknown")
        execution = comfy_job.get("execution_status") or {}
        if isinstance(execution, dict) and execution.get("status_str") == "error":
            status = "failed"
            error = "ComfyUI reported execution error"
    else:
        # Either the node has no record of this job, or it is an older build with no
        # /api/jobs/{id} route. /history answers both: it holds the job once it has
        # finished. Empty means the node cannot account for the job at all — "unknown",
        # never "running". Reading an empty history as still-running is what let dead
        # jobs sit in the generating lane forever.
        raw = await client.get_optional(f"/history/{prompt_id}") or {}
        outputs = _extract_outputs(raw, client)
        status = "completed" if outputs else "unknown"

    node_started, node_finished = _run_times(comfy_job, raw.get(prompt_id) if comfy_job is None else None)
    if node_started is not None:
        await update_job_run_times(prompt_id, node_started, node_finished, exact_start=True)
    elif status in _RUNNING_STATUSES:
        # A node reports execution_start_time only once the job has finished, so a job
        # in flight has no start time at all and nothing can tell how long it has been
        # on the GPU. Stamp the first cycle that sees it running — within the reconcile
        # interval of the truth, and replaced by the node's exact figure when it lands.
        await update_job_run_times(prompt_id, datetime.now(UTC), node_finished)
    elif node_finished is not None:
        await update_job_run_times(prompt_id, None, node_finished)

    # ComfyUI saying "completed" means generation finished, not that we hold the files.
    # Only report completed once _persist_outputs has actually imported them.
    if status == "completed" and outputs:
        status = "completed" if await _persist_outputs(prompt_id, outputs) else "running"

    if status in {"pending", "running", "completed", "failed"}:
        await update_job_status(prompt_id, status, error=error)
    return {"status": status, "outputs": outputs if status == "completed" else [], "raw": raw}


def _ms_to_utc(value: Any) -> datetime | None:
    return datetime.fromtimestamp(value / 1000, UTC) if isinstance(value, (int, float)) else None


def _run_times(comfy_job: dict[str, Any] | None, history_entry: Any) -> tuple[datetime | None, datetime | None]:
    """When the node started and finished running a job, from /api/jobs/{id} or /history/{id}."""
    if comfy_job is not None:
        return _ms_to_utc(comfy_job.get("execution_start_time")), _ms_to_utc(comfy_job.get("execution_end_time"))
    status = history_entry.get("status") if isinstance(history_entry, dict) else None
    messages = status.get("messages") or [] if isinstance(status, dict) else []
    stamps = {m[0]: m[1].get("timestamp") for m in messages if isinstance(m, list) and len(m) == 2 and isinstance(m[1], dict)}
    finished = stamps.get("execution_success") or stamps.get("execution_error") or stamps.get("execution_interrupted")
    return _ms_to_utc(stamps.get("execution_start")), _ms_to_utc(finished)


def _abandoned(job: dict[str, Any]) -> bool:
    """True if a job the node has no record of is old enough to write off."""
    created = job.get("created_at")
    if not isinstance(created, datetime):
        return False
    age = (datetime.now(UTC) - created).total_seconds()
    return age > _ABANDON_AFTER_SECONDS


async def _reconcile_loop() -> None:
    """Poll every unfinished job against its node until it reaches a terminal state.

    This is the only thing that imports generated files. It replaced a per-node
    WebSocket bridge: ComfyUI evicts an existing socket when a new client claims the
    same clientId but leaves the TCP connection open, so the bridge stayed connected,
    silently received nothing, and jobs sat at "pending" forever with no error logged
    anywhere. A poll has no equivalent failure mode — a bad cycle is simply retried on
    the next one, and anything that goes wrong is logged.
    """
    while True:
        try:
            for job in await list_active_jobs():
                prompt_id = job.get("prompt_id")
                if not isinstance(prompt_id, str):
                    continue
                try:
                    result = await _reconcile_job(prompt_id, job.get("provider"))
                except Exception:
                    logger.warning("reconcile failed for job %s", prompt_id, exc_info=True)
                    continue
                if result["status"] == "unknown" and _abandoned(job):
                    logger.warning("job %s abandoned: node has no record of it", prompt_id)
                    await update_job_status(
                        prompt_id, "failed", error="Abandoned — the GPU node has no record of this job."
                    )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("reconcile cycle failed", exc_info=True)
        await asyncio.sleep(_RECONCILE_INTERVAL_SECONDS)


@app.get("/api/workflows")
async def list_workflows() -> list[dict]:
    """List all available workflows an agent can request, including each one's params.

    `run_time` holds measured run times per node from this install's recent completed
    jobs, or null if the workflow has never finished here. Times reflect the params
    those jobs used; longer videos and bigger sizes take longer.
    """
    registry = get_registry()
    run_times = await workflow_run_times()
    workflows = []
    for w in registry.list_workflows():
        entry = w.to_dict()
        by_provider = run_times.get(w.id)
        entry["run_time"] = {"by_provider": by_provider} if by_provider else None
        workflows.append(entry)
    return workflows


@app.get("/api/providers")
async def list_registered_providers() -> list[dict]:
    """List all registered providers an agent can target."""
    return list_providers()


@app.on_event("startup")
async def start_reconciler() -> None:
    global _RECONCILE_TASK
    await init_db()
    init_default_providers()  # Register GPU providers
    init_registry(Path(__file__).parent / "workflows")  # Load workflow metadata
    # Backgrounded on purpose: this walks every output file and shells out to
    # ffprobe for the ones it has not catalogued yet. Awaiting it here held the
    # port closed for ~2.5 minutes on a 1500-file gallery, so a restart looked
    # like an outage.
    asyncio.create_task(_sync_media_catalog())
    if _RECONCILE_TASK is None or _RECONCILE_TASK.done():
        _RECONCILE_TASK = asyncio.create_task(_reconcile_loop())


@app.on_event("shutdown")
async def stop_reconciler() -> None:
    global _RECONCILE_TASK
    if _RECONCILE_TASK:
        _RECONCILE_TASK.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _RECONCILE_TASK
        _RECONCILE_TASK = None
    await close_db()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _is_media_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in _ALLOW_EXT


def _media_type_from_path(path: Path) -> str:
    return "video" if path.suffix.lower() in {".mp4", ".webm", ".gif"} else "image"


def _parse_jsonb(value: Any) -> Any:
    """Parse a JSONB string returned by asyncpg into a Python object."""
    if isinstance(value, str):
        with contextlib.suppress(json.JSONDecodeError):
            return json.loads(value)
    return value


async def _sync_media_catalog() -> None:
    """Ensure every media file on disk has a row in the media table.

    This is a one-way import: files present in the media table are left as-is,
    and any output files missing from the table are upserted so the catalog
    stays in sync with the filesystem. Project renders are excluded from the
    gallery catalog.

    Files already catalogued at the same size and mtime with known dimensions
    are skipped, because reading dimensions shells out to ffprobe once per
    video. This runs as a background task (see the startup hook) so a restart
    never waits on it.
    """
    try:
        files = [p for p in _OUTPUT_DIR.rglob("*") if _is_media_file(p)]
    except Exception:  # noqa: BLE001
        return

    try:
        known = await media_catalog_fingerprints()
    except Exception:  # noqa: BLE001
        known = {}

    for path in files:
        rel = path.relative_to(_OUTPUT_DIR).as_posix()
        if rel.startswith("projects/") and "render-" in rel:
            continue
        # Skip hidden dirs (e.g. .thumbs/ poster cache) — those are internal
        # artifacts, not gallery media, and must never appear as catalog items.
        if any(part.startswith(".") for part in Path(rel).parts):
            continue
        try:
            stat = path.stat()
            modified = utc_from_timestamp(stat.st_mtime)
            row = known.get(rel)
            if (
                row is not None
                and row[0] == stat.st_size
                and row[1] == modified
                and row[2] is not None
                and row[3] is not None
            ):
                continue
            width, height = _read_dimensions(path)
            await upsert_media({
                "filename": rel,
                "type": _media_type_from_path(path),
                "width": width,
                "height": height,
                "size": stat.st_size,
                "modified": modified,
            })
        except Exception:  # noqa: BLE001
            continue


def _record_with_id(data: BaseModel, prefix: str, **overrides: Any) -> dict[str, Any]:
    record = data.model_dump()
    record.update(overrides)
    if not record.get("id"):
        record["id"] = _new_id(prefix)
    return record


def _request_character_bindings(character: str | None, characters: list[CharacterBinding]) -> list[CharacterBinding]:
    bindings = list(characters)
    if character and not any(binding.id == character for binding in bindings):
        bindings.insert(0, CharacterBinding(id=character))
    return bindings


async def _resolve_characters(character: str | None, characters: list[CharacterBinding]) -> list[tuple[CharacterBinding, dict[str, Any]]]:
    resolved: list[tuple[CharacterBinding, dict[str, Any]]] = []
    for binding in _request_character_bindings(character, characters):
        record = await get_character(binding.id)
        if not record:
            raise HTTPException(status_code=404, detail=f"Character not found: {binding.id}")
        resolved.append((binding, record))
    return resolved


def _prompt_with_character_triggers(prompt: str, records: list[dict[str, Any]]) -> str:
    triggers = [record.get("trigger") for record in records if record.get("trigger")]
    missing = [trigger for trigger in triggers if trigger.lower() not in prompt.lower()]
    if not missing:
        return prompt
    return f"{', '.join(missing)}, {prompt}"


def _character_loras(records: list[dict[str, Any]], workflow: str, bindings: list[CharacterBinding]) -> list[dict[str, Any]]:
    loras: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        binding_strength = bindings[index].lora_strength if index < len(bindings) else None
        for lora in record.get("loras") or []:
            if lora.get("workflow") != workflow:
                continue
            loras.append({
                "name": lora.get("name"),
                "strength": binding_strength if binding_strength is not None else float(lora.get("strength", 1.0)),
                "character_id": record.get("id"),
            })
    return loras


def _character_reference_image(binding: CharacterBinding, record: dict[str, Any]) -> str | None:
    if binding.reference_image and binding.reference_image != "latest_best":
        return binding.reference_image
    defaults = record.get("defaults") or {}
    if defaults.get("reference_image"):
        return defaults["reference_image"]
    images = record.get("source_images") or []
    return images[0] if images else None


async def _ensure_comfy_input_image(image: str, provider: str | None = None) -> str:
    source = _resolve_output_file(image)
    if source is None:
        return image
    # Upload to the node that will run the job, not the default node. Otherwise
    # the image lands on the wrong machine when image and video run on separate nodes.
    node = comfy_node_for_provider(provider)
    tmp_path = Path(tempfile.gettempdir()) / source.name
    shutil.copy2(source, tmp_path)
    try:
        result = await comfy(node).upload_image(tmp_path)
        return result.get("name") or image
    finally:
        tmp_path.unlink(missing_ok=True)


async def _ensure_comfy_input_audio(audio: str, provider: str | None = None) -> str:
    """Stage an audio file into the run node's ComfyUI input dir (mirror of image staging).

    Uses upload_input_file (generic /upload/image path) since audio has no dedicated
    endpoint. Returns the input filename LoadAudio expects, or the original on miss.
    """
    source = _resolve_output_file(audio)
    if source is None:
        return audio
    node = comfy_node_for_provider(provider)
    tmp_path = Path(tempfile.gettempdir()) / source.name
    shutil.copy2(source, tmp_path)
    try:
        result = await comfy(node).upload_input_file(tmp_path)
        return result.get("name") or audio
    finally:
        tmp_path.unlink(missing_ok=True)


def _resolve_output_file(name: str) -> Path | None:
    """Resolve a caller-supplied output reference to a real file under _OUTPUT_DIR.

    Callers pass paths like 'videos/clip.mp4' or 'clip.wav'. Try the relative
    subpath first (the common case for anything in outputs/videos, outputs/images,
    etc.), then fall back to the bare filename at the output root. Returns None on
    miss. Path components are stripped to their parts to keep resolution inside
    _OUTPUT_DIR (no traversal).
    """
    rel = Path(name)
    candidates = []
    if rel.parts:
        candidates.append(_OUTPUT_DIR.joinpath(*[p for p in rel.parts if p not in ("..", "/")]))
    candidates.append(_OUTPUT_DIR / rel.name)
    for c in candidates:
        if c.is_file():
            return c
    return None


async def _ensure_comfy_input_video(video: str, provider: str | None = None) -> str:
    """Stage a driving-video file into the run node's ComfyUI input dir.

    Mirror of _ensure_comfy_input_audio. Uses upload_input_file (generic /upload/image
    path) since VHS_LoadVideo reads from the same input dir. Returns the input filename
    VHS_LoadVideo expects, or the original on miss.
    """
    source = _resolve_output_file(video)
    if source is None:
        return video
    node = comfy_node_for_provider(provider)
    tmp_path = Path(tempfile.gettempdir()) / source.name
    shutil.copy2(source, tmp_path)
    try:
        result = await comfy(node).upload_input_file(tmp_path)
        return result.get("name") or video
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/api/agent/chat")
async def agent_chat(payload: dict[str, Any]) -> dict[str, Any]:
    """Demo in-app chat endpoint for assistant-ui. Returns a friendly response; tool execution is planned."""
    messages = payload.get("messages") or []

    def _text_from_part(part: Any) -> str:
        if isinstance(part, str):
            return part
        if not isinstance(part, dict):
            return ""
        if isinstance(part.get("text"), str):
            return part["text"]
        if isinstance(part.get("content"), str):
            return part["content"]
        return ""

    last_text = ""
    for message in reversed(messages if isinstance(messages, list) else []):
        if not isinstance(message, dict):
            continue
        if message.get("role") != "user":
            continue
        parts = message.get("content") or message.get("parts") or []
        if isinstance(parts, str):
            last_text = parts
        elif isinstance(parts, list):
            last_text = " ".join(filter(None, (_text_from_part(part) for part in parts)))
        break

    text = (
        "I'm the built-in FlixML agent surface. I can use the same API shape OpenClaw uses: "
        "characters, image/video generation, projects, GPU nodes, and ai-toolkit LoRA training. "
        "For this hackathon demo I'm wired through assistant-ui; the next step is enabling tool execution for requests like"
        f" '{last_text or 'generate an image'}'."
    )
    return {"ok": True, "text": text}


@app.get("/api/characters")
async def characters(agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """List registered characters with their LoRAs, triggers, and voices (those the caller may use)."""
    items = await list_characters()
    if agent is not None and owner_scope(agent) is not None:
        items = [item for item in items if agent.can_use_character(item["id"])]
    return {"characters": items, "count": len(items)}


@app.get("/api/characters/{character_id}")
async def character_detail(character_id: str) -> dict[str, Any]:
    """Return a single character record by ID."""
    record = await get_character(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="Character not found")
    return record


@app.post("/api/characters", response_model=CharacterRecord)
async def create_character(character: CharacterRecord, agent: Agent | None = Depends(current_agent)) -> CharacterRecord:
    """Create or replace a character (idempotent by character id)."""
    if agent is not None:
        agent.require_characters([character.id])
    record = await upsert_character(character.model_dump())
    return CharacterRecord(**record)


@app.patch("/api/characters/{character_id}", response_model=CharacterRecord)
async def patch_character(character_id: str, patch: dict[str, Any]) -> CharacterRecord:
    """Update selected fields of an existing character."""
    current = await get_character(character_id)
    if not current:
        raise HTTPException(status_code=404, detail="Character not found")
    allowed = {"name", "kind", "trigger", "description", "source_images", "loras", "voice", "defaults", "metadata"}
    unknown = sorted(set(patch) - allowed)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unsupported character fields: {', '.join(unknown)}")
    current.update(patch)
    current["id"] = character_id
    record = await upsert_character(current)
    return CharacterRecord(**record)


@app.delete("/api/characters/{character_id}")
async def remove_character(character_id: str) -> dict[str, Any]:
    """Delete a character and its associated media rows."""
    deleted = await delete_character(character_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Character not found")
    return {"ok": True, "id": character_id}


@app.get("/api/characters/{character_id}/media")
async def character_media(character_id: str, offset: int = 0, limit: int = 60, agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """List media associated with a specific character."""
    scope = owner_scope(agent)
    total = await media_count(character_id=character_id, owner_id=scope)
    rows = await list_media(character_id=character_id, limit=limit, offset=offset, owner_id=scope)

    items = []
    for row in rows:
        filename = row.get("filename")
        if not filename:
            continue
        modified = row.get("modified") or row.get("updated_at") or row.get("created_at")
        mtime = modified.timestamp() if hasattr(modified, "timestamp") else (modified or 0)
        items.append({
            "name": Path(filename).name,
            "filename": filename,
            "type": row.get("type", "image"),
            "width": row.get("width", 0),
            "height": row.get("height", 0),
            "mtime": mtime,
            "url": f"/media/{filename}",
            "thumb": f"/api/thumb/{filename}",
            "prompt": row.get("prompt"),
            "prompt_id": row.get("prompt_id"),
            "character_ids": row.get("character_ids") or [],
            "tags": row.get("tags") or [],
            "included_in_training_dataset": row.get("included_in_training_dataset", False),
            "metadata": _parse_jsonb(row.get("metadata")),
        })

    return {"images": items, "total": total, "offset": offset, "limit": limit}


@app.get("/api/projects")
async def projects(limit: int = 100, agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """List projects with basic metadata and render counts."""
    items = await list_projects(limit, owner_id=owner_scope(agent))
    # Augment each project with render count from the renders table
    for item in items:
        item["render_count"] = len(await list_project_renders(item["id"]))
    return {"projects": items, "count": len(items)}


@app.post("/api/projects", response_model=ProjectRecord)
async def create_project(project: ProjectRecord, agent: Agent | None = Depends(current_agent)) -> ProjectRecord:
    """Create a new project (script) with title, aspect ratio, and cast."""
    record = _record_with_id(project, "prj")
    if agent is not None:
        existing = await get_project(record["id"])
        if existing and not owns(agent, existing.get("metadata")):
            raise HTTPException(status_code=409, detail="Project id already in use")
        record["metadata"] = {**(record.get("metadata") or {}), "owner_id": agent.id}
    saved = await upsert_project(record)
    return ProjectRecord(**saved)


@app.get("/api/projects/{project_id}")
async def project_detail(project_id: str) -> dict[str, Any]:
    """Return a project and all of its scenes and shots."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    scenes = await list_project_scenes(project_id)
    shots = await list_project_shots(project_id)
    return {"project": project, "scenes": scenes, "shots": shots}


@app.patch("/api/projects/{project_id}", response_model=ProjectRecord)
async def patch_project(project_id: str, patch: dict[str, Any]) -> ProjectRecord:
    """Update selected fields of an existing project."""
    current = await get_project(project_id)
    if not current:
        raise HTTPException(status_code=404, detail="Project not found")
    allowed = {"title", "description", "aspect_ratio", "duration_seconds", "status", "characters", "narrator_voice", "metadata"}
    unknown = sorted(set(patch) - allowed)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unsupported project fields: {', '.join(unknown)}")
    owner_id = (current.get("metadata") or {}).get("owner_id")
    current.update(patch)
    if owner_id:
        current["metadata"] = {**(current.get("metadata") or {}), "owner_id": owner_id}
    saved = await upsert_project(current)
    return ProjectRecord(**saved)


@app.delete("/api/projects/{project_id}")
async def remove_project(project_id: str) -> dict[str, Any]:
    """Delete a project and all its scenes, shots, and renders."""
    deleted = await delete_project(project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True, "id": project_id}


@app.get("/api/projects/{project_id}/scenes")
async def project_scenes(project_id: str) -> dict[str, Any]:
    """List all scenes belonging to a project."""
    if not await get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    scenes = await list_project_scenes(project_id)
    return {"scenes": scenes, "count": len(scenes)}


@app.post("/api/projects/{project_id}/scenes", response_model=SceneRecord)
async def create_project_scene(project_id: str, scene: SceneRecord) -> SceneRecord:
    """Add a scene to a project."""
    if not await get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    record = _record_with_id(scene, "scn", project_id=project_id)
    saved = await upsert_project_scene(record)
    return SceneRecord(**saved)


@app.patch("/api/projects/{project_id}/scenes/{scene_id}", response_model=SceneRecord)
async def patch_project_scene(project_id: str, scene_id: str, patch: dict[str, Any]) -> SceneRecord:
    """Update selected fields of a scene."""
    current = await get_project_scene(project_id, scene_id)
    if not current:
        raise HTTPException(status_code=404, detail="Scene not found")
    allowed = {"scene_number", "title", "setting", "weather", "summary", "location", "time_of_day", "characters", "metadata"}
    unknown = sorted(set(patch) - allowed)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unsupported scene fields: {', '.join(unknown)}")
    current.update(patch)
    saved = await upsert_project_scene(current)
    return SceneRecord(**saved)


@app.delete("/api/projects/{project_id}/scenes/{scene_id}")
async def remove_project_scene(project_id: str, scene_id: str) -> dict[str, Any]:
    """Delete a scene and all its shots."""
    deleted = await delete_project_scene(project_id, scene_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Scene not found")
    return {"ok": True, "id": scene_id}


@app.get("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/versions")
async def project_shot_versions(project_id: str, scene_id: str, shot_id: str) -> dict[str, Any]:
    """List all generated image/video versions for a shot."""
    if not await get_project_shot(project_id, scene_id, shot_id):
        raise HTTPException(status_code=404, detail="Shot not found")
    versions = await list_project_shot_versions(project_id, scene_id, shot_id)
    return {"versions": versions, "count": len(versions)}


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/versions/{version_id}/select", response_model=ShotRecord)
async def select_project_shot_version(project_id: str, scene_id: str, shot_id: str, version_id: str) -> ShotRecord:
    """Pick a completed version as the active image or video for a shot."""
    shot = await get_project_shot(project_id, scene_id, shot_id)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    version = await get_project_shot_version(project_id, scene_id, shot_id, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    if version.get("status") != "completed" or not version.get("file"):
        raise HTTPException(status_code=400, detail="Only completed versions with files can be selected")
    if version.get("kind") == "image":
        shot.update({"image_file": version["file"], "status": "image_ready", "video_file": None, "video_prompt_id": None})
    else:
        shot.update({"video_file": version["file"], "status": "video_ready"})
    saved = await upsert_project_shot(shot)
    return ShotRecord(**saved)


@app.get("/api/projects/{project_id}/scenes/{scene_id}/shots")
async def project_scene_shots(project_id: str, scene_id: str) -> dict[str, Any]:
    """List all shots in a scene."""
    if not await get_project_scene(project_id, scene_id):
        raise HTTPException(status_code=404, detail="Scene not found")
    shots = await list_project_shots(project_id, scene_id)
    return {"shots": shots, "count": len(shots)}


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots", response_model=ShotRecord)
async def create_project_shot(project_id: str, scene_id: str, shot: ShotRecord) -> ShotRecord:
    """Add a shot to a scene."""
    if not await get_project_scene(project_id, scene_id):
        raise HTTPException(status_code=404, detail="Scene not found")
    record = _record_with_id(shot, "sht", project_id=project_id, scene_id=scene_id)
    saved = await upsert_project_shot(record)
    return ShotRecord(**saved)


@app.patch("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}", response_model=ShotRecord)
async def patch_project_shot(project_id: str, scene_id: str, shot_id: str, patch: dict[str, Any]) -> ShotRecord:
    """Update selected fields of a shot."""
    current = await get_project_shot(project_id, scene_id, shot_id)
    if not current:
        raise HTTPException(status_code=404, detail="Shot not found")
    allowed = {"shot_number", "text", "description", "subtitle", "speaker", "image_prompt", "motion_prompt", "characters", "duration_seconds", "status", "image_file", "video_file", "image_prompt_id", "video_prompt_id", "workflow", "metadata"}
    unknown = sorted(set(patch) - allowed)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unsupported shot fields: {', '.join(unknown)}")
    current.update(patch)
    saved = await upsert_project_shot(current)
    return ShotRecord(**saved)


@app.delete("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}")
async def remove_project_shot(project_id: str, scene_id: str, shot_id: str) -> dict[str, Any]:
    """Delete a shot and all its versions."""
    deleted = await delete_project_shot(project_id, scene_id, shot_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Shot not found")
    return {"ok": True, "id": shot_id}


def _wan_resolution(aspect_ratio: str | None) -> tuple[int, int]:
    # Wan 2.2 I2V works best at 640x640 per official ComfyUI blueprint.
    # Override project aspect ratio to prevent distortion.
    return (640, 640)


async def _project_owner(project_id: str) -> str | None:
    """Shots and renders belong to whoever owns the project, whoever triggered them."""
    project = await get_project(project_id)
    return ((project or {}).get("metadata") or {}).get("owner_id")


def _character_bindings_from_ids(ids: list[str]) -> list[CharacterBinding]:
    return [CharacterBinding(id=item) for item in ids]


async def _project_character_ids(project_id: str, scene_id: str, shot: dict[str, Any]) -> list[str]:
    if shot.get("characters"):
        return shot["characters"]
    scene = await get_project_scene(project_id, scene_id)
    if scene and scene.get("characters"):
        return scene["characters"]
    project = await get_project(project_id)
    return project.get("characters", []) if project else []


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/generate-image", response_model=ImageGenerateResponse)
async def generate_project_shot_image(project_id: str, scene_id: str, shot_id: str, body: ShotGenerateRequest, agent: Agent | None = Depends(current_agent)) -> ImageGenerateResponse:
    """Generate an image for a project shot using its description/image_prompt and character LoRAs."""
    shot = await get_project_shot(project_id, scene_id, shot_id)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    if shot.get("status") in {"rendering_image", "animating"}:
        raise HTTPException(status_code=409, detail="Shot is already rendering")
    prompt = shot.get("description") or shot.get("image_prompt") or shot.get("text")
    if not prompt:
        raise HTTPException(status_code=400, detail="Shot description, image_prompt, or text is required")

    character_ids = await _project_character_ids(project_id, scene_id, shot)
    resolved = await _resolve_characters(None, _character_bindings_from_ids(character_ids))
    bindings = [binding for binding, _ in resolved]
    records = [record for _, record in resolved]
    resolved_prompt = _prompt_with_character_triggers(prompt, records)
    # Determine workflow from the shot (explicit, not inferred from characters)
    workflow = body.workflow
    if agent is not None:
        agent.require_workflow(workflow)
        agent.require_characters(character_ids)
        await agent.require_capacity()

    loras = _character_loras(records, workflow, bindings)
    if not loras:
        raise HTTPException(status_code=400, detail=f"No character LoRA resolved for workflow: {workflow}")

    version_number = await next_shot_version_number(shot_id, "image")
    version_id = _new_id("ver")
    filename_prefix = f"projects/{project_id}/scene-{shot.get('shot_number', 1):02d}-{shot_id}-image-v{version_number:02d}"

    service = GenerationService()

    workflow_params = {
        "loras": loras,
    }

    try:
        job_handle = await service.generate(
            workflow=workflow,
            prompt=resolved_prompt,
            provider=body.provider,
            filename_prefix=filename_prefix,
            workflow_params=workflow_params,
            owner_id=await _project_owner(project_id),
            extra_metadata={
                "project_id": project_id,
                "scene_id": scene_id,
                "shot_id": shot_id,
                "version_id": version_id,
                "output_role": "image",
            },
            submit=True,
        )
        prompt_id = job_handle.job_id  # type: ignore
    except WorkflowNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GenerationError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Project-specific side effects (not handled by service)
    await upsert_project_shot_version({
        "id": version_id,
        "project_id": project_id,
        "scene_id": scene_id,
        "shot_id": shot_id,
        "version_number": version_number,
        "kind": "image",
        "status": "pending",
        "prompt": resolved_prompt,
        "prompt_id": prompt_id,
        "metadata": {"character_ids": character_ids, "resolved_loras": loras},
    })
    shot.update({"status": "rendering_image", "image_prompt_id": prompt_id})
    await upsert_project_shot(shot)

    return ImageGenerateResponse(
        ok=True,
        workflow=workflow,
        lora_name=loras[0].get("name"),
        prompt_id=prompt_id,
    )


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/animate", response_model=VideoGenerateResponse)
async def animate_project_shot(project_id: str, scene_id: str, shot_id: str, body: ShotGenerateRequest, agent: Agent | None = Depends(current_agent)) -> VideoGenerateResponse:
    """Animate a project shot by generating a video from its selected/generated image."""
    shot = await get_project_shot(project_id, scene_id, shot_id)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    if shot.get("status") in {"rendering_image", "animating"}:
        raise HTTPException(status_code=409, detail="Shot is already rendering")
    prompt = shot.get("motion_prompt")
    if not prompt:
        raise HTTPException(status_code=400, detail="Shot motion_prompt is required")

    character_ids = await _project_character_ids(project_id, scene_id, shot)
    resolved = await _resolve_characters(None, _character_bindings_from_ids(character_ids))
    bindings = [binding for binding, _ in resolved]
    records = [record for _, record in resolved]

    if agent is not None:
        agent.require_workflow(body.workflow)
        agent.require_characters(character_ids)
        await agent.require_capacity()

    image = shot.get("image_file")
    await _require_readable(agent, image)
    if not image and resolved:
        image = _character_reference_image(bindings[0], records[0])
    if not image:
        raise HTTPException(status_code=400, detail="Shot image_file or character reference image is required")
    comfy_image = await _ensure_comfy_input_image(image, body.provider)

    project = await get_project(project_id)
    width, height = _wan_resolution(project.get("aspect_ratio") if project else None)

    version_number = await next_shot_version_number(shot_id, "video")
    version_id = _new_id("ver")
    filename_prefix = f"projects/{project_id}/scene-{shot.get('shot_number', 1):02d}-{shot_id}-video-v{version_number:02d}"

    service = GenerationService()
    workflow_params = {
        "image": comfy_image,
        "length": max(1, int(shot.get("duration_seconds") or 5) * 16),
        "fps": 16,
    }

    try:
        job_handle = await service.generate(
            workflow=body.workflow,
            prompt=prompt,
            provider=body.provider,
            width=width,
            height=height,
            filename_prefix=filename_prefix,
            workflow_params=workflow_params,
            owner_id=await _project_owner(project_id),
            extra_metadata={
                "project_id": project_id,
                "scene_id": scene_id,
                "shot_id": shot_id,
                "version_id": version_id,
                "output_role": "video",
                "source_image": image,
                "character_ids": character_ids,
            },
            submit=True,
        )
        prompt_id = job_handle.job_id
    except WorkflowNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GenerationError as e:
        raise HTTPException(status_code=502, detail=str(e))

    await upsert_project_shot_version({
        "id": version_id,
        "project_id": project_id,
        "scene_id": scene_id,
        "shot_id": shot_id,
        "version_number": version_number,
        "kind": "video",
        "status": "pending",
        "prompt": prompt,
        "prompt_id": prompt_id,
        "metadata": {"source_image": image, "character_ids": character_ids},
    })
    shot.update({"status": "animating", "video_prompt_id": prompt_id})
    await upsert_project_shot(shot)

    return VideoGenerateResponse(ok=True, mode="i2v", prompt_id=prompt_id)


def _srt_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


async def _set_render_status(project_id: str, status: str, error: str | None = None, final_video: str | None = None, render_id: str | None = None) -> None:
    # Update legacy metadata for backward compat (frontend watches this)
    project = await get_project(project_id)
    if project:
        meta = dict(project.get("metadata") or {})
        meta["render_status"] = status
        if error is not None:
            meta["render_error"] = error
        if final_video is not None:
            meta["final_video"] = final_video
        project["metadata"] = meta
        await upsert_project(project)

    # Update the proper project_renders record if we have a render_id
    if render_id:
        await upsert_project_render({
            "id": render_id,
            "project_id": project_id,
            "render_number": 0,  # not used on update
            "status": status,
            "final_video": final_video,
            "error_message": error,
        })


async def _probe_duration(path: Path) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    try:
        return float(stdout.decode().strip())
    except (ValueError, AttributeError):
        return 5.0


async def _probe_fps(path: Path) -> float | None:
    """Frame rate of a clip, or None if it can't be read.

    ffprobe reports r_frame_rate as a rational like ``16/1``.
    """
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    text = stdout.decode().strip()
    try:
        num, _, den = text.partition("/")
        value = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        return None
    return value if value > 0 else None


# Render master defaults. Shots are normalized to these before concat so clips
# with mismatched resolution / fps / audio can be stitched into one clean movie.
_RENDER_FPS = 25          # matches InfiniteTalk lip-sync output fps; avoids re-timing drift
_RENDER_A_RATE = 48000    # audio sample rate for the master track
_RENDER_A_LAYOUT = "stereo"


def _render_dimensions(aspect_ratio: str | None, base: int = 720) -> tuple[int, int]:
    """Derive an even-numbered master W×H from a project aspect ratio.

    Defaults to a square master (our footage is square). ``base`` is the short
    edge. Widescreen/portrait ratios scale the long edge off it.
    """
    ratio = (aspect_ratio or "1:1").strip()
    try:
        w_r, h_r = (float(x) for x in ratio.split(":", 1))
        if w_r <= 0 or h_r <= 0:
            raise ValueError
    except (ValueError, TypeError):
        w_r, h_r = 1.0, 1.0
    if w_r >= h_r:
        h = base
        w = round(base * (w_r / h_r))
    else:
        w = base
        h = round(base * (h_r / w_r))
    # x264 requires even dimensions
    return (w - (w % 2), h - (h % 2))


async def _has_audio(path: Path) -> bool:
    """True if the file has at least one audio stream."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
        "stream=codec_type", "-of", "csv=p=0", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    return b"audio" in stdout


def _drawtext_filter(subtitle_text: str) -> str:
    """Build a bottom-centered drawtext filter for a subtitle line."""
    import textwrap
    wrapped = "\n".join(textwrap.wrap(subtitle_text, width=32))
    safe_text = (
        wrapped
        .replace("\\", "\\\\")
        .replace("'", "'")
        .replace(":", "\\:")
        .replace("%", "\\%")
        .replace("\n", "\\n")
    )
    return (
        f"drawtext=text='{safe_text}'"
        f":fontsize=26:fontcolor=white:borderw=2:bordercolor=black"
        f":x=(w-text_w)/2:y=h-line_h*{wrapped.count(chr(10))+1}-50"
    )


async def _normalize_clip(
    dst: Path,
    target_w: int,
    target_h: int,
    *,
    video_src: Path | None = None,
    image_src: Path | None = None,
    duration: float = 5.0,
    subtitle_text: str = "",
    fps: float = _RENDER_FPS,
) -> tuple[bool, str]:
    """Re-encode one shot to the master format so clips can be concatenated.

    Normalizes video (scale+pad to target, setsar=1, fps, yuv420p) and audio
    (48k stereo). Clips with no audio track — image stills, silent i2v — get a
    synthesized silent track so every segment has matching streams. Returns
    (ok, stderr_tail).
    """
    inputs: list[str] = []
    if image_src is not None:
        inputs += ["-loop", "1", "-t", str(duration), "-i", str(image_src)]
        source_has_audio = False
    else:
        inputs += ["-i", str(video_src)]
        source_has_audio = await _has_audio(video_src)  # type: ignore[arg-type]

    vf = (
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,"
        f"setsar=1,fps={fps},format=yuv420p"
    )
    if subtitle_text:
        vf += "," + _drawtext_filter(subtitle_text)

    cmd = ["ffmpeg", "-y", *inputs]
    if source_has_audio:
        filter_complex = (
            f"[0:v]{vf}[v];"
            f"[0:a]aformat=sample_rates={_RENDER_A_RATE}:channel_layouts={_RENDER_A_LAYOUT}[a]"
        )
        cmd += ["-filter_complex", filter_complex, "-map", "[v]", "-map", "[a]"]
    else:
        # synthesize a silent track; -shortest clamps it to the video length
        cmd += [
            "-f", "lavfi", "-i",
            f"anullsrc=channel_layout={_RENDER_A_LAYOUT}:sample_rate={_RENDER_A_RATE}",
            "-filter_complex", f"[0:v]{vf}[v]",
            "-map", "[v]", "-map", "1:a", "-shortest",
        ]
    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-ar", str(_RENDER_A_RATE),
        str(dst),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        return False, stderr.decode(errors="replace")[-400:]
    return True, ""


async def _run_render(project_id: str, shots: list[dict[str, Any]], render_id: str) -> None:
    # Create the render record in the database
    render_number = await next_render_number(project_id)
    await upsert_project_render({
        "id": render_id,
        "project_id": project_id,
        "render_number": render_number,
        "status": "running",
    })

    out_path = (_OUTPUT_DIR / f"projects/{project_id}/render-{render_id}.mp4").resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Master format for this render, derived from the project aspect ratio.
    project = await get_project(project_id)
    target_w, target_h = _render_dimensions((project or {}).get("aspect_ratio"))

    # ── Normalize every shot to the master format ──
    # Mismatched resolution / fps / audio-sample-rate / audio-presence across
    # shots make a stream-copy concat break. Re-encode each shot to one uniform
    # format (video + audio, silent track synthesized where missing) so the
    # concat below is safe. Subtitles are burned in during this same pass.
    output_clips: list[Path] = []
    for idx, shot in enumerate(shots, start=1):
        subtitle_text = (shot.get("subtitle") or "").strip()
        norm_path = _OUTPUT_DIR / f"projects/{project_id}/render-{render_id}-shot{idx:02d}.mp4"
        video_file = shot.get("video_file")
        image_file = shot.get("image_file")

        if video_file:
            src = (_OUTPUT_DIR / video_file).resolve()
            if not src.is_file():
                await _set_render_status(project_id, "failed", f"Missing clip for shot {shot['id']}: {video_file}")
                return
            ok, err = await _normalize_clip(
                norm_path, target_w, target_h,
                video_src=src, subtitle_text=subtitle_text,
            )
        elif image_file:
            img_p = (_OUTPUT_DIR / image_file).resolve()
            if not img_p.is_file():
                continue  # skip shots with missing image
            ok, err = await _normalize_clip(
                norm_path, target_w, target_h,
                image_src=img_p, duration=float(shot.get("duration_seconds") or 5),
                subtitle_text=subtitle_text,
            )
        else:
            continue  # no media - skip

        if not ok:
            await _set_render_status(project_id, "failed", f"normalize failed shot {idx}: {err}")
            return
        output_clips.append(norm_path)

    if not output_clips:
        await _set_render_status(project_id, "failed", "No renderable clips found")
        return

    # ── Concatenate clips ──
    # Safe stream-copy concat: all clips are now uniform after normalization.
    concat_tmp = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, prefix="nemo_concat_")
    try:
        for p in output_clips:
            concat_tmp.write(f"file '{p}'\n")
        concat_tmp.flush()
        concat_path = concat_tmp.name
    finally:
        concat_tmp.close()

    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_path, "-c:v", "copy", "-c:a", "copy", str(out_path)]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    Path(concat_path).unlink(missing_ok=True)

    if proc.returncode != 0:
        err = stderr.decode(errors="replace")[-800:]
        await _set_render_status(project_id, "failed", err)
        return

    stat = out_path.stat()
    rel = str(out_path.relative_to(_OUTPUT_DIR))
    await upsert_media({
        "filename": rel,
        "type": "video",
        "size": stat.st_size,
        "workflow_type": "project_render",
        "prompt": project_id,
        "metadata": json.dumps({"owner_id": await _project_owner(project_id)}),
    })
    await _set_render_status(project_id, "completed", final_video=rel, render_id=render_id)


@app.post("/api/projects/{project_id}/render")
async def render_project(project_id: str, background_tasks: BackgroundTasks, agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """Assemble all completed shot images/videos into the final project video."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    scenes = await list_project_scenes(project_id)
    ordered_shots: list[dict[str, Any]] = []
    for scene in scenes:
        shots = await list_project_shots(project_id, scene["id"])
        ordered_shots.extend(shots)

    if not ordered_shots:
        raise HTTPException(status_code=400, detail="Project has no shots")

    renderable = [s for s in ordered_shots if s.get("video_file") or s.get("image_file")]
    if not renderable:
        raise HTTPException(status_code=400, detail="No shots have images or video to render")
    for shot in renderable:
        await _require_readable(agent, shot.get("video_file"))
        await _require_readable(agent, shot.get("image_file"))

    render_id = _new_id("rnd")
    meta = dict(project.get("metadata") or {})
    meta.update({"render_status": "rendering", "render_id": render_id, "render_error": None, "final_video": None})
    project["metadata"] = meta
    await upsert_project(project)

    background_tasks.add_task(_run_render, project_id, ordered_shots, render_id)
    return {"ok": True, "render_id": render_id, "shot_count": len(ordered_shots)}


@app.get("/api/tts/voices")
async def list_tts_voices() -> dict[str, Any]:
    """List available ElevenLabs voices for TTS."""
    voices = await _tts_voices()
    return {"voices": voices}


@app.post("/api/tts/generate", response_model=TTSGenerateResponse)
async def generate_tts(body: TTSGenerateRequest, agent: Agent | None = Depends(current_agent)) -> TTSGenerateResponse:
    """Speak a line and land it in the output dir as a wav.

    This is the front of the voiced-clip flow: pass the returned `audio` straight
    to POST /api/video/generate with an InfiniteTalk workflow, which bakes the
    voice in as lip-sync. Laying audio over a finished clip at assembly time is
    the wrong end — the mouth won't match.
    """
    voice_id = body.voice_id
    voice_settings = body.voice_settings

    if voice_id is None and body.character:
        if agent is not None:
            agent.require_characters([body.character])
        record = await get_character(body.character)
        if not record:
            raise HTTPException(status_code=404, detail=f"Character not found: {body.character}")
        voice = record.get("voice") or {}
        voice_id = voice.get("voice_id")
        voice_settings = voice_settings or voice.get("settings")

    if voice_id is None and body.project:
        project = await get_project(body.project)
        if not project or (owner_scope(agent) is not None and not owns(agent, project.get("metadata"))):
            raise HTTPException(status_code=404, detail=f"Project not found: {body.project}")
        voice = project.get("narrator_voice") or {}
        voice_id = voice.get("voice_id")
        voice_settings = voice_settings or voice.get("settings")

    if voice_id is None:
        voice_id = get_settings().elevenlabs_voice_id
    if not voice_id:
        raise HTTPException(
            status_code=400,
            detail="No voice to speak with: pass voice_id, give the character or project a voice, or set ELEVENLABS_VOICE_ID.",
        )

    prefix = _resolve_filename_prefix(body.filename_prefix, "voice")
    output_path = _OUTPUT_DIR / f"{prefix}.wav"

    try:
        ok, duration = await _generate_tts(body.text, output_path, voice_id, voice_settings)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"ElevenLabs rejected the request: {exc.response.text[:300]}") from exc
    if not ok:
        raise HTTPException(status_code=503, detail="TTS unavailable: no ElevenLabs API key configured.")

    audio = f"{prefix}.wav"
    return TTSGenerateResponse(
        ok=True,
        audio=audio,
        audio_url=f"/media/{audio}",
        duration=duration,
        voice_id=voice_id,
    )


@app.get("/api/projects/{project_id}/render")
async def render_project_status(project_id: str) -> dict[str, Any]:
    """Return the latest render status, final video URL, and history for a project."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    meta = project.get("metadata") or {}
    final_video = meta.get("final_video")
    renders = await list_project_renders(project_id)
    return {
        "status": meta.get("render_status", "none"),
        "render_id": meta.get("render_id"),
        "final_video": final_video,
        "final_video_url": f"/media/{final_video}" if final_video else None,
        "render_error": meta.get("render_error"),
        "renders": [
            {
                "id": r["id"],
                "render_number": r["render_number"],
                "final_video": r["final_video"],
                "final_video_url": f"/media/{r['final_video']}" if r["final_video"] else None,
                "created_at": r["created_at"],
                "status": r["status"],
                "error_message": r["error_message"],
            }
            for r in renders
        ],
    }


@app.delete("/api/projects/{project_id}/renders/{render_id}")
async def delete_project_render(project_id: str, render_id: str) -> dict[str, Any]:
    """Delete a project render record and its output file."""
    project = await get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    render = await get_project_render(project_id, render_id)
    if not render:
        raise HTTPException(status_code=404, detail="Render not found")
    # Delete the file if it exists
    if render.get("final_video"):
        target = _safe_output_path(render["final_video"])
        if target and target.is_file():
            target.unlink()
    await delete_project_render_row(render_id)
    return {"ok": True}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    """Report API health and how many configured ComfyUI nodes are reachable."""
    settings = get_settings()
    configured_nodes = settings.gpu_nodes()
    comfy_nodes = settings.comfy_nodes()
    online = 0
    for configured in comfy_nodes:
        with contextlib.suppress(Exception):
            await comfy(configured).get("/system_stats")
            online += 1
    return {
        "ok": True,
        "nodes_total": len(configured_nodes),
        "comfy_nodes_total": len(comfy_nodes),
        "comfy_nodes_online": online,
        "comfy_nodes_offline": len(comfy_nodes) - online,
    }




@app.get("/api/nodes")
async def nodes() -> dict[str, Any]:
    """Return configured GPU/ComfyUI node status for the Studio Nodes tab."""
    settings = get_settings()
    result: dict[str, Any] = {}
    for configured in settings.gpu_nodes():
        node: dict[str, Any] = {
            "id": configured.id,
            "label": configured.label,
            "roles": configured.roles,
            "online": False,
            "metadata": configured.metadata,
            "runtimes": {},
        }
        if configured.comfyui:
            client = comfy(configured)
            node["provider"] = f"local-{configured.id}"  # matches LocalComfyUIProvider.provider_id
            node["url"] = configured.comfyui.normalized_url
            node["client_id"] = configured.comfy_client_id
            node["runtimes"]["comfyui"] = {"url": configured.comfyui.normalized_url, "client_id": configured.comfy_client_id, "online": False}
            try:
                stats = await client.get("/system_stats")
                node["online"] = True
                node["runtimes"]["comfyui"]["online"] = True
                node["system"] = stats.get("system", {}) if isinstance(stats, dict) else {}
                devices = stats.get("devices", []) if isinstance(stats, dict) else []
                if devices:
                    dev = devices[0]
                    node.update({
                        "gpu_name": dev.get("name", "?"),
                        "vram_gb": round(dev.get("vram_total", 0) / 1_000_000_000, 1),
                        "vram_total": dev.get("vram_total", 0),
                        "vram_free": dev.get("vram_free", 0),
                        "torch_vram_total": dev.get("torch_vram_total", 0),
                        "torch_vram_free": dev.get("torch_vram_free", 0),
                    })
                with contextlib.suppress(Exception):
                    queue = await client.get("/queue")
                    node["queue_running"] = len(queue.get("queue_running", [])) if isinstance(queue, dict) else 0
                    node["queue_pending"] = len(queue.get("queue_pending", [])) if isinstance(queue, dict) else 0
            except Exception as exc:  # noqa: BLE001 - status endpoint should report offline, not fail the UI
                node["error"] = str(exc)
                node["runtimes"]["comfyui"]["error"] = str(exc)
        if configured.ai_toolkit:
            node["runtimes"]["ai_toolkit"] = configured.ai_toolkit.model_dump()
        result[configured.id] = node
    return {"nodes": result}


@app.get("/api/comfy/{path:path}")
async def comfy_get(path: str) -> Any:
    """Read-only passthrough for Comfy discovery endpoints: models, queue, object_info, history, etc."""
    allowed_roots = ("system_stats", "object_info", "models", "queue", "history", "prompt", "features", "view")
    if not path.startswith(allowed_roots):
        raise HTTPException(status_code=403, detail="Only read-only Comfy discovery/status paths are exposed here")
    return await comfy().get(f"/{path}")


@app.post("/api/images/upload")
async def upload_image(file: UploadFile = File(...), agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """Persist an uploaded image into the output dir so any workflow can reference it.

    Deliberately does NOT push to a ComfyUI node here. Node placement is decided at
    generate time by `_ensure_comfy_input_image`, which ships the file to the exact
    node running the job. Uploading to a node up front only works when image and job
    share a node — it silently breaks multi-node setups (e.g. i2v on a separate GPU).
    Landing the file in the output dir makes uploads behave like any gallery image.
    """
    suffix = Path(file.filename or "upload.png").suffix or ".png"
    name = f"upload_{uuid.uuid4().hex}{suffix}"
    target = _OUTPUT_DIR / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(await file.read())
    # Catalog it now, owned by the uploader, so the uploader can reference it in a job.
    width, height = _read_dimensions(target)
    await upsert_media({
        "filename": name,
        "type": _media_type_from_path(target),
        "width": width,
        "height": height,
        "size": target.stat().st_size,
        "modified": utc_from_timestamp(target.stat().st_mtime),
        "metadata": json.dumps({"owner_id": agent.id}) if agent else None,
    })
    return {"ok": True, "image": name, "filename": name}


@app.post("/api/video/generate", response_model=VideoGenerateResponse)
async def generate_video(body: VideoGenerateRequest, agent: Agent | None = Depends(current_agent)) -> VideoGenerateResponse:
    """Submit a single video generation job (t2v, i2v, or v2v)."""
    # Character resolution only supplies a fallback reference image for i2v.
    # Wan video takes identity from the image, so character triggers and character LoRAs
    # are not injected here. Model/LoRA names come from the workflow meta (override via a local/ meta).
    resolved = await _resolve_characters(body.character, body.characters)
    bindings = [binding for binding, _ in resolved]
    character_records = [record for _, record in resolved]
    prompt = body.prompt

    if body.mode is None:
        meta = get_registry().get(body.workflow)
        task = meta.task if meta else ""
        body.mode = "t2v" if task.startswith("text-") else "v2v" if task.startswith("video-") else "i2v"

    if agent is not None:
        agent.require_workflow(body.workflow)
        agent.require_characters([r.get("id") for r in character_records if r.get("id")])
        await agent.require_capacity()
    for reference in (body.image, body.video, body.audio):
        await _require_readable(agent, reference)

    image = body.image
    if body.mode == "i2v" and not image and resolved:
        image = _character_reference_image(bindings[0], character_records[0])
    if image:
        image = await _ensure_comfy_input_image(image, body.provider)

    filename_prefix = _resolve_filename_prefix(body.filename_prefix, "videos")

    if body.mode == "i2v" and not image:
        raise HTTPException(status_code=400, detail="image is required for i2v mode. Upload first with /api/images/upload or supply a character with a reference image.")

    service = GenerationService()

    # Only forward knobs the caller explicitly set. Anything left None falls through to the
    # workflow meta.json default (the single source of truth) — see WorkflowRegistry.build_workflow.
    workflow_params: dict[str, Any] = {}
    for _key in ("length", "fps", "steps_high", "steps_low", "cfg_high", "cfg_low", "shift", "sampler", "scheduler"):
        _val = getattr(body, _key)
        if _val is not None:
            workflow_params[_key] = _val
    if body.negative is not None:
        workflow_params["negative"] = body.negative

    workflow_name = body.workflow
    if body.mode == "i2v":
        workflow_params["image"] = image

    # Video-driven workflows (InfiniteTalk v2v: motion + lip-sync): stage the driving clip
    # to the run node the same way the image is staged, then hand VHS_LoadVideo the filename.
    if body.mode == "v2v":
        if not body.video:
            raise HTTPException(status_code=400, detail="video is required for v2v mode. Upload the driving motion clip first, then pass its filename.")
        workflow_params["video"] = await _ensure_comfy_input_video(body.video, body.provider)
        # Length is handled the author's way: the `length` meta default is a
        # generous frame cap, and MultiTalkWav2VecEmbeds internally clamps it to
        # the actual audio duration (min(num_frames, audio_frames)). The video is
        # then trimmed back to the audio track by VHS_VideoCombine's trim_to_audio.
        # No API-side derive needed — the graph + audio are the source of truth.

    # Audio-driven workflows (InfiniteTalk lip-sync): stage the wav to the run node the
    # same way the image is staged, then hand LoadAudio the resolved input filename.
    if body.audio:
        workflow_params["audio"] = await _ensure_comfy_input_audio(body.audio, body.provider)

    # Caller passthrough — overrides built-ins and workflow meta. Lets you swap or
    # neutralize workflow LoRAs (e.g. Lightning speed LoRA) per request without a new workflow.
    if body.workflow_params is not None:
        workflow_params.update(body.workflow_params)

    try:
        result = await service.generate(
            workflow=workflow_name,
            prompt=prompt,
            provider=body.provider,
            width=body.width,
            height=body.height,
            seed=body.seed,
            filename_prefix=filename_prefix,
            workflow_params=workflow_params,
            owner_id=agent.id if agent else None,
            extra_metadata={
                **body.model_dump(),
                "resolved_image": image,
                "character_ids": [record.get("id") for record in character_records],
            },
            submit=body.submit,
        )
    except WorkflowNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GenerationError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not body.submit:
        return VideoGenerateResponse(ok=True, mode=body.mode, workflow=result["workflow"])  # type: ignore[index]

    prompt_id = result.job_id  # type: ignore[union-attr]

    return VideoGenerateResponse(
        ok=True,
        mode=body.mode,
        prompt_id=prompt_id,
    )


def _extract_outputs(history: dict[str, Any], client: ComfyClient) -> list[JobOutput]:
    outputs: list[JobOutput] = []
    records = history.values() if isinstance(history, dict) else []
    for record in records:
        node_outputs = record.get("outputs", {}) if isinstance(record, dict) else {}
        for node_output in node_outputs.values():
            if not isinstance(node_output, dict):
                continue
            for key in ("video", "videos", "gifs", "images"):
                for item in node_output.get(key, []) or []:
                    filename = item.get("filename")
                    if not filename:
                        continue
                    # Type is determined solely by the file extension — the
                    # ComfyUI output slot name is NOT trusted (e.g. SaveVideo
                    # returns .mp4 under the "images" slot). No fallback: an
                    # unrecognized extension is labeled by _media_type_from_path
                    # as-is, so any mismatch surfaces loudly instead of hiding.
                    output_type = _media_type_from_path(Path(filename))
                    subfolder = item.get("subfolder", "")
                    folder_type = item.get("type", "output")
                    outputs.append(JobOutput(
                        type=output_type,
                        filename=filename,
                        subfolder=subfolder,
                        folder_type=folder_type,
                        url=client.view_url_sync(filename, subfolder=subfolder, folder_type=folder_type),
                    ))
    return outputs


def _extract_outputs_from_comfy_job(job: dict[str, Any], client: ComfyClient) -> list[JobOutput]:
    outputs = job.get("outputs", {}) if isinstance(job, dict) else {}
    if not isinstance(outputs, dict):
        return []
    return _extract_outputs({job.get("id", "job"): {"outputs": outputs}}, client)


def _relative_output_path(output: JobOutput) -> str:
    return f"{output.subfolder.strip('/')}/{output.filename}" if output.subfolder else output.filename


async def _download_output_if_missing(output: JobOutput) -> Path | None:
    rel = _relative_output_path(output)
    target = (_OUTPUT_DIR / rel).resolve()
    output_root = _OUTPUT_DIR.resolve()
    if not str(target).startswith(str(output_root)):
        return None
    if target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        async with httpx.AsyncClient(timeout=get_settings().request_timeout_seconds) as client:
            async with client.stream("GET", output.url) as response:
                response.raise_for_status()
                tmp = target.with_suffix(target.suffix + ".tmp")
                with tmp.open("wb") as fh:
                    async for chunk in response.aiter_bytes():
                        fh.write(chunk)
                tmp.replace(target)
        return target
    except Exception:
        target.unlink(missing_ok=True)
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.unlink(missing_ok=True)
        return None


async def _persist_outputs(prompt_id: str, outputs: list[JobOutput]) -> bool:
    """Download outputs from ComfyUI and persist to local storage + DB.

    Returns True if at least one file was successfully imported.
    """
    first_filename: str | None = None
    job_meta = await get_job(prompt_id) or {}
    for output in outputs:
        rel = _relative_output_path(output)
        target = await _download_output_if_missing(output)
        if not target or not target.is_file():
            continue
        first_filename = first_filename or rel
        width, height = _read_dimensions(target)
        stat = target.stat()
        await upsert_media({
            "filename": rel,
            "type": output.type,
            "width": width,
            "height": height,
            "size": stat.st_size,
            "modified": utc_from_timestamp(stat.st_mtime),
            "prompt": job_meta.get("prompt"),
            "steps": job_meta.get("steps"),
            "guidance": job_meta.get("guidance"),
            "sampler": job_meta.get("sampler"),
            "model": job_meta.get("model"),
            "vae": job_meta.get("vae"),
            "text_encoder": job_meta.get("text_encoder"),
            "loras": job_meta.get("loras"),
            "workflow_type": job_meta.get("mode"),
            "prompt_id": prompt_id,
            "source_image": job_meta.get("source_image"),
            "metadata": job_meta.get("metadata"),
        })
    if first_filename:
        await update_job_status(prompt_id, "completed", output_filename=first_filename)
        project_id = job_meta.get("project_id")
        scene_id = job_meta.get("scene_id")
        shot_id = job_meta.get("shot_id")
        output_role = job_meta.get("output_role")
        if project_id and scene_id and shot_id and output_role in {"image", "video"}:
            version_id = job_meta.get("version_id")
            if version_id:
                version = await get_project_shot_version(project_id, scene_id, shot_id, version_id)
                if version:
                    version.update({"status": "completed", "file": first_filename})
                    await upsert_project_shot_version(version)
            shot = await get_project_shot(project_id, scene_id, shot_id)
            if shot:
                if output_role == "image":
                    shot.update({"image_file": first_filename, "status": "image_ready", "video_file": None, "video_prompt_id": None})
                else:
                    shot.update({"video_file": first_filename, "status": "video_ready"})
                await upsert_project_shot(shot)
        return True
    return False


async def _clip_video_name(prompt_id: str, agent: Agent | None) -> str:
    """The video a finished job produced, named the way the output directory holds it."""
    record = await get_job(prompt_id)
    if not record or not owns(agent, record.get("metadata")):
        raise HTTPException(status_code=404, detail=f"No job {prompt_id}")

    # Outputs arrive as dicts off the job row and as JobOutput models off a live
    # reconcile, so normalise before reading either.
    def videos(items) -> list[dict[str, Any]]:
        rows = [i if isinstance(i, dict) else i.model_dump() for i in (items or [])]
        return [r for r in rows if str(r.get("filename", "")).lower().endswith(tuple(_VIDEO_SUFFIXES))]

    outputs = videos(record.get("outputs"))
    if not outputs:
        # A just-finished job may not have its outputs written to the row yet.
        outputs = videos((await _reconcile_job(prompt_id, record.get("provider")))["outputs"])
    if not outputs:
        raise HTTPException(status_code=409, detail=f"Job {prompt_id} has no video output yet")
    last = outputs[-1]
    subfolder = last.get("subfolder") or ""
    return f"{subfolder}/{last['filename']}" if subfolder else last["filename"]


async def _resolve_clip(ref: str, agent: Agent | None) -> Path:
    """Resolve a clip named by either prompt_id or filename to a local video file."""
    target = _resolve_output_file(ref)
    if target is None:
        target = _resolve_output_file(await _clip_video_name(ref, agent))
    if target is None:
        raise HTTPException(status_code=404, detail=f"No file {ref}")
    if target.suffix.lower() not in _VIDEO_SUFFIXES:
        raise HTTPException(status_code=422, detail=f"{ref} is not a video")
    return target


class LastFrameRequest(BaseModel):
    """Name the clip to take the last frame of, by job or by filename."""

    prompt_id: str | None = None
    video: str | None = None


class StitchRequest(BaseModel):
    """The clips to join, in playing order, named by prompt_id or by filename."""

    clips: list[str]


@app.post("/api/video/last-frame")
async def video_last_frame(body: LastFrameRequest, agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """Extract a clip's final frame as an image, so the next shot can start where it ended.

    Chaining shots this way is what turns separate clips into one continuous take:
    animate a start frame, take the last frame of the result, animate that. Without it
    a caller would have to download the video, run ffmpeg itself and upload the frame
    back, which a remote agent cannot do at all.

    The frame is cataloged like an upload, so it appears in the gallery and can be
    passed straight back as `image` — or edited first, if the next shot needs a change
    that motion alone can't make.
    """
    source = body.video or (await _clip_video_name(body.prompt_id, agent) if body.prompt_id else None)
    if not source:
        raise HTTPException(status_code=422, detail="Pass prompt_id or video")

    target = await _resolve_clip(source, agent)

    name = f"lastframe_{uuid.uuid4().hex}.png"
    out_path = _OUTPUT_DIR / name

    # -sseof seeks relative to the end; -update rewrites the same file for every frame
    # decoded after that point, so the file left behind is the final one. Clips shorter
    # than the seek window decode nothing, so fall back to reading the whole clip.
    async def extract(seek: str | None) -> bool:
        cmd = ["ffmpeg", "-y", "-loglevel", "error"]
        if seek:
            cmd += ["-sseof", seek]
        cmd += ["-i", str(target), "-update", "1", "-q:v", "1", str(out_path)]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            logger.warning("last-frame ffmpeg failed for %s: %s", source, err.decode()[:300])
        return proc.returncode == 0 and out_path.is_file()

    if not await extract("-1") and not await extract(None):
        raise HTTPException(status_code=500, detail=f"Could not read a frame from {source}")

    width, height = _read_dimensions(out_path)
    await upsert_media({
        "filename": name,
        "type": _media_type_from_path(out_path),
        "width": width,
        "height": height,
        "size": out_path.stat().st_size,
        "modified": utc_from_timestamp(out_path.stat().st_mtime),
        "metadata": json.dumps({"owner_id": agent.id, "last_frame_of": source} if agent else {"last_frame_of": source}),
    })
    return {"ok": True, "filename": name, "image": name, "source": source, "width": width, "height": height}


@app.post("/api/video/stitch")
async def video_stitch(body: StitchRequest, agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """Join finished clips into one video, in the order given.

    The other half of shot chaining: last-frame lets each clip start where the last
    one ended, and this puts them back together as a single take. A project render
    does the same thing for a whole movie, but building a project to join two clips
    is more scaffolding than the job needs.

    Clips are normalised to the first one's frame size and frame rate before
    concatenation, so mismatched shots join without the stream-copy artefacts that a
    raw concat produces. The first clip sets the rate because resampling generated
    footage to some other number duplicates frames unevenly and shows up as judder in
    exactly the motion the clip was made for.
    """
    if len(body.clips) < 2:
        raise HTTPException(status_code=422, detail="Pass at least two clips")

    sources = [await _resolve_clip(ref, agent) for ref in body.clips]
    target_w, target_h = _read_dimensions(sources[0])
    if not target_w or not target_h:
        raise HTTPException(status_code=422, detail=f"Could not read the size of {body.clips[0]}")

    target_fps = await _probe_fps(sources[0]) or _RENDER_FPS

    name = f"videos/stitch_{uuid.uuid4().hex}.mp4"
    out_path = _OUTPUT_DIR / name
    out_path.parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="flixml_stitch_"))
    try:
        normalised: list[Path] = []
        for index, source in enumerate(sources):
            dst = work / f"{index:03d}.mp4"
            ok, err = await _normalize_clip(dst, target_w, target_h, video_src=source, fps=target_fps)
            if not ok:
                raise HTTPException(status_code=500, detail=f"Could not prepare {body.clips[index]}: {err[-300:]}")
            normalised.append(dst)

        listing = work / "concat.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in normalised))
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", str(listing),
            "-c:v", "copy", "-c:a", "copy", str(out_path),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, err_bytes = await proc.communicate()
        if proc.returncode != 0 or not out_path.is_file():
            raise HTTPException(status_code=500, detail=f"Could not join the clips: {err_bytes.decode(errors='replace')[-300:]}")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    stat = out_path.stat()
    await upsert_media({
        "filename": name,
        "type": "video",
        "width": target_w,
        "height": target_h,
        "size": stat.st_size,
        "modified": utc_from_timestamp(stat.st_mtime),
        "workflow_type": "stitch",
        "metadata": json.dumps(
            {"owner_id": agent.id, "stitched_from": body.clips} if agent else {"stitched_from": body.clips}
        ),
    })
    return {
        "ok": True,
        "filename": name,
        "clips": body.clips,
        "width": target_w,
        "height": target_h,
        "duration": round(await _probe_duration(out_path), 2),
    }


@app.get("/api/jobs")
async def jobs(include_completed: bool = True, agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """Return jobs from durable Postgres state — a pure DB read, no live ComfyUI calls.

    `_reconcile_loop` keeps these rows current in the background. This endpoint is
    polled every few seconds by the gallery to render the "generating" lane, so it must
    never call into a ComfyUI node itself: a saturated node (mid model-load) stops
    answering HTTP, and per-job round-trips would then hang the whole endpoint until it
    times out — blanking the lane even though jobs are actively running.
    """
    db_jobs = await list_jobs(limit=100, owner_id=owner_scope(agent))

    if not include_completed:
        db_jobs = [job for job in db_jobs if job.get("status") not in {"completed", "failed"}]

    jobs_list = sorted(
        db_jobs,
        key=lambda j: (j.get("status") != "running", j.get("queue_position") or 0, str(j.get("created_at") or "")),
    )
    return {"jobs": jobs_list, "count": len(jobs_list)}


@app.get("/api/jobs/{prompt_id}", response_model=JobStatusResponse)
async def job(prompt_id: str) -> JobStatusResponse:
    """Get status, outputs and provenance for a single job, reconciled live against its node."""
    record = await get_job(prompt_id) or {}
    provider = record.get("provider")  # _job_row flattens metadata keys to top level
    result = await _reconcile_job(prompt_id, provider)
    status = result["status"]
    return JobStatusResponse(
        ok=True,
        prompt_id=prompt_id,
        status=status,
        progress=100.0 if status == "completed" else None,
        outputs=result["outputs"],
        raw=result["raw"],
        # _job_row already merges the jobs columns, the models and LoRAs read back
        # from the submitted graph, and the metadata saved at submit time.
        workflow=record.get("workflow"),
        provider=provider,
        prompt=record.get("prompt"),
        negative_prompt=record.get("negative_prompt"),
        # The staged filename the node actually loaded, not the caller's spelling of it.
        image=record.get("resolved_image") or record.get("image"),
        models=record.get("models") or [],
        loras=record.get("loras") or [],
        seed=record.get("seed"),
        width=record.get("width") or None,
        height=record.get("height") or None,
        workflow_params=record.get("workflow_params"),
        error=record.get("error"),
        started_at=record.get("started_at"),
        finished_at=record.get("finished_at"),
    )


import os

import yaml

from fastapi.responses import FileResponse, Response

_OUTPUT_DIR = Path(get_settings().output_dir)
_ALLOW_EXT = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".gif"}


def _resolve_filename_prefix(prefix: str | None, subfolder: str) -> str:
    """Return a unique filename prefix.

    If prefix is None, generate a random 8-char hex ID under subfolder.
    If prefix is provided, raise 409 if any file with that prefix already exists locally.
    """
    if prefix is None:
        return f"{subfolder}/{uuid.uuid4().hex[:8]}"
    safe = prefix.strip().lstrip("/")
    existing = list((_OUTPUT_DIR / safe).parent.glob(f"{(_OUTPUT_DIR / safe).name}*"))
    if existing:
        raise HTTPException(status_code=409, detail=f"Filename prefix '{safe}' already exists - choose a different name.")
    return safe
_TRAINING_DIR_VAL = os.environ.get("FLIXML_TRAINING_DIR")
if not _TRAINING_DIR_VAL:
    raise RuntimeError("FLIXML_TRAINING_DIR environment variable is required")
_TRAINING_DIR = Path(_TRAINING_DIR_VAL)
_TRAINING_CONFIG_DIR = _TRAINING_DIR / "config"
# Droplet paths - these live on the GPU worker, referenced by name only from the VPS.
_DROPLET_TRAINING_DIR = Path("/root/flixml-training")
_DROPLET_OUTPUT_DIR = _DROPLET_TRAINING_DIR / "output"
_DROPLET_LOGS_DIR = _DROPLET_TRAINING_DIR / "logs"
_DROPLET_DATASETS_DIR = _DROPLET_TRAINING_DIR / "datasets"
_AITK_API_URL = get_settings().aitk_api_url
_AITK_AUTH_TOKEN = os.environ.get("AITK_API_TOKEN")
if not _AITK_AUTH_TOKEN:
    raise RuntimeError("AITK_API_TOKEN environment variable is required")
_AITK_GPU_IDS = os.environ.get("AITK_GPU_IDS", "0")


def _aitk_headers() -> dict[str, str]:
    if _AITK_AUTH_TOKEN:
        return {"Authorization": f"Bearer {_AITK_AUTH_TOKEN}"}
    return {}


# Local VPS paths for LoRA checkpoints synced from the droplet.
_LORA_OUTPUT_DIR_VAL = os.environ.get("FLIXML_LORA_OUTPUT_DIR")
if not _LORA_OUTPUT_DIR_VAL:
    raise RuntimeError("FLIXML_LORA_OUTPUT_DIR environment variable is required")
_LORA_OUTPUT_DIR = Path(_LORA_OUTPUT_DIR_VAL)
_COMFY_LORA_DIR_VAL = os.environ.get("FLIXML_COMFY_LORA_DIR")
if not _COMFY_LORA_DIR_VAL:
    raise RuntimeError("FLIXML_COMFY_LORA_DIR environment variable is required")
_COMFY_LORA_DIR = Path(_COMFY_LORA_DIR_VAL)
_TRAINING_SAMPLES_DIR = _OUTPUT_DIR / "samples"


async def _fetch_sample_from_droplet(droplet_path: str, vps_dest: Path) -> bool:
    """Download a single sample image from the droplet to the VPS."""
    if vps_dest.exists():
        return True  # already synced
    encoded = quote(droplet_path, safe="")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{_AITK_API_URL}/api/img/{encoded}",
                headers=_aitk_headers(),
            )
            if resp.status_code == 200:
                vps_dest.parent.mkdir(parents=True, exist_ok=True)
                vps_dest.write_bytes(resp.content)
                return True
    except Exception:
        pass
    return False


async def _sync_training_samples(job_name: str) -> list[str]:
    """Fetch sample paths from ai-toolkit and sync the images to the VPS.

    Returns the list of VPS-relative paths for successfully synced samples.
    """
    aitk_job = await _aitk_job_by_ref(job_name)
    if not aitk_job:
        db_job = await get_training_job(job_name)
        return (db_job.get("metadata") or {}).get("sample_paths", []) if db_job else []

    aitk_id = aitk_job["id"]
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{_AITK_API_URL}/api/jobs/{aitk_id}/samples",
                headers=_aitk_headers(),
            )
            if resp.status_code != 200:
                return []
            droplet_paths = resp.json().get("samples", [])
    except Exception:
        return []

    vps_rel_paths: list[str] = []
    for dp in droplet_paths:
        filename = Path(dp).name
        vps_rel = f"samples/{job_name}/{filename}"
        vps_abs = _OUTPUT_DIR / vps_rel
        if await _fetch_sample_from_droplet(dp, vps_abs):
            vps_rel_paths.append(vps_rel)

    # Cache the VPS-relative paths in DB metadata
    if vps_rel_paths:
        await update_training_job_status(
            job_name, aitk_job.get("status", "running"),
            metadata={"sample_paths": vps_rel_paths},
        )
    return vps_rel_paths


async def _aitk_job_by_ref(job_name: str) -> dict[str, Any] | None:
    """Look up an ai-toolkit job by job_ref (our job_name)."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{_AITK_API_URL}/api/jobs",
                params={"job_ref": job_name},
                headers=_aitk_headers(),
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception:
        pass
    return None


def _build_training_config(request: LoraTrainingStartRequest) -> tuple[Path, dict[str, Any]]:
    template_path = _TRAINING_DIR / f"{request.base_config}_template.yaml"
    if not template_path.is_file():
        raise HTTPException(status_code=400, detail=f"Unknown base_config '{request.base_config}': no {template_path.name} in training dir")

    config = yaml.safe_load(template_path.read_text())
    job_name = request.job_name
    trigger = request.trigger_word
    process = config["config"]["process"][0]

    # --- Job identity ---------------------------------------------------------
    config["config"]["name"] = job_name
    process["trigger_word"] = trigger
    process["training_folder"] = str(_DROPLET_OUTPUT_DIR)

    # --- Model ----------------------------------------------------------------
    model_sec = process["model"]
    model_sec["name_or_path"] = request.model_name_or_path
    model_sec["low_vram"] = request.low_vram
    model_sec.setdefault("model_kwargs", {})
    if request.layer_offloading:
        model_sec["model_kwargs"]["layer_offloading"] = True
    model_sec["quantize"] = request.transformer_quantization != "none"
    if request.transformer_quantization != "none":
        model_sec["qtype"] = request.transformer_quantization
    model_sec["quantize_te"] = request.te_quantization != "none"
    if request.te_quantization != "none":
        model_sec["qtype_te"] = request.te_quantization

    # --- Target (LoRA) --------------------------------------------------------
    process["network"]["linear"] = request.lora_rank
    process["network"]["linear_alpha"] = request.lora_rank

    # --- Training -------------------------------------------------------------
    train_sec = process["train"]
    train_sec["steps"] = request.steps
    train_sec["lr"] = request.learning_rate
    train_sec["batch_size"] = request.batch_size
    train_sec["gradient_accumulation_steps"] = request.gradient_accumulation
    train_sec["optimizer"] = request.optimizer
    train_sec.setdefault("optimizer_params", {})
    train_sec["optimizer_params"]["weight_decay"] = request.weight_decay
    train_sec["timestep_type"] = request.timestep_type
    # Auto cache_text_embeddings: True unless DOP enabled
    if request.cache_text_embeddings is None:
        train_sec["cache_text_embeddings"] = not request.dop_enabled
    else:
        train_sec["cache_text_embeddings"] = request.cache_text_embeddings
    train_sec["unload_text_encoder"] = request.unload_text_encoder

    # --- Dataset --------------------------------------------------------------
    datasets = process.get("datasets", [])
    if datasets:
        ds = datasets[0]
        # Dataset lives on the droplet - use droplet path
        ds["folder_path"] = str(_DROPLET_DATASETS_DIR / request.dataset)
        ds["resolution"] = request.resolution
        ds["caption_dropout_rate"] = request.caption_dropout_rate
        ds["cache_latents_to_disk"] = request.cache_latents

    # --- Regularization (DOP) -------------------------------------------------
    if request.dop_enabled:
        process["differential_output_preservation"] = {
            "enabled": True,
            "trigger_word": trigger,
            "preservation_class": request.preservation_class,
        }
    elif "differential_output_preservation" in process:
        del process["differential_output_preservation"]

    # --- Advanced -------------------------------------------------------------
    process.setdefault("advanced", {})
    process["advanced"]["differential_guidance"] = request.differential_guidance
    process["advanced"]["differential_guidance_scale"] = request.differential_guidance_scale

    # --- Logging (always enable UILogger for progress tracking) ---------------
    process["logging"] = {"use_ui_logger": True}

    # --- Sampling -------------------------------------------------------------
    sample_sec = process["sample"]
    sample_sec["sample_every"] = request.sample_every
    sample_sec["sample_steps"] = request.sample_steps
    sample_sec["width"] = request.sample_width
    sample_sec["height"] = request.sample_height
    sample_sec["guidance_scale"] = request.sample_guidance_scale
    sample_sec["seed"] = request.sample_seed
    sample_sec["prompts"] = request.sample_prompts

    # --- Write config ---------------------------------------------------------
    output_path = _TRAINING_CONFIG_DIR / f"{job_name}.yaml"
    _TRAINING_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    output_path.write_text(yaml.dump(config, default_flow_style=False, sort_keys=False))

    return output_path, config


def _safe_output_path(rel: str) -> Path | None:
    target = (_OUTPUT_DIR / rel).resolve()
    if not str(target).startswith(str(_OUTPUT_DIR.resolve())):
        return None
    return target


def _read_dimensions(path: Path) -> tuple[int, int]:
    """Read a media file's real pixel size with ffprobe, for images and video alike.

    ffprobe ships with the ffmpeg install this app already requires, so this needs
    nothing extra installed. It replaced a Pillow import that was never declared as a
    dependency — it raised ModuleNotFoundError on a clean install and the except
    swallowed it, so every image in the library was stored 0x0 — and a hardcoded
    1280x720 for video, which reported portrait clips as landscape.
    """
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0:s=x",
                str(path),
            ],
            capture_output=True, text=True, timeout=20,
        )
        width, _, height = proc.stdout.strip().partition("x")
        return int(width), int(height)
    except Exception as exc:
        # Expected while a file is still being imported: ffprobe reads nothing from a
        # half-written mp4. The reconcile cycle reads it again once the copy lands, so
        # this is one line rather than a traceback per poll.
        logger.warning("could not read dimensions of %s: %s", path, exc)
        return 0, 0




@app.post("/api/lora-training/start", response_model=LoraTrainingStartResponse)
async def lora_training_start(body: LoraTrainingStartRequest) -> LoraTrainingStartResponse:
    """Build the training config locally, then enqueue and start via ai-toolkit UI API."""
    config_path, config_dict = _build_training_config(body)

    job_name = body.job_name
    output_dir = str(_DROPLET_OUTPUT_DIR / job_name)

    await save_training_job(
        job_name,
        status="pending",
        config_path=str(config_path),
        log_path="",
        output_dir=output_dir,
        dataset=body.dataset,
        trigger_word=body.trigger_word,
        model=body.model,
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Create job in ai-toolkit queue
            create_resp = await client.post(
                f"{_AITK_API_URL}/api/jobs",
                json={
                    "name": job_name,
                    "gpu_ids": _AITK_GPU_IDS,
                    "job_config": config_dict,
                    "job_ref": job_name,
                    "job_type": "train",
                },
                headers=_aitk_headers(),
            )
            if create_resp.status_code == 409:
                # Already exists - fetch it
                existing = await client.get(
                    f"{_AITK_API_URL}/api/jobs",
                    params={"job_ref": job_name},
                    headers=_aitk_headers(),
                )
                existing.raise_for_status()
                aitk_job = existing.json()
            else:
                create_resp.raise_for_status()
                aitk_job = create_resp.json()

            aitk_id = aitk_job["id"]

            # Start the job (sets it to "queued")
            start_resp = await client.get(
                f"{_AITK_API_URL}/api/jobs/{aitk_id}/start",
                headers=_aitk_headers(),
            )
            start_resp.raise_for_status()

            # Start the queue so the worker actually processes the job
            queue_resp = await client.get(
                f"{_AITK_API_URL}/api/queue/{_AITK_GPU_IDS}/start",
                headers=_aitk_headers(),
            )
            queue_resp.raise_for_status()

        await update_training_job_status(job_name, "running")
        return LoraTrainingStartResponse(
            ok=True,
            job_name=job_name,
            status="running",
            config_path=str(config_path),
            output_dir=output_dir,
        )
    except Exception as exc:
        await update_training_job_status(job_name, "failed", error=str(exc))
        return LoraTrainingStartResponse(
            ok=False,
            job_name=job_name,
            status="failed",
            config_path=str(config_path),
            output_dir=output_dir,
            error=str(exc),
        )


@app.get("/api/lora-training/status", response_model=LoraTrainingStatus)
async def lora_training_status(job_name: str | None = None) -> LoraTrainingStatus:
    """Fetch the latest status, step count, ETA, and synced samples for a LoRA training job."""
    updated_at = datetime.now(UTC).isoformat()

    # Resolve job_name from our DB if not provided
    if not job_name:
        db_job = await get_latest_training_job()
        job_name = db_job["job_name"] if db_job else None

    if not job_name:
        return LoraTrainingStatus(
            ok=False,
            status="no_job",
            job_name=None,
            updated_at=updated_at,
            error="No training job found",
        )

    db_job = await get_training_job(job_name) if job_name else await get_latest_training_job()
    db_status = db_job.get("status", "configured") if db_job else "configured"
    started_at = (db_job.get("created_at").isoformat() if db_job and db_job.get("created_at") else None)

    aitk_job = await _aitk_job_by_ref(job_name)
    if aitk_job:
        # Sync any new samples from the droplet to the VPS
        await _sync_training_samples(job_name)

        step = aitk_job.get("step") or 0
        # Derive total_steps from job_config
        try:
            jc = json.loads(aitk_job.get("job_config") or "{}")
            total = jc.get("config", {}).get("process", [{}])[0].get("train", {}).get("steps", 0)
        except Exception:
            total = 0
        progress = round((step / total) * 100, 1) if total and step else None

        # Parse ETA from speed_string (format: "Xs/it" or "Xit/s")
        eta: str | None = None
        speed_string = aitk_job.get("speed_string")
        seconds_per_step: float | None = None
        if speed_string and total and step:
            m = re.search(r"([\d.]+)\s*s/it", speed_string)
            if m:
                sps = float(m.group(1))
                seconds_per_step = sps
                remaining = int((total - step) * sps)
                h, rem = divmod(remaining, 3600)
                mi, s = divmod(rem, 60)
                eta = f"{h}:{mi:02d}:{s:02d}" if h else f"{mi}:{s:02d}"

        aitk_status = aitk_job.get("status", db_status)
        return LoraTrainingStatus(
            ok=True,
            status=aitk_status,
            job_name=job_name,
            current_step=step,
            total_steps=total,
            progress_percent=progress,
            info=aitk_job.get("info"),
            speed_string=speed_string,
            seconds_per_step=seconds_per_step,
            eta=eta,
            updated_at=updated_at,
            started_at=started_at,
        )

    return LoraTrainingStatus(
        ok=True,
        status=db_status,
        job_name=job_name,
        updated_at=updated_at,
        started_at=started_at,
    )


def _lora_checkpoint_path(checkpoint: str, output_dir: Path | None = None) -> Path:
    od = output_dir or _LORA_OUTPUT_DIR
    if checkpoint == "latest":
        candidates = sorted(
            od.glob("*.safetensors"),
            key=lambda path: path.stat().st_mtime,
        ) if od.is_dir() else []
        if not candidates:
            raise HTTPException(status_code=404, detail="No LoRA checkpoints found")
        return candidates[-1]

    path = Path(checkpoint)
    if not path.is_absolute():
        path = od / checkpoint
    try:
        resolved = path.resolve()
        output_root = od.resolve()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid checkpoint path: {checkpoint}") from exc
    if not str(resolved).startswith(str(output_root)):
        raise HTTPException(status_code=400, detail="Checkpoint must be inside the LoRA output directory")
    if resolved.suffix != ".safetensors" or not resolved.is_file():
        raise HTTPException(status_code=404, detail="LoRA checkpoint not found")
    return resolved


def _comfy_lora_name_for_checkpoint(path: Path) -> str:
    _COMFY_LORA_DIR.mkdir(parents=True, exist_ok=True)
    link_path = _COMFY_LORA_DIR / path.name
    if not link_path.exists():
        link_path.symlink_to(path)
    return f"{_COMFY_LORA_DIR.name}/{path.name}"


@app.post("/api/image/generate", response_model=ImageGenerateResponse)
async def generate_image(body: ImageGenerateRequest, agent: Agent | None = Depends(current_agent)) -> ImageGenerateResponse:
    """Submit a single image generation job."""
    resolved = await _resolve_characters(body.character, body.characters)
    bindings = [binding for binding, _ in resolved]
    character_records = [record for _, record in resolved]

    if agent is not None:
        agent.require_workflow(body.workflow)
        agent.require_characters([r.get("id") for r in character_records if r.get("id")])
        await agent.require_capacity()
    await _require_readable(agent, body.image)

    # Character presets (checkpoint, cfg/steps/sampler/scheduler, negative prompt,
    # resolution, look description) apply whenever the request doesn't explicitly
    # override them. Only the first resolved character's defaults are used —
    # multi-character requests must set params explicitly.
    character_defaults = CharacterDefaults(**(character_records[0].get("defaults") or {})) if character_records else CharacterDefaults()
    character_base_prompt = character_records[0].get("base_prompt") if character_records else None

    # Prepend base_prompt (the character's look description) first, then run
    # trigger-word injection on the combined text — base_prompt already names
    # the character, so this stops the trigger word from being duplicated as
    # an orphaned trigger-word fragment between base_prompt and the scene prompt.
    prompt = body.prompt
    if character_base_prompt and character_base_prompt.lower() not in prompt.lower():
        prompt = f"{character_base_prompt}, {prompt}"
    prompt = _prompt_with_character_triggers(prompt, character_records)
    loras = _character_loras(character_records, body.workflow, bindings)

    checkpoint_name: str | None = None
    checkpoint_lora_name: str | None = None
    if body.lora_checkpoint:
        checkpoint_path = _lora_checkpoint_path(body.lora_checkpoint)
        checkpoint_name = checkpoint_path.name
        checkpoint_lora_name = _comfy_lora_name_for_checkpoint(checkpoint_path)
        loras.insert(0, {"name": checkpoint_lora_name, "strength": body.lora_strength, "checkpoint": checkpoint_name})

    filename_prefix = _resolve_filename_prefix(body.filename_prefix, "images")

    resolved_lora_name = checkpoint_lora_name or (loras[0].get("name") if loras else None)

    # Resolve each tunable field: explicit request value > character preset > workflow's own default (unset here).
    resolved_model = body.checkpoint if body.checkpoint is not None else character_defaults.preferred_checkpoint
    resolved_width = body.width if body.width is not None else character_defaults.image_width
    resolved_height = body.height if body.height is not None else character_defaults.image_height
    resolved_steps = body.steps if body.steps is not None else character_defaults.steps
    resolved_cfg = body.cfg if body.cfg is not None else character_defaults.cfg
    resolved_sampler = body.sampler if body.sampler is not None else character_defaults.sampler
    resolved_scheduler = body.scheduler if body.scheduler is not None else character_defaults.scheduler
    resolved_negative = body.negative if body.negative is not None else character_defaults.negative_prompt

    # Use GenerationService for workflow build + submit + DB save
    service = GenerationService()

    # Build workflow-specific params (only pass what the workflow builder accepts).
    # Omitting a key (rather than passing None) lets the workflow's own meta.json
    # default apply when neither the request nor the character preset set it.
    workflow_params: dict[str, Any] = {
        "loras": loras,
        "lora_strength": body.lora_strength,
    }
    if resolved_steps is not None:
        workflow_params["steps"] = resolved_steps
    if resolved_cfg is not None:
        workflow_params["cfg"] = resolved_cfg
    if resolved_sampler is not None:
        workflow_params["sampler"] = resolved_sampler
    if resolved_scheduler is not None:
        workflow_params["scheduler"] = resolved_scheduler

    workflow_params["guidance"] = body.guidance
    if resolved_negative is not None:
        workflow_params["negative_prompt"] = resolved_negative
    if body.unet is not None:
        workflow_params["unet"] = body.unet
    if body.clip is not None:
        workflow_params["clip"] = body.clip
    if body.vae is not None:
        workflow_params["vae"] = body.vae
    if body.denoise is not None:
        workflow_params["denoise"] = body.denoise
    if resolved_model is not None:
        workflow_params["checkpoint"] = resolved_model
    if body.image is not None:
        workflow_params["image"] = await _ensure_comfy_input_image(body.image, body.provider)
    if body.workflow_params is not None:
        workflow_params.update(body.workflow_params)

    try:
        result = await service.generate(
            workflow=body.workflow,
            prompt=prompt,
            provider=body.provider,
            width=resolved_width,
            height=resolved_height,
            seed=body.seed,
            filename_prefix=filename_prefix,
            workflow_params=workflow_params,
            owner_id=agent.id if agent else None,
            submit=body.submit,
        )
    except WorkflowNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GenerationError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not body.submit:
        return ImageGenerateResponse(
            ok=True,
            workflow=body.workflow,
            checkpoint=checkpoint_name,
            lora_name=resolved_lora_name,
            graph=result["workflow"],  # type: ignore
        )

    return ImageGenerateResponse(
        ok=True,
        workflow=body.workflow,
        checkpoint=checkpoint_name,
        lora_name=resolved_lora_name,
        prompt_id=result.job_id,  # type: ignore
    )


@app.get("/api/lora-training/checkpoints", response_model=LoraCheckpointsResponse)
async def lora_training_checkpoints(job_name: str | None = None) -> LoraCheckpointsResponse:
    """List LoRA checkpoint safetensors available on the VPS, optionally filtered by job."""
    updated_at = datetime.now(UTC).isoformat()
    seen: set[str] = set()
    checkpoints: list[LoraCheckpoint] = []

    def _add(path: Path) -> None:
        if path.name in seen:
            return
        seen.add(path.name)
        stat = path.stat()
        step_match = re.search(r"_(\d{6,})\.safetensors$", path.name)
        checkpoints.append(LoraCheckpoint(
            name=path.name,
            step=int(step_match.group(1)) if step_match else None,
            path=str(path),
            size_bytes=stat.st_size,
            modified_at=datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
        ))

    # 1. Local VPS checkpoints - always available, persisted across droplets.
    for d in _LORA_OUTPUT_DIR.parent.glob("*"):
        if not d.is_dir():
            continue
        lora_dir = d / "loras"
        if not lora_dir.is_dir():
            continue
        for p in sorted(lora_dir.glob("*.safetensors")):
            if job_name and not p.stem.startswith(job_name):
                continue
            _add(p)
    if _LORA_OUTPUT_DIR.is_dir():
        for p in sorted(_LORA_OUTPUT_DIR.glob("*.safetensors")):
            if job_name and not p.stem.startswith(job_name):
                continue
            _add(p)

    checkpoints.sort(key=lambda item: item.step if item.step is not None else -1, reverse=True)
    return LoraCheckpointsResponse(
        ok=True,
        job_name="all",
        checkpoints=checkpoints,
        count=len(checkpoints),
        updated_at=updated_at,
    )


@app.get("/api/lora-training/checkpoints/download")
async def lora_training_checkpoint_download(name: str) -> FileResponse:
    """Download a LoRA checkpoint by name."""
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    target = (_LORA_OUTPUT_DIR / name).resolve()
    if not str(target).startswith(str(_LORA_OUTPUT_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target, filename=name, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/lora-training/jobs")
async def lora_training_jobs():
    """List all training jobs known to the local DB."""
    jobs = await list_training_jobs()
    return {"jobs": jobs, "count": len(jobs)}


@app.get("/api/lora-training/datasets")
async def lora_training_datasets_list():
    """List all registered training datasets."""
    datasets = await list_datasets()
    return {"datasets": datasets, "count": len(datasets)}


class CreateDatasetRequest(BaseModel):
    id: str = Field(min_length=1, description="Folder name on the droplet under /root/flixml-training/datasets/")
    name: str = Field(min_length=1)
    description: str | None = None
    image_count: int | None = None


@app.post("/api/lora-training/datasets")
async def lora_training_datasets_create(body: CreateDatasetRequest):
    """Register a new training dataset reference."""
    dataset = await upsert_dataset(body.id, body.name, body.description, body.image_count)
    return {"ok": True, "dataset": dataset}


@app.get("/api/lora-training/samples")
async def lora_training_samples(job_name: str):
    """List sample images synced from training to the VPS."""
    db_job = await get_training_job(job_name)
    paths = (db_job.get("metadata") or {}).get("sample_paths", []) if db_job else []
    return {"ok": True, "samples": paths, "count": len(paths)}


@app.get("/api/lora-training/sample-image")
async def lora_training_sample_image(path: str):
    """Serve a training sample image from the VPS output directory."""
    target = _OUTPUT_DIR / path.lstrip("/")
    target = target.resolve()
    if not str(target).startswith(str(_OUTPUT_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)


@app.get("/api/listing")
async def listing(
    offset: int = 0,
    limit: int = 60,
    type: str = "",
    q: str = "",
    character_id: str = "",
    tag: str = "",
    training_dataset: str = "",
    agent: Agent | None = Depends(current_agent),
) -> dict[str, Any]:
    """List generated media from the media table.

    This is the source-of-truth catalog for all images and videos managed by
    FlixML Studio. Filters are applied in the database and support pagination,
    type filtering, free-text search, character/tag scoping, and training
    dataset selection.
    """
    type_filter: str | None = None
    if type in {"image", "video"}:
        type_filter = type
    search = q.strip() or None
    char_id = character_id.strip() or None
    tag_filter = tag.strip() or None
    training_only = training_dataset.strip().lower() == "true"

    total = await media_count(
        type_filter=type_filter,
        search=search,
        character_id=char_id,
        tag=tag_filter,
        training_dataset=training_only if training_dataset.strip() else None,
        owner_id=owner_scope(agent),
    )
    rows = await list_media(
        limit=limit,
        offset=offset,
        type_filter=type_filter,
        search=search,
        character_id=char_id,
        tag=tag_filter,
        training_dataset=training_only if training_dataset.strip() else None,
        owner_id=owner_scope(agent),
    )

    items = []
    for row in rows:
        filename = row.get("filename")
        if not filename:
            continue
        modified = row.get("modified") or row.get("updated_at") or row.get("created_at")
        mtime = modified.timestamp() if hasattr(modified, "timestamp") else (modified or 0)
        graph = db.graph_models(row.get("job_workflow_json"))
        if not graph["models"] and row.get("model"):
            # Older rows recorded the model on the media row and have no job graph.
            graph["models"] = [row["model"]]
        items.append({
            "name": Path(filename).name,
            "filename": filename,
            "type": row.get("type", "image"),
            "width": row.get("width", 0),
            "height": row.get("height", 0),
            "mtime": mtime,
            "url": f"/media/{filename}",
            "thumb": f"/api/thumb/{filename}",
            "prompt": row.get("prompt"),
            "negative_prompt": row.get("negative_prompt"),
            "prompt_id": row.get("prompt_id"),
            "character_ids": row.get("character_ids") or [],
            "tags": row.get("tags") or [],
            "included_in_training_dataset": row.get("included_in_training_dataset", False),
            "metadata": _parse_jsonb(row.get("metadata")),
            # Imports have no job; when the file was added stands in for when it was submitted.
            "submitted_at": row.get("job_created_at") or row.get("created_at"),
            "started_at": row.get("job_started_at"),
            "finished_at": row.get("job_finished_at"),
            "models": graph["models"],
            "loras": graph["loras"],
        })

    return {
        "images": items,
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@app.get("/api/listing/counts")
async def listing_counts(agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """Return aggregate counts for the caller's media, images, and videos."""
    scope = owner_scope(agent)
    return {
        "total": await media_count(owner_id=scope),
        "images": await media_count(type_filter="image", owner_id=scope),
        "videos": await media_count(type_filter="video", owner_id=scope),
    }


@app.get("/media/{path:path}")
async def media(path: str) -> FileResponse:
    """Serve a generated image/video from the output directory with caching headers."""
    target = _safe_output_path(path)
    if not target:
        raise HTTPException(status_code=403, detail="Access denied")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    stat = target.stat()
    etag = f'W/"{stat.st_mtime_ns}-{stat.st_size}"'
    return FileResponse(
        target,
        headers={"Cache-Control": "private, max-age=604800, immutable", "ETag": etag},
    )


_THUMB_DIR = _OUTPUT_DIR / ".thumbs"
_VIDEO_SUFFIXES = {".mp4", ".webm", ".mov", ".mkv", ".gif", ".avi"}


@app.get("/api/thumb/{path:path}")
async def media_thumb(path: str) -> FileResponse:
    """Serve a still poster image for a media file.

    Images are served as-is. Videos get a cached JPEG poster (first frame,
    which for i2v is the source image) extracted once with ffmpeg — rendering
    135 <video> tags to paint frame 0 client-side is what left the gallery full
    of blank tiles.
    """
    target = _safe_output_path(path)
    if not target or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")

    if target.suffix.lower() not in _VIDEO_SUFFIXES:
        return FileResponse(target, headers={"Cache-Control": "private, max-age=604800, immutable"})

    rel = target.resolve().relative_to(_OUTPUT_DIR.resolve())
    thumb = _THUMB_DIR / rel.with_suffix(rel.suffix + ".jpg")
    if not thumb.is_file() or thumb.stat().st_mtime < target.stat().st_mtime:
        thumb.parent.mkdir(parents=True, exist_ok=True)
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-loglevel", "error", "-ss", "0", "-i", str(target),
            "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", str(thumb),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
    if not thumb.is_file():
        # Fall back to the video itself rather than 500 — the tile can still try.
        return FileResponse(target, headers={"Cache-Control": "private, max-age=3600"})
    return FileResponse(thumb, headers={"Cache-Control": "private, max-age=604800, immutable"})


@app.post("/api/delete")
async def delete_media(body: dict[str, Any], agent: Agent | None = Depends(current_agent)) -> dict[str, Any]:
    """Delete generated files by relative path and remove their DB records."""
    files = body.get("files", [])
    if not isinstance(files, list):
        raise HTTPException(status_code=400, detail="files must be a list")

    deleted: list[str] = []
    failed: list[dict[str, str]] = []
    for item in files:
        if not isinstance(item, str):
            failed.append({"file": str(item), "error": "invalid filename"})
            continue
        target = _safe_output_path(item)
        if not target:
            failed.append({"file": item, "error": "invalid path"})
            continue
        if not await can_read_file(agent, item):
            failed.append({"file": item, "error": "not found"})
            continue
        try:
            if target.is_file():
                target.unlink()
            deleted.append(item)
        except Exception as exc:  # noqa: BLE001
            failed.append({"file": item, "error": str(exc)})

    if deleted:
        await delete_media_rows(deleted)
        await delete_project_shot_versions_by_files(deleted)
    return {"ok": not failed, "deleted": deleted, "failed": failed}

