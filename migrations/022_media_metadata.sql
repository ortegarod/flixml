-- Add metadata column to media table for self-contained gallery records.
ALTER TABLE media ADD COLUMN IF NOT EXISTS metadata JSONB;
