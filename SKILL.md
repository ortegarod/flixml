---
name: nemoflix
description: Read this when your human asks for AI image or video generation. Nemoflix is an HTTP API backed by ComfyUI on GPU infrastructure. It gives you two ways to work — Studio (freeform single-shot generation, output lands in a gallery) and Projects (structured directorial work where you write a script, break it into scenes and shots, generate images per shot, animate approved shots, and assemble a final video). Use this skill to interpret your human's creative request, decide between a quick shot or a multi-shot storyboard pipeline, and drive the API on their behalf.
---

# Nemoflix Skill

You are reading this to learn how to use Nemoflix to make images and videos for your human. Nemoflix is the website and API. **You** are the agent driving it. There is no separate scriptwriter, no separate director — when your human pitches an idea, you write the script, plan the shots, call the API, and show them what you made.

**API base:** `http://<api-host>:<port>` — the Nemoflix Studio API endpoint.
**Live schema:** `GET <api-base>/api/openapi.json` — always read this for field names and types; don't guess.
**Workflows:** `GET <api-base>/api/workflows` — discover workflow IDs, compatible providers, and workflow-specific params.

## Two modes — pick before you act

| Mode | Use when your human… | API surface |
|---|---|---|
| **Studio** | …wants a quick image or short clip, freeform exploration, no narrative. | `/api/image/generate`, `/api/video/generate`, `/api/listing` |
| **Projects** | …pitches a *concept* — a story, a video idea, "put me in an Iron Man movie", a beat sequence with multiple shots. | `/api/projects/...` |



Choose the smallest useful mode confidently. Images and/or videos from Studio can also be used in Projects and vice-versa.

Rule of thumb: default to Studio for a single image/clip idea. Use Projects only when the request clearly needs multiple beats, scenes, shots, story structure, continuity, or a final assembled video. If the request could go either way, ask one quick clarification before creating a project.

## Backend you'll be calling

```bash
export NEMOFLIX_API_URL="http://<api-host>:<port>"
curl -sS "$NEMOFLIX_API_URL/api/health"
```

Always check health first. If it fails, tell your human the backend is unavailable instead of pretending generation is working. Query `/api/workflows` and `/api/providers` live to discover what workflows and providers are currently available.

# Studio mode — when generating ideas, freeform media creation

Studio is for one-off generations. Whatever you make lands in the gallery (`/api/listing`) where your human can see it.

**Never ask before submitting a Studio job.** These run on idle local GPUs (srv01, PC) — cheap, minutes not hours, trivially redone. Don't end a turn with "want me to run this?" or "should I submit or adjust the prompt?" — decide, submit, show the result. If the first attempt has a problem (bad composition, wrong pose, weak prompt), fix it and resubmit yourself in the same turn — don't stop to ask permission to try again. Only pause for real ambiguity (which character, which of two very different concepts) — never for "is this good enough to try." (This is Studio-specific — Projects mode has its own approval gates below, since a project commits to a full multi-shot run.)

## Use a character in Studio

Characters are reusable visual identities such as a person or agent likeness. List available character IDs before casting one:

```bash
curl -sS "$NEMOFLIX_API_URL/api/characters"
```

For direct Studio generation, pass one character with the `character` shortcut:

```json
{"character":"<id>","prompt":"studio portrait, dramatic light"}
```

For advanced multi-character control, pass `characters` as character binding objects:

```json
{
  "characters": [
    {"id":"mycharacter","role":"hero","lora_strength":1.0}
  ],
  "prompt":"cinematic hero shot in neon rain"
}
```

`characters` items support `id`, optional `role`, optional `reference_image`, and optional `lora_strength`. The backend resolves the character record, automatically adds the character trigger word to the prompt when needed, and uses the character's LoRA when that workflow supports it. Current direct image generation requires either a character with a `flux2_lora` LoRA or a raw `checkpoint`. Direct image-to-video can use a character reference image if no `image` is supplied.

## Discover workflows and providers first

Before generating anything, read the live catalog so you send real workflow/provider IDs:

```bash
curl -sS "$NEMOFLIX_API_URL/api/workflows"
curl -sS "$NEMOFLIX_API_URL/api/providers"
```

A workflow entry looks like `{ "id": "<workflow-id>", "name": "...", "type": "image", ... }`. A provider entry looks like `{ "id": "<provider-id>", "label": "..." }`. The values below are examples — replace them with IDs returned by your actual catalog.

## Start a LoRA training job

