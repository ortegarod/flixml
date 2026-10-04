-- One face fingerprint per character image, and how closely it matches the rest of
-- that character's gallery. Kept out of `media` so the feature can be dropped whole.
CREATE TABLE IF NOT EXISTS face_matches (
    filename TEXT PRIMARY KEY REFERENCES media(filename) ON DELETE CASCADE,
    embedding REAL[],          -- NULL when no face was found
    face_px REAL,              -- width of the detected face, in pixels
    score REAL,                -- NULL until the character has enough faces to compare against
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
