# Training Datasets & LoRA Training

Training config templates, caption files, and dataset folders for character LoRA fine-tuning.

**Source of truth for hyperparameters:** [RunComfy FLUX.2 LoRA training guide](https://www.runcomfy.com/trainer/ai-toolkit/flux-2-dev-lora-training).

## What's in this directory

**Templates (provided):**
- `flux2_character.yaml` — FLUX.2-dev character LoRA template
- `wan22_i2v_character_template.yaml` — Wan 2.2 image-to-video character template (untested)

**You create these before training:**
- `datasets/{character_id}/` — caption files (`.txt`) per training image

**Generated at runtime (do not edit):**
- `config/` — job configs generated from templates per training run
- `output/` — LoRA checkpoints and sample previews


## Workflow

1. Mark 30–60 training images per character in the Nemoflix Studio gallery (toggle "Include in training dataset").
2. Write one caption file per image in `datasets/{character_id}/{image_stem}.txt`.
3. Start training from the UI or via `POST /api/lora-training/start`.
4. Monitor samples and download checkpoints when done.

## Trigger word

Short, unique, non-dictionary token.

- Good: `ch4rtrig`, `xy_char01`, `midnight_tarot`
- Bad: `sam`, `ana`, `alex`, or the character's real name

Common words fight the base model and dilute identity learning.

## Captions

Format:

```
<trigger>, a person, <scene description>
```

Example:

```
ch4rtrig, a person, sitting at a wooden desk in a navy blazer, soft side lighting, medium shot
```

Rules:

- Start with `<trigger>, <class word>,` where the class word is the generic category of your subject (e.g. `a person`, `a robot`, `a creature`). For Nemoflix Studio character LoRAs this is usually `a person`.
- Describe visible scene details (pose, clothing, setting, lighting, framing).
- Do **not** describe identity-specific features (face shape, eye color, hair color).
- No quality tags (`masterpiece`, `8k`, `photorealistic`).
- Keep it to 15–30 words, neutral tone.

The class word lets the base model handle the generic concept while the trigger absorbs identity.

## Starting training

```
POST /api/lora-training/start
{
  "job_name": "character_v1",
  "trigger_word": "ch4rtrig",
  "character_id": "<character uuid>"
}
```

The backend reads captions, verifies each marked image has a caption, uploads everything to ai-toolkit, generates the job YAML from `flux2_character.yaml`, and starts the run.

## Monitoring

- `GET /api/lora-training/jobs` — list jobs and status
- `GET /api/lora-training/jobs/{name}/samples` — training previews
- `GET /api/lora-training/jobs/{name}/checkpoints` — downloadable LoRA weights

## Templates

`flux2_character.yaml` and `wan22_i2v_character_template.yaml` follow the defaults in the RunComfy guide. Most settings should not be changed without reading the guide first.

## References

- RunComfy guide: https://www.runcomfy.com/trainer/ai-toolkit/flux-2-dev-lora-training
- ai-toolkit: https://github.com/ostris/ai-toolkit
- API schema: `GET /api/openapi.json`
