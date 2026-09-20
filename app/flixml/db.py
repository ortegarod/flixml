from __future__ import annotations

import contextlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import asyncpg

from .config import get_settings

_pool: asyncpg.Pool | None = None
_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool


async def init_db() -> asyncpg.Pool:
    global _pool
    settings = get_settings()
    _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=5)
    await run_migrations()
    return _pool


async def close_db() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def run_migrations() -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        for path in sorted(_MIGRATIONS_DIR.glob("*.sql")):
            version = path.stem
            exists = await conn.fetchval("SELECT 1 FROM schema_migrations WHERE version=$1", version)
            if exists:
                continue
            sql = path.read_text()
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute("INSERT INTO schema_migrations(version) VALUES($1)", version)


def _json(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value)


def _text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for item in value:
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


# Loader nodes and the input naming the model file each one loads.
_MODEL_INPUTS = {
    "CheckpointLoaderSimple": "ckpt_name",
    "UNETLoader": "unet_name",
    "UnetLoaderGGUF": "unet_name",
    "WanVideoModelLoader": "model",
    "HiDreamO1ModelLoader": "model_name",
}
_LORA_NODES = {"LoraLoader", "LoraLoaderModelOnly"}


def graph_models(workflow_json: Any) -> dict[str, list[str]]:
    """Read the base models and LoRAs a submitted ComfyUI graph loads.

    The graph is what actually ran, so this covers workflows whose model is fixed in the
    template as well as ones that take it as a param. Unfilled `{{placeholders}}`, "none"
    and zero-strength LoRAs are skipped.
    """
    if isinstance(workflow_json, str):
        with contextlib.suppress(json.JSONDecodeError):
            workflow_json = json.loads(workflow_json)
    models: list[str] = []
    loras: list[str] = []
    if not isinstance(workflow_json, dict):
        return {"models": models, "loras": loras}
    for node in workflow_json.values():
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type")
        inputs = node.get("inputs") or {}
        if class_type in _MODEL_INPUTS:
            name = inputs.get(_MODEL_INPUTS[class_type])
            target = models
        elif class_type in _LORA_NODES:
            name = inputs.get("lora_name")
            target = loras
            with contextlib.suppress(TypeError, ValueError):
                if float(inputs.get("strength_model", 1)) == 0:
                    continue
        else:
            continue
        if not isinstance(name, str) or not name or name == "none" or name.startswith("{{"):
            continue
        name = Path(name).name
        if name not in target:
            target.append(name)
    return {"models": models, "loras": loras}


# Sampler nodes and the inputs each one names its settings with. A graph can hold
# several: Wan runs a high-noise pass and a low-noise pass over the same latent, and
# each gets its own entry so "6 steps, CFG 3.5 then CFG 1.0" survives intact.
_SAMPLER_INPUTS = {
    "KSampler": {"seed": "seed", "steps": "steps", "cfg": "cfg", "sampler": "sampler_name", "scheduler": "scheduler", "denoise": "denoise"},
    "KSamplerAdvanced": {"seed": "noise_seed", "steps": "steps", "cfg": "cfg", "sampler": "sampler_name", "scheduler": "scheduler", "start_step": "start_at_step", "end_step": "end_at_step"},
    "WanVideoSampler": {"seed": "seed", "steps": "steps", "cfg": "cfg", "scheduler": "scheduler", "shift": "shift", "denoise": "denoise_strength"},
    "HiDreamO1Sampler": {"seed": "seed", "steps": "steps", "cfg": "guidance_scale", "shift": "shift"},
    # Flux splits one sampling pass across four nodes; they are merged into a single
    # entry below, because a user reading "what made this" wants one pass, not four.
    "RandomNoise": {"seed": "noise_seed"},
    "KSamplerSelect": {"sampler": "sampler_name"},
    "Flux2Scheduler": {"steps": "steps"},
    "BasicScheduler": {"steps": "steps", "scheduler": "scheduler", "denoise": "denoise"},
    "FluxGuidance": {"cfg": "guidance"},
}
_SPLIT_SAMPLER_NODES = {"RandomNoise", "KSamplerSelect", "Flux2Scheduler", "BasicScheduler", "FluxGuidance"}

# Nodes that fix the output geometry, and the inputs naming it.
_SIZE_INPUTS = {
    "EmptyLatentImage": ("width", "height", None),
    "EmptyFlux2LatentImage": ("width", "height", None),
    "EmptyImage": ("width", "height", None),
    "EmptyHunyuanLatentVideo": ("width", "height", "length"),
    "WanImageToVideo": ("width", "height", "length"),
    "WanFirstLastFrameToVideo": ("width", "height", "length"),
    "WanCameraImageToVideo": ("width", "height", "length"),
    "WanVaceToVideo": ("width", "height", "length"),
    "HiDreamO1Sampler": ("width", "height", None),
}
_FPS_NODES = {"CreateVideo", "VHS_VideoCombine"}


