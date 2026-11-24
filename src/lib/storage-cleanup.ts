import { sql } from "drizzle-orm";
import { db, query } from "./db";
import {
  deleteDriveFolderTree,
  deletePrivateFile,
  deleteWarningEvidenceArchiveFromDrive,
  listDriveChildren,
  safeDriveName,
} from "./integrations";
import { userDriveAccess } from "./drive-connection";

/**
 * Delete recording folders in a teacher's connected Drive that belong to
 * exams that no longer exist: folders named "<title> (<id prefix>)" (older
 * layout) whose exam id is gone, and title-only folders that no remaining
 * exam of this teacher uses.
 */
export async function sweepDeletedExamFolders(ownerUserId: string) {
  const access = await userDriveAccess(ownerUserId);
  if (!access) return { removed: 0 };
  const [kept, titles] = await Promise.all([
    query<{ folder_id: string }>(
      sql`SELECT f.folder_id FROM exam_drive_folders f JOIN exams e ON e.id=f.exam_id WHERE f.owner_user_id=${ownerUserId}`,
    ),
    query<{ title: string }>(
      sql`SELECT e.title FROM exams e JOIN courses c ON c.id=e.course_id WHERE c.teacher_id=${ownerUserId}`,
    ),
  ]);
  const keptIds = new Set(kept.map((row) => row.folder_id));
  const liveTitles = new Set(
    titles.map((row) => safeDriveName(row.title, "Exam")),
  );
  let removed = 0;
  for (const child of await listDriveChildren(
    access.token,
    access.rootFolderId,
  )) {
    if (child.mimeType !== "application/vnd.google-apps.folder") continue;
    if (keptIds.has(child.id)) continue;
    const legacy = child.name.match(/\(([0-9a-f]{8})\)$/i);
    const examGone = legacy
      ? !(
          await query(
            sql`SELECT 1 FROM exams WHERE id::text LIKE ${legacy[1].toLowerCase() + "%"} LIMIT 1`,
          )
        ).length
      : !liveTitles.has(child.name);
    if (!examGone) continue;
    await deleteDriveFolderTree(access.token, child.id);
    removed++;
  }
  return { removed };
}

/** Delete one exam's recording folder ("<owner>:<folderId>") or sweep ("<owner>:sweep"). */
async function cleanUserDriveExam(reference: string) {
  const [ownerUserId, target] = reference.split(":");
  if (target === "sweep") {
    await sweepDeletedExamFolders(ownerUserId);
    return;
  }
  const access = await userDriveAccess(ownerUserId);
  if (!access)
    throw new Error("The teacher's Google Drive is not connected; retrying.");
  await deleteDriveFolderTree(access.token, target);
}

type CleanupJob = {
  id: string;
  kind: "PRIVATE_FILE" | "DRIVE_EXAM_ARCHIVE" | "USER_DRIVE_EXAM";
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
      } else if (job.kind === "USER_DRIVE_EXAM") {
        await cleanUserDriveExam(job.reference!);
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
