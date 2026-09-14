# FlixML Studio

FlixML Studio is a media generation workbench. It runs image and video generation through ComfyUI workflows, trains LoRAs, and exposes everything through a clean REST API with a React UI for browsing, organizing, and queuing work. Jobs are tracked from queue to completion, routed across GPU providers, and organized into projects, scenes, and shots with persistent characters.

It ships with built-in workflows and lets you add your own.

Two ways to use it:

- **API-first** — generate images and video, manage projects, and train LoRAs through a clean REST API. AI agents call the same endpoints humans do.
- **Studio UI** — browse generations, organize projects into scenes and shots, manage characters, and queue jobs without touching code.

## Core Concepts

### Image and Video Generation

The main job of the Studio is running image and video generation. You pick a workflow by ID, send a prompt and a few parameters, and the Studio queues the job on the right GPU.

### Projects, Scenes, and Shots

Organize work like a film:

- **Project** — a film, campaign, or collection
- **Scene** — a sequence within the project
- **Shot** — a single image or video clip with version history

Generate inside the structure, or generate standalone.

### Workflows

FlixML Studio is built on [ComfyUI](https://github.com/comfyanonymous/ComfyUI) workflows. Add a workflow JSON file, reference it by ID when generating, and the Studio fills in variables at request time. Built-ins are listed in [docs/WORKFLOWS.md](./docs/WORKFLOWS.md). The template variables are documented in `app/flixml/workflows/registry.py`.

### Providers

Any GPU that runs ComfyUI. Local nodes, remote servers, or RunPod serverless. The API stays the same — the GPU location is just configuration.

```json
// config.json
{
  "gpu_nodes": [
    { "id": "gpu-1", "roles": ["image"], "comfyui": { "url": "http://<your-comfyui-host>:<port>" } },
    { "id": "gpu-2", "roles": ["video"], "comfyui": { "url": "http://<your-comfyui-host>:<port>" } }
  ]
}
```

Each node becomes a provider named `local-<id>`, here `local-gpu-1` and `local-gpu-2`. Studio rejects a video job sent to a node without the `video` role.

### Characters

Register persistent characters with LoRA associations, trigger words, and reference images. Reference them by name in any generation — the Studio resolves the right LoRA and injects the trigger words automatically.

### Agent Identity & API Keys

Multiple callers — AI agents, scripts, humans — can share one Studio instance's generation queue. Send `Authorization: Bearer <key>` on `/api/image/generate` or `/api/video/generate` to attribute a job to an agent identity, optionally scoped to specific characters/workflows or capped on concurrent jobs.

Provision keys with `scripts/manage_agent_keys.py` (`create`, `list`, `rotate`, `revoke`, `enable`) — there's no HTTP endpoint for minting them, so only someone with shell access to the box can create one. Keys are stored as SHA-256 hashes, never plaintext.

Enforcement is off by default (`config.json` `security.require_api_key: false`): requests with no key, or an unrecognized one, still work — they just aren't attributed. Set it to `true` once every caller you care about has a key; unscoped/anonymous requests then get rejected with 401.

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL
- A running ComfyUI instance (local, remote, or serverless like RunPod)

Add the ComfyUI URL to `config.json` so the Studio can route jobs to it as a provider. See Providers above for an example.

### Installation

```bash
git clone https://github.com/ortegarod/flixml.git
cd flixml

# API
cd app && pip install -r requirements.txt

# Copy environment variables and edit them
cp .env.example .env
# Edit .env to set DATABASE_URL, NEMOFLIX_OUTPUT_DIR, etc.

# Create the PostgreSQL database
createdb nemoflix_studio

# Start the API — migrations run automatically
cd app && python -m flixml

# Studio UI
cd ../studio && npm install && npm run dev
```

See `.env.example` for all available variables.

| Variable | Description |
|---|---|
| `NEMOFLIX_API_URL` | URL the Studio UI uses to reach the backend |
| `DATABASE_URL` | PostgreSQL connection string |
| `NEMOFLIX_OUTPUT_DIR` | Directory where generated media is stored |
| `ELEVENLABS_API_KEY` | Optional. Lists ElevenLabs voices at `/api/tts/voices`. |

## Quick API Example

Generate an image:

```bash
curl -X POST <your-api-url>/api/image/generate \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": "<workflow-id>",
    "prompt": "portrait of a woman in a red dress, soft studio lighting",
    "provider": "<provider-id>",
    "width": 1024,
    "height": 1024
  }'
```

For agents: [SKILL.md](./SKILL.md) covers images, video, lip-sync, and multi-shot projects. The field reference is `GET /openapi.json`.

## LoRA Training

Register a dataset, start training, monitor checkpoints — all through the API. The examples below use `<your-api-url>` as a placeholder for your Studio API base URL.

### Configuration

LoRA training is designed around disposable DigitalOcean GPU droplets. Set these variables so the Studio can provision an AMD ROCm droplet, install AI Toolkit, and run training in one step:

| Variable | Description |
|---|---|
| `DIGITALOCEAN_TOKEN` | DigitalOcean API token |
| `TRAINING_CLOUD_SIZE` | Droplet size slug |
| `TRAINING_CLOUD_IMAGE` | Droplet image slug |
| `TRAINING_CLOUD_TTL_HOURS` | Droplet lifetime in hours |
| `TRAINING_CLOUD_REPO_URL` | Repository cloned onto the droplet |
| `TRAINING_CLOUD_SSH_KEYS` | Comma-separated SSH key IDs or fingerprints |

If you already run your own AI Toolkit server, point the Studio at it instead:

| Variable | Description |
|---|---|
| `AITK_API_URL` | AI Toolkit API URL |
| `AITK_API_TOKEN` | AI Toolkit API token — optional |
| `AITK_GPU_IDS` | GPU IDs to use for training — optional |

### Usage

```bash
# Register dataset
curl -X POST <your-api-url>/api/lora-training/datasets \
  -d '{"id": "my-character", "name": "My Character"}'

# Start training
curl -X POST <your-api-url>/api/lora-training/start \
  -d '{
    "job_name": "my-character-v1",
    "trigger_word": "mycharacter",
    "dataset": "my-character",
    "base_config": "flux2_identity"
  }'

# Check status
curl <your-api-url>/api/lora-training/status?job_name=my-character-v1

# List checkpoints
curl <your-api-url>/api/lora-training/checkpoints
```

Training runs on AMD ROCm via the Ostris AI Toolkit.

## Repository Layout

| Path | Purpose |
|---|---|
| `app/` | FastAPI backend and workflow engine |
| `studio/` | React + Vite frontend |
| `migrations/` | Database migrations |
| `docker/` | Container setup |
| `SKILL.md` | Agent guide (also served raw at `/api/guide`) |

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

*Built for creators who want to work with ideas, not node graphs.*
