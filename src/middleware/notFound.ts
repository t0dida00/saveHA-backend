import type { RequestHandler } from 'express'
import { HttpError } from '../lib/HttpError.ts'

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `No route for ${req.method} ${req.originalUrl}`))
}
