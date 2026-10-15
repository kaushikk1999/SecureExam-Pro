CREATE TABLE IF NOT EXISTS warning_evidence_archives (
  attempt_id uuid PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  folder_id text NOT NULL,
  report_id text NOT NULL,
  evidence_count int NOT NULL DEFAULT 0,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warning_evidence_archives_exam_idx
  ON warning_evidence_archives(exam_id, archived_at DESC);
