"""Structured JSON logging for FlixML Studio.

One JSON object per line on stdout. systemd journal captures stdout, so:

    journalctl -u flixml-studio-api.service -o cat | jq .

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


class _AccessFilter(logging.Filter):
    """Give uvicorn's access lines fields, and drop the successful ones nobody reads.

    uvicorn logs each request as `%s - "%s %s HTTP/%s" %d` with args (client, method,
    path, http_version, status). A read of a path in SUPPRESS_ACCESS_LOG_PATHS that
    succeeded is dropped; one that failed still logs.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not (isinstance(args, tuple) and len(args) == 5):
            return True
        client, method, full_path, _, status = args
        path = str(full_path).split("?", 1)[0]
        if isinstance(status, int) and status < 400 and path in SUPPRESS_ACCESS_LOG_PATHS:
            return False
        record.event = "http.request"
        record.method = method
        record.path = path
        record.status = status
        record.client = client
        return True


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
    # Python warnings (a library's DeprecationWarning) as log lines too, not raw stderr.
    logging.captureWarnings(True)

    # Quiet noisy third-party loggers — keep WARNING+ from them.
    for noisy in (
        "httpx",
        "httpcore",
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
    access = logging.getLogger("uvicorn.access")
    access.setLevel(logging.INFO)
    if not any(isinstance(f, _AccessFilter) for f in access.filters):
        access.addFilter(_AccessFilter())

    _CONFIGURED = True
    logging.getLogger("flixml").info(
        "logging configured",
        extra={"event": "logging.configured", "level": level.upper()},
    )


# Reads the Studio tab repeats on every push or page change; a successful one is not logged.
SUPPRESS_ACCESS_LOG_PATHS: frozenset[str] = frozenset({
    "/api/jobs",
    "/api/listing",
    "/api/listing/counts",
    "/api/nodes",
    "/api/projects",
    "/api/characters",
    "/api/health",
    "/api/lora-training/jobs",
    "/api/lora-training/status",
    "/api/lora-training/checkpoints",
})
