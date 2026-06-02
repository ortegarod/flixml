from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx


logger = logging.getLogger("nemoflix.comfy")


class ComfyClient:
    """Small typed wrapper around ComfyUI's native HTTP API."""

    def __init__(self, base_url: str, timeout: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def get(self, path: str) -> Any:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"{self.base_url}{path}")
                response.raise_for_status()
                return response.json()
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

    async def post(self, path: str, payload: dict[str, Any] | None = None) -> Any:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url}{path}", json=payload or {})
                response.raise_for_status()
                if not response.content:
                    return None
                return response.json()
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
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url}/prompt", json=payload)
                response.raise_for_status()
                return response.json()
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
                async with httpx.AsyncClient(timeout=self.timeout) as client:
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
                async with httpx.AsyncClient(timeout=self.timeout) as client:
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
