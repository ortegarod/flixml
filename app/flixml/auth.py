"""Agent identity: optional API keys so a shared queue can tell callers apart.

A key resolves to an `Agent` with (optionally) a character/workflow allowlist and
a concurrent-job cap. Enforcement is controlled by config.json's
`security.require_api_key` (default false): with it off, a request with no key
or an unknown key just resolves to `None` (anonymous, unrestricted) so a fresh
clone of this repo isn't locked out by default. Flip it on once every caller
that should be talking to this API actually has a key.

Provision/manage keys with `scripts/manage_agent_keys.py` — there is no HTTP
endpoint for minting keys, so a stolen session token can't mint new ones.
"""

from __future__ import annotations

import hashlib
import secrets

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .config import get_settings

bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="bearerAuth",
    description=(
        "Agent API key (see scripts/manage_agent_keys.py). Only required when "
        "config.json security.require_api_key is true; otherwise requests "
        "without a key still work, just unattributed."
    ),
)


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
        self.allowed_characters: list[str] | None = row.get("allowed_characters") or None
        self.allowed_workflows: list[str] | None = row.get("allowed_workflows") or None
        self.max_concurrent_jobs: int | None = row.get("max_concurrent_jobs")

    def require_workflow(self, workflow: str) -> None:
        if self.allowed_workflows and workflow not in self.allowed_workflows:
            raise HTTPException(
                status_code=403,
                detail=f"Agent '{self.id}' is not permitted to use workflow '{workflow}'",
            )

    def require_characters(self, character_ids: list[str]) -> None:
        if not self.allowed_characters:
            return
        for character_id in character_ids:
            if character_id not in self.allowed_characters:
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


async def resolve_agent(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> Agent | None:
    """Resolve the caller's Bearer token to an Agent, or None if anonymous.

    Raises 401 only when security.require_api_key is true and the key is
    missing, unknown, or disabled.
    """
    require_key = get_settings().security_config().require_api_key

    if credentials is None:
        if require_key:
            raise HTTPException(status_code=401, detail="Missing API key")
        return None

    row = await db.get_agent_by_key_hash(hash_key(credentials.credentials))
    if row is None or not row.get("enabled", True):
        if require_key:
            raise HTTPException(status_code=401, detail="Invalid or disabled API key")
        return None

    await db.touch_agent_last_used(row["id"])
    return Agent(row)
