CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    trigger TEXT,
    description TEXT,
    source_images JSONB NOT NULL DEFAULT '[]'::jsonb,
    loras JSONB NOT NULL DEFAULT '[]'::jsonb,
    defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_characters_updated_at ON characters(updated_at DESC);
