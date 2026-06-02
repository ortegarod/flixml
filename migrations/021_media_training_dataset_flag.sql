ALTER TABLE media ADD COLUMN IF NOT EXISTS included_in_training_dataset BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_media_included_in_training_dataset
ON media(included_in_training_dataset)
WHERE included_in_training_dataset = TRUE;
