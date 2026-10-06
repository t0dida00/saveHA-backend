import { Router } from 'express'
import { postChat } from './chat.controller.ts'

export const chatRouter = Router()

chatRouter.post('/', postChat)
