import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // The scan flow, the atlas, and the Helper are used at a table with a
    // phone: their suites run a second time at a phone viewport with touch.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /digitalizer|rulebook|helper.*\.spec/ },
  ],
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
