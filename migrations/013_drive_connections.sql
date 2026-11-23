-- A teacher's own Google Drive, connected with OAuth (drive.file scope), used to
-- store screen recordings for that teacher's exams. The refresh token is
-- encrypted with a key derived from the deployment's auth secret.
CREATE TABLE IF NOT EXISTS drive_connections (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_email text NOT NULL,
  refresh_token_enc text NOT NULL,
  root_folder_id text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);
