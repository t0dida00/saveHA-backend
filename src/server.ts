import { createApp } from './app.ts'
import { env } from './config/env.ts'

const server = createApp().listen(env.PORT, () => {
  console.log(`SaveHA API listening on http://localhost:${env.PORT}`)
})

// Finish in-flight requests before exiting (Ctrl+C, container stop)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
