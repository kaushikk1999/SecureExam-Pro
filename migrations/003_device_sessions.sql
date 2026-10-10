CREATE TABLE IF NOT EXISTS exam_devices(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),session_version int NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS exam_devices_user ON exam_devices(user_id);
