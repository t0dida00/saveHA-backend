import { styleText } from 'node:util'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { HttpError } from '../../lib/HttpError.ts'
import { scrapedColumns } from './hlagSchedule.ts'
import { scrapeHplSchedule } from './hpl.scraper.ts'
import { ddmmyyyy, requireCronSecret, sendFile, today } from './schedules.controller.ts'
import { readLatestWeeklySchedule, saveLatestWeeklySchedule, type StoredSchedule } from './scheduleStore.ts'
import { weeklyScheduleCsv } from './weeklySchedule.ts'

// Hapag-Lloyd's own schedule search, linked from the CSV's QueryString row
const HLAG_SCHEDULE_PAGE = 'https://www.hapag-lloyd.com/solutions/schedule'

const locode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'Expected a UN/LOCODE like VNVUT')

// Same shape as POST /one/weekly, with the port pair instead of services
const hlagWeeklyBodySchema = z.object({
  date: z.iso.date().optional(),
  next: z.literal([2, 4, 6, 8]).default(8),
  from: locode.default('VNVUT'),
  to: locode.default('USLAX'),
})

/** Hapag-Lloyd sailings between two ports, one column per service, e.g. HPL-06102026.csv */
export const postHlagWeeklySchedule: RequestHandler = async (req, res) => {
  const { filename, csv } = await hlagWeeklyCsv(hlagWeeklyBodySchema.parse(req.body ?? {}))
  sendFile(res, filename, csv)
}

/** Vercel Cron entry point: VNVUT → USLAX from today, next 8 weeks, saved for GET /hpl/weekly/latest */
export const getHlagWeeklyScheduleCron: RequestHandler = async (req, res) => {
  requireCronSecret(req)
  const schedule = await hlagWeeklyCsv(hlagWeeklyBodySchema.parse({}))
  await saveLatestWeeklySchedule(schedule, 'hpl')
  console.log(styleText('green', `saved ${schedule.filename} as the latest Hapag-Lloyd schedule`))
  res.json({ saved: schedule.filename })
}

/** The CSV saved by the last Hapag-Lloyd cron run */
export const getLatestHlagWeeklySchedule: RequestHandler = async (_req, res) => {
  const schedule = await readLatestWeeklySchedule('hpl')
  if (!schedule) throw new HttpError(404, 'No saved Hapag-Lloyd schedule yet: the cron job has not run')
  sendFile(res, schedule.filename, schedule.csv)
}

// Read from Hapag-Lloyd's schedule page in a visible Chrome (see hpl.scraper.ts): their site's
// PDF export has no voyage numbers, so the result cards are read instead
async function hlagWeeklyCsv(body: z.output<typeof hlagWeeklyBodySchema>): Promise<StoredSchedule> {
  const from = body.date ?? today()

  const started = Date.now()
  const sailings = await scrapeHplSchedule({ from: body.from, to: body.to, fromDate: from, weeks: body.next })
  const columns = scrapedColumns(sailings, body.from, body.to, HLAG_SCHEDULE_PAGE)
  console.log(
    `Hapag-Lloyd ${body.from}-${body.to}: ${sailings.length} sailings, ` +
      `${columns.map((c) => `${c.label.split('\n')[0]} ${c.sailings.length}`).join(', ') || 'no sailings'} ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )

  return { filename: `HPL-${ddmmyyyy(from)}.csv`, csv: weeklyScheduleCsv(columns, from, 'HPL') }
}
