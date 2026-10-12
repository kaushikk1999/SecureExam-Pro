CREATE TABLE IF NOT EXISTS screen_share_sessions (
  attempt_id uuid PRIMARY KEY REFERENCES attempts(id),
  request_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  offer jsonb,
  answer jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS screen_share_sessions_updated_at_idx
  ON screen_share_sessions(updated_at);
