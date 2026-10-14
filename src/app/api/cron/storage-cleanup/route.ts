import { timingSafeEqual } from "node:crypto";
import {
  pendingStorageCleanupCount,
  processStorageCleanupJobs,
} from "@/lib/storage-cleanup";

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

  const result = await processStorageCleanupJobs(10);
  return Response.json({
    ...result,
    pending: await pendingStorageCleanupCount(),
  });
}
