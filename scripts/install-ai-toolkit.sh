#!/bin/bash
set -Eeuo pipefail
set -x

# Install Ostris AI Toolkit on a disposable AMD MI300X ROCm droplet.

APT_GET="apt-get -o DPkg::Lock::Timeout=300"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLKIT_DIR="${TOOLKIT_DIR:-/root/ai-toolkit}"
TOOLKIT_VENV="${TOOLKIT_VENV:-/root/ai-toolkit-venv}"
TRAINING_DIR="${TRAINING_DIR:-$REPO_DIR/training}"
ROCM_INDEX_PRIMARY="${ROCM_INDEX_PRIMARY:-https://download.pytorch.org/whl/rocm7.2}"
ROCM_INDEX_FALLBACK="${ROCM_INDEX_FALLBACK:-https://download.pytorch.org/whl/rocm7.0}"
AI_TOOLKIT_REF="${AI_TOOLKIT_REF:-main}"
INSTALL_UI_DEPS="${INSTALL_UI_DEPS:-1}"
AITK_AUTH_TOKEN="${AITK_AUTH_TOKEN:-nemoflix-aitk-secret}"
AITK_GPU_IDS="${AITK_GPU_IDS:-0}"
PYTHON_BIN="$TOOLKIT_VENV/bin/python"
export DEBIAN_FRONTEND=noninteractive
# Do not let Ubuntu's needrestart apt hook bounce services while we are connected
# over SSH. The AMD images default to automatic restarts; list-only keeps the
# installer non-interactive without touching sshd/network services mid-run.
export NEEDRESTART_MODE=l

trap 'echo "ERROR: AI Toolkit install failed at line $LINENO"' ERR

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root on the AMD droplet."
  exit 1
fi

# Fresh droplets often start unattended-upgrades on first boot, grabbing the apt lock.
# Stop all apt-related services and kill any running apt processes so our apt-get
# install can proceed. The droplet is disposable; we do not re-enable them.
echo "=== Disabling automatic apt locks ==="
systemctl stop apt-daily.service apt-daily-upgrade.service apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
systemctl mask apt-daily.service apt-daily-upgrade.service 2>/dev/null || true
killall -9 unattended-upgrade apt apt-get 2>/dev/null || true
sleep 2

# Give the lock file a moment to clear, then check
_lock_wait_deadline=$(($(date +%s) + 30))
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$_lock_wait_deadline" ]; then
    echo "WARNING: apt lock still held after 30s of cleanup"
    break
  fi
  echo "Waiting for apt lock to clear..."
  sleep 5
done

echo "=== Installing AI Toolkit prerequisites ==="
$APT_GET update -y
$APT_GET install -y git git-lfs python3-pip python3.12-venv python3-dev build-essential pkg-config curl wget ffmpeg libgl1 libglib2.0-0

git lfs install --system || true

if command -v /opt/rocm/bin/rocm-smi >/dev/null 2>&1; then
  echo "=== ROCm GPU check ==="
  /opt/rocm/bin/rocm-smi || true
fi

echo "=== Creating isolated AI Toolkit venv: $TOOLKIT_VENV ==="
if [ ! -d "$TOOLKIT_VENV" ]; then
  python3 -m venv "$TOOLKIT_VENV"
fi
"$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel

echo "=== Installing ROCm PyTorch into AI Toolkit venv ==="
"$PYTHON_BIN" -m pip install torch torchvision torchaudio --index-url "$ROCM_INDEX_PRIMARY" || \
"$PYTHON_BIN" -m pip install torch torchvision torchaudio --index-url "$ROCM_INDEX_FALLBACK"

"$PYTHON_BIN" - <<'PY'
import torch
print('torch', torch.__version__)
print('cuda api available', torch.cuda.is_available())
if torch.cuda.is_available():
    print('device', torch.cuda.get_device_name(0))
PY

echo "=== Cloning/updating Ostris AI Toolkit ==="
if [ ! -d "$TOOLKIT_DIR/.git" ]; then
  git clone https://github.com/ostris/ai-toolkit.git "$TOOLKIT_DIR"
fi
git -C "$TOOLKIT_DIR" fetch --depth 1 origin "$AI_TOOLKIT_REF"
git -C "$TOOLKIT_DIR" checkout FETCH_HEAD
git -C "$TOOLKIT_DIR" submodule update --init --recursive

echo "=== Installing AI Toolkit Python requirements ==="
# Keep the ROCm torch we installed above; do not allow requirements to swap in CUDA wheels.
"$PYTHON_BIN" -m pip install -r "$TOOLKIT_DIR/requirements.txt" --extra-index-url "$ROCM_INDEX_PRIMARY"
"$PYTHON_BIN" -m pip install --upgrade accelerate huggingface_hub hf_transfer

mkdir -p \
  "$TRAINING_DIR/datasets" \
  "$TRAINING_DIR/output" \
  "$TRAINING_DIR/samples" \
  "$TRAINING_DIR/config" \
  "$TOOLKIT_DIR/config"

