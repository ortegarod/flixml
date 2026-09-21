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
in full — every param, its default, and what the value does.

Regardless of the workflow chosen, DO NOT wait for generation to complete, unless explicitly asked to. It lands in Studio UI.

Be kind to the GPUs, queue up only one generation at a time, unless explicitly asked to generate a batch.

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

When using a character, its `base_prompt` is prepended to yours, so write only the shot — pose, action, wardrobe, setting, light, framing. Describing the face again competes with the base prompt. Its `trigger` is injected only when that character's LoRA loads for the workflow you chose — check its `loras` for an entry naming that exact workflow. Without one, the likeness is the `base_prompt` alone.


## More Info

- `README.md` in the repo (github.com/ortegarod/flixml): install, config, and core concepts.
- FlixML Docs: https://flixml.com/docs/overview
