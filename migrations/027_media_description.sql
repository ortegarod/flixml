-- A human caption on an asset — what it is, not what the machine did to make it.
-- Its own column rather than a key inside `metadata`: metadata records what the
-- caller asked of the node, this is written about the result and often long after,
-- and a caption has to survive a metadata rewrite.
ALTER TABLE media ADD COLUMN IF NOT EXISTS description TEXT;
