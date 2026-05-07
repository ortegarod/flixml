CREATE TABLE IF NOT EXISTS project_shot_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_id TEXT NOT NULL REFERENCES project_scenes(id) ON DELETE CASCADE,
    shot_id TEXT NOT NULL REFERENCES project_shots(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    prompt TEXT,
    file TEXT,
    prompt_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(shot_id, kind, version_number)
);

CREATE INDEX IF NOT EXISTS idx_project_shot_versions_shot ON project_shot_versions(shot_id, kind, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_project_shot_versions_prompt ON project_shot_versions(prompt_id) WHERE prompt_id IS NOT NULL;