def _number(value: Any) -> Any:
    """Keep a real number, drop an unfilled `{{placeholder}}` or a node reference."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    if isinstance(value, str):
        with contextlib.suppress(TypeError, ValueError):
            return int(value) if value.lstrip("-").isdigit() else float(value)
        return None
    return value


def graph_settings(workflow_json: Any) -> dict[str, Any]:
    """Read the settings a submitted ComfyUI graph actually ran with.

    The metadata saved at submit time only records what the caller typed, so every
    param left at its default reads back as null — a clip generated at 6 steps and
    CFG 3.5 reports neither. The graph is what the node received, so it answers
    "what made this" for any workflow, including ones whose values are fixed in the
    template and never passed through the API at all.
    """
    if isinstance(workflow_json, str):
        with contextlib.suppress(json.JSONDecodeError):
            workflow_json = json.loads(workflow_json)
    if not isinstance(workflow_json, dict):
        return {}

    passes: list[dict[str, Any]] = []
    split: dict[str, Any] = {}
    size: dict[str, Any] = {}
    fps: Any = None
    loras: list[dict[str, Any]] = []

    for node in workflow_json.values():
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type")
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue

        if class_type in _SAMPLER_INPUTS:
            found = {
                label: _number(inputs.get(key)) if label != "sampler" and label != "scheduler" else inputs.get(key)
                for label, key in _SAMPLER_INPUTS[class_type].items()
            }
            found = {k: v for k, v in found.items() if v is not None and not isinstance(v, list) and not str(v).startswith("{{")}
            if not found:
                continue
            if class_type in _SPLIT_SAMPLER_NODES:
                split.update(found)
            else:
                passes.append(found)

        if class_type in _SIZE_INPUTS:
            width_key, height_key, length_key = _SIZE_INPUTS[class_type]
            for label, key in (("width", width_key), ("height", height_key), ("frames", length_key)):
                if key is None:
                    continue
                value = _number(inputs.get(key))
                if value is not None:
                    size.setdefault(label, value)

        if class_type in _FPS_NODES and fps is None:
            fps = _number(inputs.get("fps") or inputs.get("frame_rate"))

        if class_type in _LORA_NODES:
            name = inputs.get("lora_name")
            strength = _number(inputs.get("strength_model", inputs.get("strength")))
            if isinstance(name, str) and name and name != "none" and not name.startswith("{{") and strength != 0:
                loras.append({"name": Path(name).name, "strength": strength})

    if split:
        passes.append(split)

    settings: dict[str, Any] = {}
    if passes:
        settings["passes"] = passes
    settings.update(size)
    if fps is not None:
        settings["fps"] = fps
    if loras:
        settings["loras"] = loras
    return settings


def _job_row(row: asyncpg.Record) -> dict[str, Any]:
    data = dict(row)
    data.update(graph_models(data.get("workflow_json")))
    data["settings"] = graph_settings(data.get("workflow_json"))
    metadata = data.get("metadata")
    if isinstance(metadata, str):
        with contextlib.suppress(json.JSONDecodeError):
            metadata = json.loads(metadata)
    if isinstance(metadata, dict):
        for key, value in metadata.items():
            data.setdefault(key, value)
    return data


async def save_job(
    *,
    prompt_id: str,
    job_type: str,
    status: str = "pending",
    prompt: str | None = None,
    width: int | None = None,
    height: int | None = None,
    workflow_json: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Save a job to the database."""
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO jobs (prompt_id, job_type, status, prompt, width, height, workflow_json, metadata, error, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,NOW())
            ON CONFLICT (prompt_id) DO UPDATE SET
                job_type=EXCLUDED.job_type,
                status=EXCLUDED.status,
                prompt=COALESCE(EXCLUDED.prompt, jobs.prompt),
                width=COALESCE(EXCLUDED.width, jobs.width),
                height=COALESCE(EXCLUDED.height, jobs.height),
                workflow_json=COALESCE(EXCLUDED.workflow_json, jobs.workflow_json),
                metadata=COALESCE(EXCLUDED.metadata, jobs.metadata),
                error=EXCLUDED.error,
                updated_at=NOW()
            """,
            prompt_id,
            job_type,
            status,
            prompt,
            width,
            height,
            _json(workflow_json),
            _json(metadata),
            error,
        )


async def update_job_status(prompt_id: str, status: str, *, error: str | None = None, output_filename: str | None = None) -> None:
    completed = status in {"completed", "failed"}
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            UPDATE jobs
            SET status=$2,
                error=$3,
                output_filename=COALESCE($4, output_filename),
                updated_at=NOW(),
                -- Stamp once. _reconcile_job re-runs for a finished job on every
                -- /api/jobs/{id} read, and an unguarded NOW() walked completed_at
                -- forward on each one, inflating every run time derived from it.
                completed_at=CASE WHEN $5 AND completed_at IS NULL THEN NOW() ELSE completed_at END
            WHERE prompt_id=$1
            """,
            prompt_id,
            status,
            error,
            output_filename,
            completed,
        )


async def update_job_metadata(prompt_id: str, metadata: dict[str, Any]) -> None:
    if not metadata:
        return
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            UPDATE jobs
            SET metadata=COALESCE(jobs.metadata, '{}'::jsonb) || $2::jsonb,
                updated_at=NOW()
            WHERE prompt_id=$1
            """,
            prompt_id,
            _json(metadata),
        )


async def update_job_run_times(
    prompt_id: str,
    started_at: datetime | None,
    finished_at: datetime | None,
    exact_start: bool = False,
) -> None:
    """Record when the node started and finished running a job. Never overwrites a known time with NULL.

    A start time is normally kept once written, since the first one recorded is the
    observation closest to the event. `exact_start` is for the node's own
    execution_start_time, which it only reports once the job has finished: that figure
    is exact, so it replaces the provisional stamp taken when the job was first seen
    running, and run-time medians stay the node's numbers rather than ours.
    """
    if started_at is None and finished_at is None:
        return
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            UPDATE jobs
            -- Casts are required: Postgres cannot infer a parameter's type from a CASE arm alone.
            SET started_at=CASE
                    WHEN $4::boolean AND $2::timestamptz IS NOT NULL THEN $2::timestamptz
                    ELSE COALESCE(started_at, $2::timestamptz)
                END,
                finished_at=COALESCE($3::timestamptz, finished_at)
            WHERE prompt_id=$1
            """,
            prompt_id,
            started_at,
            finished_at,
            exact_start,
        )


