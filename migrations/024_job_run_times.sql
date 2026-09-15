-- When the GPU node actually started and finished running a job, as reported by
-- ComfyUI. created_at/completed_at are when Studio submitted the job and when it
-- noticed the job was done, so they include queue wait and polling lag.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
