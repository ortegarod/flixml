from __future__ import annotations

import json
import os
import re
import shlex
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from ..config import get_settings
from ..db import get_pool

_DO_API = "https://api.digitalocean.com/v2"
_ACTIVE_STATUSES = {"provisioning", "booting", "installing", "ready", "training", "syncing", "destroying"}
_DEFAULT_TAGS = ["nemoflix-training", "autodestroy"]


class TrainingCloudError(RuntimeError):
    """Raised for expected training cloud lifecycle failures."""


def _now() -> datetime:
    return datetime.now(UTC)


def _clean_name(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9.-]+", "-", value.strip().lower())
    return value.strip("-")[:63] or "nemoflix-training"


def _parse_ssh_keys(raw: str | None) -> list[int | str]:
    if not raw:
        return []
    keys: list[int | str] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if item.isdigit():
            keys.append(int(item))
        else:
            keys.append(item)
    return keys


def _public_ipv4(droplet: dict[str, Any]) -> str | None:
    for net in droplet.get("networks", {}).get("v4", []):
        if net.get("type") == "public" and net.get("ip_address"):
            return net["ip_address"]
    return None


def _row(row: Any) -> dict[str, Any] | None:
    if not row:
        return None
    data = dict(row)
    if data.get("public_ipv4") is not None:
        data["public_ipv4"] = str(data["public_ipv4"])
    return data


async def get_active_training_cloud_instance() -> dict[str, Any] | None:
    row = await get_pool().fetchrow(
        """
        SELECT * FROM training_cloud_instances
        WHERE status = ANY($1::text[])
        ORDER BY created_at DESC
        LIMIT 1
        """,
        list(_ACTIVE_STATUSES),
    )
    return _row(row)


async def list_training_cloud_instances(limit: int = 20) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        "SELECT * FROM training_cloud_instances ORDER BY created_at DESC LIMIT $1",
        limit,
    )
    return [_row(row) for row in rows if row]


async def save_training_cloud_instance(
    *,
    name: str,
    status: str,
    droplet_id: int | None = None,
    region: str | None = None,
    size_slug: str | None = None,
    image_slug: str | None = None,
    public_ipv4: str | None = None,
    aitk_api_url: str | None = None,
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    error: str | None = None,
    destroy_after: datetime | None = None,
) -> dict[str, Any]:
    row = await get_pool().fetchrow(
        """
        INSERT INTO training_cloud_instances (
            name, status, droplet_id, region, size_slug, image_slug, public_ipv4,
            aitk_api_url, tags, metadata, error, destroy_after, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::inet,$8,$9::text[],$10::jsonb,$11,$12,NOW())
        ON CONFLICT (droplet_id) DO UPDATE SET
            name=EXCLUDED.name,
            status=EXCLUDED.status,
            region=COALESCE(EXCLUDED.region, training_cloud_instances.region),
            size_slug=COALESCE(EXCLUDED.size_slug, training_cloud_instances.size_slug),
            image_slug=COALESCE(EXCLUDED.image_slug, training_cloud_instances.image_slug),
            public_ipv4=COALESCE(EXCLUDED.public_ipv4, training_cloud_instances.public_ipv4),
            aitk_api_url=COALESCE(EXCLUDED.aitk_api_url, training_cloud_instances.aitk_api_url),
            tags=EXCLUDED.tags,
            metadata=COALESCE(training_cloud_instances.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
            error=EXCLUDED.error,
            destroy_after=COALESCE(EXCLUDED.destroy_after, training_cloud_instances.destroy_after),
            updated_at=NOW()
        RETURNING *
        """,
        name,
        status,
        droplet_id,
        region,
        size_slug,
        image_slug,
        public_ipv4,
        aitk_api_url,
        tags or _DEFAULT_TAGS,
        json.dumps(metadata or {}),
        error,
        destroy_after,
    )
    return _row(row) or {}


