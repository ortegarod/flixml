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


def _job_row(row: asyncpg.Record) -> dict[str, Any]:
    data = dict(row)
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
                completed_at=CASE WHEN $5 THEN NOW() ELSE completed_at END
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
                completed_at = CASE WHEN $5 THEN NOW() ELSE training_jobs.completed_at END
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


async def list_projects(limit: int = 100) -> list[dict[str, Any]]:
    rows = await get_pool().fetch("SELECT * FROM projects ORDER BY updated_at DESC LIMIT $1", limit)
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


async def list_jobs(limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    rows = await get_pool().fetch("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT $1 OFFSET $2", limit, offset)
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


async def upsert_media(row: dict[str, Any]) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO media (
                filename, type, width, height, size, modified,
                prompt, negative_prompt, seed, steps, guidance, sampler, scheduler,
                model, vae, text_encoder, loras, workflow_type, workflow_json, prompt_id,
                source_image, video_file, character_ids, tags, updated_at
            ) VALUES (
                $1,$2,$3,$4,$5,$6,
                $7,$8,$9,$10,$11,$12,$13,
                $14,$15,$16,$17::jsonb,$18,$19::jsonb,$20,
                $21,$22,$23::text[],$24::text[],NOW()
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
) -> list[dict[str, Any]]:
    where, params = _media_where(type_filter, search, dir_prefix, character_id, tag, training_dataset, start_param=1)
    limit_param = f"${len(params) + 1}"
    offset_param = f"${len(params) + 2}"
    sql = f"""
        SELECT * FROM media
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
) -> int:
    where, params = _media_where(type_filter, search, dir_prefix, character_id, tag, training_dataset, start_param=1)
    sql = f"SELECT COUNT(*) FROM media WHERE {where}"
    return int(await get_pool().fetchval(sql, *params) or 0)


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
