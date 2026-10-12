ALTER TABLE exams ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS exams_visible_idx ON exams(deleted_at,created_at DESC);
CREATE INDEX IF NOT EXISTS questions_visible_idx ON questions(teacher_id,deleted_at,created_at DESC);
