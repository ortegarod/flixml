<!-- GENERATED FILE — do not edit by hand.
     Source: app/flixml/workflows/*.meta.json
     Regenerate: python scripts/gen_workflows_doc.py -->

# FlixML Workflows

The complete catalog of shipped generation workflows, grouped by task. This is generated from each workflow's `.meta.json`, which is also served live at `GET /api/workflows` — that endpoint is the source of truth and may include extra per-install workflows kept in `app/flixml/workflows/local/` (not listed here).

**12 workflows** across 5 task types.

| Workflow | Task | What it does |
|---|---|---|
| `flux2_base` | Text → Image | Text-to-image with the FLUX.2 base model |
| `flux2_lora` | Text → Image | Text-to-image with FLUX.2 plus one or more trained character LoRAs — a consistent identity rendered at high fidelity from a prompt |
| `sdxl_base` | Text → Image | Text-to-image with an SDXL checkpoint |
| `sdxl_lora` | Text → Image | Text-to-image with an SDXL checkpoint plus a character/style LoRA — a consistent trained identity or style rendered from a prompt |
| `text_logo` | Text → Image | Typeset exact text as a logo/wordmark using a real TTF font (ComfyUI AddLabel node) — NOT diffusion |
| `qwen_multiangle` | Image → Image | Re-shoot an existing image of the same subject from a new camera angle |
| `qwen_pose_edit` | Image → Image | Edit an existing image from a plain-English instruction — change a subject's pose, position, or what they're doing while holding their identity, clothing, the room, and lighting |
| `sdxl_img2img` | Image → Image | Generate SDXL image variations from a source image using prompt guidance and denoise strength |
| `wan22_t2v` | Text → Video | Text-to-video with Wan 2.2 — generate a short clip directly from a prompt, no source image |
| `infinitetalk_i2v` | Image → Video | Audio-driven talking-head |
| `wan22_i2v` | Image → Video | Image-to-video with Wan 2.2 — animate a still into a short clip, with a motion prompt driving the movement |
| `infinitetalk_v2v` | Video → Video | Audio-driven lip-sync applied on top of a driving motion clip |

## Text → Image

### `flux2_base` — FLUX.2 Base Image

Text-to-image with the FLUX.2 base model. High-fidelity stills from a prompt — no LoRA, no source image.

- **Output:** image
- **Requirements:** ~24 GB VRAM, loads ~48.1 GB of model files (VRAM + system RAM)
- **Notes:** TESTED 2026-09-07 on RTX 4070 Ti (12 GB) + 16 GB system RAM. FLUX.2-dev is ~32B: the fp8 weights are 35 GB plus a 12 GB text encoder, far more than that machine's GPU memory and RAM combined, so weights spill to disk. Real timing: 32 min @24 steps, 15 min @8-step turbo, 18 min with Q3_K_S GGUF + turbo. Untested with more system RAM or a 24 GB+ GPU (e.g. RunPod); both reduce spilling. For fast local iteration use SDXL and composite text separately.
- **Providers:** local, cloud_serverless
- **Params:**
  - `prompt` · _str_ · **required** — Text prompt
  - `width` · _int_ · default `832` — Output width
  - `height` · _int_ · default `832` — Output height
  - `seed` · _int_ — Random seed (auto if omitted)
  - `steps` · _int_ · default `20`
  - `sampler` · _str_ · default `euler`
  - `guidance` · _float_ · default `4.0` — FLUX guidance scale
  - `unet` · _str_ · default `flux2_dev_fp8mixed.safetensors`
  - `clip` · _str_ · default `mistral_3_small_flux2_fp4_mixed.safetensors`
  - `vae` · _str_ · default `flux2-vae.safetensors`

### `flux2_lora` — FLUX.2 + LoRA Image

Text-to-image with FLUX.2 plus one or more trained character LoRAs — a consistent identity rendered at high fidelity from a prompt.

- **Output:** image
- **Requirements:** supports LoRA, ~24 GB VRAM, loads ~48.1 GB of model files (VRAM + system RAM)
- **Notes:** TESTED 2026-09-07 on RTX 4070 Ti (12 GB) + 16 GB system RAM. FLUX.2-dev is ~32B: the fp8 weights are 35 GB plus a 12 GB text encoder, far more than that machine's GPU memory and RAM combined, so weights spill to disk. Real timing: 32 min @24 steps, 15 min @8-step turbo, 18 min with Q3_K_S GGUF + turbo. Untested with more system RAM or a 24 GB+ GPU (e.g. RunPod); both reduce spilling. For fast local iteration use SDXL and composite text separately.
- **Providers:** local, cloud_serverless
- **Params:**
  - `prompt` · _str_ · **required** — Text prompt
  - `loras` · _list_ — List of LoRA specs
  - `lora_strength` · _float_ · default `1.0`
  - `width` · _int_ · default `1248` — Output width
  - `height` · _int_ · default `832` — Output height
  - `seed` · _int_ — Random seed (auto if omitted)
  - `steps` · _int_ · default `20`
  - `cfg` · _float_ · default `4.0`
  - `sampler` · _str_ · default `euler`
  - `guidance` · _float_ · default `4.0` — FLUX guidance scale
  - `unet` · _str_ · default `flux2_dev_fp8mixed.safetensors`
  - `clip` · _str_ · default `mistral_3_small_flux2_fp4_mixed.safetensors`
  - `vae` · _str_ · default `flux2-vae.safetensors`

### `sdxl_base` — SDXL Base Image

Text-to-image with an SDXL checkpoint. General-purpose still generation from a prompt — no character LoRA, no source image.

- **Output:** image
- **Requirements:** ~8 GB VRAM
- **Providers:** local
- **Params:**
  - `prompt` · _string_ · **required** — Image prompt
  - `negative_prompt` · _string_ · default ``
  - `width` · _integer_ · default `832`
  - `height` · _integer_ · default `1216`
  - `seed` · _integer_ · default `42`
  - `steps` · _integer_ · default `40`
  - `cfg` · _float_ · default `5.0`
  - `sampler` · _string_ · default `dpmpp_2m`
  - `scheduler` · _string_ · default `karras`
  - `checkpoint` · _string_ · **required** — Checkpoint model filename discovered from the local ComfyUI node or supplied by the caller

### `sdxl_lora` — SDXL + LoRA Image

Text-to-image with an SDXL checkpoint plus a character/style LoRA — a consistent trained identity or style rendered from a prompt.

- **Output:** image
- **Requirements:** supports LoRA, ~8 GB VRAM
- **Providers:** local
- **Params:**
  - `prompt` · _string_ · **required** — Image prompt
  - `negative_prompt` · _string_ · default ``
  - `width` · _integer_ · default `832`
  - `height` · _integer_ · default `1216`
  - `seed` · _integer_ · default `42`
  - `steps` · _integer_ · default `28`
  - `cfg` · _float_ · default `7.0`
  - `sampler` · _string_ · default `dpmpp_2m`
  - `scheduler` · _string_ · default `karras`
  - `checkpoint` · _string_ · **required** — SDXL checkpoint model filename
  - `lora_name` · _string_ · **required** — LoRA filename
  - `lora_strength` · _float_ · default `0.8` — LoRA strength (model and clip)

### `text_logo` — Text Logo / Wordmark

Typeset exact text as a logo/wordmark using a real TTF font (ComfyUI AddLabel node) — NOT diffusion. Use this whenever the output must spell an exact string (a handle, brand, wordmark) that diffusion models garble. Renders instantly, GPU-light, lands in the gallery like any generation.

- **Output:** image
- **Requirements:** ~1 GB VRAM
- **Providers:** local
- **Params:**
  - `text` · _string_ · **required** — Exact text to typeset (spelled precisely, e.g. 'R404')
  - `font_color` · _string_ · default `gold` — Text color — PIL color name ('gold', 'white', 'red') or hex ('#D4AF37')
  - `font` · _string_ · default `TTNorms-Black.otf` — Font filename available on the ComfyUI node (e.g. TTNorms-Black.otf, FreeMonoBold.ttf)
  - `font_size` · _integer_ · default `200` — Font size in px
  - `text_x` · _integer_ · default `125` — Text left position. Default centers a 4-char string at font_size 200 on an 800px canvas
  - `text_y` · _integer_ · default `280` — Text top position. Default vertically centers at font_size 200 on an 800px canvas
  - `width` · _integer_ · default `800`
  - `height` · _integer_ · default `800`
  - `bg_color` · _integer_ · default `0` — Background color as a packed RGB int (0 = black, 16777215 = white)

## Image → Image

### `qwen_multiangle` — Qwen Multi-Angle (re-angle a still)

Re-shoot an existing image of the same subject from a new camera angle. Qwen-Image-Edit-2511 + multi-angle LoRA holds identity, clothing, and lighting while changing the camera viewpoint. Produces a sibling of the source still at a different angle.

- **Output:** image
- **Requirements:** needs image, ~12 GB VRAM, loads ~31.3 GB of model files (VRAM + system RAM)
- **Notes:** Uses the fp8 model file, same as qwen_pose_edit, where fp8 tested about 40% faster than the Q4_K_M .gguf on an RTX 4070 Ti (2026-09-14). Also runs with this workflow's multi-angle LoRA on the fp8 file (tested 2026-09-14).
- **Providers:** local
- **Params:**
  - `image` · _string_ · **required** — Source image filename or Studio output path to re-angle
  - `prompt` · _string_ · **required** — Camera-angle spec only (the <sks> trigger is prepended automatically; do NOT pass a character/scene prompt here). Format: '<azimuth> view <elevation> shot <distance>'. Azimuth: front | front-right quarter | right side | back-right quarter | back | back-left quarter | left side | front-left quarter. Elevation: low-angle | eye-level | elevated | high-angle. Distance: wide shot | medium shot | close-up. Example: 'front-right quarter view eye-level shot medium shot'
  - `seed` · _integer_ · default `42`

### `qwen_pose_edit` — Qwen Pose/Position Edit (instruction)

Edit an existing image from a plain-English instruction — change a subject's pose, position, or what they're doing while holding their identity, clothing, the room, and lighting. Powered by Qwen-Image-Edit-2511; the source image is the reference (no LoRA).

- **Output:** image
- **Requirements:** needs image, ~12 GB VRAM, loads ~30.2 GB of model files (VRAM + system RAM)
- **Notes:** TESTED 2026-09-14 on RTX 4070 Ti (12 GB) + 16 GB system RAM, 20 steps at 832x1248, same prompt and seed: the fp8 file (20.5 GB) sampled at 5.8 s per step, the Q4_K_M .gguf (13.2 GB) at 9.7 s per step, with near-identical output. The fp8 file is larger but the card does fp8 math natively and ComfyUI's Dynamic VRAM streams it from disk. A Q3_K_L .gguf (10.6 GB) was no faster than Q4_K_M and drew worse anatomy.
- **Providers:** local
- **Params:**
  - `image` · _string_ · **required** — Source image filename or Studio output path to edit
  - `prompt` · _string_ · **required** — Plain-English edit instruction. Describe only what changes; the model keeps everything else. Name each body part and where it goes ('left hand on her left hip'). Place the subject against named objects with an exact position ('on the path, one step left of the bench, not touching it'). 'Next to the bench' is too loose and can put the subject in front of the bench instead.
  - `seed` · _integer_ · default `42`

### `sdxl_img2img` — SDXL Image-to-Image

Generate SDXL image variations from a source image using prompt guidance and denoise strength

- **Output:** image
- **Requirements:** ~8 GB VRAM
- **Providers:** local
- **Params:**
  - `prompt` · _string_ · **required** — Image prompt / transformation guidance
  - `image` · _string_ · **required** — Source image filename or Studio output path
  - `negative_prompt` · _string_ · default ``
  - `width` · _integer_ · default `832`
  - `height` · _integer_ · default `1216`
  - `seed` · _integer_ · default `42`
  - `steps` · _integer_ · default `28`
  - `cfg` · _float_ · default `7.0`
  - `sampler` · _string_ · default `dpmpp_2m`
  - `scheduler` · _string_ · default `karras`
  - `denoise` · _float_ · default `0.35` — Lower preserves the source image more; 0.25-0.45 is good for identity-preserving variations
  - `checkpoint` · _string_ · **required** — SDXL checkpoint model filename

## Text → Video

### `wan22_t2v` — Wan 2.2 Text-to-Video

Text-to-video with Wan 2.2 — generate a short clip directly from a prompt, no source image.

- **Output:** video
- **Requirements:** ~12 GB VRAM, loads ~38.0 GB of model files (VRAM + system RAM)
- **Notes:** UNTESTED: not yet run end-to-end with the default fp8_scaled UNets and T2V lightx2v LoRAs. The fp8 .safetensors defaults load through ComfyUI's Dynamic VRAM path, which streams weights from disk instead of holding them in RAM. GGUF files skip that path in ComfyUI-GGUF (PR #427 unmerged) and keep both experts in system RAM, so a GGUF swap needs its own RAM check.
- **Providers:** local, cloud_serverless
- **Params:**
  - `prompt` · _str_ · **required** — Text prompt: subject, setting, and action. Describe big physical action with strong verbs (walks, jumps, turns). Words like subtle, slowly, or gently produce a near-still clip.
  - `negative_prompt` · _str_ · default `bright colors, overexposed, static, blurred details`
  - `width` · _int_ · default `640`
  - `height` · _int_ · default `640`
  - `length` · _int_ · default `81` — Frame count
  - `fps` · _int_ · default `16`
  - `seed` · _int_
  - `steps_high` · _int_ · default `2`
  - `steps_low` · _int_ · default `2`
  - `total_steps` · _int_ · default `4` — steps_high + steps_low; passed to KSamplerAdvanced.steps
  - `cfg_high` · _float_ · default `1.0`
  - `cfg_low` · _float_ · default `1.0`
  - `shift` · _float_ · default `5.0`
  - `sampler` · _str_ · default `euler`
  - `scheduler` · _str_ · default `simple`
  - `high_model` · _str_ · default `wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors` — High-noise UNet model
  - `low_model` · _str_ · default `wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors` — Low-noise UNet model
  - `vae` · _str_ · default `Wan2.1_VAE.safetensors`
  - `clip` · _str_ · default `umt5_xxl_fp8_e4m3fn_scaled.safetensors`
  - `lightx2v_high_lora` · _str_ · default `wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors`
  - `lightx2v_low_lora` · _str_ · default `wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors`
  - `lightx2v_high_strength` · _float_ · default `1.0`
  - `lightx2v_low_strength` · _float_ · default `1.0`

## Image → Video

### `infinitetalk_i2v` — InfiniteTalk Image-to-Video (lip-sync)

Audio-driven talking-head. Animates a still image to lip-sync a voice line (Wan 2.1 I2V backbone + InfiniteTalk/MultiTalk). Talking-head motion only, not big body motion.

- **Output:** video
- **Requirements:** needs audio, ~12 GB VRAM, loads ~19.8 GB of model files (VRAM + system RAM)
- **Providers:** local
- **Params:**
  - `prompt` · _str_ · **required** · default `a woman is talking` — Drives expression/motion. InfiniteTalk is talking-head; keep it simple.
  - `image` · _str_ · **required** — Input image filename (staged to ComfyUI input)
  - `audio` · _str_ · **required** — Input audio filename (wav) staged to ComfyUI input. Drives lip-sync + clip length.
  - `negative_prompt` · _str_ · default `bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards`
  - `width` · _int_ · default `640` — Resize target width (divisible by 16)
  - `height` · _int_ · default `640` — Resize target height (divisible by 16)
  - `length` · _int_ · default `81` — Frame count. At 25fps: 81 frames ~= 3.2s. Keep short — long renders choke 12GB/16GB RAM.
  - `fps` · _int_ · default `25` — InfiniteTalk is trained at 25fps; do not change unless you know why.
  - `seed` · _int_ · default `2`
  - `steps` · _int_ · default `6` — Sampler steps. 6 with the lightx2v speed LoRA is the tuned default.
  - `cfg` · _float_ · default `1.0`
  - `shift` · _float_ · default `11.0`
  - `scheduler` · _str_ · default `dpm++_sde`
  - `blocks_to_swap` · _int_ · default `12` — Block-swap count for low-VRAM. 12 is the proven sweet spot on a 12GB card with the Q3_K_S GGUF: ~10GB VRAM used, GPU at 95%, no OOM. Higher = less VRAM but GPU-starved/slow; lower risks OOM.
  - `model` · _str_ · default `wan2.1-i2v-14b-480p-Q3_K_S.gguf` — GGUF-quantized Wan2.1 I2V 14B backbone (~7.9GB). Fits 12GB card with block-swap. fp8 safetensors OOMs a 12GB card.
  - `multitalk_model` · _str_ · default `Wan2_1-InfiniteTalk_Single_Q4_K_M.gguf` — GGUF-quantized InfiniteTalk module (~1.3GB). Must be GGUF to pair with the GGUF backbone.
  - `wav2vec_model` · _str_ · default `wav2vec2-chinese-base_fp16.safetensors`
  - `t5` · _str_ · default `umt5-xxl-enc-fp8_e4m3fn.safetensors`
  - `vae` · _str_ · default `Wan2.1_VAE.safetensors`
  - `clip_vision` · _str_ · default `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`
  - `speed_lora` · _str_ · default `WanVideo\Lightx2v\lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`
  - `speed_lora_strength` · _float_ · default `1.0`
  - `filename_prefix` · _str_ · default `infinitetalk_i2v`

### `wan22_i2v` — Wan 2.2 Image-to-Video

Image-to-video with Wan 2.2 — animate a still into a short clip, with a motion prompt driving the movement. Identity and scene come from the source image.

- **Output:** video
- **Requirements:** supports LoRA, ~12 GB VRAM, loads ~36.8 GB of model files (VRAM + system RAM)
- **Notes:** TESTED 2026-09-14 on RTX 4070 Ti (12 GB) + 16 GB system RAM, 768x528, 49 frames, 30 steps, same image, prompt and seed: the fp8_scaled pair (2x14.3 GB) finished in 594 s, the Q3_K_S .gguf pair (2x6.5 GB) in 723 s, with the same composition and slightly more motion on fp8. Steady sampling was about 10.9 s per step on fp8; the Q3 run sampled at 13 to 14 s per step. The fp8 files load through ComfyUI's Dynamic VRAM path; .gguf files do not.
- **Providers:** local, cloud_serverless
- **Params:**
  - `prompt` · _str_ · **required** — Motion prompt. Describe big physical action with strong verbs (walks, jumps, turns). Words like subtle, slowly, or gently produce a near-still clip.
  - `image` · _str_ · **required** — Input image filename
  - `negative_prompt` · _str_ · default `bright colors, overexposed, static, blurred details`
  - `width` · _int_ · default `512`
  - `height` · _int_ · default `512`
  - `length` · _int_ · default `49` — Frame count (must be 4k+1, e.g. 33/49/65/81)
  - `fps` · _int_ · default `16`
  - `seed` · _int_
  - `steps_high` · _int_ · default `15` — 15+15=30 total. Lightning LoRA is 4-step-trained but 30 steps is needed for real motion (2026-08-25); low steps give a near-still 'breathing photo'. Pass 4 for a fast low-motion preview.
  - `steps_low` · _int_ · default `15` — See steps_high. 15+15=30 total for real motion; 2 for fast preview.
  - `total_steps` · _int_ · default `30` — steps_high + steps_low; passed to KSamplerAdvanced.steps
  - `cfg_high` · _float_ · default `1.0`
  - `cfg_low` · _float_ · default `1.0`
  - `shift` · _float_ · default `5.0`
  - `sampler` · _str_ · default `euler`
  - `scheduler` · _str_ · default `simple`
  - `vae` · _str_ · default `Wan2.1_VAE.safetensors`
  - `clip` · _str_ · default `umt5_xxl_fp8_e4m3fn_scaled.safetensors`
  - `high_model` · _str_ · default `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` — fp8_scaled high-noise model in diffusion_models (UNETLoader)
  - `low_model` · _str_ · default `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` — fp8_scaled low-noise model in diffusion_models (UNETLoader)
  - `high_lora` · _str_ · default `Wan2.2-Lightning_I2V-A14B-4steps-lora_HIGH_fp16.safetensors` — Lightning speed LoRA for high-noise model
  - `low_lora` · _str_ · default `Wan2.2-Lightning_I2V-A14B-4steps-lora_LOW_fp16.safetensors` — Lightning speed LoRA for low-noise model
  - `high_lora_strength` · _float_ · default `1.0`
  - `low_lora_strength` · _float_ · default `1.0`

## Video → Video

### `infinitetalk_v2v` — InfiniteTalk Video-to-Video (motion + lip-sync)

Audio-driven lip-sync applied on top of a driving motion clip. Loads a source video (e.g. a subject dancing/twirling from a t2v/i2v run), encodes its motion, and re-samples it to lip-sync a voice line while preserving the body motion (Wan 2.1 I2V backbone + InfiniteTalk/MultiTalk). Use this instead of infinitetalk_i2v when you want real body motion, not just a talking head.

- **Output:** video
- **Requirements:** needs audio, needs video, ~12 GB VRAM, loads ~19.8 GB of model files (VRAM + system RAM)
- **Providers:** local
- **Params:**
  - `prompt` · _str_ · **required** · default `a woman is talking` — Drives expression. The body motion comes from the driving video, so keep this simple.
  - `video` · _str_ · **required** — Driving motion video filename (staged to ComfyUI input). Its motion is preserved; supplies the body movement.
  - `audio` · _str_ · **required** — Input audio filename (wav) staged to ComfyUI input. Drives lip-sync + clip length.
  - `negative_prompt` · _str_ · default `bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards`
  - `denoise_strength` · _float_ · default `0.4` — V2V motion-adherence knob — THE key dial. At 1.0 the driving video is noised to pure noise and InfiniteTalk regenerates a talking head from the first frame, DISCARDING the body motion (the subject won't bend/dance). Lower preserves the driving motion: the sampler starts the denoise partway and keeps the driving latents. Default 0.4 is the verified sweet spot for body-motion clips (ride/dance) — holds hip/body motion better than Kijai's 0.5 reference while lip-sync stays clean. Raise to 0.5-0.7 for stronger lip-sync when the driving motion is subtle; drop to 0.35 for even more motion at the cost of slightly softer sync.
  - `width` · _int_ · default `480` — Resize target width (divisible by 16). Default 480x832 = portrait, matching POV/vertical driving clips. For a landscape driving clip pass 832x480 explicitly. BETTER FUTURE FIX: auto-derive w/h from the driving clip's aspect so orientation never has to be set (see length auto-clamp for the pattern).
  - `height` · _int_ · default `832` — Resize target height (divisible by 16). See width.
  - `length` · _int_ · default `201` — Generous CAP on output frames (num_frames into MultiTalkWav2VecEmbeds), NOT an exact length — matches Kijai's reference which sets a big cap. The node internally clamps to the audio: actual = min(num_frames, audio_duration*fps), so the AUDIO drives real length. 201 ~= 8s at 25fps, bounding RAM on 12GB nodes; audio shorter than that (the usual case) clamps below it. The windowed generation overshoots to the next 81-frame boundary, then VHS_VideoCombine trim_to_audio cuts the tail back to the audio track. Only lower this to force a hard shorter clip.
  - `fps` · _int_ · default `25` — InfiniteTalk is trained at 25fps. Also re-times the driving video to this rate (force_rate). Do not change unless you know why.
  - `seed` · _int_ · default `2`
  - `steps` · _int_ · default `4` — Sampler steps. 4 matches Kijai's V2V reference (the lightx2v speed-distill LoRA is trained for ~4 steps). With denoise_strength 0.5 the sampler starts ~halfway (start_step 2 of 4), preserving driving motion.
  - `cfg` · _float_ · default `1.0`
  - `shift` · _float_ · default `11.0`
  - `scheduler` · _str_ · default `dpm++_sde`
  - `blocks_to_swap` · _int_ · default `12` — Block-swap count for low-VRAM. 12 is the proven sweet spot on a 12GB card with the Q3_K_S GGUF: ~10GB VRAM used, GPU at 95%, no OOM. Higher = less VRAM but GPU-starved/slow; lower risks OOM.
  - `model` · _str_ · default `wan2.1-i2v-14b-480p-Q3_K_S.gguf` — GGUF-quantized Wan2.1 I2V 14B backbone (~7.9GB). Fits 12GB card with block-swap. fp8 safetensors OOMs a 12GB card.
  - `multitalk_model` · _str_ · default `Wan2_1-InfiniteTalk_Single_Q4_K_M.gguf` — GGUF-quantized InfiniteTalk module (~1.3GB). Must be GGUF to pair with the GGUF backbone.
  - `wav2vec_model` · _str_ · default `wav2vec2-chinese-base_fp16.safetensors`
  - `t5` · _str_ · default `umt5-xxl-enc-fp8_e4m3fn.safetensors`
  - `vae` · _str_ · default `Wan2.1_VAE.safetensors`
  - `clip_vision` · _str_ · default `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`
  - `speed_lora` · _str_ · default `WanVideo\Lightx2v\lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`
  - `speed_lora_strength` · _float_ · default `1.0`
  - `filename_prefix` · _str_ · default `infinitetalk_v2v`

