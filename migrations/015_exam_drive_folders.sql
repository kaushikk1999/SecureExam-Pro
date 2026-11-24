-- The teacher-Drive folder that holds each exam's recordings, so deleting the
-- exam can delete the whole folder tree (not just individual files).
CREATE TABLE IF NOT EXISTS exam_drive_folders (
  exam_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, owner_user_id)
);

-- New cleanup job: delete an exam folder (reference "<owner>:<folderId>") or
-- sweep folders of deleted exams (reference "<owner>:sweep") in a teacher's
-- connected Drive.
ALTER TABLE storage_cleanup_jobs DROP CONSTRAINT IF EXISTS storage_cleanup_jobs_kind_check;
ALTER TABLE storage_cleanup_jobs DROP CONSTRAINT IF EXISTS storage_cleanup_jobs_check;
ALTER TABLE storage_cleanup_jobs ADD CONSTRAINT storage_cleanup_jobs_kind_reference_check CHECK (
  (kind IN ('PRIVATE_FILE', 'USER_DRIVE_EXAM') AND reference IS NOT NULL)
  OR (kind = 'DRIVE_EXAM_ARCHIVE' AND reference IS NULL)
);