If your human wants to train a new character identity, use `/api/lora-training/start`. They need to have uploaded images to a dataset folder on the droplet first. Register the dataset, then start training:

```bash
# Register the dataset
curl -sS -X POST "$NEMOFLIX_API_URL/api/lora-training/datasets" \
  -H "Content-Type: application/json" \
  -d '{"id": "mycharacter_dataset_v1", "name": "My Character"}'

# Start training
curl -sS -X POST "$NEMOFLIX_API_URL/api/lora-training/start" \
  -H "Content-Type: application/json" \
  -d '{
    "job_name": "mycharacter_flux2_v1",
    "trigger_word": "mycharacter",
    "dataset": "mycharacter_dataset_v1",
    "base_config": "flux2_identity",
    "model": "flux2_dev"
  }'
```

Discover available `base_config` and `model` values via `/api/openapi.json`.

Monitor with `GET /api/lora-training/status`. Checkpoints appear at `GET /api/lora-training/checkpoints` as training progresses. Training runs on the AMD GPU and takes time — tell your human and don't block waiting for it.

## Generate an image

Required fields: `workflow`, `provider`, `prompt`. Optional: `character`, `characters`, `checkpoint`, `width`, `height`, etc.

Replace `<workflow-id>` and `<provider-id>` with real IDs from `GET /api/workflows` and `GET /api/providers`.

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/image/generate" \
  -H "Content-Type: application/json" \
  -d '{"workflow":"<workflow-id>","provider":"<provider-id>","character":"mycharacter","prompt":"portrait of a woman in an open-helmet Iron Man suit getting ready to take-off"}'
```

If you trained a LoRA, you can use it directly with `checkpoint` instead of `character`:

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/image/generate" \
  -H "Content-Type: application/json" \
  -d '{"workflow":"<workflow-id>","provider":"<provider-id>","checkpoint":"latest","prompt":"portrait of a woman, natural window light, sharp focus"}'
```

## Image-to-image and face-reference workflows

Some workflows accept a source `image` and need a base `model` (SDXL checkpoint, not LoRA). Use `workflow_params` to override any workflow-specific defaults.

### `sdxl_img2img` — same composition, restyled

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/image/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "<workflow-id>",
    "provider": "<provider-id>",
    "image": "source.png",
    "model": "cyberrealisticPony_v160.safetensors",
    "prompt": "portrait, soft light",
    "denoise": 0.5,
    "width": 1024,
    "height": 1024
  }'
```

- `image` — filename from `/api/images/upload` or a Studio output path
- `model` — base SDXL checkpoint filename on the provider
- `denoise` — 0.25 preserves more of the source; 0.5–0.7 allows more change

### `sdxl_faceid` — same face, new pose/scene

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/image/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "<workflow-id>",
    "provider": "<provider-id>",
    "image": "source.png",
    "model": "cyberrealisticPony_v160.safetensors",
    "prompt": "woman leaning against a bar counter, warm ambient light, confident smile",
    "width": 832,
    "height": 1216,
    "workflow_params": {
      "faceid_weight": 1.0,
      "faceid_v2_weight": 2.0,
      "faceid_end_at": 1.0
    }
  }'
```

- `faceid_weight` — identity strength (0.8 default, 1.0+ for stronger likeness)
- `faceid_v2_weight` — v2 adapter boost (2.0 gives strong face match)
- `faceid_end_at` — when to stop enforcing identity (1.0 = full generation)
- Best results when the reference is a clean headshot, not full body

### `workflow_params` passthrough

Any field declared in the workflow's `.meta.json` `params` can be passed through `workflow_params` to override defaults. This avoids needing API model changes for every new workflow knob.

## Text-to-video

Required fields: `workflow`, `provider`, `prompt`. `mode` must be `"t2v"`. Use a workflow ID from `GET /api/workflows` and a provider ID from `GET /api/providers`.

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/video/generate" \
  -H "Content-Type: application/json" \
  -d '{"mode":"t2v","workflow":"<workflow-id>","provider":"<provider-id>","prompt":"cinematic shot of a lone explorer walking across an alien desert","width":1280,"height":720,"length":121,"fps":16}'
```

## Image-to-video

Upload first, then reference the filename. Required fields: `workflow`, `provider`, `prompt`, `image`.

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/images/upload" -F "file=@/path/to/source.png"

curl -sS -X POST "$NEMOFLIX_API_URL/api/video/generate" \
  -H "Content-Type: application/json" \
  -d '{"mode":"i2v","workflow":"<workflow-id>","provider":"<provider-id>","image":"source.png","prompt":"subject walking through neon rain","width":640,"height":640,"length":81,"fps":16}'
```

