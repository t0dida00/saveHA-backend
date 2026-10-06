import { Router } from 'express'
import {
  getLatestOneWeeklySchedule,
  getOneP2pSchedule,
  getOneWeeklyScheduleCron,
  postOneWeeklySchedule,
} from './schedules.controller.ts'

export const schedulesRouter = Router()

schedulesRouter.get('/one/p2p', getOneP2pSchedule)
schedulesRouter.post('/one/weekly', postOneWeeklySchedule)
schedulesRouter.get('/one/weekly/cron', getOneWeeklyScheduleCron)
schedulesRouter.get('/one/weekly/latest', getLatestOneWeeklySchedule)
