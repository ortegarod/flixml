ALTER TABLE project_shots ADD COLUMN IF NOT EXISTS previous_shot_id TEXT REFERENCES project_shots(id);
ALTER TABLE project_shots ADD COLUMN IF NOT EXISTS end_frame_file TEXT;
ALTER TABLE project_shots ADD COLUMN IF NOT EXISTS end_frame_prompt TEXT;
