---
name: flixml
description: Use when your human asks for an image, video, edit, or movie, or mentions FlixML Studio, workflows, or models. Generates media on their own GPUs through the Studio HTTP API.
---

# FlixML Studio

FlixML is a pipeline you drive over HTTP. Text makes an image. An image makes another image or a video. Videos become shots, shots become scenes, and scenes become a movie. Every stage runs on your human's own GPUs through ComfyUI.

Show your human each result before you build the next stage on it.

Set `API` to the Studio URL your human gave you. The examples below use `API=http://localhost:8191`.

If your human gave you an API key, send it on every request as `Authorization: Bearer <key>`; the examples leave it out. Your key decides what you see: unless it's an admin key, the gallery, jobs and projects hold only what you made, and `/api/characters` lists only the characters you may use. A 401 means the key is missing or revoked. A 403 or 404 on something your human can see means your key isn't scoped to it, so ask your human rather than retrying.

## Where to read more

- `curl $API/api/workflows`: every workflow Studio can run, the params it takes, and how to write its prompt.
- `curl $API/openapi.json`: every endpoint and field, generated from the running server.
- `README.md` in the repo (github.com/ortegarod/flixml): install, config, and core concepts.
- `docs/wan22-i2v.md` in the repo: how to write motion prompts that actually move.

## See what you have

```bash
curl -s $API/api/workflows | jq -r '.[] | "\(.task)  \(.id)  \(.requirements.vram_gb) GB  \(.description)"'
curl -s $API/api/nodes | jq '.nodes[] | {provider, roles, vram_gb, online}'
```

Pick the workflow whose `task` matches what you start from and what you want back: `text-to-image`, `image-to-image`, `image-to-video`, `video-to-video`. Send it to a `provider` whose `vram_gb` is at least the workflow's, and send video jobs only to one whose `roles` include `video`. The full workflow list is large, so fetch it once per session.

Each workflow's `run_time.by_provider` gives the median, min and max seconds of its recent completed runs on each node of this install (`null` if it has never finished here). Use it when more than one workflow fits the request: a video can run 10 minutes or more where an image takes 30 seconds. Pick the long one only when the request needs what it makes, and tell your human the expected wait before you submit it.

## Make an image

```bash
curl -s $API/api/comfy/models/checkpoints    # model files, for workflows that need `checkpoint`
curl -s -X POST $API/api/image/generate -H 'Content-Type: application/json' -d '{
  "workflow": "sdxl_base", "provider": "local-gpu-1",
  "checkpoint": "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors",
  "prompt": "a lighthouse on a sea cliff at sunset, photo", "width": 832, "height": 1216
}'
```

Top-level fields are `workflow`, `provider`, `prompt`, `image`, `video`, `audio`, `width`, `height`, `seed`, `checkpoint`, and `character`. Every other workflow param goes in `workflow_params`. The response has a `prompt_id`.

## Check the job

```bash
curl -s $API/api/jobs/<prompt_id> | jq '{status, outputs}'
```

When `status` is `completed`, each file is in `outputs[*]` with its `filename` and `url`. Videos take far longer than images: tell your human the job is running and check back later instead of waiting.

## When your human pastes you an asset

They will hand you one line from the Studio UI — `FlixML asset <prompt_id>`, or a filename — and then say what they want in plain language. Look the rest up yourself; never ask them for the workflow, checkpoint, seed or params.

```bash
curl -s $API/api/jobs/<prompt_id> | jq '{prompt, workflow, provider, models, loras, seed, steps, width, height, workflow_params}'
curl -s "$API/api/listing?q=<filename>" | jq '.images[0]'   # uploads and imports have no job
```

That gives you what made it. Reuse the parts their request keeps, change the parts it asks for, and keep the same `seed` only when they want the same image back.

## Edit an image

Start from a file your human sends, or one Studio already made:

```bash
curl -s -X POST $API/api/images/upload -F file=@photo.png      # returns "filename"
curl -s "$API/api/listing?limit=5" | jq '.images[] | {filename, prompt}'
```

Pass that `filename` as `image`. Say what changes and what stays the same:

```bash
curl -s -X POST $API/api/image/generate -H 'Content-Type: application/json' -d '{
  "workflow": "qwen_pose_edit", "provider": "local-gpu-1", "image": "images/abc_00001_.png",
  "prompt": "she sits on the bench, hands in her lap. Keep the same face, clothing and background."
}'
```

## Make a video

```bash
curl -s -X POST $API/api/video/generate -H 'Content-Type: application/json' -d '{
  "workflow": "wan22_i2v", "provider": "local-gpu-2", "image": "images/abc_00001_.png",
  "prompt": "she stands up, turns and walks toward the camera"
}'
```

Write motion with strong verbs. "Slowly" or "gently" gives a near-still clip. To make the person in an image speak, upload a voice recording and run `infinitetalk_i2v` with `image` and `audio`.

## Make a movie

A project holds scenes, a scene holds shots, and each shot plays one image or video you made above.

```bash
curl -s -X POST $API/api/projects -H 'Content-Type: application/json' -d '{"title": "Lighthouse", "aspect_ratio": "9:16"}'
curl -s -X POST $API/api/projects/<project_id>/scenes -H 'Content-Type: application/json' -d '{"scene_number": 1}'
curl -s -X POST $API/api/projects/<project_id>/scenes/<scene_id>/shots -H 'Content-Type: application/json' \
  -d '{"shot_number": 1, "subtitle": "She came back every night.", "duration_seconds": 5}'
curl -s -X PATCH $API/api/projects/<project_id>/scenes/<scene_id>/shots/<shot_id> -H 'Content-Type: application/json' \
  -d '{"video_file": "videos/abc_00001_.mp4"}'     # or "image_file" to show a still
curl -s -X POST $API/api/projects/<project_id>/render
curl -s $API/api/projects/<project_id>/render | jq '{status, final_video_url}'
```

`aspect_ratio` is `9:16`, `16:9`, or `1:1`. Render plays scenes and shots in number order, burns in each `subtitle`, and keeps each clip's own audio. It does not add voiceovers.

## Rules

- Run one video job per GPU at a time.
- Never cancel a running job unless your human tells you to.
- Confirm your human has the right to use a real person's likeness.
