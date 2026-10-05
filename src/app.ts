import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { notFound } from './middleware/notFound.ts'
import { apiRouter } from './routes.ts'

export function createApp() {
  const app = express()

  app.use(helmet())
  // Expose Content-Disposition so the frontend can read the filename of downloaded files
  app.use(cors({ origin: env.CORS_ORIGIN, exposedHeaders: ['Content-Disposition'] }))
  app.use(express.json({ limit: '1mb' }))
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'))

  app.use('/api/v1', apiRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
