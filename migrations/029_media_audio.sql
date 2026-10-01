-- A TTS line is an output file a caller then hands to a lip-sync job, so it needs a
-- row like any other: without one, the ownership check finds no owner and refuses it.
-- Audio rows exist for that check; the gallery listing leaves them out.
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_type_check;
ALTER TABLE media ADD CONSTRAINT media_type_check CHECK (type IN ('image', 'video', 'audio'));
