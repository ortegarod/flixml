-- A character belongs to one account. The owner uses it and sees its media; an admin
-- key sees every character. This replaces the per-key character list, which made the
-- admin match characters to keys by hand and let a key with an empty list use them all.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_characters_owner_id ON characters (owner_id);

-- Carry the old lists over: a character named by exactly one key belongs to that key.
-- The rest stay unowned, which only admin keys can use, until an admin assigns them.
UPDATE characters c SET owner_id = a.id
FROM agents a
WHERE c.owner_id IS NULL
  AND c.id = ANY(a.allowed_characters)
  AND (SELECT COUNT(*) FROM agents b WHERE c.id = ANY(b.allowed_characters)) = 1;

ALTER TABLE agents DROP COLUMN IF EXISTS allowed_characters;
