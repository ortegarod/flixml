-- A file a workflow writes besides its picture or video (an FBX, a GLB) is kept on its
-- job and downloaded from there. Like audio, it needs a row so the ownership check
-- finds its owner; the gallery listing leaves it out.
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_type_check;
ALTER TABLE media ADD CONSTRAINT media_type_check CHECK (type IN ('image', 'video', 'audio', 'file'));
