CREATE TABLE IF NOT EXISTS reentry_requests (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','DECLINED','COMPLETED')),
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  CHECK ((status = 'PENDING' AND reviewed_at IS NULL) OR status <> 'PENDING')
);

CREATE UNIQUE INDEX IF NOT EXISTS reentry_requests_one_pending_per_attempt
  ON reentry_requests(attempt_id) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS reentry_requests_course_status_created_idx
  ON reentry_requests(course_id, status, created_at DESC);
