CREATE TABLE IF NOT EXISTS training_jobs (
    job_name     TEXT PRIMARY KEY,
    status       TEXT NOT NULL DEFAULT 'configured'
                 CHECK (status IN ('configured', 'pending', 'running', 'training', 'completed', 'failed', 'missing_log', 'starting', 'unknown')),
    config_path  TEXT,
    log_path     TEXT,
    output_dir   TEXT,
    dataset      TEXT,
    trigger_word TEXT,
    model        TEXT,
    metadata     JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON training_jobs(status);
CREATE INDEX IF NOT EXISTS idx_training_jobs_created ON training_jobs(created_at DESC);
