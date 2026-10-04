"""Character match: how closely the face in each character image matches that character.

Every image bound to exactly one character gets a face fingerprint. A character's
reference is the average fingerprint of its own gallery, so deleting the takes that
miss is what keeps the reference honest. Each image is scored against the average
of the others (cosine similarity, about -1..1; higher is closer).

Optional. It needs the packages in `requirements-face.txt` and an InsightFace model
pack (a folder holding a detection and a recognition `.onnx`) that the user installs
themselves. Without either, Studio runs as before and images carry no score.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from . import db
from .config import get_settings

logger = logging.getLogger("flixml.facematch")

# Faces narrower than this are fingerprinted but left out of the reference: the
# recognition model sees too few pixels to say much about them.
MIN_REFERENCE_FACE_PX = 150
# A character needs this many usable faces before its images get a score.
MIN_REFERENCE_FACES = 5
_BATCH = 16

_task: asyncio.Task | None = None
# Set by every media write (db.on_media_change); the loop sleeps on it.
_wake = asyncio.Event()
_models: tuple[Any, Any] | None = None
_model_lock = asyncio.Lock()


def _model_dir() -> Path:
    configured = get_settings().face_model_dir
    return Path(configured).expanduser() if configured else Path.home() / ".insightface" / "models" / "buffalo_l"


def unavailable_reason() -> str | None:
    """Why scoring is off, or None when it can run."""
    try:
        import cv2  # noqa: F401
        import insightface  # noqa: F401
        import numpy  # noqa: F401
        import onnxruntime  # noqa: F401
    except ImportError as exc:
        return f"face packages not installed ({exc.name}); see requirements-face.txt"
    directory = _model_dir()
    if not any(directory.glob("*.onnx")):
        return f"no InsightFace model pack at {directory}"
    return None


def _load_models() -> tuple[Any, Any]:
    import onnxruntime as ort
    from insightface.model_zoo import model_zoo

    # One thread: scoring is background work and must not starve the API.
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    found: dict[str, Any] = {}
    for path in sorted(_model_dir().glob("*.onnx")):
        model = model_zoo.get_model(str(path), providers=["CPUExecutionProvider"], sess_options=options)
        task = getattr(model, "taskname", None)
        if task in {"detection", "recognition"} and task not in found:
            found[task] = model
    if set(found) != {"detection", "recognition"}:
        raise RuntimeError(f"model pack at {_model_dir()} needs a detection and a recognition model")
    found["detection"].prepare(ctx_id=-1, input_size=(640, 640), det_thresh=0.5)
    found["recognition"].prepare(ctx_id=-1)
    return found["detection"], found["recognition"]


def _fingerprint(path: Path) -> tuple[list[float] | None, float | None]:
    """The largest face's normalized embedding and its width, or (None, None)."""
    import cv2
    import numpy as np
    from insightface.app.common import Face

    assert _models is not None
    detector, recognizer = _models
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return None, None
    boxes, landmarks = detector.detect(image, max_num=0, metric="default")
    if boxes is None or len(boxes) == 0:
        return None, None
    widths = boxes[:, 2] - boxes[:, 0]
    largest = int(np.argmax(widths * (boxes[:, 3] - boxes[:, 1])))
    face = Face(bbox=boxes[largest, :4], kps=landmarks[largest], det_score=boxes[largest, 4])
    recognizer.get(image, face)
    return face.normed_embedding.astype(float).tolist(), float(widths[largest])


def _scores(rows: list[dict[str, Any]]) -> dict[str, float]:
    """Each row's similarity to the mean of the character's other reference faces."""
    import numpy as np

    reference = [row for row in rows if (row["face_px"] or 0) >= MIN_REFERENCE_FACE_PX]
    if len(reference) < MIN_REFERENCE_FACES:
        return {}
    total = np.sum([row["embedding"] for row in reference], axis=0)
    in_reference = {row["filename"] for row in reference}
    scores: dict[str, float] = {}
    for row in rows:
        embedding = np.asarray(row["embedding"])
        mean = total - embedding if row["filename"] in in_reference else total
        scores[row["filename"]] = float(mean @ embedding / np.linalg.norm(mean))
    return scores


async def _fingerprint_batch() -> set[str]:
    """Fingerprint the newest character images that have none yet; return their characters."""
    global _models
    rows = await db.media_without_face_match(_BATCH)
    if not rows:
        return set()
    async with _model_lock:
        if _models is None:
            _models = await asyncio.to_thread(_load_models)
            logger.info("face models loaded", extra={"event": "facematch.models_loaded", "path": str(_model_dir())})
    output_dir = Path(get_settings().output_dir)
    for row in rows:
        try:
            embedding, face_px = await asyncio.to_thread(_fingerprint, output_dir / row["filename"])
        except Exception:
            logger.warning("fingerprint failed", extra={"event": "facematch.fingerprint_failed", "filename": row["filename"]}, exc_info=True)
            embedding, face_px = None, None
        await db.save_face_fingerprint(row["filename"], embedding, face_px)
    return {row["character_id"] for row in rows}


async def rescore(character_id: str) -> int:
    """Recompute every score for one character from its stored fingerprints."""
    rows = await db.face_fingerprints(character_id)
    scores = _scores(rows)
    await db.save_face_scores(character_id, scores)
    return len(scores)


async def _rescore_logged(character_id: str) -> None:
    scored = await rescore(character_id)
    logger.info("character rescored", extra={"event": "facematch.rescored", "character_id": character_id, "scored": scored})


async def _loop() -> None:
    """Wake on a media write, fingerprint what's new, rescore the characters that changed."""
    reference_sizes: dict[str, int] = {}
    while True:
        await _wake.wait()
        _wake.clear()
        try:
            # Rescore after every batch, so a new image shows its score within one batch
            # even while a long backfill is still running behind it.
            while touched := await _fingerprint_batch():
                for character_id in touched:
                    await _rescore_logged(character_id)
            # A deletion or a re-tag adds no fingerprint; a character whose count moved
            # lost or gained an image. Most writes (a file already scored) change neither.
            sizes = await db.face_fingerprint_counts()
            changed = {cid for cid in sizes.keys() | reference_sizes.keys() if sizes.get(cid) != reference_sizes.get(cid)}
            reference_sizes = sizes
            for character_id in changed:
                await _rescore_logged(character_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Left for the next write to retry; nothing here runs on a timer.
            logger.warning("face match cycle failed", extra={"event": "facematch.cycle_failed"}, exc_info=True)


def start() -> None:
    global _task
    reason = unavailable_reason()
    if reason:
        logger.info("character match off", extra={"event": "facematch.off", "reason": reason})
        return
    if _task is None or _task.done():
        if _wake.set not in db._media_change_listeners:
            db.on_media_change(_wake.set)
        _wake.set()  # first pass scores whatever arrived while Studio was off
        _task = asyncio.create_task(_loop())
        logger.info("character match on", extra={"event": "facematch.on", "path": str(_model_dir())})


async def stop() -> None:
    global _task
    if _task:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
