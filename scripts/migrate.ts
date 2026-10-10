import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db, query } from "../src/lib/db";
await db.execute(
  sql`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`,
);
for (const name of (await readdir("migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  if (
    (await query(sql`SELECT name FROM schema_migrations WHERE name=${name}`))
      .length
  )
    continue;
  await db.transaction(async (tx) => {
    for (const statement of (await readFile("migrations/" + name, "utf8"))
      .split(/;\s*\n/)
      .filter((s) => s.trim()))
      await tx.execute(sql.raw(statement));
    await tx.execute(sql`INSERT INTO schema_migrations(name) VALUES(${name})`);
  });
  console.log("Applied " + name);
}
process.exit(0);
