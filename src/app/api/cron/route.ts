import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, query } from "@/lib/db";
import { finish } from "@/lib/exams";
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
  let count = 0;
  await db.transaction(async (tx) => {
    const attempts = await query(
      sql`SELECT a.* FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.status='ACTIVE' AND e.status<>'PAUSED' AND a.deadline<=now() FOR UPDATE OF a SKIP LOCKED LIMIT 100`,
      tx,
    );
    for (const a of attempts) {
      await finish(tx, a, "AUTO_SUBMITTED_TIME", a.user_id);
      count++;
    }
    await tx.execute(
      sql`DELETE FROM rate_limits WHERE resets_at<now()-interval '1 day'`,
    );
  });
  return Response.json({ expired: count });
}
