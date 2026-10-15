CREATE TABLE IF NOT EXISTS teacher_notification_reads (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_warning_sequence bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Treat warnings that predate this feature as already seen.
INSERT INTO teacher_notification_reads(user_id,last_warning_sequence)
SELECT u.id,COALESCE((SELECT max(sequence) FROM audit_events WHERE event_type='WARNING_ISSUED'),0)
FROM users u WHERE u.role IN ('TEACHER','ADMIN')
ON CONFLICT(user_id) DO NOTHING;
