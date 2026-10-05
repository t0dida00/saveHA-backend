import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', DOWNLOADS_DIR: path.join(tmpdir(), 'saveha-test-downloads') },
  },
})
