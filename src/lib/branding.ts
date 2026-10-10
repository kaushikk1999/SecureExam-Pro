import { sql } from "drizzle-orm";
import { query } from "./db";
export async function branding() {
  const [s] = await query(
    sql`SELECT value FROM settings WHERE id='institution'`,
  );
  return {
    brand: s?.value.brand ?? "SecureExam Pro",
    institution: s?.value.institution ?? "Bangkok University",
    accent: s?.value.accent ?? "#2563eb",
    timezone: s?.value.timezone ?? "Asia/Bangkok",
  };
}
