# Nemoflix Studio

A **workflow-driven creative engine** for AI image, video, and voice generation. Drop in ComfyUI workflows, connect your GPUs, and produce media through a clean API — or let your agent handle it.

## What It Is

Nemoflix Studio sits between you and ComfyUI. You work with **named workflows** instead of raw node graphs. You describe what you want in natural language prompts. The Studio builds the workflow, routes it to the right GPU, and tracks the job from queue to completion.

Built for two modes of operation:

- **API-first** — generate images, video, and voice through a clean REST API. AI agents call the same endpoints humans do.
- **Studio UI** — browse generations, manage projects, and edit shots in a React interface.

## Core Concepts

### Workflows

ComfyUI JSON templates with `{{variable}}` placeholders. Register a workflow once, generate from it forever.

```json
// workflows/flux2_lora.json — a template
{
  "1": {
    "inputs": {
      "text": "{{prompt}}",
      "width": {{width}},
      "seed": {{seed}}
    },
    "class_type": "CLIPTextEncode"
  }
}
```

Call it by name:

```bash
curl -X POST http://localhost:8190/api/image/generate \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "flux2_lora",
    "prompt": "a cyberpunk street at night, neon reflections on wet pavement",
    "provider": "srv01"
  }'
```

### Providers

Any GPU that runs ComfyUI. Local nodes, remote servers, or RunPod serverless. The API stays the same — the GPU location is just configuration.

```json
// config.json
{
  "gpu_nodes": [
    { "id": "srv01", "roles": ["image"], "comfyui": { "url": "http://192.168.1.100:8188" } },
    { "id": "pc", "roles": ["video"], "comfyui": { "url": "http://192.168.1.101:8188" } }
  ]
}
```

Role-based routing prevents video jobs from landing on image-only nodes.

### Projects, Scenes, and Shots

Organize your creative work:

- **Project** — a film, campaign, or collection
- **Scene** — a sequence within the project
- **Shot** — a single image or video clip with version history

Generate inside the structure, or generate standalone. The API supports both.

### Characters

Register persistent characters with LoRA associations, trigger words, and reference images. Reference them by name in any generation — the Studio resolves the right LoRA and injects the trigger words automatically.

## Features

| Feature | Status |
|---------|--------|
| Image generation (FLUX, SDXL, SDXL) | ✅ Built-in workflows |
| Video generation (Wan 2.1) | ✅ Text-to-video and image-to-video |
| LoRA training | ✅ Ostris AI Toolkit on AMD ROCm |
| Multi-GPU routing | ✅ Local + RunPod serverless |
| Project/scene/shot organization | ✅ Full project structure with versions |
| Character profiles | ✅ LoRA + trigger word + reference image |
| Voice generation | ✅ ElevenLabs integration |
| Agent API | ✅ Single REST surface for all operations |
| Studio UI | ✅ React + Vite for browsing and editing |

## Architecture

| Layer | Technology |
|---|---|
| API | FastAPI (Python) |
| Generation engine | ComfyUI (via JSON API) |
| Workflow system | Template registry with variable substitution |
| Provider abstraction | Local nodes + RunPod serverless |
| Training | Ostris AI Toolkit (ROCm) |
| Studio UI | React + Vite |
| Database | PostgreSQL |

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL
- ComfyUI instance (local or remote)

### Installation

```bash
git clone https://github.com/ortegarod/nemoflix-studio.git
cd nemoflix-studio

# API
cd api && pip install -r requirements.txt

# Studio UI
cd ../studio && npm install && npm run dev
```

### Configuration

Copy `.env.example` to `.env`:

| Variable | Description |
|---|---|
| `COMFY_URL` | ComfyUI base URL |
| `DATABASE_URL` | PostgreSQL connection string |
| `AITK_API_URL` | AI Toolkit API URL (for training) |
| `NEMOFLIX_OUTPUT_DIR` | Output directory |
| `ELEVENLABS_API_KEY` | TTS — optional |
| `RUNPOD_API_KEY` | RunPod serverless — optional |
| `RUNPOD_ENDPOINT_ID` | RunPod endpoint — optional |

GPU nodes live in `config.json`. RunPod auto-registers when the env vars are present.

## Usage

### Generate an Image

```bash
curl -X POST http://localhost:8190/api/image/generate \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "flux2_lora",
    "prompt": "portrait of a woman in a red dress, soft studio lighting",
    "provider": "srv01",
    "width": 1024,
    "height": 1024
  }'
```

Returns `prompt_id`. Check status:

```bash
curl http://localhost:8190/api/jobs/<prompt_id>
```

### Generate a Video

```bash
curl -X POST http://localhost:8190/api/video/generate \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "wan22_i2v",
    "prompt": "slow motion, camera panning left, cinematic",
    "image": "path/to/reference.png",
    "provider": "pc",
    "mode": "i2v"
  }'
```

### Discover Workflows

```bash
# List available workflows
curl http://localhost:8190/api/workflows

# List providers
curl http://localhost:8190/api/providers
```

### Project Workflow

```bash
# Create a project
curl -X POST http://localhost:8190/api/projects \
  -d '{"name": "Cyberpunk Short", "aspect_ratio": "16:9"}'

# Add a scene
curl -X POST http://localhost:8190/api/projects/<id>/scenes \
  -d '{"name": "Opening"}'

# Add a shot and generate
curl -X POST http://localhost:8190/api/projects/<id>/scenes/<id>/shots \
  -d '{"description": "neon cityscape at dusk", "duration_seconds": 5}'

curl -X POST http://localhost:8190/api/projects/<id>/scenes/<id>/shots/<id>/generate-image \
  -d '{"workflow": "flux2_lora", "provider": "srv01"}'
```

## LoRA Training

Register a dataset, start training, monitor checkpoints — all through the API.

```bash
# Register dataset
curl -X POST http://localhost:8190/api/lora-training/datasets \
  -d '{"id": "my-character", "name": "My Character"}'

# Start training
curl -X POST http://localhost:8190/api/lora-training/start \
  -d '{
    "job_name": "my-character-v1",
    "trigger_word": "mycharacter",
    "dataset": "my-character",
    "base_config": "flux2_identity"
  }'

# Check status
curl http://localhost:8190/api/lora-training/status?job_name=my-character-v1

# List checkpoints
curl http://localhost:8190/api/lora-training/checkpoints
```

Training runs on AMD ROCm via the Ostris AI Toolkit.

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

*Built for creators who want to work with ideas, not node graphs.*
