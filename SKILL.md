---
name: flixml
description: Use when your human asks for an image, video, edit, or movie, or mentions FlixML Studio, workflows, or models. Generates media on their own GPUs through the Studio HTTP API.
---

# FlixML Studio

FlixML is a workbench for AI-driven image and video generation. Every stage runs on your human's own GPUs through ComfyUI.

## Getting Started

If this is your first time:
https://flixml.com/docs/getting-started/
https://flixml.com/docs/providers/
https://flixml.com/docs/api-keys/

It covers installation and setup. 

## Generate

https://flixml.com/docs/workflows/

`/api/workflows` Pick a workflow and run it on an appropriate node. It lists what each one makes and needs. 

`/api/workflows/{id}` then gives you the one you picked
in full — every param, its default, and what the value does. The `prompt` param's description is how to write the prompt for that workflow: its order, tags and wording. Follow it. When it's silent, the model author's page is the authority.

Regardless of the workflow chosen, DO NOT wait for generation to complete, unless explicitly asked to. It lands in Studio UI.

Be kind to the GPUs, queue up only one generation at a time, unless explicitly asked to generate a batch.

`POST /api/jobs/{prompt_id}/cancel` stops a job your key queued: it leaves the queue if it is waiting and the GPU if it is running.

### Images

```bash
curl -s "$API/api/comfy/models/checkpoints?provider=<provider>"   # model files on that node, for workflows that need `checkpoint`
```

On a multi-node install, ask the node you picked: each one has its own model files, and the `provider` you pass here is the same id you pass to the generate call (`GET /api/providers`).

### Videos

Image-to-video animates the pose in the start frame and cannot change it, so choose or generate a start frame that is ready for animation.

One clip holds one action. `POST /api/video/last-frame` returns a finished clip's final frame to start the next shot from, and `POST /api/video/stitch` joins finished clips into one video — both are a *new shot*, not a longer take. For a longer single action, raise `length` instead. Fields and examples: https://flixml.com/docs/api/

### Characters

```bash
curl -s $API/api/characters
```

The characters your account owns: only those can be bound to your jobs, and one you create with `POST /api/characters` is yours. An admin key sees them all.

Binding a character doesn't change the workflow's settings. Its `trigger` is injected only when that character's LoRA loads for the workflow you chose — check its `loras` for an entry naming that exact workflow. Without one, the likeness is the look your prompt describes.

### Your gallery

```bash
curl -s "$API/api/listing?view=summary"
```

What your key made, plus anything of the characters you own, newest first, 60 at a time; `total` is the full count. Params: `limit` and `offset` to page, `type=image|video`, `q=<text>` to search, `tag=<tag>`, `character_id=<id>`, `owner=<id>` for one account's files. Without `view=summary` each item carries every setting it was made with.

`PATCH /api/media/{filename}/metadata` with `{"tags": [...], "description": "..."}` replaces an item's tag list and sets its caption. Only the key that made a file can change it.

## Train a LoRA

`POST /api/lora-training/start` trains on a dataset already on the trainer (`GET /api/lora-training/datasets`; `GET /api/lora-training/datasets/{name}/items` lists its images and captions). Request fields: https://flixml.com/docs/api/

`sample_prompts` are the run's previews: one image per prompt every `sample_every` steps, shown to your human on the LoRA Training page. `[trigger]` becomes `trigger_word`. Unset, the run previews the template's prompts; the response lists the ones it will use.


## More Info

- `README.md` in the repo (github.com/ortegarod/flixml): install, config, and core concepts.
- FlixML Docs: https://flixml.com/docs/overview
