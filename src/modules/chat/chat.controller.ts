import { InferenceClientError } from '@huggingface/inference'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.ts'
import { HttpError } from '../../lib/HttpError.ts'
import { parseWeeklyCsv } from '../schedules/parseWeeklyCsv.ts'
import { readRecentWeeklySchedules } from '../schedules/scheduleStore.ts'
import { askScheduleBot, type BotAnswer } from './scheduleBot.ts'

// The bot answers from the last 3 Saturday runs
const FILES_IN_CONTEXT = 3

const chatBodySchema = z.object({
  /** The whole conversation so far; the server keeps no state between requests */
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20)
    .refine((messages) => messages.at(-1)?.role === 'user', 'The last message must be from the user'),
})

/** Answers a question about the saved weekly schedules, e.g. "How many voyages does MS2 have?" */
export const postChat: RequestHandler = async (req, res) => {
  const { messages } = chatBodySchema.parse(req.body ?? {})
  if (!env.HF_TOKEN) throw new HttpError(503, 'The chatbot is not configured: HF_TOKEN is missing')

  const stored = await readRecentWeeklySchedules(FILES_IN_CONTEXT)
  if (stored.length === 0) throw new HttpError(404, 'No saved schedules yet: the weekly cron job has not run')
  const schedules = stored.map(({ filename, csv }) => parseWeeklyCsv(filename, csv))

  let reply: BotAnswer
  try {
    reply = await askScheduleBot(messages, schedules)
  } catch (err) {
    // The model provider failed (rate limit, outage, bad token): not the caller's fault
    if (err instanceof InferenceClientError) {
      console.error('Hugging Face chat failed:', err)
      throw new HttpError(502, 'The chatbot model is unavailable, please try again')
    }
    throw err
  }
  res.json(reply)
}
