import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "dot" : "list",
  // Generous — this runs against `next dev`, where each route compiles
  // on-demand (Turbopack) the first time it's hit, which can take several
  // seconds well past Playwright's 5s default expect timeout.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    navigationTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Runs against `next dev`, not a production build+start: `next start` re-runs
  // instrumentation.ts's register() with production: true, which requires
  // https NEXT_PUBLIC_SITE_URL and Upstash — real production infra this test
  // environment doesn't have. `next dev` exercises the same application code.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
