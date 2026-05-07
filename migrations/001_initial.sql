CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media (
    filename TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('image', 'video')),
    width INT,
    height INT,
    size BIGINT,
    modified TIMESTAMPTZ,

    prompt TEXT,
    seed BIGINT,
    steps INT,
    guidance FLOAT,
    sampler TEXT,

    model TEXT,
    vae TEXT,
    text_encoder TEXT,
    loras JSONB,
    workflow_type TEXT,
    prompt_id TEXT,
    source_image TEXT,
    video_file TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
CREATE INDEX IF NOT EXISTS idx_media_modified ON media(modified DESC);
CREATE INDEX IF NOT EXISTS idx_media_prompt_id ON media(prompt_id) WHERE prompt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_source_image ON media(source_image) WHERE source_image IS NOT NULL;

CREATE TABLE IF NOT EXISTS jobs (
    prompt_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'unknown')),
    prompt TEXT,
    width INT,
    height INT,
    workflow_json JSONB,
    output_filename TEXT,
    error TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC);
