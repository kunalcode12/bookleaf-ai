import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4310;
const WEB_PORT = 3310;
const WEB = `http://localhost:${WEB_PORT}`;
/** CI (and E2E_WEB=start) tests the production build; otherwise `next dev` compiles on demand. */
const useBuild = Boolean(process.env.CI) || process.env.E2E_WEB === 'start';

/**
 * End-to-end: boots the real API (embedded Postgres, seeded demo data, no AI keys, so Leaf runs on
 * its fallbacks) and the web app, then drives both portals in a browser.
 * PW_CHROMIUM_PATH lets a machine reuse an already-installed Chromium.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm exec tsx src/main.ts',
      cwd: '../api',
      url: `http://localhost:${API_PORT}/health/live`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATABASE_URL: 'pglite://memory',
        AUTO_SEED: 'true',
        LOG_LEVEL: 'warn',
        APP_ORIGINS: WEB,
        PUBLIC_APP_URL: WEB,
        GEMINI_API_KEY: '',
        GROQ_API_KEY: '',
        OPENROUTER_API_KEY: '',
      },
    },
    {
      command: useBuild ? `pnpm exec next start --port ${WEB_PORT}` : `pnpm exec next dev --port ${WEB_PORT}`,
      url: `${WEB}/login`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { API_ORIGIN: `http://127.0.0.1:${API_PORT}`, NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
