import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = 3100;
const dbUrl = `file:${path.join(__dirname, "data", "test-e2e.db")}`;
/** Run against an already running server instead (e.g. `next dev` opened via the network address). It must use ALLOWED_EMAIL_DOMAINS=acme-corp.com. */
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: external
    ? undefined
    : {
        command: `npx tsx tests/e2e/prepare-db.ts && ${process.env.E2E_SKIP_BUILD ? "" : "npx next build && "}npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        env: {
          DATABASE_URL: dbUrl,
          ALLOWED_EMAIL_DOMAINS: "acme-corp.com",
          ADMIN_EMAILS: "admin@acme-corp.com",
          BACKUP_INTERVAL_HOURS: "0",
          BACKUP_DIR: path.join(__dirname, "data", "test-e2e-backups"),
        },
        reuseExistingServer: false,
        timeout: 240_000,
      },
});
