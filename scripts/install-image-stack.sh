#!/bin/bash
set -Eeuo pipefail
set -x

COMFY_DIR="${COMFY_DIR:-/root/ComfyUI}"
COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"
# Optional VPS control-plane API. On disposable GPU workers this may be unset;
# this script must still succeed with ComfyUI-only verification.
NEMOFLIX_API_URL="${NEMOFLIX_API_URL:-}"
HF_BASE_FLUX2="https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files"
HF_BASE_Z_IMAGE="https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files"
RUN_IMAGE_STACK_TEST="${RUN_IMAGE_STACK_TEST:-0}"
IMAGE_STACK_TEST_PROMPT="${IMAGE_STACK_TEST_PROMPT:-realistic social media creator photo, confident person filming lifestyle content, modern studio setup, smartphone camera, soft natural light, polished Instagram aesthetic}"
IMAGE_STACK_TEST_CHECKPOINT="${IMAGE_STACK_TEST_CHECKPOINT:-latest}"

mkdir -p \
  "$COMFY_DIR/models/diffusion_models" \
  "$COMFY_DIR/models/loras/nemoflix-amd" \
  "$COMFY_DIR/models/text_encoders" \
  "$COMFY_DIR/models/vae"

download_if_missing() {
    local url="$1"
    local dest="$2"
    if [ -s "$dest" ]; then
        echo "exists: $dest"
        return 0
    fi
    mkdir -p "$(dirname "$dest")"
    wget -q --show-progress "$url" -O "$dest.tmp"
    test -s "$dest.tmp"
    mv "$dest.tmp" "$dest"
}

# Official Comfy FLUX.2 image stack.
# Source: Comfy workflow template `templates-all_in_one-image_edit_models.json`.
download_if_missing "$HF_BASE_FLUX2/diffusion_models/flux2_dev_fp8mixed.safetensors" "$COMFY_DIR/models/diffusion_models/flux2_dev_fp8mixed.safetensors"
download_if_missing "$HF_BASE_FLUX2/vae/flux2-vae.safetensors" "$COMFY_DIR/models/vae/flux2-vae.safetensors"
download_if_missing "$HF_BASE_FLUX2/text_encoders/mistral_3_small_flux2_bf16.safetensors" "$COMFY_DIR/models/text_encoders/mistral_3_small_flux2_bf16.safetensors"
download_if_missing "$HF_BASE_Z_IMAGE/text_encoders/qwen_3_4b.safetensors" "$COMFY_DIR/models/text_encoders/qwen_3_4b.safetensors"

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files comfyui.service >/dev/null 2>&1; then
    systemctl restart comfyui.service
fi

for i in {1..60}; do
    if curl -sS --max-time 5 "$COMFY_URL/system_stats" >/dev/null; then
        break
    fi
    echo "Waiting for ComfyUI API... ($i/60)"
    sleep 5
done

curl -sS --max-time 10 "$COMFY_URL/system_stats"
curl -sS --max-time 10 "$COMFY_URL/models/diffusion_models"
curl -sS --max-time 10 "$COMFY_URL/models/text_encoders"
curl -sS --max-time 10 "$COMFY_URL/models/vae"
curl -sS --max-time 10 "$COMFY_URL/models/loras"

if [ -n "$NEMOFLIX_API_URL" ]; then
    curl -sS --max-time 10 "$NEMOFLIX_API_URL/api/health"
fi

if [ "$RUN_IMAGE_STACK_TEST" = "1" ]; then
    if [ -z "$NEMOFLIX_API_URL" ]; then
        echo "ERROR: RUN_IMAGE_STACK_TEST=1 requires NEMOFLIX_API_URL pointing at the VPS control-plane API."
        exit 1
    fi
    curl -sS -X POST "$NEMOFLIX_API_URL/api/lora-training/generate" \
      -H "Content-Type: application/json" \
      -d "{\"checkpoint\":\"${IMAGE_STACK_TEST_CHECKPOINT}\",\"prompt\":\"${IMAGE_STACK_TEST_PROMPT}\",\"submit\":false}"
fi

echo "FLUX.2 image stack installed"
