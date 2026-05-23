-- Nemoflix Studio schema — dev-only, single file
-- Run on every init_db(); all statements use IF NOT EXISTS / IF NOT EXISTS

-- Media files (gallery)
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

-- Generation jobs
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

-- Characters
CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    trigger TEXT,
    description TEXT,
    kind TEXT,
    source_images JSONB NOT NULL DEFAULT '[]'::jsonb,
    loras JSONB NOT NULL DEFAULT '[]'::jsonb,
    defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
    voice JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_characters_updated_at ON characters(updated_at DESC);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    aspect_ratio TEXT NOT NULL DEFAULT '9:16',
    duration_seconds INT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planning', 'ready', 'rendering', 'completed', 'failed')),
    characters JSONB NOT NULL DEFAULT '[]'::jsonb,
    narrator_voice JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Project scenes
CREATE TABLE IF NOT EXISTS project_scenes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_number INT NOT NULL,
    title TEXT,
    setting TEXT NOT NULL DEFAULT 'interior',
    weather TEXT NOT NULL DEFAULT 'clear',
    summary TEXT,
    location TEXT,
    time_of_day TEXT,
    characters JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, scene_number)
);
CREATE INDEX IF NOT EXISTS idx_project_scenes_project ON project_scenes(project_id, scene_number);

-- Project shots
CREATE TABLE IF NOT EXISTS project_shots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scene_id TEXT NOT NULL REFERENCES project_scenes(id) ON DELETE CASCADE,
    shot_number INT NOT NULL,
    text TEXT,
    description TEXT,
    subtitle TEXT,
    speaker TEXT,
    image_prompt TEXT,
    motion_prompt TEXT,
    characters JSONB NOT NULL DEFAULT '[]'::jsonb,
    duration_seconds INT NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'rendering_image', 'image_ready', 'animating', 'video_ready', 'failed')),
    image_file TEXT,
    video_file TEXT,
    image_prompt_id TEXT,
    video_prompt_id TEXT,
    workflow TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scene_id, shot_number)
);
CREATE INDEX IF NOT EXISTS idx_project_shots_project ON project_shots(project_id);
CREATE INDEX IF NOT EXISTS idx_project_shots_scene ON project_shots(scene_id, shot_number);
CREATE INDEX IF NOT EXISTS idx_project_shots_status ON project_shots(status);

-- Project shot versions
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

-- Project renders
CREATE TABLE IF NOT EXISTS project_renders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    render_number INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    final_video TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, render_number)
);
CREATE INDEX IF NOT EXISTS idx_project_renders_project ON project_renders(project_id, render_number DESC);
CREATE INDEX IF NOT EXISTS idx_project_renders_status ON project_renders(project_id, status) WHERE status = 'completed';

-- Training jobs
CREATE TABLE IF NOT EXISTS training_jobs (
    job_name TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'configured'
        CHECK (status IN ('configured', 'pending', 'running', 'training', 'completed', 'failed', 'missing_log', 'starting', 'unknown')),
    config_path TEXT,
    log_path TEXT,
    output_dir TEXT,
    dataset TEXT,
    trigger_word TEXT,
    model TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON training_jobs(status);
CREATE INDEX IF NOT EXISTS idx_training_jobs_created ON training_jobs(created_at DESC);

-- Datasets
CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    image_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