# Seed checked-in config templates into the runtime config directory.
# TRAINING_DIR defaults to the cloned Studio repo's training/ directory, so this
# copy usually just makes editable job configs under training/config/.
if compgen -G "$REPO_DIR/training/*.yaml" >/dev/null; then
  cp -f "$REPO_DIR"/training/*.yaml "$TRAINING_DIR/config/"
fi

cat > "$TRAINING_DIR/README.md" <<'EOF'
# Nemoflix AI Toolkit Training Workspace

Training layout for disposable AMD droplets. The Studio repo is cloned at
`/root/nemoflix-studio`; datasets/config/output live under that repo's
`training/` directory.

## Paths

- AI Toolkit: `/root/ai-toolkit`
- Venv: `/root/ai-toolkit-venv`
- Datasets: `/root/nemoflix-studio/training/datasets`
- Configs: `/root/nemoflix-studio/training/config`
- Outputs/checkpoints: `/root/nemoflix-studio/training/output`
- Sample control images: `/root/nemoflix-studio/training/samples`

## Run a config

```bash
cd /root/ai-toolkit
/root/ai-toolkit-venv/bin/python run.py /root/nemoflix-studio/training/config/<config>.yaml
```

## Hugging Face token

For gated models, create `/root/ai-toolkit/.env`:

```bash
HF_TOKEN=hf_xxx
HF_HUB_ENABLE_HF_TRANSFER=1
```

## Character dataset conventions

Image/FLUX LoRA:
- 20-40 good face/body images
- one `.txt` caption beside each image
- include trigger word, e.g. `character_trigger, person, portrait, natural lighting`

Wan I2V character LoRA:
- 10-30 short clips, ideally 3-8 seconds
- one `.txt` caption beside each clip
- include trigger word, e.g. `character_trigger, person, walking outdoors, close-up face`
- trim dead time; varied angles/lighting/backgrounds; avoid sunglasses
EOF

cat > "$TRAINING_DIR/run-ai-toolkit.sh" <<'EOF'
#!/bin/bash
set -Eeuo pipefail
CONFIG_PATH="${1:?Usage: /root/nemoflix-studio/training/run-ai-toolkit.sh /root/nemoflix-studio/training/config/job.yaml}"
cd /root/ai-toolkit
export HF_HUB_ENABLE_HF_TRANSFER="${HF_HUB_ENABLE_HF_TRANSFER:-1}"
exec /root/ai-toolkit-venv/bin/python run.py "$CONFIG_PATH"
EOF
chmod +x "$TRAINING_DIR/run-ai-toolkit.sh"

if [ "$INSTALL_UI_DEPS" = "1" ]; then
  if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' 2>/dev/null; then
    echo "=== Installing Node.js 22 for AI Toolkit UI ==="
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    $APT_GET install -y nodejs
  fi
  $APT_GET install -y sqlite3

  # The UI worker looks for python at $TOOLKIT_DIR/.venv; our venv lives next to it.
  ln -sfn "$TOOLKIT_VENV" "$TOOLKIT_DIR/.venv"

  if [ -f "$TOOLKIT_DIR/ui/package.json" ]; then
    echo "=== Building AI Toolkit UI ==="
    (cd "$TOOLKIT_DIR/ui" && npm install && npm run update_db && npm run build)

    echo "=== Configuring AI Toolkit settings DB ==="
    # Write TRAINING_FOLDER into the Prisma settings table so /api/img/ resolves paths correctly.
    sqlite3 "$TOOLKIT_DIR/aitk_db.db" \
      "INSERT INTO Settings(key,value) VALUES('TRAINING_FOLDER','$TRAINING_DIR/output') ON CONFLICT(key) DO UPDATE SET value=excluded.value;"
    sqlite3 "$TOOLKIT_DIR/aitk_db.db" \
      "INSERT INTO Settings(key,value) VALUES('DATASETS_FOLDER','$TRAINING_DIR/datasets') ON CONFLICT(key) DO UPDATE SET value=excluded.value;"
  fi

  cat > /etc/systemd/system/ai-toolkit-ui.service <<EOF
[Unit]
Description=Ostris AI Toolkit UI (port 8675)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$TOOLKIT_DIR/ui
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="AI_TOOLKIT_AUTH=$AITK_AUTH_TOKEN"
Environment="AITK_GPU_IDS=$AITK_GPU_IDS"
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable ai-toolkit-ui.service
  systemctl restart ai-toolkit-ui.service
  echo "AI Toolkit UI started on port 8675"
fi

"$PYTHON_BIN" - <<'PY'
import importlib
mods = ['torch', 'accelerate', 'diffusers', 'transformers', 'huggingface_hub']
for name in mods:
    mod = importlib.import_module(name)
    print(name, getattr(mod, '__version__', 'ok'))
PY

echo "=== AI Toolkit install complete ==="
echo "Toolkit:  $TOOLKIT_DIR"
echo "Venv:     $TOOLKIT_VENV"
echo "Training: $TRAINING_DIR"
echo "UI API:   http://localhost:8675 (AI_TOOLKIT_AUTH configured)"
echo ""
echo "=== !!! REMINDER !!! ==="
echo "FLUX.2-dev is a gated Hugging Face model. The installer cannot download it automatically."
echo "Create /root/ai-toolkit/.env with your HF token:"
echo "  echo 'HF_TOKEN=hf_...' > /root/ai-toolkit/.env"
echo "Then re-run your training job — ai-toolkit will download the Diffusers-format model."