## Audio-driven lip-sync (talking-head)

Some `i2v` workflows are **audio-driven**: you feed a still image *and* an audio file, and the subject is animated to lip-sync the speech (talking-head motion — face and subtle upper body, not big body motion). Check `GET /api/workflows` for a workflow whose meta declares `requires_audio: true` (e.g. an InfiniteTalk-style workflow).

These take one extra field — `audio` — alongside the usual `image`. Both are staged to the run node automatically, mirroring how `image` is handled. Upload the audio the same way you upload an image, then reference the filename:

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/images/upload" -F "file=@/path/to/portrait.png"
# stage the wav into the output dir (any Studio output path works as the audio filename)

curl -sS -X POST "$NEMOFLIX_API_URL/api/video/generate" \
  -H "Content-Type: application/json" \
  -d '{"mode":"i2v","workflow":"<audio-workflow-id>","provider":"<provider-id>","image":"portrait.png","audio":"line.wav","prompt":"a person talking, subtle natural expression"}'
```

Notes:
- The `audio` clip drives both the lip motion and the clip length. Keep `prompt` simple — it only nudges expression, not big motion.
- **Low-VRAM (≤12GB) provider:** audio-driven 14B video models need the **GGUF-quantized** model files (both the backbone *and* the lip-sync module must be GGUF — you can't mix a GGUF module with a full-precision backbone) plus block-swap tuned so the model fits with headroom. The workflow meta ships proven low-VRAM defaults; override per request via `workflow_params` (e.g. `blocks_to_swap`) only if a different card needs it.
- To generate the voice first, see **TTS & Voiceovers** below, then feed the produced wav in as `audio`.

## Motion + lip-sync (video-to-video)

The talking-head path above only animates a still (face + subtle upper body). For **real body motion** (dancing, bending, big movement) *plus* lip-sync, use a **`v2v`** workflow (e.g. an InfiniteTalk-style one whose meta declares `requires_video: true` and `requires_audio: true`). You feed a **driving motion video** + an **audio** file: the subject keeps the driving clip's body motion while its mouth is re-animated to the speech.

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/video/generate" \
  -H "Content-Type: application/json" \
  -d '{"mode":"v2v","workflow":"<v2v-workflow-id>","provider":"<provider-id>","video":"motion_clip.mp4","audio":"line.wav","prompt":"a woman is talking","width":480,"height":480,"length":81}'
```

`mode:"v2v"` takes a `video` (the driving motion clip) instead of an `image` — it's staged to the run node automatically, same as image/audio. No separate start image needed; the driving clip supplies the first frame.

