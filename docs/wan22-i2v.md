# Wan 2.2 Image-to-Video (I2V) — Model & Motion Reference

Author-sourced reference for the Wan 2.2 I2V model: how the architecture works, how
motion is driven, and how the model authors say to prompt it. This is **not** a description
of our Studio wiring — it distills the official Wan-Video / Alibaba / ComfyUI documentation
so we prompt and configure the model the way its creators intended.

> Sources are cited inline. Primary references:
> - Wan official blog — https://wan.video/blog/wan2.2
> - Model card (Wan-AI/Wan2.2-I2V-A14B) — https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B
> - Alibaba Cloud Model Studio prompt guide — https://help.aliyun.com/en/model-studio/text-to-video-prompt
> - ComfyUI official Wan 2.2 tutorial — https://docs.comfy.org/tutorials/video/wan/wan2_2
> - The Batch (deeplearning.ai) architecture summary — https://www.deeplearning.ai/the-batch/alibabas-wan-2-2-video-models-adopt-a-new-architecture-to-sort-noisy-from-less-noisy-inputs/

---

## 1. What the model is

Wan 2.2 is Alibaba's open-weights (Apache 2.0) video generation family. The image-to-video
variant is **Wan2.2-I2V-A14B**: it takes a starting image (+ optional text prompt) and
animates it into video while preserving the image's content, subject, scene, and style.

Three model variants ship:

| Variant | Params | Role |
|---|---|---|
| `Wan2.2-TI2V-5B` | 5B | Hybrid t2v + i2v, single model. Fits ~8GB VRAM with offloading. Fast prototyping. |
| `Wan2.2-I2V-A14B` | 14B (MoE) | Dedicated image-to-video. Highest i2v quality. |
| `Wan2.2-T2V-A14B` | 14B (MoE) | Dedicated text-to-video. |

Source: ComfyUI tutorial model table — docs.comfy.org/tutorials/video/wan/wan2_2

The 14B models are the ones with the two-expert architecture below. The 5B hybrid is a
single dense model (no high/low-noise split).

---

## 2. The MoE architecture — why there are two model files

The 14B models use a **Mixture-of-Experts (MoE)** design on a flow-matching Diffusion
Transformer (DiT) backbone. This is the single most important thing to understand about
Wan 2.2, because it's why i2v ships as **two `.safetensors` files** (`high_noise` + `low_noise`).

- **Two specialized experts**, ~14B params each (~27B total), but **only one is active per
  denoising step** — so per-step compute/memory stays close to a dense 14B model.
- The experts are **temporally specialized by noise level**, not by content. They split the
  denoising trajectory in two.

Source: wan.video/blog/wan2.2; Wan-AI/Wan2.2-I2V-A14B model card; deeplearning.ai The Batch.

### High-noise expert (early denoising)
- Active in the **early** steps (high noise, low signal-to-noise ratio).
- Owns **global structure**: composition, subject placement, coarse motion, scene layout —
  the high-level "plan" of the shot as it emerges from pure noise.

### Low-noise expert (late denoising)
- Active in the **later** steps (low noise, high SNR).
- Owns **refinement**: textures, fine detail, edges, lighting, and temporal consistency.

### How the switch happens (SNR routing)
- Routing is by **signal-to-noise ratio (SNR)**, which falls monotonically as denoising
  progresses.
- A boundary timestep `t_moe` is defined where `SNR = SNR_min / 2`.
  - `t ≥ t_moe` (high noise) → high-noise expert.
  - `t < t_moe` (low noise) → low-noise expert.

Source: Wan-AI/Wan2.2-I2V-A14B model card; wan.video/blog/wan2.2.

**Practical implication for us:** in a ComfyUI graph you load *both* diffusion models and
sample in two stages — high-noise model for the first block of steps, low-noise model for the
remainder. Getting the step split / boundary right matters: motion and structure are decided
in the high-noise stage, so that stage is what governs how much and what kind of motion you get.

---

## 3. How motion is driven

Two inputs shape motion in i2v:

1. **The starting image** anchors identity, framing, scene, and style. The model animates
   *from* it — it does not re-invent the subject.
2. **The text prompt** drives what moves and how the camera moves. For i2v the authors are
   explicit that the prompt's job is **motion + camera**, not describing the subject again
   (the image already did that).

The high-noise expert is where coarse motion and layout are established during early
denoising; the low-noise expert then keeps that motion temporally consistent while sharpening
detail. So motion "amplitude" is largely a high-noise-stage phenomenon.

Wan 2.2 was specifically trained for **large-scale complex motion** and **cinematic camera
control** — the authors call out improved motion smoothness/controllability and professional
camera-language adherence as headline features.

Source: ComfyUI tutorial "Model Highlights"; wan.video/blog/wan2.2.

---

## 4. Official prompting formulas (from the model authors)

These come straight from Alibaba Cloud Model Studio's prompt guide — the authoritative
source for how to prompt this model family.

Source: help.aliyun.com/en/model-studio/text-to-video-prompt

