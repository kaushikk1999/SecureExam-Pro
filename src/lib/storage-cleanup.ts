import { sql } from "drizzle-orm";
import { db, query } from "./db";
import {
  deletePrivateFile,
  deleteWarningEvidenceArchiveFromDrive,
} from "./integrations";

type CleanupJob = {
  id: string;
  kind: "PRIVATE_FILE" | "DRIVE_EXAM_ARCHIVE";
  reference: string | null;
  exam_id: string;
  exam_title: string;
  attempts: number;
};

/**
 * Retry cloud cleanup outside the exam purge transaction. A cloud outage must
 * not keep the exam and its submitted work in the application indefinitely.
 */
export async function processStorageCleanupJobs(limit = 3) {
  const jobs = await db.transaction(async (tx) =>
    query<CleanupJob>(
      sql`
        WITH pending AS (
          SELECT id FROM storage_cleanup_jobs
          WHERE next_attempt_at <= now()
            AND (locked_until IS NULL OR locked_until < now())
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE storage_cleanup_jobs AS jobs
        SET locked_until = now() + interval '2 minutes'
        FROM pending
        WHERE jobs.id = pending.id
        RETURNING jobs.id,jobs.kind,jobs.reference,jobs.exam_id,jobs.exam_title,jobs.attempts
      `,
      tx,
    ),
  );

  let cleaned = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      if (job.kind === "PRIVATE_FILE") {
        await deletePrivateFile(job.reference!);
      } else {
        await deleteWarningEvidenceArchiveFromDrive(
          job.exam_id,
          job.exam_title,
        );
      }
      await db.execute(
        sql`DELETE FROM storage_cleanup_jobs WHERE id=${job.id}`,
      );
      cleaned++;
    } catch (error) {
      const attempt = job.attempts + 1;
      const delayMinutes = Math.min(60 * 24, 5 * 2 ** Math.min(attempt - 1, 8));
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error("Exam storage cleanup retry scheduled", {
        jobId: job.id,
        kind: job.kind,
        errorName,
      });
      await db.execute(sql`
        UPDATE storage_cleanup_jobs
        SET attempts=${attempt},last_error=${errorName},locked_until=NULL,
            next_attempt_at=now()+(${delayMinutes}::text || ' minutes')::interval
        WHERE id=${job.id}
      `);
      failed++;
    }
  }
  return { cleaned, failed };
}

export async function pendingStorageCleanupCount(examId?: string) {
  const [result] = await query<{ count: number }>(
    examId
      ? sql`SELECT count(*)::int AS count FROM storage_cleanup_jobs WHERE exam_id=${examId}`
      : sql`SELECT count(*)::int AS count FROM storage_cleanup_jobs`,
  );
  return result?.count ?? 0;
}
