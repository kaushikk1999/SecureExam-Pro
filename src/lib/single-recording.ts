/**
 * Save a student's screen recording as ONE video file in the exam owner's
 * connected Google Drive. The browser records one continuous stream in 10 s
 * chunks; each chunk is appended to a Drive resumable upload, and the file is
 * completed when the recording stops (or later by a server fallback).
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, query } from "./db";
import { HttpError } from "./auth";
import { userDriveAccess, type DriveOwnerAccess } from "./drive-connection";
import {
  cachedDriveFolder,
  driveApi,
  logDriveFailure,
  recordingNames,
} from "./integrations";

/** Drive requires resumable chunks in multiples of 256 KiB (except the last). */
export const DRIVE_CHUNK = 256 * 1024;

export type RecordingMime = "video/mp4" | "video/webm";

type UploadRow = {
  attempt_id: string;
  session_id: string;
  owner_user_id: string;
  mime: RecordingMime;
  file_name: string;
  upload_url: string | null;
  uploaded_bytes: string | number;
  carry: Buffer | Uint8Array | null;
  last_sequence: string | number;
  drive_file_id: string | null;
  finalized_at: string | null;
};

const asBuffer = (value: Buffer | Uint8Array | null) =>
  value ? Buffer.from(value) : Buffer.alloc(0);

/** Bytes Drive has persisted, from a 308 response's Range header. */
function persistedBytes(response: Response) {
  const range = response.headers.get("range");
  const end = range?.match(/bytes=0-(\d+)/)?.[1];
  return end === undefined ? 0 : Number(end) + 1;
}

async function startUpload(
  owner: DriveOwnerAccess,
  input: {
    attemptId: string;
    examTitle: string;
    studentName: string;
    studentId: string | null;
    mime: RecordingMime;
  },
) {
  const names = recordingNames(input);
  const examFolderId = await cachedDriveFolder(
    owner.token,
    owner.rootFolderId,
    names.exam,
  );
  const studentFolderId = await cachedDriveFolder(
    owner.token,
    examFolderId,
    names.student,
  );
  const extension = input.mime === "video/mp4" ? "mp4" : "webm";
  const fileName = names.file.replace(/\.webm$/, `.${extension}`);
  const response = await fetch(
    driveApi(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mime,
      },
      body: JSON.stringify({
        name: fileName,
        parents: [studentFolderId],
        mimeType: input.mime,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const uploadUrl = response.headers.get("location");
  if (!response.ok || !uploadUrl) {
    await logDriveFailure("start recording upload", response);
    throw new HttpError(502, "Google Drive could not start the recording.");
  }
  return { uploadUrl, fileName };
}

/** Ask Drive how many bytes of this resumable upload it holds. */
async function uploadStatus(uploadUrl: string, token: string) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Range": "bytes */*",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 308) return persistedBytes(response);
  if (response.ok) return null; // already completed
  await logDriveFailure("recording upload status", response);
  throw new HttpError(502, "Google Drive lost the recording upload session.");
}

/**
 * Send `data` (which starts at byte `start` of the file) and return how many
 * of its leading bytes Drive persisted. `total` completes the file.
 */
async function sendChunk(
  uploadUrl: string,
  token: string,
  data: Buffer,
  start: number,
  total?: number,
) {
  const end = start + data.length - 1;
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Range": data.length
        ? `bytes ${start}-${end}/${total ?? "*"}`
        : `bytes */${total ?? "*"}`,
    },
    body: data.length ? new Uint8Array(data) : undefined,
    signal: AbortSignal.timeout(40000),
  });
  if (response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      id?: string;
    };
    return { done: true, fileId: result.id, persisted: start + data.length };
  }
  if (response.status === 308)
    return {
      done: false,
      fileId: undefined,
      persisted: persistedBytes(response),
    };
  // Unknown outcome: ask Drive what it kept so nothing is sent twice.
  await logDriveFailure("recording chunk upload", response);
  const persisted = await uploadStatus(uploadUrl, token);
  if (persisted === null)
    throw new HttpError(409, "This recording was already completed.");
  return { done: false, fileId: undefined, persisted };
}

