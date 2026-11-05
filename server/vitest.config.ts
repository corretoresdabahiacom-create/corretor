import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://imobflow:imobflow_dev@127.0.0.1:5432/imobflow_test',
      NODE_ENV: 'test',
      DEV_EXPOSE_TOKENS: 'true',
      RATE_LIMIT_DISABLED: 'true',
      EMAIL_DRIVER: 'memory',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
