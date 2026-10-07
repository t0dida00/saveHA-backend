import { Router } from 'express'
import { getHlagWeeklyScheduleCron, getLatestHlagWeeklySchedule, postHlagWeeklySchedule } from './hlag.controller.ts'
import {
  getLatestOneWeeklySchedule,
  getLatestOneHealthCheck,
  getOneHealthCheck,
  getOneP2pSchedule,
  getOneWeeklyScheduleCron,
  postOneWeeklySchedule,
} from './schedules.controller.ts'

export const schedulesRouter = Router()

schedulesRouter.get('/one/p2p', getOneP2pSchedule)
schedulesRouter.post('/one/weekly', postOneWeeklySchedule)
schedulesRouter.get('/one/weekly/cron', getOneWeeklyScheduleCron)
schedulesRouter.get('/one/weekly/latest', getLatestOneWeeklySchedule)
schedulesRouter.get('/one/healthCheck', getOneHealthCheck)
schedulesRouter.get('/one/healthCheck/latest', getLatestOneHealthCheck)

schedulesRouter.post('/hpl/weekly', postHlagWeeklySchedule)
schedulesRouter.get('/hpl/weekly/cron', getHlagWeeklyScheduleCron)
schedulesRouter.get('/hpl/weekly/latest', getLatestHlagWeeklySchedule)
