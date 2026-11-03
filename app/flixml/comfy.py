from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from . import node_events


logger = logging.getLogger("flixml.comfy")

CONNECT_TIMEOUT_SECONDS = 5.0


class NodeUnreachable(httpx.ConnectError):
    """A node's ComfyUI could not be reached; the API answers 503 with this message."""

    def __init__(self, node_id: str, base_url: str) -> None:
        parsed = urlparse(base_url)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        self.node_id = node_id
        super().__init__(f"Can't connect to ComfyUI on {node_id} ({parsed.hostname}:{port}). Is it running?")


def request_timeout(read_seconds: float) -> httpx.Timeout:
    """A long read timeout for slow ComfyUI calls, a short one to find out the node is down."""
    return httpx.Timeout(read_seconds, connect=min(CONNECT_TIMEOUT_SECONDS, read_seconds))


@contextmanager
def reaching(node_id: str | None, base_url: str) -> Iterator[None]:
    """Fail at once with NodeUnreachable when the node is known down or refuses a connection."""
    if node_id and node_events.node_unreachable(node_id):
        raise NodeUnreachable(node_id, base_url)
    try:
        yield
    except NodeUnreachable:
        raise
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        logger.warning(
            "comfy unreachable",
            extra={"event": "comfy.http.unreachable", "base_url": base_url, "error": str(exc)},
        )
        raise NodeUnreachable(node_id or urlparse(base_url).hostname or "node", base_url) from exc


class ComfyClient:
    """Small typed wrapper around ComfyUI's native HTTP API."""

    def __init__(self, base_url: str, timeout: float = 120.0, node_id: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.node_id = node_id

    def _reach(self):
        return reaching(self.node_id, self.base_url)

    async def get(self, path: str) -> Any:
        try:
            with self._reach():
                async with httpx.AsyncClient(timeout=request_timeout(self.timeout)) as client:
                    response = await client.get(f"{self.base_url}{path}")
                    response.raise_for_status()
                    return response.json()
        except NodeUnreachable:
            raise
        except httpx.HTTPError:
            logger.exception(
                "comfy get failed",
                extra={
                    "event": "comfy.http.error",
                    "method": "GET",
                    "base_url": self.base_url,
                    "path": path,
                },
            )
            raise

    async def get_optional(self, path: str) -> Any | None:
        """GET that treats 404 as an answer rather than a failure.

        The reconciler asks a node about every unfinished job it owns. A node with no
        record of one replies 404 — that is information, not an error, and logging it
        as an exception buried the real failures in stack traces.
        """
        with self._reach():
            async with httpx.AsyncClient(timeout=request_timeout(self.timeout)) as client:
                response = await client.get(f"{self.base_url}{path}")
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                return response.json()

    async def post(self, path: str, payload: dict[str, Any] | None = None) -> Any:
        try:
            with self._reach():
                async with httpx.AsyncClient(timeout=request_timeout(self.timeout)) as client:
                    response = await client.post(f"{self.base_url}{path}", json=payload or {})
                    response.raise_for_status()
                    if not response.content:
                        return None
                    return response.json()
        except NodeUnreachable:
            raise
        except httpx.HTTPError:
            logger.exception(
                "comfy post failed",
                extra={
                    "event": "comfy.http.error",
                    "method": "POST",
                    "base_url": self.base_url,
                    "path": path,
                },
            )
            raise

    async def queue_prompt(self, workflow: dict[str, Any], *, client_id: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"prompt": workflow}
        if client_id:
            payload["client_id"] = client_id
        try:
            with self._reach():
                async with httpx.AsyncClient(timeout=request_timeout(self.timeout)) as client:
                    response = await client.post(f"{self.base_url}/prompt", json=payload)
                    response.raise_for_status()
                    return response.json()
        except NodeUnreachable:
            raise
        except httpx.HTTPError:
            logger.exception(
                "comfy queue_prompt failed",
                extra={
                    "event": "comfy.http.error",
                    "method": "POST",
                    "base_url": self.base_url,
                    "path": "/prompt",
                    "client_id": client_id,
                },
            )
            raise

    async def upload_image(self, path: Path, *, overwrite: bool = True) -> dict[str, Any]:
        data = {"type": "input", "overwrite": str(overwrite).lower()}
        try:
            with path.open("rb") as fh:
                files = {"image": (path.name, fh, "application/octet-stream")}
                with self._reach():
                    async with httpx.AsyncClient(timeout=request_timeout(self.timeout)) as client:
                        response = await client.post(f"{self.base_url}/upload/image", data=data, files=files)
                        response.raise_for_status()
                        result = response.json()
            logger.info(
                "comfy upload_image ok",
                extra={
                    "event": "comfy.upload.ok",
                    "base_url": self.base_url,
                    "image_name": path.name,
                    "size_bytes": path.stat().st_size if path.exists() else None,
                },
            )
            return result
        except NodeUnreachable:
            raise
        except httpx.HTTPError:
            logger.exception(
                "comfy upload_image failed",
                extra={
                    "event": "comfy.upload.error",
                    "base_url": self.base_url,
                    "image_name": path.name,
                },
            )
            raise

    async def upload_input_file(self, path: Path, *, overwrite: bool = True) -> dict[str, Any]:
        """Upload an arbitrary file into ComfyUI's input directory.

        ComfyUI's upload endpoint is named /upload/image, but current ComfyUI
        uses it as the generic browser-upload path for input assets, including
        videos consumed by LoadVideo.
        """
        data = {"type": "input", "overwrite": str(overwrite).lower()}
        try:
            with path.open("rb") as fh:
                files = {"image": (path.name, fh, "application/octet-stream")}
                with self._reach():
                    async with httpx.AsyncClient(timeout=request_timeout(self.timeout)) as client:
                        response = await client.post(f"{self.base_url}/upload/image", data=data, files=files)
                        response.raise_for_status()
                        result = response.json()
            logger.info(
                "comfy upload_input_file ok",
                extra={
                    "event": "comfy.upload_file.ok",
                    "base_url": self.base_url,
                    "file_name": path.name,
                    "size_bytes": path.stat().st_size if path.exists() else None,
                },
            )
            return result
        except NodeUnreachable:
            raise
        except httpx.HTTPError:
            logger.exception(
                "comfy upload_input_file failed",
                extra={
                    "event": "comfy.upload_file.error",
                    "base_url": self.base_url,
                    "file_name": path.name,
                },
            )
            raise

    def view_url_sync(self, filename: str, *, subfolder: str = "", folder_type: str = "output") -> str:
        # Return a directly fetchable Comfy URL; caller can download or embed it.
        params = httpx.QueryParams({"filename": filename, "subfolder": subfolder, "type": folder_type})
        return f"{self.base_url}/view?{params}"
