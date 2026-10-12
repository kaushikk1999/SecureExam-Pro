import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
  const migration = spawnSync(npm, ["run", "db:migrate"], {
    stdio: "inherit",
    env: process.env,
  });
  if (migration.error) throw migration.error;
  if (migration.status !== 0)
    process.exit(migration.status ?? 1);
}

const build = spawnSync(npm, ["run", "build:next"], {
  stdio: "inherit",
  env: process.env,
});
if (build.error) throw build.error;
process.exit(build.status ?? 1);
