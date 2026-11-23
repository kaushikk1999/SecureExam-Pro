-- One growing Google Drive file per screen-recording session (one browser
-- MediaRecorder run). Chunks are appended through a Drive resumable upload;
-- Drive needs 256 KiB-aligned pieces, so the unaligned tail waits in `carry`.
CREATE TABLE IF NOT EXISTS recording_uploads (
  attempt_id uuid NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime text NOT NULL,
  file_name text NOT NULL DEFAULT '',
  upload_url text,
  uploaded_bytes bigint NOT NULL DEFAULT 0,
  carry bytea,
  last_sequence bigint NOT NULL DEFAULT -1,
  drive_file_id text,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, session_id)
);
CREATE INDEX IF NOT EXISTS recording_uploads_open
  ON recording_uploads(updated_at) WHERE finalized_at IS NULL;