### Image-to-video formula (use this one for i2v)
```
Prompt = Motion + Camera movement
```
Because the image already defines entity, scene, and style, the i2v prompt should focus **only**
on:
- **Motion** — what the elements *do*. Name an action a viewer could describe afterwards:
  *"she stands up and walks toward the camera," "he throws the bag over his shoulder and
  turns."* Describe the full movement with strong verbs. `subtle / slightly / gently /
  slowly / drifting / breeze` are instructions to do nothing — see §6.
- **Camera movement** — explicit camera instructions: *"camera pushes in," "camera moves
  left," "slow pan right," "orbit around the subject."* To hold the camera still, say
  **"fixed camera"** — if you omit camera direction the model tends to invent a default move.

### For reference — the text-to-video formulas (context, not for i2v)
- **Basic:** `Entity + Scene + Motion`
- **Advanced:** `Entity + Scene + Motion + Aesthetic control + Stylization`
  - "Aesthetic control" = light source, lighting, shot size, camera angle, lens, camera move.
  - Most weak prompts cover entity + motion but skip aesthetic control → you get a static
    camera in an undefined void. (Authors' own words.)

### Camera language & emotional intent (from the guide)
The guide maps camera moves to intent — use professional cinematography vocabulary for
predictable results:
- **Push-in** → narrows attention onto the subject
- **Pull-out** → scale / isolation / reveal
- **Tracking shot** → viewer moves alongside the subject
- **Orbit** → emphasizes the subject's importance
- **Fixed camera** → stillness and focus

Other supported moves: pan (left/right), tilt (up/down), dolly, crane, handheld, zoom.

### Prompt hygiene
- Be **explicit** about camera — omission yields default motion.
- Keep prompts focused; combine motion modifiers with clear camera intent.
- `prompt_extend` (Alibaba API / a Qwen model) can auto-expand a short prompt into a full
  structured one if you want the model to fill in cinematic detail.

---

## 5. ComfyUI wiring the authors ship (14B i2v)

The official ComfyUI i2v workflow loads **both** experts and samples in two stages:

- `Load Diffusion Model` #1 → `wan2.2_i2v_high_noise_14B_*.safetensors`
- `Load Diffusion Model` #2 → `wan2.2_i2v_low_noise_14B_*.safetensors`
- Text encoder: `umt5_xxl` (UMT5) — Wan uses UMT5 for text conditioning.
- VAE: `wan2.2_vae.safetensors` (I2V image conditioning uses the 3D VAE; compatible with the
  Wan2.1 VAE).
- The input image feeds the i2v latent node; `length` sets total frames.

Source: docs.comfy.org/tutorials/video/wan/wan2_2 (14B I2V section); model card (UMT5 / 3D VAE).

For low-VRAM boxes, GGUF quantized builds exist (e.g. `bullerwins/Wan2.2-I2V-A14B-GGUF`) and
speed LoRAs (Lightx2v 4-step) are published for faster sampling — cited in the same ComfyUI
tutorial. These are third-party accelerations, not core model behavior.

---

## 6. TL;DR for prompting our i2v shots

1. Don't re-describe the subject — the image already carries it.
2. Write **motion first, camera second**: what moves + how the camera moves.
3. **"Motion" means REAL motion** — walking, running, dancing, jumping, workouts,
   exercises, sports: big physical action. Describe the full movement with strong
   verbs. Do **not** default to `subtle / slightly / gently / slowly / drifting / breeze` — that
   vocabulary yields a near-still "breathing photo," which is the wrong result unless motion is
   explicitly *not* wanted.
4. Ambient/subtle language is **only** for talking-head or deliberately-still shots (lip-sync
   clips where the character just speaks). Know which mode you're in before writing the prompt.
5. Always state a camera instruction — even "fixed camera" — or the model picks one for you.
6. Two-stage denoise: coarse motion/structure is set in the **high-noise** stage, so that
   stage is where motion is won or lost — but the lever is **LoRA strength and CFG, not step
   count**. The Lightning LoRA is CFG-distilled, and at strength 1.0 it flattens motion into
   the well-known slow-motion artifact; running 30 steps to fight that just pays for the same
   near-still clip more slowly. Drop `high_lora_strength` to ~0.5 and give the high-noise
   stage real CFG (`cfg_high` ~3.5); keep the low-noise stage at strength 1.0 / CFG 1.0.
   Measured here: 480x832, 6 steps (3+3), `cfg_high` 3.5 / `cfg_low` 1.0, strengths 0.5/1.0
   ran in a median **176 s** against **328 s** for the old 30-step CFG-1 config, with more
   motion, not less.
7. **`cfg_high` 1.0 disables your negative prompt.** At CFG 1 there is no unconditional
   branch, so the negative is never evaluated. It only starts doing anything above 1.0.
8. **A motion LoRA goes in the second slot, not the first.** `high_lora` / `low_lora` hold the
   speed LoRA that buys you the 4-step render; overwriting them with a motion LoRA silently
   costs you that and leaves 4 steps far too few to converge. Put the motion LoRA in
   `high_lora_2` / `low_lora_2` instead and it stacks on top. Wan 2.2 LoRAs are trained as a
   high/low pair — set both halves, or the stage you left empty fights the one you filled.
   An empty slot is dropped from the graph, so leaving them blank costs nothing.
