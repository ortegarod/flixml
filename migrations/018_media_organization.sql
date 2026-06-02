ALTER TABLE media ADD COLUMN IF NOT EXISTS character_ids TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE media ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_media_character_ids ON media USING GIN(character_ids);
CREATE INDEX IF NOT EXISTS idx_media_tags ON media USING GIN(tags);

-- Backfill media rows from completed generation job metadata where possible.
UPDATE media
SET character_ids = ARRAY(
    SELECT DISTINCT jsonb_array_elements_text(jobs.metadata->'character_ids')
),
updated_at = NOW()
FROM jobs
WHERE media.prompt_id = jobs.prompt_id
  AND cardinality(media.character_ids) = 0
  AND jsonb_typeof(jobs.metadata->'character_ids') = 'array';
