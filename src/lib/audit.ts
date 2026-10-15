import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, query, type Tx } from "./db";
import { auditHash } from "./domain";
export async function audit(
  tx: Tx,
  {
    userId,
    examId,
    attemptId,
    type,
    severity = "INFO",
    metadata = {},
    chainKey,
  }: {
    userId?: string;
    examId?: string;
    attemptId?: string;
    type: string;
    severity?: string;
    metadata?: unknown;
    /** Override the default attempt/exam/user chain when a shared resource
     * is touched by many independent users in parallel. */
    chainKey?: string;
  },
): Promise<string> {
  const chain = chainKey ?? attemptId ?? examId ?? userId ?? "authentication";
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${chain}))`);
  const [last] = await query(
    sql`SELECT event_hash FROM audit_events WHERE chain_key=${chain} ORDER BY sequence DESC LIMIT 1`,
    tx,
  );
  const id = randomUUID(),
    createdAt = new Date().toISOString(),
    previous = last?.event_hash ?? "GENESIS";
  const data = {
    id,
    chain,
    examId: examId ?? null,
    attemptId: attemptId ?? null,
    userId: userId ?? null,
    type,
    severity,
    metadata,
    createdAt,
  };
  const hash = auditHash(previous, data);
  await tx.execute(
    sql`INSERT INTO audit_events(id,chain_key,exam_id,attempt_id,user_id,event_type,severity,metadata,created_at,previous_hash,event_hash) VALUES(${id},${chain},${examId ?? null},${attemptId ?? null},${userId ?? null},${type},${severity},${JSON.stringify(metadata)}::jsonb,${createdAt},${previous},${hash})`,
  );
  return id;
}
export async function record(data: Parameters<typeof audit>[1]) {
  await db.transaction((tx) => audit(tx, data));
}
export async function rateLimit(key: string, max = 20, seconds = 60) {
  const [r] = await query(
    sql`INSERT INTO rate_limits(key,count,resets_at) VALUES(${key},1,now()+${seconds}*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.resets_at<now() THEN 1 ELSE rate_limits.count+1 END,resets_at=CASE WHEN rate_limits.resets_at<now() THEN now()+${seconds}*interval '1 second' ELSE rate_limits.resets_at END RETURNING count`,
  );
  return r.count <= max;
}
