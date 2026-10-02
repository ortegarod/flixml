# Training Datasets & LoRA Training

Training config templates for character LoRA fine-tuning on [AI Toolkit](https://github.com/ostris/ai-toolkit). Each template cites the sources its settings come from.

## What's in this directory

**Templates (provided):**
- `flux2_character_template.yaml` — FLUX.2-dev character LoRA template
- `sdxl_character_template.yaml` — SDXL character LoRA template (any SDXL-architecture checkpoint, from a single `.safetensors`)

**Generated at runtime (do not edit):**
- `config/` — job configs generated from templates per training run
- `output/` — LoRA checkpoints and sample previews


## Workflow

1. Put the dataset on the trainer: images plus one `.txt` caption per image, in AI Toolkit's datasets folder.
2. Start training with `POST /api/lora-training/start`.
3. Watch it on the LoRA Training page, then download checkpoints when done.

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

- Start with `<trigger>, <class word>,` where the class word is the generic category of your subject (e.g. `a person`, `a robot`, `a creature`). For FlixML Studio character LoRAs this is usually `a person`.
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
  "dataset": "character_v1",
  "base_config": "sdxl_character",
  "model_name_or_path": "<path to the checkpoint on the trainer>"
}
```

That is all a run needs. The recipe (rank, learning rate, resolution, steps, previews) comes from the template, as its sources give it. Any recipe field can still be set in the request (`steps`, `lora_rank`, `learning_rate`, `sample_prompts`, …; see `GET /openapi.json`); an unset field keeps the template's value. A template's `studio:` block sets steps from the dataset size (`steps_per_image`).

`sample_prompts` are the previews: the trainer renders one image per prompt every `sample_every` steps, and the LoRA Training page shows them. `[trigger]` in a prompt becomes the trigger word. Unset, the run previews the template's prompts; the start response lists the ones it will use.

The dataset (images plus a `.txt` caption per image) must already be in the trainer's datasets folder, uploaded with ai-toolkit's `POST /api/datasets/upload`. The backend generates the job YAML from the template named by `base_config`, with the trainer's own folders, and starts the run.

## Monitoring

- `GET /api/lora-training/jobs` — list jobs and status
- `GET /api/lora-training/samples?job_name={name}` — training previews
- `GET /api/lora-training/checkpoints?job_name={name}` — downloadable LoRA weights

## Templates

`flux2_character_template.yaml` follows the defaults in the RunComfy guide. Most settings should not be changed without reading the guide first.

## References

- RunComfy guide: https://www.runcomfy.com/trainer/ai-toolkit/flux-2-dev-lora-training
- ai-toolkit: https://github.com/ostris/ai-toolkit
- API schema: `GET /openapi.json`
