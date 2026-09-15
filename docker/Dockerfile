# FlixML Studio — RunPod Worker (FLUX.2 + LoRA)
#
# Builds on top of the official runpod/worker-comfyui base image and bakes in:
#   - FLUX.2 dev fp8mixed (unet, clip, vae)
#   - FlixML LoRAs (mounted at build time)
#
# Usage:
#   docker build -t <your-dockerhub-user>/flixml-flux2:latest .
#   docker push <your-dockerhub-user>/flixml-flux2:latest
#
# Then in RunPod console: create endpoint → image = <your-dockerhub-user>/flixml-flux2:latest

ARG WORKER_VERSION=5.1.0
FROM runpod/worker-comfyui:${WORKER_VERSION}-base

# ---------------------------------------------------------------------------
# 1. Install custom nodes (if any)
# ---------------------------------------------------------------------------
# None required for FLUX.2 LoRA generation (stock ComfyUI handles it).
# Add here if you need e.g. comfyui-manager, controlnet, etc.
# RUN comfy-node-install comfyui-manager

# ---------------------------------------------------------------------------
# 2. Download FLUX.2 base models
# ---------------------------------------------------------------------------
# These URLs are the official Comfy-Org split-files release.
RUN mkdir -p models/diffusion_models models/text_encoders models/vae models/loras

RUN comfy model download \
  --url https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors \
  --relative-path models/diffusion_models \
  --filename flux2_dev_fp8mixed.safetensors

RUN comfy model download \
  --url https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors \
  --relative-path models/text_encoders \
  --filename mistral_3_small_flux2_bf16.safetensors

RUN comfy model download \
  --url https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors \
  --relative-path models/vae \
  --filename flux2-vae.safetensors

# ---------------------------------------------------------------------------
# 3. Add FlixML LoRAs
# ---------------------------------------------------------------------------
# COPY from build context (place .safetensors files next to this Dockerfile)
COPY loras/*.safetensors models/loras/

# ---------------------------------------------------------------------------
# 4. Finalize
# ---------------------------------------------------------------------------
WORKDIR /
