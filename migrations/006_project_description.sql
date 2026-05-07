-- Drop the unused freeform `content` field on projects (the script lives in
-- the scenes/shots themselves, not in a separate top-level field) and rename
-- `synopsis` to `description` so the field name reflects what it holds.

ALTER TABLE projects DROP COLUMN IF EXISTS content;
ALTER TABLE projects RENAME COLUMN synopsis TO description;
