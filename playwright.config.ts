import { defineConfig } from '@playwright/test';

const localBaseUrl = 'http://localhost:3000';
const localApiUrl = 'http://localhost:8787';
const baseURL = process.env.BASE_URL ?? localBaseUrl;
const storageState = process.env.E2E_STORAGE_STATE;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  metadata: {
    e2eUsernameConfigured: Boolean(process.env.E2E_USERNAME),
    e2ePasswordConfigured: Boolean(process.env.E2E_PASSWORD),
  },
  use: {
    baseURL,
    storageState: storageState || undefined,
    trace: 'retain-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command: `LOCAL_ALLOWED_ORIGIN=${localBaseUrl} LOCAL_API_BASE_URL=${localApiUrl} node --import tsx scripts/dev-server.ts`,
          url: `${localApiUrl}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: `NEXT_PUBLIC_DEV_AUTH_BYPASS=true NEXT_PUBLIC_API_BASE_URL=${localApiUrl} NODE_OPTIONS=--disable-warning=DEP0205 ./node_modules/.bin/next dev`,
          url: localBaseUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
