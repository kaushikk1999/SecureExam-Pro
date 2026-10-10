import "dotenv/config";
import { sql } from "drizzle-orm";
import { query } from "../src/lib/db";
import { auditHash } from "../src/lib/domain";
const rows = await query(sql`SELECT * FROM audit_events ORDER BY sequence`);
const previous = new Map<string, string>();
let failures = 0;
for (const r of rows) {
  const expectedPrevious = previous.get(r.chain_key) ?? "GENESIS";
  const data = {
    id: r.id,
    chain: r.chain_key,
    examId: r.exam_id,
    attemptId: r.attempt_id,
    userId: r.user_id,
    type: r.event_type,
    severity: r.severity,
    metadata: r.metadata,
    createdAt: new Date(r.created_at).toISOString(),
  };
  if (
    r.previous_hash !== expectedPrevious ||
    auditHash(r.previous_hash, data) !== r.event_hash
  )
    failures++;
  previous.set(r.chain_key, r.event_hash);
}
console.log(
  `Verified ${rows.length} events across ${previous.size} chains. Integrity failures: ${failures}.`,
);
process.exit(failures ? 1 : 0);
