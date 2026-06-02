#!/bin/bash
set -Eeuo pipefail
set -x

# Install HF diffusers training stack on AMD MI300X ROCm droplet
# Run this AFTER scripts/startup-script.sh has completed successfully

PYTHON_BIN="/root/comfyui-venv/bin/python"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TRAINING_DIR="${TRAINING_DIR:-$REPO_DIR/training}"
DIFFUSERS_DIR="/root/diffusers"

echo "=== Installing HF Diffusers Training Stack ==="

# 1. Clone diffusers from source (official HF recommendation for latest examples)
if [ ! -d "$DIFFUSERS_DIR" ]; then
    echo "=== Cloning Hugging Face diffusers ==="
    git clone --depth 1 https://github.com/huggingface/diffusers.git "$DIFFUSERS_DIR"
fi

# 2. Install diffusers from source
"$PYTHON_BIN" -m pip install -e "$DIFFUSERS_DIR"

# 3. Install training dependencies
"$PYTHON_BIN" -m pip install -r "$DIFFUSERS_DIR/examples/text_to_image/requirements.txt"

# 4. Install accelerate and configure for single-GPU ROCm
"$PYTHON_BIN" -m pip install accelerate
"$PYTHON_BIN" -m accelerate config default

# 5. Create training workspace
echo "=== Creating training workspace ==="
mkdir -p "$TRAINING_DIR"
mkdir -p "$TRAINING_DIR/datasets"
mkdir -p "$TRAINING_DIR/outputs"
mkdir -p "$TRAINING_DIR/logs"

# 6. Write a sample training script for SDXL LoRA
cat > "$TRAINING_DIR/train-lora-sdxl.sh" << 'EOF'
#!/bin/bash
set -Eeuo pipefail

# SDXL LoRA training script using HF diffusers
# Usage: ./train-lora-sdxl.sh /path/to/dataset output_name

DATASET_DIR="${1:-/root/nemoflix-studio/training/datasets/sample}"
OUTPUT_NAME="${2:-my-lora}"
OUTPUT_DIR="/root/nemoflix-studio/training/outputs/${OUTPUT_NAME}"
PYTHON_BIN="/root/comfyui-venv/bin/python"

echo "=== Training SDXL LoRA ==="
echo "Dataset: $DATASET_DIR"
echo "Output:  $OUTPUT_DIR"

# Ensure dataset exists
if [ ! -d "$DATASET_DIR" ]; then
    echo "ERROR: Dataset directory not found: $DATASET_DIR"
    echo "Place images + caption .txt files in the dataset folder."
    exit 1
fi

# Run training
"$PYTHON_BIN" -m accelerate launch \
    /root/diffusers/examples/text_to_image/train_text_to_image_lora_sdxl.py \
    --pretrained_model_name_or_path="stabilityai/stable-diffusion-xl-base-1.0" \
    --train_data_dir="$DATASET_DIR" \
    --output_dir="$OUTPUT_DIR" \
    --rank=16 \
    --lora_alpha=16 \
    --learning_rate=1e-4 \
    --max_train_steps=1500 \
    --resolution=1024 \
    --train_batch_size=1 \
    --gradient_accumulation_steps=4 \
    --mixed_precision="bf16" \
    --report_to="none" \
    --validation_prompt="a photo of sks person" \
    --validation_epochs=5 \
    --checkpointing_steps=500 \
    --seed=42

echo "=== Training complete ==="
echo "LoRA saved to: $OUTPUT_DIR"
echo "Copy the .safetensors file to /root/ComfyUI/models/loras/ to use in ComfyUI"
EOF

chmod +x "$TRAINING_DIR/train-lora-sdxl.sh"

# 7. Write dataset prep notes
cat > "$TRAINING_DIR/README.md" << 'EOF'
# Nemoflix Training Workspace

## Dataset Format

Place images in `datasets/<name>/` with matching `.txt` caption files:

```
datasets/sample/
  img01.jpg
  img01.txt
  img02.jpg
  img02.txt
```

Caption files contain the prompt text. Include your trigger word, e.g.:
```
a photo of sks person, smiling, outdoor lighting
```

## Run Training

```bash
./train-lora-sdxl.sh datasets/sample my-lora
```

## Outputs

Trained LoRAs land in `outputs/<name>/`. Copy the `.safetensors` file to:
```
/root/ComfyUI/models/loras/
```

Then use it in ComfyUI with a `Load LoRA` node.
EOF

echo "=== Installation complete ==="
echo "Training workspace: $TRAINING_DIR"
echo "Sample script:      $TRAINING_DIR/train-lora-sdxl.sh"
echo "Next steps:"
echo "  1. Prepare dataset in $TRAINING_DIR/datasets/sample/"
echo "  2. Run: $TRAINING_DIR/train-lora-sdxl.sh"
