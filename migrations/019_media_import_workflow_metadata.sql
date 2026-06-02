-- Preserve imported image generation metadata extracted from PNG/ComfyUI metadata.
ALTER TABLE media ADD COLUMN IF NOT EXISTS negative_prompt TEXT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS scheduler TEXT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS workflow_json JSONB;
