import { Router } from 'express'
import { getOneP2pSchedule, postOneWeeklySchedule } from './schedules.controller.ts'

export const schedulesRouter = Router()

schedulesRouter.get('/one/p2p', getOneP2pSchedule)
schedulesRouter.post('/one/weekly', postOneWeeklySchedule)
