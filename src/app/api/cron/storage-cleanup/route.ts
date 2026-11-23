import { timingSafeEqual } from "node:crypto";
import {
  pendingStorageCleanupCount,
  processStorageCleanupJobs,
} from "@/lib/storage-cleanup";
import { sql } from "drizzle-orm";
import { query } from "@/lib/db";
import { finalizeRecordings } from "@/lib/single-recording";

export const runtime = "nodejs";
export async function GET(req: Request) {
  const key = process.env.CRON_SECRET;
  const token = req.headers.get("authorization") ?? "";
  if (
    !key ||
    token.length !== ("Bearer " + key).length ||
    !timingSafeEqual(Buffer.from(token), Buffer.from("Bearer " + key))
  )
    return new Response("Unauthorized", { status: 401 });

  // Complete screen recordings whose browser never finished them.
  let recordingsCompleted = 0;
  const open = await query<{ attempt_id: string }>(
    sql`SELECT DISTINCT attempt_id FROM recording_uploads WHERE finalized_at IS NULL AND updated_at < now() - interval '10 minutes' LIMIT 50`,
  );
  for (const { attempt_id } of open)
    recordingsCompleted += (
      await finalizeRecordings({
        attemptId: attempt_id,
        idleMs: 600_000,
      }).catch(() => ({ completed: 0 }))
    ).completed;
  const result = await processStorageCleanupJobs(10);
  return Response.json({
    ...result,
    recordingsCompleted,
    pending: await pendingStorageCleanupCount(),
  });
}
