import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', CRON_SECRET: 'test-cron-secret', HF_TOKEN: 'test-hf-token' },
  },
})
