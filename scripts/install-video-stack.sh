#!/bin/bash
set -Eeuo pipefail
set -x

COMFY_DIR="${COMFY_DIR:-/root/ComfyUI}"
COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"
# Optional VPS control-plane API. On disposable GPU workers this may be unset;
# this script must still succeed with ComfyUI-only verification.
NEMOFLIX_API_URL="${NEMOFLIX_API_URL:-}"
HF_BASE_WAN22="https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files"
HF_BASE_WAN21="https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files"
RUN_VIDEO_TEST="${RUN_VIDEO_TEST:-1}"

mkdir -p \
  "$COMFY_DIR/models/diffusion_models" \
  "$COMFY_DIR/models/loras" \
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

# Official Comfy-Org Wan 2.2 14B I2V stack.
download_if_missing "$HF_BASE_WAN22/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors" "$COMFY_DIR/models/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
download_if_missing "$HF_BASE_WAN22/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors" "$COMFY_DIR/models/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
download_if_missing "$HF_BASE_WAN22/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors" "$COMFY_DIR/models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors"
download_if_missing "$HF_BASE_WAN22/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors" "$COMFY_DIR/models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors"
download_if_missing "$HF_BASE_WAN22/vae/wan_2.1_vae.safetensors" "$COMFY_DIR/models/vae/wan_2.1_vae.safetensors"
download_if_missing "$HF_BASE_WAN21/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" "$COMFY_DIR/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"

# Official Comfy-Org Wan 2.2 14B T2V stack.
download_if_missing "$HF_BASE_WAN22/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors" "$COMFY_DIR/models/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors"
download_if_missing "$HF_BASE_WAN22/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors" "$COMFY_DIR/models/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors"
download_if_missing "$HF_BASE_WAN22/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors" "$COMFY_DIR/models/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors"
download_if_missing "$HF_BASE_WAN22/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors" "$COMFY_DIR/models/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors"

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
if [ -n "$NEMOFLIX_API_URL" ]; then
    curl -sS --max-time 10 "$NEMOFLIX_API_URL/api/health"
fi

echo "Wan 2.2 video stack installed"