async def get_job(prompt_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM jobs WHERE prompt_id=$1", prompt_id)
    return _job_row(row) if row else None


# -- training_jobs ---------------------------------------------------------------

def _training_job_row(row: asyncpg.Record) -> dict[str, Any]:
    data = dict(row)
    if isinstance(data.get("metadata"), str):
        with contextlib.suppress(json.JSONDecodeError):
            data["metadata"] = json.loads(data["metadata"])
    return data


async def get_training_job(job_name: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM training_jobs WHERE job_name=$1", job_name)
    return _training_job_row(row) if row else None


async def get_latest_training_job() -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM training_jobs ORDER BY created_at DESC LIMIT 1")
    return _training_job_row(row) if row else None


async def list_training_jobs() -> list[dict[str, Any]]:
    rows = await get_pool().fetch("SELECT * FROM training_jobs ORDER BY created_at DESC")
    return [_training_job_row(row) for row in rows]


async def list_datasets() -> list[dict[str, Any]]:
    rows = await get_pool().fetch("SELECT * FROM datasets ORDER BY created_at")
    return [dict(row) for row in rows]


async def upsert_dataset(id: str, name: str, description: str | None = None, image_count: int | None = None) -> dict[str, Any]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO datasets (id, name, description, image_count)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
                name        = EXCLUDED.name,
                description = COALESCE(EXCLUDED.description, datasets.description),
                image_count = COALESCE(EXCLUDED.image_count, datasets.image_count)
            RETURNING *
            """,
            id, name, description, image_count,
        )
    return dict(row)


async def save_training_job(
    job_name: str,
    *,
    status: str = "configured",
    config_path: str | None = None,
    log_path: str | None = None,
    output_dir: str | None = None,
    dataset: str | None = None,
    trigger_word: str | None = None,
    model: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO training_jobs (job_name, status, config_path, log_path, output_dir,
                                       dataset, trigger_word, model, metadata, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
            ON CONFLICT (job_name) DO UPDATE SET
                status      = EXCLUDED.status,
                config_path = COALESCE(EXCLUDED.config_path, training_jobs.config_path),
                log_path    = COALESCE(EXCLUDED.log_path, training_jobs.log_path),
                output_dir  = COALESCE(EXCLUDED.output_dir, training_jobs.output_dir),
                dataset     = COALESCE(EXCLUDED.dataset, training_jobs.dataset),
                trigger_word= COALESCE(EXCLUDED.trigger_word, training_jobs.trigger_word),
                model       = COALESCE(EXCLUDED.model, training_jobs.model),
                metadata    = COALESCE(training_jobs.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                updated_at  = NOW()
            """,
            job_name, status, config_path, log_path, output_dir,
            dataset, trigger_word, model, _json(metadata),
        )


async def update_training_job_status(
    job_name: str,
    status: str,
    *,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    completed = status in {"completed", "failed"}
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            UPDATE training_jobs
            SET status       = $2,
                error        = $3,
                metadata     = COALESCE(training_jobs.metadata, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
                updated_at   = NOW(),
                -- Stamp once, same as jobs. GET /api/lora-training/status re-runs this for
                -- a finished job on every poll, and an unguarded NOW() walks completed_at
                -- forward each time.
                completed_at = CASE WHEN $5 AND training_jobs.completed_at IS NULL THEN NOW() ELSE training_jobs.completed_at END
            WHERE job_name   = $1
            """,
            job_name, status, error, _json(metadata), completed,
        )


def _character_row(row: asyncpg.Record) -> dict[str, Any]:
    data = dict(row)
    for key in ("source_images", "loras", "voice", "defaults"):
        value = data.get(key)
        if isinstance(value, str):
            with contextlib.suppress(json.JSONDecodeError):
                data[key] = json.loads(value)
    return data


async def list_characters() -> list[dict[str, Any]]:
    rows = await get_pool().fetch("SELECT * FROM characters ORDER BY updated_at DESC")
    return [_character_row(row) for row in rows]


async def get_character(character_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM characters WHERE id=$1", character_id)
    return _character_row(row) if row else None


async def upsert_character(character: dict[str, Any]) -> dict[str, Any]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO characters (id, name, kind, trigger, description, base_prompt, source_images, loras, voice, defaults, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,NOW())
            ON CONFLICT (id) DO UPDATE SET
                name=EXCLUDED.name,
                kind=EXCLUDED.kind,
                trigger=EXCLUDED.trigger,
                description=EXCLUDED.description,
                base_prompt=EXCLUDED.base_prompt,
                source_images=EXCLUDED.source_images,
                loras=EXCLUDED.loras,
                voice=EXCLUDED.voice,
                defaults=EXCLUDED.defaults,
                updated_at=NOW()
            RETURNING *
            """,
            character["id"],
            character["name"],
            character.get("kind"),
            character.get("trigger"),
            character.get("description"),
            character.get("base_prompt"),
            _json(character.get("source_images", [])),
            _json(character.get("loras", [])),
            _json(character.get("voice")),
            _json(character.get("defaults", {})),
        )
    return _character_row(row)


async def delete_character(character_id: str) -> bool:
    result = await get_pool().execute("DELETE FROM characters WHERE id=$1", character_id)
    return not result.endswith(" 0")


def _json_row(row: asyncpg.Record, keys: tuple[str, ...]) -> dict[str, Any]:
    data = dict(row)
    for key in keys:
        value = data.get(key)
        if isinstance(value, str):
            with contextlib.suppress(json.JSONDecodeError):
                data[key] = json.loads(value)
    return data


def _project_row(row: asyncpg.Record) -> dict[str, Any]:
    return _json_row(row, ("characters", "narrator_voice", "metadata"))


def _scene_row(row: asyncpg.Record) -> dict[str, Any]:
    return _json_row(row, ("characters", "metadata"))


def _shot_row(row: asyncpg.Record) -> dict[str, Any]:
    return _json_row(row, ("characters", "metadata"))


def _shot_version_row(row: asyncpg.Record) -> dict[str, Any]:
    return _json_row(row, ("metadata",))


async def list_projects(limit: int = 100, owner_id: str | None = None) -> list[dict[str, Any]]:
    """List projects, newest first. `owner_id` limits them to one agent's projects."""
    if owner_id is None:
        rows = await get_pool().fetch("SELECT * FROM projects ORDER BY updated_at DESC LIMIT $1", limit)
    else:
        rows = await get_pool().fetch(
            "SELECT * FROM projects WHERE metadata->>'owner_id' = $2 ORDER BY updated_at DESC LIMIT $1", limit, owner_id
        )
    return [_project_row(row) for row in rows]


async def get_project(project_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM projects WHERE id=$1", project_id)
    return _project_row(row) if row else None


async def upsert_project(project: dict[str, Any]) -> dict[str, Any]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO projects (id, title, description, aspect_ratio, duration_seconds, status, characters, narrator_voice, metadata, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,NOW())
            ON CONFLICT (id) DO UPDATE SET
                title=EXCLUDED.title,
                description=EXCLUDED.description,
                aspect_ratio=EXCLUDED.aspect_ratio,
                duration_seconds=EXCLUDED.duration_seconds,
                status=EXCLUDED.status,
                characters=EXCLUDED.characters,
                narrator_voice=EXCLUDED.narrator_voice,
                metadata=EXCLUDED.metadata,
                updated_at=NOW()
            RETURNING *
            """,
            project["id"],
            project["title"],
            project.get("description"),
            project.get("aspect_ratio", "9:16"),
            project.get("duration_seconds"),
            project.get("status", "draft"),
            _json(project.get("characters", [])),
            _json(project.get("narrator_voice")),
            _json(project.get("metadata", {})),
        )
    return _project_row(row)


async def delete_project(project_id: str) -> bool:
    result = await get_pool().execute("DELETE FROM projects WHERE id=$1", project_id)
    return not result.endswith(" 0")


async def delete_project_scene(project_id: str, scene_id: str) -> bool:
    result = await get_pool().execute("DELETE FROM project_scenes WHERE project_id=$1 AND id=$2", project_id, scene_id)
    return not result.endswith(" 0")


async def delete_project_shot(project_id: str, scene_id: str, shot_id: str) -> bool:
    result = await get_pool().execute("DELETE FROM project_shots WHERE project_id=$1 AND scene_id=$2 AND id=$3", project_id, scene_id, shot_id)
    return not result.endswith(" 0")


async def delete_project_render_row(render_id: str) -> bool:
    result = await get_pool().execute("DELETE FROM project_renders WHERE id=$1", render_id)
    return not result.endswith(" 0")


async def list_project_scenes(project_id: str) -> list[dict[str, Any]]:
    rows = await get_pool().fetch("SELECT * FROM project_scenes WHERE project_id=$1 ORDER BY scene_number", project_id)
    return [_scene_row(row) for row in rows]


async def get_project_scene(project_id: str, scene_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM project_scenes WHERE project_id=$1 AND id=$2", project_id, scene_id)
    return _scene_row(row) if row else None


async def upsert_project_scene(scene: dict[str, Any]) -> dict[str, Any]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO project_scenes (id, project_id, scene_number, title, setting, weather, summary, location, time_of_day, characters, metadata, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,NOW())
            ON CONFLICT (id) DO UPDATE SET
                scene_number=EXCLUDED.scene_number,
                title=EXCLUDED.title,
                setting=EXCLUDED.setting,
                weather=EXCLUDED.weather,
                summary=EXCLUDED.summary,
                location=EXCLUDED.location,
                time_of_day=EXCLUDED.time_of_day,
                characters=EXCLUDED.characters,
                metadata=EXCLUDED.metadata,
                updated_at=NOW()
            RETURNING *
            """,
            scene["id"],
            scene["project_id"],
            scene["scene_number"],
            scene.get("title"),
            scene.get("setting"),
            scene.get("weather"),
            scene.get("summary"),
            scene.get("location"),
            scene.get("time_of_day"),
            _json(scene.get("characters", [])),
            _json(scene.get("metadata", {})),
        )
    return _scene_row(row)


async def list_project_shots(project_id: str, scene_id: str | None = None) -> list[dict[str, Any]]:
    if scene_id:
        rows = await get_pool().fetch("SELECT * FROM project_shots WHERE project_id=$1 AND scene_id=$2 ORDER BY shot_number", project_id, scene_id)
    else:
        rows = await get_pool().fetch("SELECT * FROM project_shots WHERE project_id=$1 ORDER BY scene_id, shot_number", project_id)
    return [_shot_row(row) for row in rows]


async def get_project_shot(project_id: str, scene_id: str, shot_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM project_shots WHERE project_id=$1 AND scene_id=$2 AND id=$3", project_id, scene_id, shot_id)
    return _shot_row(row) if row else None


async def next_shot_version_number(shot_id: str, kind: str) -> int:
    value = await get_pool().fetchval("SELECT COALESCE(MAX(version_number), 0) + 1 FROM project_shot_versions WHERE shot_id=$1 AND kind=$2", shot_id, kind)
    return int(value or 1)


async def list_project_shot_versions(project_id: str, scene_id: str, shot_id: str) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        """
        SELECT * FROM project_shot_versions
        WHERE project_id=$1 AND scene_id=$2 AND shot_id=$3
        ORDER BY kind, version_number DESC
        """,
        project_id,
        scene_id,
        shot_id,
    )
    return [_shot_version_row(row) for row in rows]


async def get_project_shot_version(project_id: str, scene_id: str, shot_id: str, version_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow(
        "SELECT * FROM project_shot_versions WHERE project_id=$1 AND scene_id=$2 AND shot_id=$3 AND id=$4",
        project_id,
        scene_id,
        shot_id,
        version_id,
    )
    return _shot_version_row(row) if row else None


async def get_project_shot_version_by_prompt(prompt_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM project_shot_versions WHERE prompt_id=$1", prompt_id)
    return _shot_version_row(row) if row else None


async def upsert_project_shot_version(version: dict[str, Any]) -> dict[str, Any]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO project_shot_versions (id, project_id, scene_id, shot_id, version_number, kind, status, prompt, file, prompt_id, metadata, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
            ON CONFLICT (id) DO UPDATE SET
                status=EXCLUDED.status,
                prompt=COALESCE(EXCLUDED.prompt, project_shot_versions.prompt),
                file=COALESCE(EXCLUDED.file, project_shot_versions.file),
                prompt_id=COALESCE(EXCLUDED.prompt_id, project_shot_versions.prompt_id),
                metadata=COALESCE(project_shot_versions.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                updated_at=NOW()
            RETURNING *
            """,
            version["id"],
            version["project_id"],
            version["scene_id"],
            version["shot_id"],
            version["version_number"],
            version["kind"],
            version.get("status", "pending"),
            version.get("prompt"),
            version.get("file"),
            version.get("prompt_id"),
            _json(version.get("metadata", {})),
        )
    return _shot_version_row(row)


async def upsert_project_shot(shot: dict[str, Any]) -> dict[str, Any]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO project_shots (
                id, project_id, scene_id, shot_number, text, description, subtitle, speaker, image_prompt, motion_prompt,
                characters, duration_seconds, status, image_file, video_file,
                image_prompt_id, video_prompt_id, workflow, previous_shot_id, end_frame_file, end_frame_prompt, metadata, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,NOW())
            ON CONFLICT (id) DO UPDATE SET
                shot_number=EXCLUDED.shot_number,
                text=EXCLUDED.text,
                description=EXCLUDED.description,
                subtitle=EXCLUDED.subtitle,
                speaker=EXCLUDED.speaker,
                image_prompt=EXCLUDED.image_prompt,
                motion_prompt=EXCLUDED.motion_prompt,
                characters=EXCLUDED.characters,
                duration_seconds=EXCLUDED.duration_seconds,
                status=EXCLUDED.status,
                image_file=EXCLUDED.image_file,
                video_file=EXCLUDED.video_file,
                image_prompt_id=EXCLUDED.image_prompt_id,
                video_prompt_id=EXCLUDED.video_prompt_id,
                workflow=COALESCE(EXCLUDED.workflow, project_shots.workflow),
                previous_shot_id=EXCLUDED.previous_shot_id,
                end_frame_file=EXCLUDED.end_frame_file,
                end_frame_prompt=EXCLUDED.end_frame_prompt,
                metadata=EXCLUDED.metadata,
                updated_at=NOW()
            RETURNING *
            """,
            shot["id"],
            shot["project_id"],
            shot["scene_id"],
            shot["shot_number"],
            shot.get("text"),
            shot.get("description"),
            shot.get("subtitle"),
            shot.get("speaker"),
            shot.get("image_prompt"),
            shot.get("motion_prompt"),
            _json(shot.get("characters", [])),
            shot.get("duration_seconds", 5),
            shot.get("status", "draft"),
            shot.get("image_file"),
            shot.get("video_file"),
            shot.get("image_prompt_id"),
            shot.get("video_prompt_id"),
            shot.get("workflow"),
            shot.get("previous_shot_id"),
            shot.get("end_frame_file"),
            shot.get("end_frame_prompt"),
            _json(shot.get("metadata", {})),
        )
    return _shot_row(row)


# ── Project renders ──

def _render_row(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "render_number": row["render_number"],
        "status": row["status"],
        "final_video": row["final_video"],
        "error_message": row["error_message"],
        "metadata": row["metadata"] or {},
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


async def next_render_number(project_id: str) -> int:
    value = await get_pool().fetchval(
        "SELECT COALESCE(MAX(render_number), 0) + 1 FROM project_renders WHERE project_id=$1",
        project_id,
    )
    return int(value or 1)


async def list_project_renders(project_id: str) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        """
        SELECT * FROM project_renders
        WHERE project_id=$1
        ORDER BY render_number DESC
        """,
        project_id,
    )
    return [_render_row(row) for row in rows]


async def get_project_render(project_id: str, render_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow(
        "SELECT * FROM project_renders WHERE project_id=$1 AND id=$2",
        project_id,
        render_id,
    )
    return _render_row(row) if row else None


async def upsert_project_render(render: dict[str, Any]) -> dict[str, Any]:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO project_renders (id, project_id, render_number, status, final_video, error_message, metadata, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
            ON CONFLICT (id) DO UPDATE SET
                status=EXCLUDED.status,
                final_video=EXCLUDED.final_video,
                error_message=EXCLUDED.error_message,
                metadata=COALESCE(project_renders.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                updated_at=NOW()
            RETURNING *
            """,
            render["id"],
            render["project_id"],
            render["render_number"],
            render.get("status", "pending"),
            render.get("final_video"),
            render.get("error_message"),
            _json(render.get("metadata", {})),
        )
    return _render_row(row)


async def workflow_run_times(recent: int = 20) -> dict[str, dict[str, Any]]:
    """How long each workflow took on each node, from its most recent completed runs.

    Only the last `recent` runs per workflow and node count, so a model or hardware
    change shows up within a few jobs. Returns {workflow: {provider: stats}}.
    """
    rows = await get_pool().fetch(
        """
        WITH runs AS (
            SELECT metadata->>'workflow' AS workflow,
                   metadata->>'provider' AS provider,
                   EXTRACT(EPOCH FROM finished_at - started_at) AS seconds,
                   ROW_NUMBER() OVER (
                       PARTITION BY metadata->>'workflow', metadata->>'provider'
                       ORDER BY finished_at DESC
                   ) AS n
            FROM jobs
            WHERE status = 'completed' AND started_at IS NOT NULL AND finished_at >= started_at
              AND metadata->>'workflow' IS NOT NULL AND metadata->>'provider' IS NOT NULL
        )
        SELECT workflow, provider, COUNT(*) AS samples,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY seconds) AS median_seconds,
               MIN(seconds) AS min_seconds, MAX(seconds) AS max_seconds
        FROM runs
        WHERE n <= $1
        GROUP BY workflow, provider
        """,
        recent,
    )
    stats: dict[str, dict[str, Any]] = {}
    for row in rows:
        stats.setdefault(row["workflow"], {})[row["provider"]] = {
            "median_seconds": round(float(row["median_seconds"])),
            "min_seconds": round(float(row["min_seconds"])),
            "max_seconds": round(float(row["max_seconds"])),
            "samples": row["samples"],
        }
    return stats


async def list_jobs(limit: int = 100, offset: int = 0, owner_id: str | None = None) -> list[dict[str, Any]]:
    """List jobs, most recently updated first. `owner_id` limits them to one agent's jobs."""
    if owner_id is None:
        rows = await get_pool().fetch("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT $1 OFFSET $2", limit, offset)
    else:
        rows = await get_pool().fetch(
            "SELECT * FROM jobs WHERE metadata->>'owner_id' = $3 ORDER BY updated_at DESC LIMIT $1 OFFSET $2",
            limit, offset, owner_id,
        )
    return [_job_row(row) for row in rows]


async def list_active_jobs() -> list[dict[str, Any]]:
    """Return every job that has not reached a terminal state, oldest first."""
    rows = await get_pool().fetch(
        "SELECT * FROM jobs WHERE status NOT IN ('completed', 'failed') ORDER BY created_at ASC"
    )
    return [_job_row(row) for row in rows]


async def list_jobs_by_character(
    character_id: str, limit: int = 60, offset: int = 0
) -> list[dict[str, Any]]:
    """Return completed jobs for a character."""
    all_rows = await list_jobs(limit=100, offset=0)
    matching = [
        row for row in all_rows
        if row.get("status") == "completed"
        and isinstance(row.get("character_ids"), list)
        and character_id in row["character_ids"]
    ]
    return matching[offset:offset + limit]


async def count_active_jobs_for_agent(agent_id: str) -> int:
    """Count an agent's in-flight jobs, for enforcing max_concurrent_jobs."""
    return await get_pool().fetchval(
        "SELECT COUNT(*) FROM jobs WHERE status IN ('pending', 'running') AND metadata->>'owner_id' = $1",
        agent_id,
    )


def _agent_row(row: asyncpg.Record) -> dict[str, Any]:
    data = dict(row)
    for key in ("allowed_characters", "allowed_workflows"):
        if data.get(key) is None:
            data[key] = []
    return data


async def create_agent(
    *,
    id: str,
    name: str,
    key_hash: str,
    allowed_characters: list[str] | None = None,
    allowed_workflows: list[str] | None = None,
    max_concurrent_jobs: int | None = None,
    is_admin: bool = False,
) -> dict[str, Any]:
    row = await get_pool().fetchrow(
        """
        INSERT INTO agents (id, name, key_hash, allowed_characters, allowed_workflows, max_concurrent_jobs, is_admin)
        VALUES ($1, $2, $3, $4::text[], $5::text[], $6, $7)
        RETURNING *
        """,
        id,
        name,
        key_hash,
        allowed_characters or None,
        allowed_workflows or None,
        max_concurrent_jobs,
        is_admin,
    )
    return _agent_row(row)


async def update_agent(agent_id: str, fields: dict[str, Any]) -> bool:
    """Set any of name, enabled, allowed_characters, allowed_workflows, max_concurrent_jobs, is_admin."""
    columns = {"name": "", "enabled": "", "allowed_characters": "::text[]", "allowed_workflows": "::text[]", "max_concurrent_jobs": "", "is_admin": ""}
    sets: list[str] = []
    params: list[Any] = [agent_id]
    for key, cast in columns.items():
        if key in fields:
            params.append(fields[key])
            sets.append(f"{key}=${len(params)}{cast}")
    if not sets:
        return await get_agent(agent_id) is not None
    result = await get_pool().execute(f"UPDATE agents SET {', '.join(sets)} WHERE id=$1", *params)
    return result != "UPDATE 0"


async def list_agents() -> list[dict[str, Any]]:
    rows = await get_pool().fetch("SELECT * FROM agents ORDER BY created_at")
    return [_agent_row(row) for row in rows]


async def get_agent(agent_id: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM agents WHERE id=$1", agent_id)
    return _agent_row(row) if row else None


async def get_agent_by_key_hash(key_hash: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM agents WHERE key_hash=$1", key_hash)
    return _agent_row(row) if row else None


async def set_agent_enabled(agent_id: str, enabled: bool) -> bool:
    result = await get_pool().execute("UPDATE agents SET enabled=$2 WHERE id=$1", agent_id, enabled)
    return result != "UPDATE 0"


async def set_agent_key_hash(agent_id: str, key_hash: str) -> bool:
    result = await get_pool().execute("UPDATE agents SET key_hash=$2 WHERE id=$1", agent_id, key_hash)
    return result != "UPDATE 0"


async def delete_agent(agent_id: str) -> bool:
    """Delete an agent. What it owns stays, visible to admin keys only."""
    result = await get_pool().execute("DELETE FROM agents WHERE id=$1", agent_id)
    return result != "DELETE 0"


async def touch_agent_last_used(agent_id: str) -> None:
    await get_pool().execute("UPDATE agents SET last_used_at=NOW() WHERE id=$1", agent_id)


async def upsert_media(row: dict[str, Any]) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO media (
                filename, type, width, height, size, modified,
                prompt, negative_prompt, seed, steps, guidance, sampler, scheduler,
                model, vae, text_encoder, loras, workflow_type, workflow_json, prompt_id,
                source_image, video_file, character_ids, tags, metadata, updated_at
            ) VALUES (
                $1,$2,$3,$4,$5,$6,
                $7,$8,$9,$10,$11,$12,$13,
                $14,$15,$16,$17::jsonb,$18,$19::jsonb,$20,
                $21,$22,$23::text[],$24::text[],$25::jsonb,NOW()
            )
            ON CONFLICT (filename) DO UPDATE SET
                type=EXCLUDED.type,
                width=EXCLUDED.width,
                height=EXCLUDED.height,
                size=EXCLUDED.size,
                modified=EXCLUDED.modified,
                prompt=COALESCE(EXCLUDED.prompt, media.prompt),
                negative_prompt=COALESCE(EXCLUDED.negative_prompt, media.negative_prompt),
                seed=COALESCE(EXCLUDED.seed, media.seed),
                steps=COALESCE(EXCLUDED.steps, media.steps),
                guidance=COALESCE(EXCLUDED.guidance, media.guidance),
                sampler=COALESCE(EXCLUDED.sampler, media.sampler),
                scheduler=COALESCE(EXCLUDED.scheduler, media.scheduler),
                model=COALESCE(EXCLUDED.model, media.model),
                vae=COALESCE(EXCLUDED.vae, media.vae),
                text_encoder=COALESCE(EXCLUDED.text_encoder, media.text_encoder),
                loras=COALESCE(EXCLUDED.loras, media.loras),
                workflow_type=COALESCE(EXCLUDED.workflow_type, media.workflow_type),
                workflow_json=COALESCE(EXCLUDED.workflow_json, media.workflow_json),
                prompt_id=COALESCE(EXCLUDED.prompt_id, media.prompt_id),
                source_image=COALESCE(EXCLUDED.source_image, media.source_image),
                video_file=COALESCE(EXCLUDED.video_file, media.video_file),
                character_ids=CASE WHEN cardinality(EXCLUDED.character_ids) > 0 THEN EXCLUDED.character_ids ELSE media.character_ids END,
                tags=CASE WHEN cardinality(EXCLUDED.tags) > 0 THEN EXCLUDED.tags ELSE media.tags END,
                metadata=COALESCE(EXCLUDED.metadata, media.metadata),
                updated_at=NOW()
            """,
            row.get("filename"),
            row.get("type", "image"),
            row.get("width"),
            row.get("height"),
            row.get("size"),
            row.get("modified"),
            row.get("prompt"),
            row.get("negative_prompt"),
            row.get("seed"),
            row.get("steps"),
            row.get("guidance"),
            row.get("sampler"),
            row.get("scheduler"),
            row.get("model"),
            row.get("vae"),
            row.get("text_encoder"),
            _json(row.get("loras")),
            row.get("workflow_type"),
            _json(row.get("workflow_json")),
            row.get("prompt_id"),
            row.get("source_image"),
            row.get("video_file"),
            _text_list(row.get("character_ids")),
            _text_list(row.get("tags")),
            row.get("metadata"),
        )


_VIDEO_PREDICATE = (
    "(type = 'video' "
    "OR LOWER(filename) LIKE '%.mp4' "
    "OR LOWER(filename) LIKE '%.webm' "
    "OR LOWER(filename) LIKE '%.gif')"
)


def _media_where(
    type_filter: str | None,
    search: str | None,
    dir_prefix: str | None,
    character_id: str | None = None,
    tag: str | None = None,
    training_dataset: bool | None = None,
    start_param: int = 1,
    owner_id: str | None = None,
) -> tuple[str, list[Any]]:
    """Build a shared WHERE clause + params for media listing/count queries.

    Keeps list_media and media_count in lockstep so `total` always matches the
    rows that would be returned by a paged listing with the same filters.
    """
    clauses = [
        "workflow_type IS DISTINCT FROM 'project_render'",
        "NOT (filename LIKE 'projects/%' AND filename LIKE '%render-%')",
    ]
    params: list[Any] = []

    def _next() -> str:
        return f"${start_param + len(params)}"

    if type_filter == "video":
        clauses.append(_VIDEO_PREDICATE)
    elif type_filter == "image":
        clauses.append(f"NOT {_VIDEO_PREDICATE}")

    if search:
        token = _next()
        params.append(f"%{search.lower()}%")
        clauses.append(f"(LOWER(COALESCE(prompt, '')) LIKE {token} OR LOWER(filename) LIKE {token} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE LOWER(t) LIKE {token}))")

    if dir_prefix:
        token = _next()
        params.append(dir_prefix.strip("/") + "/%")
        clauses.append(f"filename LIKE {token}")

    if character_id == "__unassigned__":
        clauses.append("cardinality(character_ids) = 0")
    elif character_id:
        token = _next()
        params.append(character_id)
        clauses.append(f"{token} = ANY(character_ids)")

    if tag:
        token = _next()
        params.append(tag.lower())
        clauses.append(f"EXISTS (SELECT 1 FROM unnest(tags) t WHERE LOWER(t) = {token})")

    if training_dataset is True:
        clauses.append("included_in_training_dataset = TRUE")
    elif training_dataset is False:
        clauses.append("included_in_training_dataset = FALSE")

    if owner_id is not None:
        token = _next()
        params.append(owner_id)
        clauses.append(f"metadata->>'owner_id' = {token}")

    return " AND ".join(clauses), params


async def list_media(
    limit: int = 60,
    offset: int = 0,
    type_filter: str | None = None,
    search: str | None = None,
    dir_prefix: str | None = None,
    character_id: str | None = None,
    tag: str | None = None,
    training_dataset: bool | None = None,
    owner_id: str | None = None,
) -> list[dict[str, Any]]:
    where, params = _media_where(type_filter, search, dir_prefix, character_id, tag, training_dataset, start_param=1, owner_id=owner_id)
    limit_param = f"${len(params) + 1}"
    offset_param = f"${len(params) + 2}"
    # Submit and run times live on the job that produced the file. Scalar subqueries keep
    # the shared WHERE clause's unqualified column names pointing at media.
    sql = f"""
        SELECT media.*,
               (SELECT created_at FROM jobs WHERE jobs.prompt_id = media.prompt_id) AS job_created_at,
               (SELECT started_at FROM jobs WHERE jobs.prompt_id = media.prompt_id) AS job_started_at,
               (SELECT finished_at FROM jobs WHERE jobs.prompt_id = media.prompt_id) AS job_finished_at,
               (SELECT workflow_json FROM jobs WHERE jobs.prompt_id = media.prompt_id) AS job_workflow_json
        FROM media
        WHERE {where}
        ORDER BY COALESCE(modified, created_at) DESC, filename DESC
        LIMIT {limit_param} OFFSET {offset_param}
    """
    rows = await get_pool().fetch(sql, *params, limit, offset)
    return [dict(row) for row in rows]


async def media_count(
    type_filter: str | None = None,
    search: str | None = None,
    dir_prefix: str | None = None,
    character_id: str | None = None,
    tag: str | None = None,
    training_dataset: bool | None = None,
    owner_id: str | None = None,
) -> int:
    where, params = _media_where(type_filter, search, dir_prefix, character_id, tag, training_dataset, start_param=1, owner_id=owner_id)
    sql = f"SELECT COUNT(*) FROM media WHERE {where}"
    return int(await get_pool().fetchval(sql, *params) or 0)


async def workflow_examples(owner_id: str | None = None) -> dict[str, dict[str, Any]]:
    """One example output per workflow, from what this install has actually made.

    A catalog of image and video tools has to show images. The media row records the
    file; the workflow that made it lives on the job, so the two are joined on
    prompt_id. Tag a file `showcase` to pin it as that workflow's example — otherwise
    the newest output wins, so the catalog stays current with nobody curating it.
    """
    media_where, params = _media_where(None, None, None, owner_id=owner_id)
    rows = await get_pool().fetch(
        f"""
        WITH picks AS (
            SELECT j.metadata->>'workflow' AS workflow,
                   m.filename, m.type, m.width, m.height, m.prompt_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY j.metadata->>'workflow'
                       ORDER BY EXISTS (
                                  SELECT 1 FROM unnest(m.tags) t WHERE LOWER(t) = 'showcase'
                                ) DESC,
                                m.created_at DESC
                   ) AS n
            FROM (SELECT * FROM media WHERE {media_where}) m
            JOIN jobs j ON j.prompt_id = m.prompt_id
            -- Status is deliberately not checked: the reconciler marks a job failed when
            -- the node forgets it, which happens to old jobs whose output files are fine
            -- and still in the gallery. The media row existing is the proof it ran.
            WHERE j.metadata->>'workflow' IS NOT NULL
        )
        SELECT workflow, filename, type, width, height, prompt_id FROM picks WHERE n = 1
        """,
        *params,
    )
    return {
        row["workflow"]: {
            "filename": row["filename"],
            "type": row["type"],
            "width": row["width"],
            "height": row["height"],
            "prompt_id": row["prompt_id"],
        }
        for row in rows
    }


async def list_training_dataset_media(character_id: str) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        """
        SELECT * FROM media
        WHERE included_in_training_dataset = TRUE
          AND type = 'image'
          AND $1 = ANY(character_ids)
        ORDER BY COALESCE(modified, created_at) DESC, filename DESC
        """,
        character_id,
    )
    return [dict(row) for row in rows]


async def training_dataset_media_count(character_id: str) -> int:
    return int(await get_pool().fetchval(
        """
        SELECT COUNT(*) FROM media
        WHERE included_in_training_dataset = TRUE
          AND type = 'image'
          AND $1 = ANY(character_ids)
        """,
        character_id,
    ) or 0)


async def update_media_metadata(
    filename: str,
    *,
    character_ids: list[str] | None = None,
    tags: list[str] | None = None,
    included_in_training_dataset: bool | None = None,
) -> dict[str, Any] | None:
    sets: list[str] = []
    params: list[Any] = [filename]
    if character_ids is not None:
        params.append(_text_list(character_ids))
        sets.append(f"character_ids=${len(params)}::text[]")
    if tags is not None:
        params.append(_text_list(tags))
        sets.append(f"tags=${len(params)}::text[]")
    if included_in_training_dataset is not None:
        params.append(bool(included_in_training_dataset))
        sets.append(f"included_in_training_dataset=${len(params)}")
    if not sets:
        return await get_media_by_filename(filename)
    sql = f"""
        UPDATE media
        SET {', '.join(sets)}, updated_at=NOW()
        WHERE filename=$1
        RETURNING *
    """
    row = await get_pool().fetchrow(sql, *params)
    return dict(row) if row else None


async def get_media_by_filename(filename: str) -> dict[str, Any] | None:
    row = await get_pool().fetchrow("SELECT * FROM media WHERE filename=$1", filename)
    return dict(row) if row else None


async def media_catalog_fingerprints() -> dict[str, tuple[int | None, Any, int | None, int | None]]:
    """Return {filename: (size, modified, width, height)} for every catalogued file.

    One query, used by the startup catalog sweep to skip files it has already
    seen unchanged. Without it the sweep re-probes every video on disk on every
    boot, which costs an ffprobe process per file.
    """
    rows = await get_pool().fetch("SELECT filename, size, modified, width, height FROM media")
    return {r["filename"]: (r["size"], r["modified"], r["width"], r["height"]) for r in rows}


async def delete_media_rows(files: list[str]) -> None:
    if not files:
        return
    await get_pool().execute("DELETE FROM media WHERE filename = ANY($1::text[])", files)


async def delete_project_shot_versions_by_files(files: list[str]) -> None:
    if not files:
        return
    async with get_pool().acquire() as conn:
        # If image file is deleted, clear image and video (video depends on image)
        await conn.execute(
            """
            UPDATE project_shots
            SET image_file = NULL,
                video_file = NULL,
                video_prompt_id = NULL,
                status = 'draft'
            WHERE image_file = ANY($1::text[])
            """,
            files,
        )
        # If video file is deleted (but image remains), clear just video
        await conn.execute(
            """
            UPDATE project_shots
            SET video_file = NULL,
                video_prompt_id = NULL,
                status = 'image_ready'
            WHERE video_file = ANY($1::text[]) AND image_file IS NOT NULL
            """,
            files,
        )
        # Delete version records
        await conn.execute(
            "DELETE FROM project_shot_versions WHERE file = ANY($1::text[])",
            files,
        )


def utc_from_timestamp(value: float) -> datetime:
    return datetime.fromtimestamp(value, UTC)
