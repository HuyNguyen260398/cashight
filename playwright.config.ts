import { defineConfig } from '@playwright/test';

const localAppPort = process.env.E2E_APP_PORT ?? '3100';
const localApiPort = process.env.E2E_API_PORT ?? '8887';
const localBaseUrl = `http://localhost:${localAppPort}`;
const localApiUrl = `http://localhost:${localApiPort}`;
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
          command: `LOCAL_API_PORT=${localApiPort} LOCAL_ALLOWED_ORIGIN=${localBaseUrl} LOCAL_API_BASE_URL=${localApiUrl} node --import tsx scripts/dev-server.ts`,
          url: `${localApiUrl}/health`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: `NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_DEV_AUTH_BYPASS=true NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER=true NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE=true NEXT_PUBLIC_API_BASE_URL=${localApiUrl} NEXT_PUBLIC_COGNITO_AUTHORITY=${localApiUrl}/_oidc NEXT_PUBLIC_COGNITO_CLIENT_ID=e2e-public-client NEXT_PUBLIC_APP_ORIGIN=${localBaseUrl} NODE_OPTIONS=--disable-warning=DEP0205 ./node_modules/.bin/next dev --port ${localAppPort}`,
          url: localBaseUrl,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
