CREATE TABLE IF NOT EXISTS storage_cleanup_jobs (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('PRIVATE_FILE', 'DRIVE_EXAM_ARCHIVE')),
  reference text,
  exam_id uuid NOT NULL,
  exam_title text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'PRIVATE_FILE' AND reference IS NOT NULL) OR (kind = 'DRIVE_EXAM_ARCHIVE' AND reference IS NULL))
);
CREATE INDEX IF NOT EXISTS storage_cleanup_jobs_retry_idx ON storage_cleanup_jobs(next_attempt_at, created_at);
