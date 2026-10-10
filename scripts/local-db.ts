import "dotenv/config";
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
if (process.env.VERCEL || process.env.NODE_ENV === "production")
  throw new Error("The local database runner is development-only.");
mkdirSync(".data", { recursive: true });
let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  const password = randomBytes(32).toString("base64url");
  databaseUrl = `postgresql://secureexam:${password}@127.0.0.1:55432/postgres`;
  let env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  env = env
    .replace(/^DATABASE_PROVIDER=.*$/m, "DATABASE_PROVIDER=postgres")
    .replace(/^DATABASE_URL=.*\n?/m, "");
  writeFileSync(".env", env + "\nDATABASE_URL=" + databaseUrl + "\n", {
    mode: 0o600,
  });
}
const connection = new URL(databaseUrl);
if (connection.hostname !== "127.0.0.1" || connection.port !== "55432")
  throw new Error(
    "Local runner requires 127.0.0.1:55432. For a remote database, run migrations directly.",
  );
const dir = resolve(".data/postgres");
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: decodeURIComponent(connection.username),
  password: decodeURIComponent(connection.password),
  port: 55432,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1", "-k", resolve(".data")],
  onLog: () => {},
  onError: () => {},
});
if (!existsSync(dir + "/PG_VERSION")) await pg.initialise();
await pg.start();
console.log(
  "Local PostgreSQL is ready on 127.0.0.1:55432. Credentials are private in .env. Keep this process running.",
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
setInterval(() => {}, 60000);
