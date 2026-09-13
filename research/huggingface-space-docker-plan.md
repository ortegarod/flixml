# Hugging Face Space Docker Migration Plan

## Goal

Replace the temporary Gradio Space UI with the existing Nemoflix AMD Studio UI so we maintain one frontend instead of two.

Current Space:

- Repo: `lablab-ai-amd-developer-hackathon/nemoflix-amd-video`
- URL: `https://huggingface.co/spaces/lablab-ai-amd-developer-hackathon/nemoflix-amd-video`
- Current SDK: Gradio
- Problem: Gradio UI duplicates Studio UI and has image rendering issues when hosted on Hugging Face.

Target Space:

- SDK: Docker
- App: existing `studio/` React/Vite UI
- Runtime server: small HTTP server on port `7860`
- Backend: live Nemoflix AMD API on the MI300X droplet

## Why Docker

Hugging Face Spaces support multiple SDKs. Docker lets us host the real Studio UI instead of rebuilding a second UI in Gradio.

Benefits:

1. **One UI to maintain**
   - Studio remains the source of truth.
   - No duplicated Gradio components.

2. **Fixes image loading cleanly**
   - Browser talks to the HF Space origin over HTTPS.
   - Docker server proxies `/media/*` to the backend droplet.
   - Avoids browser mixed-content blocking from `https://huggingface.co` trying to load `http://134.x.x.x` images directly.

3. **Matches local/custom UI behavior**
   - Same React components.
   - Same gallery, LoRA, checkpoints, jobs, and generation UX.

4. **More professional hackathon demo**
   - Space looks like the product, not a temporary control panel.

## Architecture

```text
Browser
  |
  | HTTPS
  v
Hugging Face Space Docker app :7860
  |
  | serves built Studio UI
  |
  | proxies /api/* and /media/*
  v
Nemoflix AMD backend droplet :8190
  |
  v
ComfyUI :8188 + MI300X
```

## Required Space config

Update `README.md` frontmatter from Gradio:

```yaml
sdk: gradio
sdk_version: 5.29.0
app_file: app.py
```

to Docker:

```yaml
sdk: docker
app_port: 7860
```

Keep useful metadata:

```yaml
title: Nemoflix AMD Gallery
emoji: 🎬
colorFrom: red
colorTo: yellow
pinned: true
tags:
  - amd
  - amd-hackathon-2026
  - comfyui
  - video-generation
  - lora
```

## Space files

Recommended Space repo layout:

```text
README.md
Dockerfile
server.js
package.json
studio/
  package.json
  package-lock.json
  index.html
  src/
  vite.config.ts
  tsconfig*.json
  tailwind.config.js
  postcss.config.js
```

Alternative: copy prebuilt `dist/`, but building inside Docker is more reproducible.

## Server responsibilities

Use a small Node server, probably Express, to:

1. Serve static Studio build from `studio/dist`.
2. Proxy backend calls:
   - `/api/*` → `${NEMOFLIX_API_URL}/api/*`
   - `/media/*` → `${NEMOFLIX_API_URL}/media/*`
3. Fallback all unknown routes to `index.html` for SPA routing.
4. Listen on `0.0.0.0:7860`.

Environment variable:

```bash
NEMOFLIX_API_URL=http://134.199.200.202:8190
```

The server should normalize host-only values defensively:

- `134.199.200.202` → `http://134.199.200.202:8190`
- `http://134.199.200.202` → `http://134.199.200.202:8190`

## Dockerfile outline

```Dockerfile
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY server.js ./
COPY studio ./studio

WORKDIR /app/studio
RUN npm ci
RUN npm run build

WORKDIR /app
RUN npm install --omit=dev

ENV PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]
```

If root `package.json` only exists for the server, keep server dependencies there:

```json
{
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "latest",
    "http-proxy-middleware": "latest"
  }
}
```

## Vite config requirement

The Studio build should call relative paths:

- `/api/...`
- `/media/...`

Do **not** bake the droplet IP into the browser build.

The Docker server owns backend routing.

## Migration steps

1. **Create a local Space Docker staging folder**
   - Do not push directly to HF.
   - Copy current `studio/` source.
   - Add `Dockerfile`, `server.js`, root `package.json`, updated `README.md`.

2. **Verify local Docker build**

   ```bash
   docker build -t nemoflix-amd-space .
   docker run --rm -p 7860:7860 \
     -e NEMOFLIX_API_URL=http://134.199.200.202:8190 \
     nemoflix-amd-space
   ```

3. **Verify locally in browser**
   - Open `http://<host>:7860` or local exposed URL.
   - Check backend health.
   - Confirm LoRA status.
   - Confirm checkpoints.
   - Confirm gallery images render through `/media/...`.
   - Queue a test image only if appropriate.

4. **Push once to Hugging Face Space**
   - Use `huggingface_hub.upload_folder()` or git/Xet-compatible upload.
   - Commit message: `Use Docker Studio UI for AMD Space`.

5. **Set/confirm Space secret**
   - `NEMOFLIX_API_URL=http://134.199.200.202:8190`

6. **Factory reboot Space**
   - Required after SDK change.

7. **Final verification on HF**
   - Space loads Studio UI.
   - Backend online.
   - Gallery media visible.
   - No Gradio UI.
   - No broken image placeholders.

## Risks / gotchas

- Docker build may take longer than Gradio.
- HF cache may require factory reboot after SDK change.
- If backend droplet is destroyed/offline, UI should show a clear backend unavailable state.
- Do not commit secrets.
- Do not commit `.venv`, `node_modules`, build cache, or local output junk.
- Avoid pushing multiple experimental commits to the public Space. Build/test locally first, then push once.

## Recommendation

Proceed with Docker migration after the hackathon backend is stable enough to test against.

This should replace the Gradio Space entirely and make the Hugging Face Space a hosted version of the real Nemoflix AMD Studio UI.
