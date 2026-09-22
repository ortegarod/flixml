#!/usr/bin/env python3
"""MCP server for FlixML Studio.

Exposes a running Studio to any MCP host (Claude Desktop, Claude Code, Cursor,
...) so an agent can drive the whole pipeline — text to image, image to video,
shots into a rendered movie — without being taught the HTTP API first.

Standard library only, so it runs against any Python 3.9+ with nothing
installed. It talks to Studio over HTTP; Studio does the work.

    FLIXML_API_URL        Studio base URL  (default http://localhost:8191)
    FLIXML_API_KEY        sent as Authorization: Bearer <key>, if set
    FLIXML_API_KEY_FILE   read the key from this file instead, so it stays out of
                          the host's config file. Accepts a bare key or a whole
                          "Authorization: Bearer <key>" line.

Host config:

    {"mcpServers": {"flixml": {
      "command": "python",
      "args": ["/path/to/flixml/scripts/mcp_server.py"],
      "env": {"FLIXML_API_URL": "http://localhost:8191",
              "FLIXML_API_KEY_FILE": "~/.config/flixml/key"}}}}
"""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

API_URL = os.environ.get("FLIXML_API_URL", "http://localhost:8191").rstrip("/")
TIMEOUT = float(os.environ.get("FLIXML_MCP_TIMEOUT", "120"))


def _read_key() -> str:
    """Key from FLIXML_API_KEY, or from the file FLIXML_API_KEY_FILE points at."""
    key_file = os.environ.get("FLIXML_API_KEY_FILE", "")
    if key_file:
        path = os.path.expanduser(key_file)
        try:
            with open(path, encoding="utf-8") as handle:
                text = handle.read().strip()
        except OSError as exc:
            print(f"flixml-mcp: cannot read FLIXML_API_KEY_FILE {path}: {exc}", file=sys.stderr)
            return ""
        # Accept either a bare key or a full "Authorization: Bearer <key>" line.
        return text.rsplit(" ", 1)[-1] if text.lower().startswith("authorization:") else text
    return os.environ.get("FLIXML_API_KEY", "")


API_KEY = _read_key()

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOLS = {"2025-06-18", "2025-03-26", "2024-11-05"}
SERVER_INFO = {"name": "flixml", "version": "1.0.0"}


# ── HTTP ─────────────────────────────────────────────────────────────────────

class ApiError(Exception):
    pass


def _headers(extra: dict | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    headers.update(extra or {})
    return headers


def api(method: str, path: str, body=None, params: dict | None = None, raw: bool = False):
    """Call Studio. Returns parsed JSON, or raises ApiError with the reason.

    `raw=True` returns the response body as text, for endpoints that serve something
    other than JSON — `/api/guide` is markdown.
    """
    url = f"{API_URL}{path}"
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url += "?" + urllib.parse.urlencode(clean)

    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, method=method, headers=_headers(headers))
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            text = response.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:600]
        if exc.code == 401:
            raise ApiError(
                "401 from Studio: no API key, or the key is unknown or revoked. "
                "Set FLIXML_API_KEY in this server's env."
            ) from exc
        if exc.code in (403, 404):
            raise ApiError(
                f"{exc.code} from Studio on {path}. If your human can see this item, "
                f"your key is not scoped to it — ask them rather than retrying. {detail}"
            ) from exc
        raise ApiError(f"{exc.code} from Studio on {path}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(
            f"Cannot reach Studio at {API_URL} ({exc.reason}). Is it running, and is "
            f"FLIXML_API_URL right?"
        ) from exc

    if raw:
        return text
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"body": text}


