# Nemoflix Studio — RunPod FLUX.2 Worker

Custom RunPod serverless worker for Nemoflix Studio. Bakes FLUX.2 models + your LoRAs into a Docker image.

## What's inside

| Model | Path in image | Size |
|-------|---------------|------|
| `flux2_dev_fp8mixed.safetensors` | `models/diffusion_models/` | ~17 GB |
| `mistral_3_small_flux2_bf16.safetensors` | `models/text_encoders/` | ~8 GB |
| `flux2-vae.safetensors` | `models/vae/` | ~300 MB |
| `atlas_flux2_lora.safetensors` | `models/loras/` | 373 MB |

## Build + Push

```bash
cd nemoflix-studio/docker
./build.sh
```

Requires:
- Docker Desktop or Docker Engine
- `docker login` to Docker Hub

## Deploy on RunPod

1. Go to [RunPod Console → Serverless](https://www.runpod.io/console/serverless)
2. Create endpoint
3. Template → "Custom Image" → enter `ortegarodrigo/nemoflix-flux2:latest`
4. GPU → pick your poison (RTX 4090 is cheapest, ~$0.50/hr)
5. Copy the **Endpoint ID** into Nemoflix Studio `.env`:
   ```
   RUNPOD_API_KEY=your_key_here
   RUNPOD_ENDPOINT_ID=your_endpoint_id_here
   ```

## Adding more LoRAs

Drop `.safetensors` files into `docker/loras/` and rebuild:

```bash
cp new_lora.safetensors docker/loras/
cd docker && ./build.sh
```
