import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'lib/__mocks__/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
  },
});
