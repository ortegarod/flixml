<!-- GENERATED FILE — do not edit by hand.
     Source: app/flixml/workflows/*.meta.json
     Regenerate: python scripts/gen_workflows_doc.py -->

# FlixML Workflows

The complete catalog of shipped generation workflows, grouped by task. This is generated from each workflow's `.meta.json`, which is also served live at `GET /api/workflows` for the catalog and `GET /api/workflows/{id}` for one workflow's params in full — those endpoints are the source of truth and may include extra per-install workflows kept in `app/flixml/workflows/local/` (not listed here).

**14 workflows** across 5 task types.

| Workflow | Task | What it does |
|---|---|---|
| `flux2_klein` | Text → Image | Text-to-image with FLUX.2 Klein 4B |
| `krea2_turbo` | Text → Image | Krea 2 Turbo makes an image from a prompt in 8 steps, 1K to 2K |
| `qwen_image_21` | Text → Image | Qwen-Image 2.1 makes an image from a prompt |
| `sdxl_base` | Text → Image | Text-to-image with an SDXL checkpoint or any SDXL finetune, with up to two LoRAs and an optional face-detail pass |
| `text_logo` | Text → Image | Typeset exact text as a logo/wordmark using a real TTF font (ComfyUI AddLabel node) — NOT diffusion |
| `flux2_klein_edit` | Image → Image | Generate a new image from a reference image and a plain-English instruction |
| `qwen_image_21_edit` | Image → Image | Qwen-Image 2.1 makes a new image from one to three reference images and a plain-English instruction, such as putting the shirt from <image2> on the person in <image1> |
| `qwen_multiangle` | Image → Image | Re-shoot an existing image of the same subject from a new camera angle |
| `qwen_pose_edit` | Image → Image | Edit an existing image from a plain-English instruction — change a subject's pose, position, or what they're doing while holding their identity, clothing, the room, and lighting |
| `sdxl_img2img` | Image → Image | Generate SDXL image variations from a source image using prompt guidance and denoise strength |
| `wan22_t2v` | Text → Video | Text-to-video with Wan 2.2 — generate a short clip directly from a prompt, no source image |
| `infinitetalk_i2v` | Image → Video | Audio-driven talking-head |
| `wan22_i2v` | Image → Video | Image-to-video with Wan 2.2 — animate a still into a clip, with a motion prompt driving the movement |
| `infinitetalk_v2v` | Video → Video | Audio-driven lip-sync applied on top of a driving motion clip |

## Text → Image

### `flux2_klein` — FLUX.2 Klein Image

Text-to-image with FLUX.2 Klein 4B. High-fidelity stills from a prompt, with two optional LoRA slots.

- **Output:** image
- **Requirements:** supports LoRA, ~8 GB VRAM, loads ~8.3 GB of model files (VRAM + system RAM)
- **Providers:** local, cloud_serverless
- **Params:**
  - `prompt` · _str_ · **required** — Natural language sentences, not tags — the opposite of an SDXL prompt. Subject, then action, then style, then context, in that order: word order is weight, so lead with the subject and close with atmosphere. 30-80 words suits most shots. 'A businessman in a charcoal grey suit resting his arms on a bamboo railing at a secluded beach, illustrated in a vintage woodblock print style, calm turquoise water under a hazy afternoon sky.' FLUX.2 has no negative prompt and this graph has no node for one, so describe what you want instead of what you don't — 'sharp focus throughout', not 'not blurry'. For photorealism, name a camera, lens or film stock rather than saying 'professional'.
  - `lora_name` · _str_ · default `` — Optional LoRA file in the node's loras folder. Leave empty and the slot is removed from the graph entirely. A FLUX.2 LoRA is built for one variant: a Klein 4B LoRA does not load on Klein 9B or on FLUX.2-dev, and a dev LoRA does not load here — the residual stream is 3072 wide on 4B against 6144 on dev, so the tensors do not fit. Match the LoRA's stated base model to the weights in the unet param.
  - `lora_strength` · _float_ · default `1.0` — Weight of the first LoRA. Ignored when lora_name is empty.
  - `lora_name_2` · _str_ · default `` — Second LoRA, chained after the first — for stacking a concept LoRA on top of a likeness or style one. Same variant rule as lora_name.
  - `lora_strength_2` · _float_ · default `1.0` — Weight of the second LoRA. Ignored when lora_name_2 is empty.
  - `width` · _int_ · default `832` — Output width
  - `height` · _int_ · default `832` — Output height
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `steps` · _int_ · default `4` — Klein is distilled to 4 steps; raise it only when running undistilled FLUX.2 weights through the unet param
  - `sampler` · _str_ · default `euler`
  - `guidance` · _float_ · default `4.0` — FLUX guidance scale
  - `unet` · _str_ · default `flux-2-klein-4b-fp8.safetensors`
  - `clip` · _str_ · default `qwen_3_4b_fp4_flux2.safetensors`
  - `vae` · _str_ · default `flux2-vae.safetensors`

### `krea2_turbo` — Krea 2 Turbo

Krea 2 Turbo makes an image from a prompt in 8 steps, 1K to 2K. Krea 2 Community License: https://www.krea.ai/krea-2-licensing

- **Output:** image
- **Requirements:** ~12 GB VRAM, loads ~18.6 GB of model files (VRAM + system RAM)
- **Providers:** local
- **Params:**
  - `prompt` · _str_ · **required** — Natural language, not a tag list: Krea recommends natural-language prompts and says long, detailed ones give the best results. Name the medium (a photograph, a digital painting) along with the subject, framing, setting and light. Put any text to render in quotes.
  - `width` · _int_ · default `1024` — Krea 2 Turbo generates from 1K to 2K. Multiples of 16.
  - `height` · _int_ · default `1024` — Multiples of 16.
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `steps` · _int_ · default `8` — Turbo is distilled for 8 steps, the number Krea and ComfyUI both run.
  - `sampler` · _str_ · default `euler`
  - `scheduler` · _str_ · default `simple`
  - `unet` · _str_ · default `krea2_turbo_fp8_scaled.safetensors` — Diffusion model file on the node. ComfyUI recommends the fp8 build for most users.
  - `clip` · _str_ · default `qwen3vl_4b_fp8_scaled.safetensors`
  - `vae` · _str_ · default `qwen_image_vae.safetensors`

### `qwen_image_21` — Qwen-Image 2.1

Qwen-Image 2.1 makes an image from a prompt. To edit from reference images, use qwen_image_21_edit. Qwen Research License: non-commercial use only.

- **Output:** image
- **Requirements:** ~12 GB VRAM, loads ~17.3 GB of model files (VRAM + system RAM)
- **Providers:** local
- **Params:**
  - `prompt` · _str_ · **required** — Describe the picture. Put any text that should appear in the image in quotes.
  - `negative_prompt` · _str_ · default `` — Only read when cfg is above 1.
  - `width` · _int_ · default `1024` — Multiples of 32. Qwen's listed sizes run from 2048x2048 at 1:1 to 2752x1536 at 16:9.
  - `height` · _int_ · default `1024` — Multiples of 32.
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `steps` · _int_ · default `25` — ComfyUI's template runs 25; Qwen's own examples run 40.
  - `cfg` · _float_ · default `1.0` — Keep at 1 for the official path. Raise it only to use a negative prompt.
  - `sampler` · _str_ · default `euler`
  - `scheduler` · _str_ · default `simple`
  - `unet` · _str_ · default `qwen_image_2.1_int8_convrot.safetensors`
  - `clip` · _str_ · default `qwen3vl_8b_int8_convrot.safetensors` — Text encoder file on the node. The default is the int8 build; qwen3vl_8b_w4a8.safetensors (6.31 GB) is a smaller one from the same repo for nodes short on system RAM.
  - `vae` · _str_ · default `qwen_image_2.1_vae_bf16.safetensors`

### `sdxl_base` — SDXL Image

Text-to-image with an SDXL checkpoint or any SDXL finetune, with up to two LoRAs and an optional face-detail pass. General-purpose still generation from a prompt — no source image.

- **Output:** image
- **Requirements:** supports LoRA, ~8 GB VRAM
- **Providers:** local
- **Params:**
  - `prompt` · _string_ · **required** — Comma-separated tags and short phrases, the way SDXL's training captions were written. A sentence still parses — it does not fail — but every article and preposition spends part of the same budget, so tags buy more control per token. Order is weight: subject, appearance, clothing, pose, setting, lighting, then medium and quality. 'young woman, short white hair, black leather jacket, standing in a rain-wet alley, neon signs, night, shallow depth of field, photorealistic, sharp focus'. Push or pull one term with `(term:1.2)` or `(term:0.8)`; bare `(term)` is 1.1. Keep it near 75 tokens — CLIP encodes the rest in a later chunk where it pulls less. Match the checkpoint: one trained on booru tags wants booru tags, one merged for realism wants photographic ones, and its model page is the authority on any trigger or quality tags it expects. With a LoRA loaded: most character and style LoRAs fire on a trigger word, and without it in the prompt the LoRA loads and does close to nothing — put the trigger at the front, then describe only what the LoRA does not already carry: pose, clothing, setting, light. Describing the face a character LoRA was trained on fights it. The LoRA's model page is where the trigger word is stated; there is no way to read it off the file.
  - `negative_prompt` · _string_ · default `` — What to steer away from, same tag syntax. SDXL uses this — unlike FLUX.2, which has no negative and needs the positive to say 'sharp focus' instead. Start with the defects you actually see rather than a stock wall of tags: 'blurry, low quality, extra fingers, watermark, text'. An oversized negative eats guidance and flattens the image.
  - `width` · _integer_ · default `832`
  - `height` · _integer_ · default `1216`
  - `seed` · _integer_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `steps` · _integer_ · default `40`
  - `cfg` · _float_ · default `5.0`
  - `sampler` · _string_ · default `dpmpp_2m`
  - `scheduler` · _string_ · default `karras`
  - `checkpoint` · _string_ · **required** — Checkpoint filename on the node: SDXL itself or any finetune built on it. A finetune's model page is the authority on its prompt style, trigger or quality tags, steps, CFG and sampler — send those params to match it.
  - `lora_name` · _string_ · default `` — Optional LoRA file in the node's loras folder, built for SDXL or the checkpoint's own family. Leave empty and the slot is removed from the graph entirely.
  - `lora_strength` · _float_ · default `0.8` — Weight of the first LoRA, on both the model and the text encoder. Ignored when lora_name is empty.
  - `lora_name_2` · _string_ · default `` — Second LoRA, chained after the first — for stacking a concept LoRA on top of a likeness or style one.
  - `lora_strength_2` · _float_ · default `0.8` — Weight of the second LoRA. Ignored when lora_name_2 is empty.
  - `face_denoise` · _float_ · default `0.0` — Face-detail pass, off at 0 (the default) and left out of the graph. Above 0, faces found by the `bbox/face_yolov8m.pt` detector are redrawn at 1024 px after the render, with the same prompt, checkpoint, LoRAs and sampler — what ADetailer does in A1111, where 0.4 is the default. Higher fixes more and drifts further from the first render. Needs ComfyUI-Impact-Pack and ComfyUI-Impact-Subpack on the node, and the detector in `models/ultralytics/bbox/`.

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

### `flux2_klein_edit` — FLUX.2 Klein Reference Edit

Generate a new image from a reference image and a plain-English instruction. FLUX.2 Klein 4B reads the reference as conditioning and samples a fresh frame, so unlike img2img it can change pose, wardrobe and setting while holding the subject's identity. Say what changes and what stays.

- **Output:** image
- **Requirements:** needs image, supports LoRA, ~8 GB VRAM, loads ~8.3 GB of model files (VRAM + system RAM)
- **Providers:** local, cloud_serverless
- **Params:**
  - `image` · _str_ · **required** — Reference image filename
  - `prompt` · _str_ · **required** — An instruction, not a scene description. Name the change, then name what stays: 'Change her outfit to a black leather coat and place her on a castle rampart at dusk. Keep her face and hair exactly as they are.' Never re-describe the subject's face, hair or body — the reference carries them, and describing them again makes the model draw its own version instead.
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `lora_name` · _str_ · default `` — Optional LoRA file in the node's loras folder. Leave empty and the slot is removed from the graph entirely. A FLUX.2 LoRA is built for one variant: a Klein 4B LoRA does not load on Klein 9B or on FLUX.2-dev, and a dev LoRA does not load here — the residual stream is 3072 wide on 4B against 6144 on dev, so the tensors do not fit. Match the LoRA's stated base model to the weights in the unet param.
  - `lora_strength` · _float_ · default `1.0` — Weight of the first LoRA. Ignored when lora_name is empty.
  - `lora_name_2` · _str_ · default `` — Second LoRA, chained after the first — for stacking a concept LoRA on top of a likeness or style one. Same variant rule as lora_name.
  - `lora_strength_2` · _float_ · default `1.0` — Weight of the second LoRA. Ignored when lora_name_2 is empty.
  - `steps` · _int_ · default `4` — Klein is distilled to 4 steps; raise it only when running undistilled FLUX.2 weights through the unet param
  - `cfg` · _float_ · default `1.0` — Distilled Klein runs at 1.0. Raising it fights the distillation
  - `sampler` · _str_ · default `euler`
  - `reference_megapixels` · _float_ · default `1.0` — The reference is scaled to this many megapixels before encoding, and the output inherits its size
  - `unet` · _str_ · default `flux-2-klein-4b-fp8.safetensors`
  - `clip` · _str_ · default `qwen_3_4b_fp4_flux2.safetensors`
  - `vae` · _str_ · default `flux2-vae.safetensors`

### `qwen_image_21_edit` — Qwen-Image 2.1 Reference Edit

Qwen-Image 2.1 makes a new image from one to three reference images and a plain-English instruction, such as putting the shirt from <image2> on the person in <image1>. Say what changes and what stays. Qwen Research License: non-commercial use only.

- **Output:** image
- **Requirements:** needs image, ~12 GB VRAM, loads ~17.3 GB of model files (VRAM + system RAM)
- **Providers:** local
- **Params:**
  - `image` · _str_ · **required** — First reference (image 1).
  - `prompt` · _str_ · **required** — An instruction, not a scene description. Name what changes, then what stays, and refer to references as <image1>, <image2> in the order they were sent: image is <image1>, then images in order ('Keep the person and pose in <image1> unchanged, put the jacket from <image2> on them').
  - `image_2` · _str_ · default `` — Optional second reference. Send it through the request's images list rather than setting it directly, so Studio stages it on the node.
  - `image_3` · _str_ · default `` — Optional third reference, sent the same way as image_2.
  - `negative_prompt` · _str_ · default `` — Only read when cfg is above 1.
  - `reference_resolution` · _int_ · default `1024` — Each reference is resized to about this many pixels squared, keeping its aspect ratio; the output comes out at the first reference's size. 0 keeps each reference at its own size.
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `steps` · _int_ · default `25` — ComfyUI's template runs 25; Qwen's own examples run 40.
  - `cfg` · _float_ · default `1.0` — Keep at 1 for the official path. Raise it only to use a negative prompt.
  - `sampler` · _str_ · default `euler`
  - `scheduler` · _str_ · default `simple`
  - `unet` · _str_ · default `qwen_image_2.1_int8_convrot.safetensors`
  - `clip` · _str_ · default `qwen3vl_8b_int8_convrot.safetensors` — Text encoder file on the node. The default is the int8 build; qwen3vl_8b_w4a8.safetensors (6.31 GB) is a smaller one from the same repo for nodes short on system RAM.
  - `vae` · _str_ · default `qwen_image_2.1_vae_bf16.safetensors`

### `qwen_multiangle` — Qwen Multi-Angle (re-angle a still)

Re-shoot an existing image of the same subject from a new camera angle. Qwen-Image-Edit-2511 + multi-angle LoRA holds identity, clothing, and lighting while changing the camera viewpoint. Produces a sibling of the source still at a different angle.

- **Output:** image
- **Requirements:** needs image, ~12 GB VRAM, loads ~31.3 GB of model files (VRAM + system RAM)
- **Providers:** local
- **Params:**
  - `image` · _string_ · **required** — Source image filename or Studio output path to re-angle
  - `prompt` · _string_ · **required** — Camera-angle spec only (the <sks> trigger is prepended automatically; do NOT pass a character/scene prompt here). Format: '<azimuth> view <elevation> shot <distance>'. Azimuth: front | front-right quarter | right side | back-right quarter | back | back-left quarter | left side | front-left quarter. Elevation: low-angle | eye-level | elevated | high-angle. Distance: wide shot | medium shot | close-up. Example: 'front-right quarter view eye-level shot medium shot'
  - `seed` · _integer_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.

### `qwen_pose_edit` — Qwen Pose/Position Edit (instruction)

Edit an existing image from a plain-English instruction — change a subject's pose, position, or what they're doing while holding their identity, clothing, the room, and lighting. Powered by Qwen-Image-Edit-2511; the source image is the reference (no LoRA).

- **Output:** image
- **Requirements:** needs image, ~12 GB VRAM, loads ~30.2 GB of model files (VRAM + system RAM)
- **Providers:** local
- **Params:**
  - `image` · _string_ · **required** — Source image filename or Studio output path to edit
  - `prompt` · _string_ · **required** — Plain-English edit instruction. Describe only what changes; the model keeps everything else. Name each body part and where it goes ('left hand on her left hip'). Place the subject against named objects with an exact position ('on the path, one step left of the bench, not touching it'). 'Next to the bench' is too loose and can put the subject in front of the bench instead.
  - `seed` · _integer_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.

### `sdxl_img2img` — SDXL Image-to-Image

Generate SDXL image variations from a source image using prompt guidance and denoise strength

- **Output:** image
- **Requirements:** ~8 GB VRAM
- **Providers:** local
- **Params:**
  - `prompt` · _string_ · **required** — Comma-separated tags describing the image you want out, not the change you want made — this is a re-render of the source at `denoise` strength, not an instruction-following edit. 'restyled as an oil painting' works because it is a description of the result; 'make the sky darker' does not, because nothing here reads commands. For an edit you can phrase as an instruction, use flux2_klein_edit or qwen_pose_edit instead. Same tag syntax as sdxl_base: subject first, `(term:1.2)` to weight a term. Keep the prompt consistent with what is already in the frame — at the 0.25-0.45 denoise this workflow is built for, a prompt that contradicts the source fights it and smears.
  - `image` · _string_ · **required** — Source image filename or Studio output path
  - `negative_prompt` · _string_ · default `` — What to steer away from, same tag syntax. Keep it to defects you actually see — 'blurry, low quality, watermark'.
  - `width` · _integer_ · default `832`
  - `height` · _integer_ · default `1216`
  - `seed` · _integer_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
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
- **Providers:** local, cloud_serverless
- **Params:**
  - `prompt` · _str_ · **required** — Text prompt: subject, setting, and action. Describe big physical action with strong verbs (walks, jumps, turns). Words like subtle, slowly, or gently produce a near-still clip.
  - `negative_prompt` · _str_ · default `bright colors, overexposed, static, blurred details`
  - `width` · _int_ · default `640`
  - `height` · _int_ · default `640`
  - `length` · _int_ · default `81` — Frame count
  - `fps` · _int_ · default `16`
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
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
  - `image` · _str_ · **required** — Input image filename (staged to ComfyUI input).
  - `audio` · _str_ · **required** — Input audio filename (wav) staged to ComfyUI input. Drives lip-sync + clip length.
  - `negative_prompt` · _str_ · default `bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards`
  - `width` · _int_ · default `640` — Resize target width (divisible by 16). Kijai's example: 640, center crop.
  - `height` · _int_ · default `640` — Resize target height (divisible by 16). Kijai's example: 640, center crop.
  - `length` · _int_ · default `500` — Cap on output frames (num_frames into MultiTalkWav2VecEmbeds), not an exact length: the node clamps to the audio, so the voice line sets the real length. 500 is Kijai's example_03 value (its max_frames INTConstant).
  - `fps` · _int_ · default `25` — InfiniteTalk is trained at 25fps; do not change unless you know why.
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `steps` · _int_ · default `6` — Sampler steps. 6 is Kijai's example_03 value.
  - `cfg` · _float_ · default `1.0`
  - `shift` · _float_ · default `11.0`
  - `scheduler` · _str_ · default `dpm++_sde`
  - `blocks_to_swap` · _int_ · default `20` — Transformer blocks kept in system RAM instead of VRAM. 20 is Kijai's example_03 value.
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

Image-to-video with Wan 2.2 — animate a still into a clip, with a motion prompt driving the movement. Identity and scene come from the source image. Past 81 frames the clip is sampled in overlapping context windows and fused, so one action carries on as ONE clip — use a longer length instead of taking a clip's last frame and animating it again, which hands the model a still and restarts the motion from rest.

- **Output:** video
- **Requirements:** supports LoRA, ~12 GB VRAM, loads ~36.8 GB of model files (VRAM + system RAM)
- **Providers:** local, cloud_serverless
- **Params:**
  - `prompt` · _str_ · **required** — Motion prompt. Name an action a viewer could describe afterwards - she stands up and walks toward the camera, he throws the bag over his shoulder. Add a camera instruction on top of it, never instead of it. Words like subtle, slowly or gently are instructions to do nothing. Past 81 frames every context window reads the same prompt, so one sustained action works better than a sequence: asking for a beginning and an end gives you neither.
  - `image` · _str_ · **required** — Input image filename. The clip keeps this image's aspect ratio and is rendered at the area of 1280x720, the Wan 2.2 authors' default (wan/image2video.py, max_area=720*1280), in steps of 16.
  - `negative_prompt` · _str_ · default `bright colors, overexposed, static, blurred details`
  - `length` · _int_ · default `81` — Frame count, must be 4n+1 (33/49/65/81). Default 81 is the length Wan itself ships and generates at: wan_shared_cfg.frame_num = 81 with sample_fps = 16 in wan/configs/shared_config.py, i.e. 5.06 s. The 4n+1 rule is the authors' too - generate.py --frame_num help: "How many frames of video are generated. The number should be 4n+1". Source: github.com/Wan-Video/Wan2.2, both files read 2026-09-21. Up to 81 frames the clip renders in one pass. Past that it is sampled in overlapping context windows (the context_* params) and fused into one clip; 161 frames at 16 fps is about 10 seconds.
  - `context_length` · _int_ · default `21` — Window size in LATENT frames, not real frames - Wan packs 4 real frames into 1 latent, so 21 latent is the model's native 81 real frames ((81-1)/4+1). This sets the per-step VRAM cost. Keep at 21. A clip that fits in one window (length up to 81 at 21) skips context windows entirely: the nodes are removed from the graph.
  - `context_overlap` · _int_ · default `12` — Latent frames shared between neighbouring windows; 12 latent is 48 real frames. This overlap is what carries the motion across a join, so it is the knob to raise if the action stutters or the face shifts mid-clip. Measured 2026-09-17: at 7 latent (28 real) a 161-frame clip showed a visible artefact where the second window blends in, and 12 removed it. Raising it also adds windows, so it costs time.
  - `cond_retain_index_list` · _str_ · default `0` — Past one window: pins the start image into EVERY window instead of only the first. Leave at "0". Measured 2026-09-17: with this empty, only the first window is anchored to the image, and a 161-frame clip ended on a different subject in a different location than it started - each later window invents its own. Set it empty only if you want the clip free to wander.
  - `context_schedule` · _str_ · default `standard_static` — standard_static cuts the clip into fixed sequential windows, each starting context_length - context_overlap frames after the last, and reuses that same set on every step - which is what a one-way action wants. standard_uniform instead re-picks strided windows per step from a shifting offset, and looped_uniform lets them wrap around to the start; both come from AnimateDiff's scheduler and suit looping or ambient motion. Read from comfy/context_windows.py, create_windows_static_standard vs create_windows_uniform_standard.
  - `fuse_method` · _str_ · default `pyramid` — How overlapping windows are blended. pyramid weights the middle of each window highest.
  - `fps` · _int_ · default `32` — Frame rate of the saved clip. Wan renders 16 fps; every clip then goes through RIFE x2 frame interpolation (rife49, ComfyUI-Frame-Interpolation), which doubles the frames, so 32 plays at the speed Wan rendered it.
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `steps_high` · _int_ · default `2` — 2+2=4 total. The model authors' published value, not one we tuned. The Lightning LoRA is step-distilled: it was trained on the noise schedule a 4-step run produces, and ComfyUI derives its sigma spacing from the step count you pass, so any other count denoises at noise levels the LoRA never saw. That shows up as rising contrast and a light that blooms across the clip. Source: lightx2v/Wan2.2-Lightning, official native-ComfyUI workflow Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1-NativeComfy.json — steps 4, split 0-2 / 2-4.
  - `steps_low` · _int_ · default `2` — See steps_high. 2+2=4 total, per the authors' workflow.
  - `total_steps` · _int_ · default `4` — steps_high + steps_low; passed to KSamplerAdvanced.steps. Fixed by what the distillation was trained on, not by quality preference — changing it means changing the LoRA.
  - `cfg_high` · _float_ · default `1.0` — 1.0 on both stages. The Lightning LoRA is CFG-distilled — there is no unconditional branch to guide, and raising CFG pushes it off its trained trajectory. Source: lightx2v/Wan2.2-Lightning official native-ComfyUI workflow, cfg 1 on both KSamplerAdvanced nodes. Consequence: negative_prompt is inert here, because at CFG 1.0 nothing evaluates it.
  - `cfg_low` · _float_ · default `1.0` — Leave at 1.0; the low-noise stage runs the distilled LoRA.
  - `shift` · _float_ · default `5.0`
  - `sampler` · _str_ · default `euler`
  - `scheduler` · _str_ · default `simple`
  - `vae` · _str_ · default `Wan2.1_VAE.safetensors`
  - `clip` · _str_ · default `umt5_xxl_fp8_e4m3fn_scaled.safetensors`
  - `high_model` · _str_ · default `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` — fp8_scaled high-noise model in diffusion_models (UNETLoader)
  - `low_model` · _str_ · default `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` — fp8_scaled low-noise model in diffusion_models (UNETLoader)
  - `high_lora` · _str_ · default `Wan2.2-Lightning_I2V-A14B-4steps-lora_HIGH_fp16.safetensors` — Lightning speed LoRA for high-noise model
  - `low_lora` · _str_ · default `Wan2.2-Lightning_I2V-A14B-4steps-lora_LOW_fp16.safetensors` — Lightning speed LoRA for low-noise model
  - `high_lora_strength` · _float_ · default `1.0` — 1.0, same as low_lora_strength. Source: lightx2v/Wan2.2-Lightning official native-ComfyUI workflow — both LoraLoaderModelOnly nodes at 1.0. Lowering it to fight the Lightning slow-motion artifact is a community recipe, not the authors': it weakens the distillation that the 4-step schedule assumes, and we measured the cost on 2026-09-21 as a light blooming across the clip. If motion is flat, change the start frame or the action, not this.
  - `high_lora_2` · _str_ · default `` — Optional second LoRA stacked after the speed LoRA - this is where a motion or concept LoRA goes, e.g. a dance or action LoRA trained for Wan 2.2 i2v. Leave empty and the slot is removed from the graph entirely. Wan 2.2 LoRAs ship as a high/low pair: set both.
  - `high_lora_2_strength` · _float_ · default `1.0` — Weight of the second high-noise LoRA. Ignored when high_lora_2 is empty.
  - `low_lora_strength` · _float_ · default `1.0` — Leave at 1.0.
  - `low_lora_2` · _str_ · default `` — Low-noise half of the pair in high_lora_2. Leave empty to disable.
  - `low_lora_2_strength` · _float_ · default `1.0` — Weight of the second low-noise LoRA. Ignored when low_lora_2 is empty.
  - `high_lora_3` · _str_ · default `` — Optional third LoRA, stacked after high_lora_2 - for a second concept on the same clip, e.g. a facial-expression LoRA on top of a motion LoRA. Leave empty and the slot is removed from the graph entirely. Set both halves of the pair.
  - `high_lora_3_strength` · _float_ · default `1.0` — Weight of the third high-noise LoRA. Ignored when high_lora_3 is empty.
  - `low_lora_3` · _str_ · default `` — Low-noise half of the pair in high_lora_3. Leave empty to disable.
  - `low_lora_3_strength` · _float_ · default `1.0` — Weight of the third low-noise LoRA. Ignored when low_lora_3 is empty.

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
  - `width` · _int_ · default `640` — Resize target width (divisible by 16). Kijai's example: 640, center crop.
  - `height` · _int_ · default `640` — Resize target height (divisible by 16). Kijai's example: 640, center crop.
  - `length` · _int_ · default `1000` — Cap on output frames (num_frames into MultiTalkWav2VecEmbeds), not an exact length: the node clamps to the audio, so the voice line sets the real length. 1000 is Kijai's V2V example_02 value (its max_frames INTConstant).
  - `fps` · _int_ · default `25` — InfiniteTalk is trained at 25fps. Also re-times the driving video to this rate (force_rate). Do not change unless you know why.
  - `seed` · _int_ — Optional. Leave it out and every run is a new random take. Send a seed only to remake an image exactly: the seed a job used is in its record.
  - `steps` · _int_ · default `4` — Sampler steps. 4 is Kijai's V2V example_02 value; the sampler starts at step 2 with denoise 1.0, as in his graph, which keeps the driving clip's motion.
  - `cfg` · _float_ · default `1.0`
  - `shift` · _float_ · default `11.0`
  - `scheduler` · _str_ · default `dpm++_sde`
  - `blocks_to_swap` · _int_ · default `20` — Transformer blocks kept in system RAM instead of VRAM. 20 is Kijai's V2V example_02 value.
  - `model` · _str_ · default `wan2.1-i2v-14b-480p-Q3_K_S.gguf` — GGUF-quantized Wan2.1 I2V 14B backbone (~7.9GB). Fits 12GB card with block-swap. fp8 safetensors OOMs a 12GB card.
  - `multitalk_model` · _str_ · default `Wan2_1-InfiniteTalk_Single_Q4_K_M.gguf` — GGUF-quantized InfiniteTalk module (~1.3GB). Must be GGUF to pair with the GGUF backbone.
  - `wav2vec_model` · _str_ · default `wav2vec2-chinese-base_fp16.safetensors`
  - `t5` · _str_ · default `umt5-xxl-enc-fp8_e4m3fn.safetensors`
  - `vae` · _str_ · default `Wan2.1_VAE.safetensors`
  - `clip_vision` · _str_ · default `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`
  - `speed_lora` · _str_ · default `WanVideo\Lightx2v\lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`
  - `speed_lora_strength` · _float_ · default `1.0`
  - `filename_prefix` · _str_ · default `infinitetalk_v2v`

