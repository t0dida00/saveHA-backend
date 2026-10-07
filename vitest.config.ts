import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      CRON_SECRET: 'test-cron-secret',
      HLAG_API_URL: 'https://api.hlag.test/point-to-point-routes',
      HLAG_CLIENT_ID: 'test-hlag-id',
      HLAG_CLIENT_SECRET: 'test-hlag-secret',
    },
  },
})
