import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e.spec.ts",
  timeout: 90000,
  workers: 1,
  // Run against a local production build (`npm run test:e2e` builds first).
  webServer: {
    command: "npx next start -p 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      // Seeded test students use @example.test addresses; allow them locally
      // (the allowlist cannot be widened on Vercel).
      STUDENT_LOGIN_EMAILS: "*",
      // Never write test files to the real Blob store that `vercel env pull`
      // may have placed in .env.local, and never call the real AI provider.
      BLOB_READ_WRITE_TOKEN: "",
      OPENROUTER_API_KEY: "",
    },
  },
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    channel: "chromium",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
    viewport: { width: 1440, height: 1000 },
    trace: "off",
  },
  reporter: "list",
});
