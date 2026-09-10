-- Agent identity: lets each caller (human tool, AI agent, script) carry its own API
-- key so generation jobs on a shared queue can be attributed back to who submitted
-- them, and optionally restricted to specific characters/workflows/concurrency.
-- Enforcement is opt-in via config.json security.require_api_key (default false) —
-- callers with no key still work, they just aren't attributed to an agent.
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    allowed_characters TEXT[],
    allowed_workflows TEXT[],
    max_concurrent_jobs INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- Jobs/media already carry an "owner_id" key in their JSONB metadata (see
-- GenerationService.generate) — it was wired for exactly this but never
-- populated. Index it so filtering by agent stays cheap once it is.
CREATE INDEX IF NOT EXISTS idx_jobs_owner_id ON jobs ((metadata->>'owner_id'));
CREATE INDEX IF NOT EXISTS idx_media_owner_id ON media ((metadata->>'owner_id'));
