"""Structured JSON logging for NemoFlix Studio.

One JSON object per line on stdout. systemd journal captures stdout, so:

    journalctl -u nemoflix-studio-api.service -o cat | jq .

is the single source of truth for application activity.

Conventions:
- Every log call should pass a stable `event` field via `extra={}`:
      logger.info("queued", extra={"event": "generation.queued", "prompt_id": pid})
- Stable correlation fields when relevant: `prompt_id`, `job_id`, `provider`,
  `workflow`, `request_id`.
- Errors should pass `exc_info=True` to capture the stacktrace.
"""

from __future__ import annotations

import json
import logging
import sys
import traceback
from datetime import UTC, datetime
from typing import Any


# Standard LogRecord attributes we don't want to copy into the output object.
_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "taskName",
}


class JsonFormatter(logging.Formatter):
    """Emit one JSON object per record, with stable top-level keys."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds")

        obj: dict[str, Any] = {
            "ts": ts,
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }

        # Promote any extras passed via logger.info(..., extra={...}).
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            try:
                json.dumps(value)
                obj[key] = value
            except (TypeError, ValueError):
                obj[key] = repr(value)

        if record.exc_info:
            obj["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            obj["exc"] = "".join(traceback.format_exception(*record.exc_info)).rstrip()

        return json.dumps(obj, ensure_ascii=False, default=str)


_CONFIGURED = False


def setup_logging(level: str = "INFO") -> None:
    """Configure root logger for structured JSON output to stdout.

    Safe to call multiple times — replaces existing handlers each call so
    uvicorn's reloader doesn't end up with duplicate handlers.
    """
    global _CONFIGURED

    root = logging.getLogger()
    # Wipe any existing handlers (uvicorn default + previous setup runs).
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Quiet noisy third-party loggers — keep WARNING+ from them.
    for noisy in (
        "httpx",
        "httpcore",
        "uvicorn.access",     # we do our own request logging in middleware
        "websockets",
        "asyncio",
        "watchfiles",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # Uvicorn attaches its own non-JSON handlers to these loggers. Strip them
    # and let records propagate up to root so they go through our formatter.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        lg = logging.getLogger(name)
        for handler in list(lg.handlers):
            lg.removeHandler(handler)
        lg.propagate = True
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)

    _CONFIGURED = True
    logging.getLogger("nemoflix").info(
        "logging configured",
        extra={"event": "logging.configured", "level": level.upper()},
    )


# Paths whose access logs would drown the journal. Skipped by middleware.
SUPPRESS_ACCESS_LOG_PATHS: frozenset[str] = frozenset({
    "/api/jobs",
    "/api/listing",
    "/api/nodes",
    "/api/projects",
    "/api/characters",
    "/api/events",
    "/api/health",
    "/api/lora-training/jobs",
    "/api/lora-training/status",
    "/api/lora-training/checkpoints",
})
