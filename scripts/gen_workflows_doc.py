#!/usr/bin/env python3
"""Generate docs/WORKFLOWS.md from the shipped workflow .meta.json files.

The workflow registry (app/flixml/workflows/*.meta.json, served live at
GET /api/workflows) is the single source of truth for what each workflow is and
does. This script renders those meta files into a human-browseable catalog so
the docs can never drift from what actually runs — regenerate it whenever a
workflow is added, removed, or its meta changes:

    python scripts/gen_workflows_doc.py

Local, per-install workflows (app/flixml/workflows/local/, git-ignored) are
intentionally excluded — they vary by machine and only appear via the live API.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORKFLOWS_DIR = REPO / "app" / "flixml" / "workflows"
OUT = REPO / "docs" / "WORKFLOWS.md"

# Task ordering follows the creative pipeline: still → re-angle/edit → animate →
# talk → stitch. Unknown tasks fall to the end, alphabetically.
TASK_ORDER = [
    "text-to-image",
    "image-to-image",
    "face-reference-to-image",
    "text-to-video",
    "image-to-video",
    "first-last-frame-to-video",
    "video-to-video",
]

TASK_LABELS = {
    "text-to-image": "Text → Image",
    "image-to-image": "Image → Image",
    "face-reference-to-image": "Face reference → Image",
    "text-to-video": "Text → Video",
    "image-to-video": "Image → Video",
    "first-last-frame-to-video": "First/Last frame → Video",
    "video-to-video": "Video → Video",
}


def load_meta() -> list[dict]:
    metas = []
    for f in sorted(WORKFLOWS_DIR.glob("*.meta.json")):
        with open(f) as fh:
            metas.append(json.load(fh))
    return metas


def requirement_flags(req: dict) -> str:
    flags = []
    if req.get("requires_image"):
        flags.append("needs image")
    if req.get("requires_audio"):
        flags.append("needs audio")
    if req.get("requires_video"):
        flags.append("needs video")
    if req.get("supports_lora"):
        flags.append("supports LoRA")
    vram = req.get("vram_gb")
    if vram:
        flags.append(f"~{vram} GB VRAM")
    files = req.get("model_files_gb")
    if files:
        # Weights that don't fit in VRAM are offloaded to system RAM, then disk.
        # VRAM + RAM covering this total is what keeps generation fast.
        flags.append(f"loads ~{files} GB of model files (VRAM + system RAM)")
    return ", ".join(flags) if flags else "—"


def render_params(params: dict) -> list[str]:
    lines = []
    for name, schema in params.items():
        if not isinstance(schema, dict):
            continue
        bits = [f"`{name}`"]
        typ = schema.get("type")
        if typ:
            bits.append(f"_{typ}_")
        if schema.get("required"):
            bits.append("**required**")
        if "default" in schema:
            bits.append(f"default `{schema['default']}`")
        desc = schema.get("description", "")
        head = " · ".join(bits)
        lines.append(f"  - {head}{' — ' + desc if desc else ''}")
    return lines


def main() -> None:
    metas = load_meta()
    by_task: dict[str, list[dict]] = {}
    for m in metas:
        by_task.setdefault(m.get("task", "unknown"), []).append(m)

    ordered_tasks = [t for t in TASK_ORDER if t in by_task]
    ordered_tasks += sorted(t for t in by_task if t not in TASK_ORDER)

    out: list[str] = []
    out.append("<!-- GENERATED FILE — do not edit by hand.")
    out.append("     Source: app/flixml/workflows/*.meta.json")
    out.append("     Regenerate: python scripts/gen_workflows_doc.py -->")
    out.append("")
    out.append("# FlixML Workflows")
    out.append("")
    out.append(
        "The complete catalog of shipped generation workflows, grouped by task. "
        "This is generated from each workflow's `.meta.json`, which is also served "
        "live at `GET /api/workflows` for the catalog and `GET /api/workflows/{id}` "
        "for one workflow's params in full — those endpoints are the source of truth "
        "and may include extra per-install workflows kept in "
        "`app/flixml/workflows/local/` (not listed here)."
    )
    out.append("")
    out.append(f"**{len(metas)} workflows** across {len(ordered_tasks)} task types.")
    out.append("")

    # Quick index table.
    out.append("| Workflow | Task | What it does |")
    out.append("|---|---|---|")
    for task in ordered_tasks:
        for m in sorted(by_task[task], key=lambda x: x.get("id", "")):
            desc = (m.get("description", "") or "").split(". ")[0].rstrip(".")
            out.append(f"| `{m.get('id')}` | {TASK_LABELS.get(task, task)} | {desc} |")
    out.append("")

    # Full detail per task.
    for task in ordered_tasks:
        out.append(f"## {TASK_LABELS.get(task, task)}")
        out.append("")
        for m in sorted(by_task[task], key=lambda x: x.get("id", "")):
            out.append(f"### `{m.get('id')}` — {m.get('name', m.get('id'))}")
            out.append("")
            if m.get("description"):
                out.append(m["description"])
                out.append("")
            out.append(f"- **Output:** {m.get('output_type', 'image')}")
            out.append(f"- **Requirements:** {requirement_flags(m.get('requirements', {}))}")
            providers = m.get("compatible_providers") or []
            if providers:
                out.append(f"- **Providers:** {', '.join(providers)}")
            params = m.get("params") or {}
            if params:
                out.append("- **Params:**")
                out.extend(render_params(params))
            out.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out) + "\n")
    print(f"Wrote {OUT.relative_to(REPO)} ({len(metas)} workflows)")


if __name__ == "__main__":
    main()