def upload_file(local_path: str) -> dict:
    """POST a local file to /api/images/upload as multipart/form-data."""
    if not os.path.isfile(local_path):
        raise ApiError(f"No file at {local_path}")

    with open(local_path, "rb") as handle:
        payload = handle.read()

    name = os.path.basename(local_path)
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    boundary = f"----flixml{uuid.uuid4().hex}"
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'.encode(),
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        payload,
        f"\r\n--{boundary}--\r\n".encode(),
    ])

    request = urllib.request.Request(
        f"{API_URL}/api/images/upload",
        data=body,
        method="POST",
        headers=_headers({"Content-Type": f"multipart/form-data; boundary={boundary}"}),
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        raise ApiError(f"{exc.code} uploading {name}: {exc.read().decode()[:600]}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"Cannot reach Studio at {API_URL} ({exc.reason}).") from exc


# ── Tools ────────────────────────────────────────────────────────────────────
#
# Each entry: description, JSON Schema for arguments, and a handler taking the
# parsed arguments. Descriptions carry the operating knowledge an agent needs
# before it calls the thing — they are the only documentation an MCP host sees.

def _obj(properties: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": properties, "required": required or []}


STRING = {"type": "string"}
INTEGER = {"type": "integer"}


def tool_list_workflows(args):
    workflows = api("GET", "/api/workflows")
    if not isinstance(workflows, list):
        return workflows
    return [
        {
            "id": w.get("id"),
            "task": w.get("task"),
            "description": w.get("description"),
            "vram_gb": (w.get("requirements") or {}).get("vram_gb"),
            "params": list((w.get("params") or {}).keys()) or None,
            "run_time": w.get("run_time"),
        }
        for w in workflows
    ]


def tool_list_nodes(args):
    nodes = (api("GET", "/api/nodes") or {}).get("nodes") or {}
    # Studio keys this by node id; tolerate a list in case that ever changes.
    entries = list(nodes.values()) if isinstance(nodes, dict) else list(nodes)
    return [
        {
            "provider": n.get("provider"),
            "roles": n.get("roles"),
            "vram_gb": n.get("vram_gb"),
            "vram_free": n.get("vram_free"),
            "gpu": n.get("gpu_name"),
            "online": n.get("online"),
            "queue_running": n.get("queue_running"),
            "queue_pending": n.get("queue_pending"),
        }
        for n in entries
    ]


def _generate_body(args):
    body = {
        key: args[key]
        for key in (
            "workflow", "provider", "prompt", "image", "video",
            "audio", "width", "height", "seed", "checkpoint", "character",
        )
        if args.get(key) is not None
    }
    # The tool schema says negative_prompt because that is what the concept is
    # called everywhere else; the API field is `negative`. Sent under the tool's
    # own name it was dropped as an unknown field and the workflow's default
    # negative ran instead, silently.
    if args.get("negative_prompt") is not None:
        body["negative"] = args["negative_prompt"]
    if args.get("workflow_params"):
        body["workflow_params"] = args["workflow_params"]
    return body


def tool_generate_image(args):
    result = api("POST", "/api/image/generate", _generate_body(args))
    return {
        "prompt_id": result.get("prompt_id"),
        "next": "Call get_job with this prompt_id to collect the output. Show your "
                "human the result before building anything on top of it.",
        "raw": result,
    }


def tool_generate_video(args):
    result = api("POST", "/api/video/generate", _generate_body(args))
    return {
        "prompt_id": result.get("prompt_id"),
        "next": "Video renders take minutes, not seconds. Tell your human it is "
                "running and check get_job later — do not poll in a loop, and do "
                "not submit a second video to the same provider while this one runs.",
        "raw": result,
    }


def tool_get_job(args):
    job = api("GET", f"/api/jobs/{urllib.parse.quote(str(args['prompt_id']))}")
    result = {key: job.get(key) for key in (
        "status", "outputs", "error", "progress", "queue_position",
        "workflow", "provider", "prompt", "models", "loras", "seed",
        "width", "height", "workflow_params", "started_at", "finished_at",
    )}
    # Studio answers 200 with status "unknown" for a prompt_id it has never seen,
    # which otherwise reads like a job that simply hasn't started.
    if job.get("status") == "unknown":
        result["note"] = ("Studio has no job with this prompt_id. Check the id rather "
                          "than waiting for it to start.")
    return result


def tool_last_frame(args):
    body = {k: args[k] for k in ("prompt_id", "video") if args.get(k)}
    result = api("POST", "/api/video/last-frame", body)
    return {
        "filename": result.get("filename"),
        "source": result.get("source"),
        "next": "Pass this filename as `image` to generate_video to continue the take "
                "from where the last clip ended, or edit it first with generate_image "
                "if the next shot needs a change motion alone can't make.",
    }


def tool_stitch(args):
    result = api("POST", "/api/video/stitch", {"clips": args["clips"]})
    return {
        "filename": result.get("filename"),
        "duration": result.get("duration"),
        "next": "Show this to your human as the joined take.",
    }


def tool_list_jobs(args):
    return api("GET", "/api/jobs", params={"limit": args.get("limit", 20)})


def tool_search_media(args):
    return api("GET", "/api/listing", params={
        "q": args.get("q"),
        "limit": args.get("limit", 20),
        "media_type": args.get("media_type"),
    })


def tool_upload_image(args):
    result = upload_file(args["path"])
    return {
        "filename": result.get("filename"),
        "next": "Pass this filename as the `image` argument of generate_image or "
                "generate_video.",
        "raw": result,
    }


def tool_list_characters(args):
    return api("GET", "/api/characters")


def tool_create_project(args):
    return api("POST", "/api/projects", {
        "title": args["title"],
        "aspect_ratio": args.get("aspect_ratio", "16:9"),
    })


def tool_create_scene(args):
    return api("POST", f"/api/projects/{args['project_id']}/scenes", {
        "scene_number": args["scene_number"],
    })


def tool_create_shot(args):
    project, scene = args["project_id"], args["scene_id"]
    shot = api("POST", f"/api/projects/{project}/scenes/{scene}/shots", {
        "shot_number": args["shot_number"],
        "subtitle": args.get("subtitle"),
        "duration_seconds": args.get("duration_seconds"),
    })
    media = {}
    if args.get("video_file"):
        media["video_file"] = args["video_file"]
    if args.get("image_file"):
        media["image_file"] = args["image_file"]
    if media and shot.get("id"):
        shot = api("PATCH", f"/api/projects/{project}/scenes/{scene}/shots/{shot['id']}", media)
    return shot


def tool_set_shot_media(args):
    body = {k: args[k] for k in ("video_file", "image_file", "subtitle", "duration_seconds")
            if args.get(k) is not None}
    return api(
        "PATCH",
        f"/api/projects/{args['project_id']}/scenes/{args['scene_id']}/shots/{args['shot_id']}",
        body,
    )


def tool_render_project(args):
    result = api("POST", f"/api/projects/{args['project_id']}/render")
    return {
        "next": "Call get_render with the same project_id to collect final_video_url.",
        "raw": result,
    }


def tool_get_render(args):
    render = api("GET", f"/api/projects/{args['project_id']}/render")
    return {
        "status": render.get("status"),
        "final_video_url": render.get("final_video_url"),
        "error": render.get("error"),
    }


TOOLS = {
    "list_workflows": {
        "description": (
            "Every workflow this Studio can run: its id, what it turns into what "
            "(`task` is text-to-image, image-to-image, image-to-video or "
            "video-to-video), the VRAM it needs, its params, and `run_time` — the "
            "median, min and max seconds of its recent runs on each node here. "
            "Fetch once per session, then pick by task. When several fit, use "
            "run_time to choose, and tell your human the expected wait before "
            "submitting anything long."
        ),
        "schema": _obj({}),
        "handler": tool_list_workflows,
    },
    "list_nodes": {
        "description": (
            "The GPU nodes this Studio can send work to: roles, VRAM, GPU, whether "
            "they are online, and how much work each already has queued. Send a job "
            "only to a node whose vram_gb meets the workflow's, and send video only "
            "to a node whose roles include 'video'. Check queue_running before "
            "submitting a video — one video job per node at a time."
        ),
        "schema": _obj({}),
        "handler": tool_list_nodes,
    },
    "generate_image": {
        "description": (
            "Generate or edit an image. Returns a prompt_id immediately; the render "
            "happens on the GPU node. For an edit, pass the source `image` filename "
            "and say in the prompt both what changes and what stays the same. Any "
            "param not listed here goes in workflow_params."
        ),
        "schema": _obj({
            "workflow": {**STRING, "description": "Workflow id from list_workflows."},
            "provider": {**STRING, "description": "Node from list_nodes."},
            "prompt": STRING,
            "negative_prompt": STRING,
            "image": {**STRING, "description": "Source image filename, for an edit."},
            "width": INTEGER,
            "height": INTEGER,
            "seed": {**INTEGER, "description": "Reuse only to get the same image back."},
            "checkpoint": {**STRING, "description": "Model file, for workflows that need one."},
            "character": STRING,
            "workflow_params": {"type": "object", "description": "Any other workflow param."},
        }, ["workflow", "provider", "prompt"]),
        "handler": tool_generate_image,
    },
    "generate_video": {
        "description": (
            "Generate a video, usually from a start image. Returns a prompt_id "
            "immediately. Name an action, not an atmosphere: a clip should show an "
            "event someone could describe afterwards — she stands up, he turns and "
            "walks toward the camera. 'Slowly', 'gently' and 'subtly' are "
            "instructions to do nothing, and a camera move alone is not motion; a "
            "push-in rides on top of an action, it does not replace one. "
            "Image-to-video animates the pose in the start frame and cannot change "
            "it, so pick a start frame that is already mid-action. To make someone "
            "in an image speak, pass `audio` with a lip-sync workflow. Run one video "
            "job per GPU node at a time."
        ),
        "schema": _obj({
            "workflow": {**STRING, "description": "Workflow id from list_workflows."},
            "provider": {**STRING, "description": "Node whose roles include 'video'."},
            "prompt": {**STRING, "description": "The motion, in strong verbs."},
            "negative_prompt": STRING,
            "image": {**STRING, "description": "Start frame filename."},
            "video": {**STRING, "description": "Source video, for video-to-video."},
            "audio": {**STRING, "description": "Voice recording, for lip-sync."},
            "width": INTEGER,
            "height": INTEGER,
            "seed": INTEGER,
            "character": STRING,
            "workflow_params": {"type": "object"},
        }, ["workflow", "provider", "prompt"]),
        "handler": tool_generate_video,
    },
    "get_job": {
        "description": (
            "Everything about one job: its status, its output files once complete, "
            "and what made it — workflow, provider, prompt, models, LoRAs, seed and "
            "params. This is also how you answer 'do that again but ...' when your "
            "human hands you a bare 'FlixML asset <prompt_id>': look the settings up "
            "here rather than asking them for any of it."
        ),
        "schema": _obj({"prompt_id": STRING}, ["prompt_id"]),
        "handler": tool_get_job,
    },
    "last_frame": {
        "description": (
            "Take a clip's final frame as an image, so the next shot starts exactly "
            "where the last one ended. Use it for a new shot — a different action, "
            "angle or place — then join the clips with stitch_clips. To make one "
            "action run longer, raise `length` on the wan22_i2v_context workflow "
            "instead. Name the clip by the prompt_id of the job that made it, or by "
            "filename."
        ),
        "schema": _obj({
            "prompt_id": {**STRING, "description": "Job whose video to read."},
            "video": {**STRING, "description": "Video filename, if it has no job."},
        }),
        "handler": tool_last_frame,
    },
    "stitch_clips": {
        "description": (
            "Join finished clips into one video, in the order given. Use it after "
            "chaining shots with last_frame, to hand your human a single take rather "
            "than a list of clips. Name each clip by the prompt_id of the job that "
            "made it, or by filename. To make one action run longer, raise `length` "
            "on the wan22_i2v_context workflow instead of joining clips."
        ),
        "schema": _obj({
            "clips": {
                "type": "array",
                "items": STRING,
                "description": "Two or more clips, in playing order.",
            },
        }, ["clips"]),
        "handler": tool_stitch,
    },
    "list_jobs": {
        "description": "Recent jobs and their status, newest first.",
        "schema": _obj({"limit": INTEGER}),
        "handler": tool_list_jobs,
    },
    "search_media": {
        "description": (
            "Search the media library. Use `q` with a filename when your human names "
            "a file that has no job behind it, such as an upload or an import."
        ),
        "schema": _obj({
            "q": {**STRING, "description": "Filename or prompt text."},
            "media_type": {**STRING, "description": "image or video."},
            "limit": INTEGER,
        }),
        "handler": tool_search_media,
    },
    "upload_image": {
        "description": (
            "Upload a local image file into Studio and get back the filename to use "
            "as an `image` argument."
        ),
        "schema": _obj({"path": {**STRING, "description": "Absolute path on this machine."}},
                       ["path"]),
        "handler": tool_upload_image,
    },
    "list_characters": {
        "description": (
            "Characters defined in this Studio. A character carries its own prompt, "
            "so passing `character` keeps a subject consistent across shots. Your key "
            "may only be allowed some of them."
        ),
        "schema": _obj({}),
        "handler": tool_list_characters,
    },
    "create_project": {
        "description": (
            "Start a movie. A project holds scenes, a scene holds shots, and each "
            "shot plays one image or video you generated."
        ),
        "schema": _obj({
            "title": STRING,
            "aspect_ratio": {**STRING, "description": "9:16, 16:9 or 1:1."},
        }, ["title"]),
        "handler": tool_create_project,
    },
    "create_scene": {
        "description": "Add a scene to a project. Scenes render in scene_number order.",
        "schema": _obj({"project_id": STRING, "scene_number": INTEGER},
                       ["project_id", "scene_number"]),
        "handler": tool_create_scene,
    },
    "create_shot": {
        "description": (
            "Add a shot to a scene, optionally attaching the media it plays. Shots "
            "render in shot_number order and the subtitle is burned in."
        ),
        "schema": _obj({
            "project_id": STRING,
            "scene_id": STRING,
            "shot_number": INTEGER,
            "subtitle": STRING,
            "duration_seconds": {"type": "number"},
            "video_file": {**STRING, "description": "Video output filename."},
            "image_file": {**STRING, "description": "Still image filename."},
        }, ["project_id", "scene_id", "shot_number"]),
        "handler": tool_create_shot,
    },
    "set_shot_media": {
        "description": "Attach or change the media, subtitle or duration on an existing shot.",
        "schema": _obj({
            "project_id": STRING,
            "scene_id": STRING,
            "shot_id": STRING,
            "video_file": STRING,
            "image_file": STRING,
            "subtitle": STRING,
            "duration_seconds": {"type": "number"},
        }, ["project_id", "scene_id", "shot_id"]),
        "handler": tool_set_shot_media,
    },
    "render_project": {
        "description": (
            "Render the project into one video. Plays scenes and shots in number "
            "order, burns in subtitles, and keeps each clip's own audio. It does not "
            "add voiceovers."
        ),
        "schema": _obj({"project_id": STRING}, ["project_id"]),
        "handler": tool_render_project,
    },
    "get_render": {
        "description": "Render status and, once finished, the final video URL.",
        "schema": _obj({"project_id": STRING}, ["project_id"]),
        "handler": tool_get_render,
    },
}


# ── Resources ────────────────────────────────────────────────────────────────

RESOURCES = {
    "flixml://guide": {
        "name": "FlixML agent guide",
        "description": "How to drive the whole pipeline, served by this Studio.",
        "mimeType": "text/markdown",
        "fetch": lambda: api("GET", "/api/guide", raw=True),
    },
    "flixml://openapi": {
        "name": "FlixML OpenAPI schema",
        "description": "Every endpoint and field, generated from the running server.",
        "mimeType": "application/json",
        "fetch": lambda: api("GET", "/openapi.json"),
    },
}


# ── JSON-RPC over stdio ──────────────────────────────────────────────────────

def handle(method: str, params: dict):
    """Return a result for a request, or None for a notification."""
    if method == "initialize":
        asked = params.get("protocolVersion")
        return {
            "protocolVersion": asked if asked in SUPPORTED_PROTOCOLS else PROTOCOL_VERSION,
            "capabilities": {"tools": {}, "resources": {}},
            "serverInfo": SERVER_INFO,
            "instructions": (
                "FlixML Studio runs image and video generation on your human's own "
                "GPUs. Text makes an image, an image makes another image or a video, "
                "and videos become shots in a rendered movie. Start with "
                "list_workflows and list_nodes. Show your human each result before "
                "building the next stage on it, and confirm they have the right to "
                "use a real person's likeness."
            ),
        }

    if method in ("notifications/initialized", "notifications/cancelled"):
        return None

    if method == "ping":
        return {}

    if method == "tools/list":
        return {"tools": [
            {"name": name, "description": spec["description"], "inputSchema": spec["schema"]}
            for name, spec in TOOLS.items()
        ]}

    if method == "tools/call":
        name = params.get("name")
        spec = TOOLS.get(name)
        if spec is None:
            return {"content": [{"type": "text", "text": f"No such tool: {name}"}],
                    "isError": True}
        try:
            result = spec["handler"](params.get("arguments") or {})
        except ApiError as exc:
            return {"content": [{"type": "text", "text": str(exc)}], "isError": True}
        except KeyError as exc:
            return {"content": [{"type": "text", "text": f"Missing argument: {exc}"}],
                    "isError": True}
        text = result if isinstance(result, str) else json.dumps(result, indent=2, default=str)
        return {"content": [{"type": "text", "text": text}]}

    if method == "resources/list":
        return {"resources": [
            {"uri": uri, "name": spec["name"], "description": spec["description"],
             "mimeType": spec["mimeType"]}
            for uri, spec in RESOURCES.items()
        ]}

    if method == "resources/read":
        uri = params.get("uri")
        spec = RESOURCES.get(uri)
        if spec is None:
            raise LookupError(f"No such resource: {uri}")
        payload = spec["fetch"]()
        text = payload if isinstance(payload, str) else json.dumps(payload, indent=2, default=str)
        return {"contents": [{"uri": uri, "mimeType": spec["mimeType"], "text": text}]}

    raise LookupError(f"Method not found: {method}")


def main() -> None:
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue

        request_id = message.get("id")
        try:
            result = handle(message.get("method", ""), message.get("params") or {})
        except LookupError as exc:
            if request_id is not None:
                out.write(json.dumps({"jsonrpc": "2.0", "id": request_id,
                                      "error": {"code": -32601, "message": str(exc)}}) + "\n")
                out.flush()
            continue
        except Exception as exc:  # noqa: BLE001 - never take the transport down
            if request_id is not None:
                out.write(json.dumps({"jsonrpc": "2.0", "id": request_id,
                                      "error": {"code": -32603, "message": repr(exc)}}) + "\n")
                out.flush()
            continue

        # Notifications carry no id and get no reply.
        if request_id is None:
            continue
        out.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
