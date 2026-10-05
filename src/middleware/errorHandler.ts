import type { ErrorRequestHandler } from 'express'
import { ZodError, z } from 'zod'
import { env } from '../config/env.ts'
import { HttpError } from '../lib/HttpError.ts'

// Express 5 forwards errors thrown in async handlers here, so routes can just throw
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request', details: z.flattenError(err).fieldErrors })
    return
  }

  console.error(err)
  res.status(500).json({
    error: 'Internal server error',
    ...(env.NODE_ENV !== 'production' && err instanceof Error ? { message: err.message } : {}),
  })
}
