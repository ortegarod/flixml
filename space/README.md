---
title: Nemoflix AMD Gallery
emoji: 🎬
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: true
tags:
  - amd
  - amd-hackathon-2026
  - comfyui
  - video-generation
  - lora
---

# Nemoflix AMD Gallery

Hosted Nemoflix Studio UI for the AMD MI300X hackathon demo.

This Space serves the real React/Vite Studio UI and proxies API/media requests to the Nemoflix AMD control-plane API.

## Required Space secret

| Secret | Description |
| --- | --- |
| `NEMOFLIX_API_URL` | URL for the Nemoflix API|