/** Append one recorded chunk to the session's single Drive file. */
export async function appendRecordingChunk(input: {
  owner: DriveOwnerAccess;
  attemptId: string;
  sessionId: string;
  sequence: number;
  mime: RecordingMime;
  bytes: Buffer;
  examTitle: string;
  studentName: string;
  studentId: string | null;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO recording_uploads(attempt_id,session_id,owner_user_id,mime)
      VALUES(${input.attemptId},${input.sessionId},${input.owner.userId},${input.mime})
      ON CONFLICT(attempt_id,session_id) DO NOTHING
    `);
    const [row] = await query<UploadRow>(
      sql`SELECT * FROM recording_uploads WHERE attempt_id=${input.attemptId} AND session_id=${input.sessionId} FOR UPDATE`,
      tx,
    );
    if (row.finalized_at)
      throw new HttpError(409, "This recording has already been completed.");
    if (input.sequence <= Number(row.last_sequence)) return { duplicate: true };
    let uploadUrl = row.upload_url;
    let fileName = row.file_name;
    if (!uploadUrl) {
      ({ uploadUrl, fileName } = await startUpload(input.owner, {
        ...input,
        mime: row.mime,
      }));
    }
    const start = Number(row.uploaded_bytes);
    const data = Buffer.concat([asBuffer(row.carry), input.bytes]);
    const aligned = Math.floor(data.length / DRIVE_CHUNK) * DRIVE_CHUNK;
    let persisted = start;
    if (aligned > 0) {
      const result = await sendChunk(
        uploadUrl,
        input.owner.token,
        data.subarray(0, aligned),
        start,
      );
      persisted = result.persisted;
      if (persisted < start)
        throw new HttpError(502, "Google Drive lost part of the recording.");
    }
    const carry = data.subarray(Math.min(data.length, persisted - start));
    await tx.execute(sql`
      UPDATE recording_uploads SET upload_url=${uploadUrl},file_name=${fileName},
        uploaded_bytes=${persisted},carry=${carry},last_sequence=${input.sequence},updated_at=now()
      WHERE attempt_id=${input.attemptId} AND session_id=${input.sessionId}
    `);
    return { duplicate: false, uploadedBytes: persisted + carry.length };
  });
}

/**
 * Complete recording sessions: the given one, or (without `sessionId`) every
 * open session of the attempt that has been idle for `idleMs`.
 */
export async function finalizeRecordings(input: {
  attemptId: string;
  sessionId?: string;
  idleMs?: number;
}) {
  const sessions = await query<{ session_id: string; owner_user_id: string }>(
    input.sessionId
      ? sql`SELECT session_id,owner_user_id FROM recording_uploads WHERE attempt_id=${input.attemptId} AND session_id=${input.sessionId} AND finalized_at IS NULL`
      : sql`SELECT session_id,owner_user_id FROM recording_uploads WHERE attempt_id=${input.attemptId} AND finalized_at IS NULL AND updated_at < now() - ${(input.idleMs ?? 0) / 1000} * interval '1 second'`,
  );
  let completed = 0;
  for (const { session_id, owner_user_id } of sessions) {
    // Fetch the owner's token BEFORE opening the transaction: it needs its own
    // database query, which must not wait on this transaction's connection.
    const access = await userDriveAccess(owner_user_id);
    await db.transaction(async (tx) => {
      const [row] = await query<UploadRow & { exam_id: string }>(
        sql`SELECT r.*,a.exam_id FROM recording_uploads r JOIN attempts a ON a.id=r.attempt_id
            WHERE r.attempt_id=${input.attemptId} AND r.session_id=${session_id} AND r.finalized_at IS NULL FOR UPDATE OF r`,
        tx,
      );
      if (!row) return;
      const carry = asBuffer(row.carry);
      const start = Number(row.uploaded_bytes);
      const total = start + carry.length;
      let fileId: string | undefined;
      if (row.upload_url && total > 0) {
        if (!access)
          throw new HttpError(
            503,
            "Reconnect Google Drive to finish saving this recording.",
          );
        const result = await sendChunk(
          row.upload_url,
          access.token,
          carry,
          start,
          total,
        );
        fileId = result.fileId;
        if (!result.done || !fileId)
          throw new HttpError(
            502,
            "Google Drive did not complete the recording.",
          );
        await tx.execute(sql`
          INSERT INTO files(id,exam_id,attempt_id,owner_id,name,mime,url,size,extracted_text)
          SELECT ${randomUUID()},${row.exam_id},${row.attempt_id},a.user_id,
                 ${`RECORDING::${row.attempt_id}::${row.file_name}`},${row.mime},
                 ${`udrive:${row.owner_user_id}:${fileId}`},${total},''
          FROM attempts a WHERE a.id=${row.attempt_id}
        `);
      }
      await tx.execute(sql`
        UPDATE recording_uploads SET finalized_at=now(),drive_file_id=${fileId ?? null},carry=NULL,updated_at=now()
        WHERE attempt_id=${input.attemptId} AND session_id=${session_id}
      `);
      if (fileId) completed++;
    });
  }
  return { completed };
}