async def update_training_cloud_instance_status(
    instance_id: str,
    status: str,
    *,
    public_ipv4: str | None = None,
    aitk_api_url: str | None = None,
    metadata: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any] | None:
    row = await get_pool().fetchrow(
        """
        UPDATE training_cloud_instances
        SET status=$2,
            public_ipv4=COALESCE($3::inet, public_ipv4),
            aitk_api_url=COALESCE($4, aitk_api_url),
            metadata=COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
            error=$6,
            ready_at=CASE WHEN $2='ready' THEN NOW() ELSE ready_at END,
            destroyed_at=CASE WHEN $2='destroyed' THEN NOW() ELSE destroyed_at END,
            updated_at=NOW()
        WHERE id=$1::uuid
        RETURNING *
        """,
        instance_id,
        status,
        public_ipv4,
        aitk_api_url,
        json.dumps(metadata or {}),
        error,
    )
    return _row(row)


class DigitalOceanTrainingCloud:
    """Provision disposable AMD ROCm GPU droplets for LoRA training."""

    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def configured(self) -> bool:
        return bool(self.settings.digitalocean_token)

    def _headers(self) -> dict[str, str]:
        if not self.settings.digitalocean_token:
            raise TrainingCloudError("DIGITALOCEAN_TOKEN is not configured")
        return {
            "Authorization": f"Bearer {self.settings.digitalocean_token}",
            "Content-Type": "application/json",
        }

    def _build_user_data(self, bootstrap_mode: str = "full") -> str:
        repo_url = self.settings.training_cloud_repo_url
        aitk_token = os.environ.get("AITK_API_TOKEN", "")
        if bootstrap_mode == "bare":
            return f"""#cloud-config
runcmd:
  - |
    set -Eeuo pipefail
    exec > >(tee -a /var/log/nemoflix-training-cloud-init.log) 2>&1
    mkdir -p /root/nemoflix-studio
    echo "nemoflix training droplet bootstrap_mode=bare" > /root/nemoflix-bootstrap-ready
"""
        return f"""#cloud-config
runcmd:
  - |
    set -Eeuo pipefail
    exec > >(tee -a /var/log/nemoflix-training-cloud-init.log) 2>&1
    export APP_REPO_URL={shlex.quote(repo_url)}
    export APP_DIR='/root/nemoflix-studio'
    export INSTALL_UI_DEPS='1'
    export AITK_GPU_IDS='0'
    export AITK_AUTH_TOKEN={shlex.quote(aitk_token)}
    git clone --depth 1 "$APP_REPO_URL" "$APP_DIR" || git -C "$APP_DIR" pull --ff-only || true
    echo "nemoflix training droplet bootstrap_mode={bootstrap_mode}" > /root/nemoflix-bootstrap-ready
    bash "$APP_DIR/scripts/startup-script.sh"
    bash "$APP_DIR/scripts/install-ai-toolkit.sh"
"""

    async def status(self) -> dict[str, Any]:
        active = await get_active_training_cloud_instance()
        recent = await list_training_cloud_instances(limit=10)
        return {
            "ok": True,
            "configured": self.configured,
            "active": active,
            "recent": recent,
            "defaults": {
                "provider": "digitalocean",
                "region": self.settings.training_cloud_region,
                "size": self.settings.training_cloud_size,
                "image": self.settings.training_cloud_image,
                "ttl_hours": self.settings.training_cloud_ttl_hours,
                "rocm_image_required": True,
            },
        }

    async def provision(self, *, bootstrap_mode: str = "full") -> dict[str, Any]:
        if bootstrap_mode not in {"full", "bare"}:
            raise TrainingCloudError("bootstrap_mode must be 'full' or 'bare'")
        if self.settings.training_cloud_image != "gpu-amd-base":
            raise TrainingCloudError("TRAINING_CLOUD_IMAGE must be gpu-amd-base for ROCm AMD training")

        active = await get_active_training_cloud_instance()
        if active and active.get("status") != "destroyed":
            raise TrainingCloudError(f"Active training droplet already exists: {active.get('name')} ({active.get('status')})")

        name = _clean_name(f"nemoflix-training-{_now().strftime('%Y%m%d-%H%M%S')}")
        tags = list(_DEFAULT_TAGS)
        ssh_keys = _parse_ssh_keys(self.settings.training_cloud_ssh_keys)
        body: dict[str, Any] = {
            "name": name,
            "region": self.settings.training_cloud_region,
            "size": self.settings.training_cloud_size,
            "image": self.settings.training_cloud_image,
            "monitoring": True,
            "tags": tags,
            "user_data": self._build_user_data(bootstrap_mode=bootstrap_mode),
        }
        if ssh_keys:
            body["ssh_keys"] = ssh_keys

        destroy_after = _now() + timedelta(hours=self.settings.training_cloud_ttl_hours)
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{_DO_API}/droplets", headers=self._headers(), json=body)
            if resp.status_code >= 400:
                raise TrainingCloudError(f"DigitalOcean create failed: {resp.status_code} {resp.text[:500]}")
            data = resp.json()

        droplet = data.get("droplet") or {}
        instance = await save_training_cloud_instance(
            name=name,
            status="provisioning",
            droplet_id=droplet.get("id"),
            region=self.settings.training_cloud_region,
            size_slug=self.settings.training_cloud_size,
            image_slug=self.settings.training_cloud_image,
            public_ipv4=_public_ipv4(droplet),
            aitk_api_url=None,
            tags=tags,
            metadata={"do_response": droplet, "actions": data.get("links", {}).get("actions", []), "bootstrap_mode": bootstrap_mode},
            destroy_after=destroy_after,
        )
        return {"ok": True, "instance": instance, "message": "Paid AMD ROCm GPU droplet provisioning started."}

    async def refresh(self, instance_id: str | None = None) -> dict[str, Any]:
        instance = await get_active_training_cloud_instance() if instance_id is None else None
        if instance_id is not None:
            row = await get_pool().fetchrow("SELECT * FROM training_cloud_instances WHERE id=$1::uuid", instance_id)
            instance = _row(row)
        if not instance:
            return {"ok": True, "instance": None}
        droplet_id = instance.get("droplet_id")
        if not droplet_id:
            return {"ok": True, "instance": instance}

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{_DO_API}/droplets/{droplet_id}", headers=self._headers())
            if resp.status_code == 404:
                updated = await update_training_cloud_instance_status(instance["id"], "destroyed")
                return {"ok": True, "instance": updated}
            if resp.status_code >= 400:
                raise TrainingCloudError(f"DigitalOcean retrieve failed: {resp.status_code} {resp.text[:500]}")
            droplet = resp.json().get("droplet") or {}

        ip = _public_ipv4(droplet)
        status = instance.get("status")
        if droplet.get("status") == "active" and status in {"provisioning", "booting"}:
            status = "installing"
        aitk_api_url = f"http://{ip}:8675" if ip else None
        updated = await update_training_cloud_instance_status(
            instance["id"],
            status or "provisioning",
            public_ipv4=ip,
            aitk_api_url=aitk_api_url,
            metadata={"do_status": droplet.get("status"), "last_refresh": _now().isoformat()},
        )
        return {"ok": True, "instance": updated}

    async def destroy(self, *, confirm_destroy: bool, droplet_id: int | None = None, public_ipv4: str | None = None) -> dict[str, Any]:
        if not confirm_destroy:
            raise TrainingCloudError("Refusing to destroy droplet without confirm_destroy=true")
        instance = None
        if droplet_id is None:
            instance = await get_active_training_cloud_instance()
            droplet_id = int(instance["droplet_id"]) if instance and instance.get("droplet_id") else None

        # Manual droplets (no DB row): resolve droplet_id via DO API by public IP
        if not droplet_id and public_ipv4:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    f"{_DO_API}/droplets?tag_name=nemoflix-training",
                    headers=self._headers(),
                )
                if resp.status_code == 200:
                    for d in resp.json().get("droplets", []):
                        for net in d.get("networks", {}).get("v4", []):
                            if net.get("type") == "public" and net.get("ip_address") == public_ipv4:
                                droplet_id = d.get("id")
                                break
                        if droplet_id:
                            break

        if not droplet_id:
            raise TrainingCloudError("No active training droplet to destroy")

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(f"{_DO_API}/droplets/{droplet_id}", headers=self._headers())
            if resp.status_code not in {204, 404}:
                raise TrainingCloudError(f"DigitalOcean destroy failed: {resp.status_code} {resp.text[:500]}")

        if instance:
            updated = await update_training_cloud_instance_status(instance["id"], "destroyed")
        else:
            row = await get_pool().fetchrow("SELECT * FROM training_cloud_instances WHERE droplet_id=$1", droplet_id)
            updated = await update_training_cloud_instance_status(str(row["id"]), "destroyed") if row else None
        return {"ok": True, "instance": updated, "message": "Training droplet destroy requested."}
