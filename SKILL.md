---
name: flixml
description: Use when your human asks for an image, video, edit, or movie, or mentions FlixML Studio, workflows, or models. Generates media on their own GPUs through the Studio HTTP API.
---

# FlixML Studio

FlixML is a workbench for AI-driven image and video generation. Every stage runs on your human's own GPUs through ComfyUI.

## The API

The API is at the same address that serves this guide (`/api/guide`); every path below is under it. Send your key on every request as `Authorization: Bearer <key>`. A 401 means the key is missing or revoked; a 403 or 404 on something your human can see means your key isn't scoped to it.

```bash
API=<studio-address>
AUTH="Authorization: Bearer <key>"

curl -s -H "$AUTH" "$API/api/workflows"         # what this install can run
curl -s -H "$AUTH" "$API/api/workflows/<id>"    # one workflow's params in full
curl -s -H "$AUTH" "$API/api/providers"         # the nodes it runs on

curl -s -X POST "$API/api/image/generate" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"workflow": "<id>", "provider": "<provider-id>", "prompt": "<prompt>", "workflow_params": {"<param>": "<value>"}}'
```

The generate call queues the job and answers at once:

```json
{"ok": true, "workflow": "<id>", "prompt_id": "9f63123a-70fd-4c62-934f-ed93f670f3d0", "node_errors": null, ...}
```

`GET /api/jobs/{prompt_id}` is the job's status and, once it finishes, its outputs.

`prompt` goes at the top level; the workflow's other params go in `workflow_params`. Video workflows take the same body at `POST /api/video/generate`. Every field: `GET /openapi.json` or https://flixml.com/docs/api/.

## Generate

https://flixml.com/docs/workflows/

`/api/workflows` Pick a workflow and run it on an appropriate node. It lists what each one makes and needs. 

`/api/workflows/{id}` then gives you the one you picked
in full — every param, its default, and what the value does. The `prompt` param's description is how to write the prompt for that workflow: its order, tags and wording. Follow it. Everything you need to run a workflow is in its params, so don't go searching the web for settings or prompt rules. If a guide doesn't cover what you're doing, tell your human: that's a gap in the guide, and it gets fixed there.

Regardless of the workflow chosen, DO NOT wait for generation to complete, unless explicitly asked to. It lands in Studio UI.

`POST /api/jobs/{prompt_id}/cancel` stops a job your key queued: it leaves the queue if it is waiting and the GPU if it is running.

### Images

```bash
curl -s -H "$AUTH" "$API/api/comfy/models/checkpoints?provider=<provider>"   # model files on that node, for workflows that need `checkpoint`
```

On a multi-node install, ask the node you picked: each one has its own model files, and the `provider` you pass here is the same id you pass to the generate call (`GET /api/providers`).

### Videos

Image-to-video animates the pose in the start frame and cannot change it, so choose or generate a start frame that is ready for animation.

One clip holds one action. `POST /api/video/last-frame` returns a finished clip's final frame to start the next shot from, and `POST /api/video/stitch` joins finished clips into one video — both are a *new shot*, not a longer take. For a longer single action, raise `length` instead. Fields and examples: https://flixml.com/docs/api/

### Characters

```bash
curl -s -H "$AUTH" "$API/api/characters"
```

The characters your account owns: only those can be bound to your jobs, and one you create with `POST /api/characters` is yours. An admin key sees them all.

Binding a character doesn't change the workflow's settings. Its `trigger` is injected only when that character's LoRA loads for the workflow you chose — check its `loras` for an entry naming that exact workflow. Without one, the likeness is the look your prompt describes.

### Your gallery

```bash
curl -s -H "$AUTH" "$API/api/listing?view=summary"
```

What your key made, plus anything of the characters you own, newest first, 60 at a time; `total` is the full count. Params: `limit` and `offset` to page, `type=image|video`, `q=<text>` to search, `tag=<tag>`, `character_id=<id>`, `owner=<id>` for one account's files. Without `view=summary` each item carries every setting it was made with.

`PATCH /api/media/{filename}/metadata` with `{"tags": [...], "description": "..."}` replaces an item's tag list and sets its caption. Only the key that made a file can change it.

## Train a LoRA

`POST /api/lora-training/start` trains on a dataset already on the trainer (`GET /api/lora-training/datasets`; `GET /api/lora-training/datasets/{name}/items` lists its images and captions). Request fields: https://flixml.com/docs/api/

`sample_prompts` are the run's previews: one image per prompt every `sample_every` steps, shown to your human on the LoRA Training page. `[trigger]` becomes `trigger_word`. Unset, the run previews the template's prompts; the response lists the ones it will use.


## More Info

- `README.md` in the repo (github.com/ortegarod/flixml): install, config, and core concepts.
- Installing and setting up Studio, for your human: https://flixml.com/docs/getting-started/, https://flixml.com/docs/providers/, https://flixml.com/docs/api-keys/
- FlixML Docs: https://flixml.com/docs/overview
