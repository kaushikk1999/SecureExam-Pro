import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e.spec.ts",
  timeout: 90000,
  workers: 1,
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
