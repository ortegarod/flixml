"""Agent identity and scope: API keys that decide what each caller can see and do.

A key resolves to an `Agent`. An admin key sees everything. Any other key sees only
what it owns — the jobs and media it generated, the files it uploaded, the projects it
created — plus the characters in its allowlist (all of them if the list is empty). A
key can also be limited to certain workflows and capped on concurrent jobs.

Callers send the key as `Authorization: Bearer <key>`. The Studio frontend can't put a
header on an <img> request, so it signs in once through `POST /api/session`, which
stores the key in an HttpOnly cookie that is checked the same way.

`security.require_api_key` in config.json (default false) decides what happens to a
request with no key: rejected with 401 when true, served unrestricted when false, so a
fresh clone isn't locked out. A key that is sent but unknown or revoked is always
rejected, never downgraded to anonymous.

Manage keys on the Studio Agents page (`/api/agents`, admin keys only) or with
`scripts/manage_agent_keys.py`, which is how the first admin key gets made.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets

from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .config import get_settings

SESSION_COOKIE = "flixml_key"
SESSION_PATH = "/api/session"

bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="bearerAuth",
    description=(
        "Agent API key (see scripts/manage_agent_keys.py). Required when config.json "
        "security.require_api_key is true. A non-admin key only sees what it owns."
    ),
)

# Routes a non-admin key can't use at all: key management, and LoRA training, which rents
# GPUs and reads every dataset.
_ADMIN_ONLY_PREFIXES = ("/api/agents", "/api/lora-training")
# The one route under those prefixes a non-admin key may call: its own account profile.
# Matched whole, not by prefix or suffix, so nothing else under /api/agents/ slips through;
# the route still refuses a scoped caller asking about an account that isn't its own.
_ADMIN_EXEMPT = re.compile(r"^/api/agents/[^/]+/profile$")
# ComfyUI passthrough roots that describe the install rather than anyone's jobs.
# history, queue, prompt and view expose every caller's prompts and outputs.
_COMFY_DISCOVERY_ROOTS = ("system_stats", "object_info", "models", "features")


def set_session_cookie(response: Response, raw_key: str) -> None:
    """Sign the browser in with this key. Signing in and rotating your own key both land here."""
    response.set_cookie(SESSION_COOKIE, raw_key, max_age=365 * 24 * 3600, httponly=True, samesite="lax")


def hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_key() -> str:
    """Return a new random raw key. Never store this — store hash_key(this)."""
    return f"nfx_{secrets.token_hex(24)}"


class Agent:
    """A resolved agent identity, with its permission scope."""

    def __init__(self, row: dict):
        self.id: str = row["id"]
        self.name: str = row["name"]
        self.is_admin: bool = bool(row.get("is_admin"))
        # The public half of the row — the header shows it, so the session carries it.
        self.avatar: str | None = row.get("avatar")
        self.allowed_characters: list[str] | None = row.get("allowed_characters") or None
        self.allowed_workflows: list[str] | None = row.get("allowed_workflows") or None
        self.max_concurrent_jobs: int | None = row.get("max_concurrent_jobs")

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "is_admin": self.is_admin, "avatar": self.avatar}

    def require_workflow(self, workflow: str) -> None:
        if self.allowed_workflows and workflow not in self.allowed_workflows:
            raise HTTPException(
                status_code=403,
                detail=f"Agent '{self.id}' is not permitted to use workflow '{workflow}'",
            )

    def can_use_character(self, character_id: str) -> bool:
        return not self.allowed_characters or character_id in self.allowed_characters

    def require_characters(self, character_ids: list[str]) -> None:
        for character_id in character_ids:
            if not self.can_use_character(character_id):
                raise HTTPException(
                    status_code=403,
                    detail=f"Agent '{self.id}' is not permitted to use character '{character_id}'",
                )

    async def require_capacity(self) -> None:
        if self.max_concurrent_jobs is None:
            return
        active = await db.count_active_jobs_for_agent(self.id)
        if active >= self.max_concurrent_jobs:
            raise HTTPException(
                status_code=429,
                detail=f"Agent '{self.id}' has {active} jobs in flight (limit {self.max_concurrent_jobs})",
            )


def owner_scope(agent: Agent | None) -> str | None:
    """The owner id to filter reads by, or None when the caller sees everything."""
    if agent is None or agent.is_admin:
        return None
    return agent.id


def owns(agent: Agent | None, metadata: dict | str | None) -> bool:
    """Whether a row with this metadata is visible to the caller."""
    scope = owner_scope(agent)
    if scope is None:
        return True
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            return False
    return isinstance(metadata, dict) and metadata.get("owner_id") == scope


async def agent_for_key(raw_key: str) -> Agent | None:
    """Resolve a raw key to an enabled Agent, or None."""
    row = await db.get_agent_by_key_hash(hash_key(raw_key))
    if row is None or not row.get("enabled", True):
        return None
    return Agent(row)


async def can_read_file(agent: Agent | None, filename: str) -> bool:
    """Whether the caller may read or reference an output file by its relative path."""
    if owner_scope(agent) is None:
        return True
    row = await db.get_media_by_filename(filename.lstrip("/"))
    return row is not None and owns(agent, row.get("metadata"))


async def authorize(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> None:
    """App-wide dependency: identify the caller, then check the route is in its scope.

    Stores the caller on `request.state.agent` (None when anonymous and keys aren't
    required). List endpoints narrow their own results with `owner_scope`; this checks
    everything a path addresses by id, so a new route under an existing path parameter
    is scoped without extra code.
    """
    request.state.agent = None
    path = request.url.path
    raw_key = credentials.credentials if credentials else request.cookies.get(SESSION_COOKIE)

    if raw_key:
        agent = await agent_for_key(raw_key)
        if agent is None:
            if path == SESSION_PATH:
                return
            raise HTTPException(status_code=401, detail="Invalid or revoked API key")
        await db.touch_agent_last_used(agent.id)
        request.state.agent = agent
    elif path == SESSION_PATH:
        return
    elif get_settings().security_config().require_api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    agent = request.state.agent
    if agent is None or owner_scope(agent) is None:
        return

    params = request.path_params
    if path.startswith(_ADMIN_ONLY_PREFIXES) and not _ADMIN_EXEMPT.match(path):
        raise HTTPException(status_code=403, detail="Requires an admin key")
    if path.startswith("/api/comfy/") and not params.get("path", "").startswith(_COMFY_DISCOVERY_ROOTS):
        raise HTTPException(status_code=403, detail="Requires an admin key")

    if "character_id" in params:
        agent.require_characters([params["character_id"]])
    if "project_id" in params:
        project = await db.get_project(params["project_id"])
        if project is None or not owns(agent, project.get("metadata")):
            raise HTTPException(status_code=404, detail="Project not found")
    if "prompt_id" in params:
        job = await db.get_job(params["prompt_id"])
        if job is None or job.get("owner_id") != agent.id:
            raise HTTPException(status_code=404, detail="Job not found")
    if path.startswith(("/media/", "/api/thumb/")) and not await can_read_file(agent, params.get("path", "")):
        raise HTTPException(status_code=404, detail="Not found")


def current_agent(request: Request) -> Agent | None:
    """Route dependency: the caller `authorize` resolved for this request."""
    return getattr(request.state, "agent", None)
