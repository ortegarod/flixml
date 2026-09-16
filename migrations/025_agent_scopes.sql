-- Read scoping for agent keys. A non-admin key only sees the jobs, media and projects
-- it owns (metadata->>'owner_id'); an admin key sees everything. Existing keys stay
-- non-admin, so turning on security.require_api_key never widens what they can read.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects ((metadata->>'owner_id'));
