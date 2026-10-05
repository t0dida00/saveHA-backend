import { Router } from 'express'
import { healthRouter } from './modules/health/health.routes.ts'
import { schedulesRouter } from './modules/schedules/schedules.routes.ts'

/** Every feature module mounts its router here, under /api/v1. */
export const apiRouter = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/schedules', schedulesRouter)
