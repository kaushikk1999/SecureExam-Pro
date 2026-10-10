import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import type { SQL } from "drizzle-orm";
const globalDB = globalThis as unknown as {
  examDB: ReturnType<typeof drizzle>;
};
function createDB() {
  if (process.env.DATABASE_PROVIDER === "pglite") {
    if (
      process.env.VERCEL ||
      (process.env.NODE_ENV === "production" &&
        process.env.ALLOW_LOCAL_PRODUCTION_TEST !== "true")
    )
      throw new Error("PGlite is development-only. Configure PostgreSQL.");
    mkdirSync(dirname(process.env.PGLITE_PATH ?? "./.data/db"), {
      recursive: true,
    });
    return liteDrizzle(
      new PGlite(process.env.PGLITE_PATH ?? "./.data/db"),
    ) as unknown as ReturnType<typeof drizzle>;
  }
  if (process.env.DATABASE_PROVIDER === "google_sheets")
    throw new Error(
      "Sheets cannot guarantee attempt transactions; use PostgreSQL and the Sheets export adapter.",
    );
  return drizzle(
    new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
  );
}
export const db = globalDB.examDB ?? createDB();
if (process.env.NODE_ENV !== "production") globalDB.examDB = db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function query<T = Record<string, any>>(
  statement: SQL,
  executor: typeof db | Tx = db,
): Promise<T[]> {
  return (await executor.execute(statement)).rows as T[];
}
