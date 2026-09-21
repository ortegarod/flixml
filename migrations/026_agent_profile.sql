-- Profile fields for an account. The agents table held only what a key needs to work —
-- id, name, hash, scopes — so an account page had nothing to show but its id. These two
-- are the public half of an account and are deliberately explicit: everything else in the
-- row (key_hash, the scope lists) never leaves the admin API.
-- `avatar` is a media filename relative to the output dir, the same shape
-- characters.source_images uses, so it renders through /api/thumb like anything else.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS bio TEXT;