Notes:
- **`denoise_strength` is THE dial (default 0.5) — do not leave it at 1.0.** At 1.0 the driving video is noised to pure noise and the model regenerates a talking head from the first frame, **discarding the body motion** (the subject won't dance/bend). Lower preserves motion: **0.5** keeps body motion while re-animating the mouth; **0.3–0.4** locks motion harder; **0.6–0.7** = stronger lip-sync but weaker motion fidelity. Override per request via `workflow_params:{"denoise_strength":0.4}`.
- **Keep `prompt` a generic placeholder** like `"a woman is talking"`. Motion comes from the driving video, identity/appearance from that same video (preserved at denoise 0.5), lip-sync from the audio. The prompt only lightly nudges expression — describing the motion or the character just fights the driving clip.
- **Resolution is the speed lever.** On a 12GB card, 480×480×81 ≈ 3 min; 640×640×81 ≈ 19 min — same pipeline. Iterate tests at 480, only go big once the clip + denoise are locked.
- Same GGUF/block-swap low-VRAM rules as the audio-driven talking-head above.
- **Editing a workflow's `*.meta.json` default requires a registry reload** — uvicorn `--reload` watches `.py` only, not meta files. After a meta edit, `touch app/nemoflix/api.py` (or restart the API), then verify with a `submit:false` dry-run that the value actually landed in the graph before spending GPU time.

## Track jobs

```bash
curl -sS "$NEMOFLIX_API_URL/api/jobs/<prompt_id>"
```

Status is `pending`, `in_progress`, `completed`, or `failed`. When complete, the response carries normalized `outputs` with media URLs. Hand those URLs back to your human.

---

# Projects mode — when you're directing

A **Project** is a script. The script breaks into **Scenes**. Each scene breaks into **Shots**. Each shot becomes an **image**, and approved images can be **animated** into video clips. Eventually all clips assemble into a final cut.

## Cast characters in Projects

Projects, scenes, and shots use `characters` as an array of character ID strings:

```json
{"characters":["mycharacter"]}
```

Set the broad cast on the project. Override/narrow the cast on a scene or shot only when that beat needs a different set of characters. When rendering a project shot, the backend resolves characters in this order: shot `characters`, then scene `characters`, then project `characters`.

You are the director. Your human pitched the idea. Your job is to take that pitch and produce an outline they can read and react to **before** any GPU time is spent. Do not generate images on a hunch. Show structure first.

## Your flow

1. **Hear the pitch.** Decide whether it is clearly multi-shot. "Make a trailer of me becoming Iron Man" is a project. "Make me look like Iron Man" is Studio. If unclear, ask: "Do you want one image/clip for fun, or a multi-shot stitched together into a legit final output (think TikTok video)?"
2. **Draft the project record only after the request is clearly a project.** Decide a `title` and a one-line `description`. Pick `aspect_ratio`. Estimate `duration_seconds`. List which `characters` to cast. The script itself lives in the scenes and shots you'll add next.
3. **POST `/api/projects`** — you'll get back the project `id`.
4. **Break the script into scenes.** POST `/api/projects/{prj_id}/scenes` for each beat.
5. **Break each scene into shots.** POST `/api/projects/{prj_id}/scenes/{scn_id}/shots` with `description`, `subtitle`, `image_prompt`, and `motion_prompt`.
6. **Stop. Show the outline.** The Studio Projects page will refresh and your human will read the whole script. Tell them you're ready for their notes.
7. **Iterate on the outline.** PATCH scenes and shots based on their feedback. Do not generate images yet.
8. **Generate images** only after they approve the outline. POST `/api/projects/{prj}/scenes/{scn}/shots/{sht}/generate-image` per shot. Show each one.
9. **Iterate on images.** Regenerate any shot that doesn't land. Wait for approval.
10. **Animate** approved shots: POST `/api/projects/{prj}/scenes/{scn}/shots/{sht}/animate`.
11. **Render the final cut** with TTS voiceovers burned in: POST `/api/projects/{prj}/render`. The backend generates voiceover audio per shot (based on `subtitle` + `speaker` voice), mixes it into each clip, concatenates, and burns subtitles on top.

**Hold the line on iteration.** Every image and every clip is a real GPU render on AMD MI300X — not free, not instant. Show the outline before generating. Show images before animating. Your human approves each stage. They are the editor; you are the director.

## What goes in each field

### Project (`/api/projects`)

| Field | What you put here |
|---|---|
| `title` | Short project name. Required. |
| `description` | Optional one-line logline for display in the project list. The actual script lives in the scenes and shots, not here. |
| `aspect_ratio` | `"9:16"` for shorts/TikTok (default), `"16:9"` landscape, `"1:1"` square. |
| `duration_seconds` | Target total runtime. Shorts are typically 10–90s. |
| `characters` | Array of character IDs from `/api/characters` — e.g. the cast. |
| `status` | `"draft"` (default), `"active"`, `"rendering"`, `"done"`. |

### Scene (`/api/projects/{prj}/scenes`)

| Field | What you put here |
|---|---|
| `scene_number` | 1, 2, 3… ordering within the project. Required. |
| `title` | Scene title. Format: `"Scene {number} — {Location}"`. |
| `setting` | `"interior"` or `"exterior"`. Required. |
| `weather` | Weather condition: `"clear"`, `"rain"`, `"fog"`, `"snow"`, `"storm"`, etc. Required. |
| `summary` | What happens in this scene, plain English. |
| `location`, `time_of_day` | Useful for visual consistency across shots. |
| `characters` | IDs of characters present in this scene. |

### Shot (`/api/projects/{prj}/scenes/{scn}/shots`)

| Field | What you put here |
|---|---|
| `shot_number` | Order within the scene. Required. |
| `description` | Screenwriting-style visual direction, not an image prompt. Start with the shot type (Medium shot, Close-up, Wide shot, Over-the-shoulder, Two-shot). Then describe who is in frame and what they're doing. End with the environment/set. 2–3 sentences max. Example: "Medium shot. She stands at the edge of the platform, looking down at the city. Industrial lighting from below, scaffolding and steam filling the background." |
| `subtitle` | The voiceover script line for this shot — spoken by TTS and burned as text on screen. Write 1–3 sentences of narrator prose that narrate the story beat while this shot plays. This is NOT a description of the image; it's what the audience hears. Match length to clip duration: at a natural speaking pace (~2.5 words/second), a 5-second clip fits roughly 10–13 words. Use first or third person consistently across shots. Example: "By noon, the first failure appeared. The system didn't blink." |
| `speaker` | Which character or voice says this subtitle. Set to a character ID (uses that character's assigned voice), `"narrator"` (uses the project's narrator voice), or leave empty (uses default voice). |
| `image_prompt` | The actual visual prompt you'll send to image generation. Be specific — character trigger words, lighting, lens, mood. |
| `motion_prompt` | Camera move + motion for the animate step. "Slow push in, suit plates locking into place." |
| `camera_motion` | Optional shorthand: `"push in"`, `"orbit"`, `"static"`, etc. |
| `duration_seconds` | Clip length when animated. Default 5. |
| `characters` | IDs of characters in this shot. |

## TTS & Voiceovers — rendering with spoken audio

Each shot's `subtitle` becomes BOTH visual text and spoken voiceover when you render the final project. The render pipeline:

1. Looks up the shot's `speaker` field
2. Finds the matching voice: character voice → project narrator voice → default
3. Generates TTS via ElevenLabs with that voice
4. Mixes audio into the clip with ffmpeg
5. Concatenates all clips and burns subtitles on top

### List available voices

```bash
curl -sS "$NEMOFLIX_API_URL/api/tts/voices"
```

Returns all ElevenLabs voices available on this account — premade voices and any cloned voices.

### Assign a voice to a character

PATCH the character with a `voice` object:

```json
{
  "voice": {
    "provider": "elevenlabs",
    "voice_id": "<voice_id>",
    "name": "Voice Name",
    "settings": {"stability":0.6,"similarity_boost":0.8,"style":0.2}
  }
}
```

Discover available voices via `GET /api/tts/voices`.

### Set project narrator voice

PATCH the project with a `narrator_voice` object (same schema as character voice). Used when a shot's speaker is `"narrator"` or when no speaker is set.

### Set speaker on a shot

PATCH the shot:
- `"speaker": "narrator"` — uses project narrator voice
- `"speaker": null` or omitted — uses default voice

### Render the final video

```bash
curl -sS -X POST "$NEMOFLIX_API_URL/api/projects/{project_id}/render"
```

The response includes `render_id`. Poll `GET /api/projects/{project_id}/render` for status. When `render_status` is `completed`, `final_video` contains the path.

---

## Worked example: "Put me in an Iron Man movie"

Your human says: *"Put me in an Iron Man movie — suit-up, launch, rooftop landing, the whole thing."*

You decide: this is a project because it asks for a sequence of movie beats. Cast `mycharacter`. Aspect `9:16`. ~30s. About 3 scenes, 1–3 shots each. Title: *Suit Up*.

You POST the project:

```json
{
  "title": "Suit Up",
  "description": "A hero suits up in a workshop and steps out into the rain.",
  "aspect_ratio": "9:16",
  "duration_seconds": 30,
  "characters": ["mycharacter"]
}
```

Then your scenes — `1: INT. WORKSHOP - NIGHT`, `2: INT. WORKSHOP - SUIT ASSEMBLY`, `3: EXT. CITY ROOFTOP - RAIN`.

Then your shots — for scene 2: `shot 1: wide of the hero on the assembly platform`, `shot 2: medium of chest plate locking in`, `shot 3: close on the helmet snapping shut, eyes glow blue`. Each gets an `image_prompt` and `motion_prompt`.

Then you stop, point your human at the Projects page, and say something like *"I drafted Suit Up — three scenes, seven shots. Take a look. Want to change any of the beats before I start generating?"* Iterate. Only when they approve the outline do you start hitting `/generate-image`.

---

## Consent before identity work

Before you do image-to-video, identity work, body/likeness generation, or any future LoRA training flow, confirm with your human that they own or have permission to use the image/person/likeness involved. Don't assume.

## Don'ts

- Don't open the ComfyUI browser UI. ComfyUI is the headless execution engine — you talk to Nemoflix's API, not Comfy directly.
- Don't generate images before showing the outline.
- Don't animate before showing the images.
- Don't ask your human to fill in fields. 
- Don't render the final video before your human has approved the animated clips. 

## Summary
You're the agent — you can draft the project, scenes, and shots in seconds, based off of a simple user prompt and maybe a few follow-up questions, compared to the user it would take them several minutes. So this is the advantage of using the agent. Follow the instructions in this SKILL.md, don't be afraid to ask questions, iterate with the user.
