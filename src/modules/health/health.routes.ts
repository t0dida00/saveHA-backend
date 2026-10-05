import { Router } from 'express'
import { getHealth } from './health.controller.ts'

export const healthRouter = Router()

healthRouter.get('/', getHealth)
