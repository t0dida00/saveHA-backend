import { styleText } from 'node:util'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { HttpError } from '../../lib/HttpError.ts'
import { ddmmyyyy, requireCronSecret, sendFile, today } from './schedules.controller.ts'
import { readLatestWeeklySchedule, saveLatestWeeklySchedule, type StoredSchedule } from './scheduleStore.ts'
import { weeklyScheduleCsv } from './weeklySchedule.ts'

// The default search: VUNG TAU → NEW YORK, NY
export const HPL_FROM = 'VNVUT'
export const HPL_TO = 'USNYC'

/** The QueryString row's cell for every service: Hapag-Lloyd's search for this port pair and date */
export function hplQueryString(from: string, to: string, date: string): string {
  return (
    `sl=${from}&el=${to}&exportHaulage=MH&importHaulage=MH&containerType=45GP` +
    `&departureDate=${date}&usFlag=false&dg=false&reefer`
  )
}

const locode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'Expected a UN/LOCODE like VNVUT')
const serviceCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, 'Expected a service code like AA7')

// Same shape as POST /one/weekly, with the port pair instead of services
const hlagWeeklyBodySchema = z.object({
  date: z.iso.date().optional(),
  // Accepted like ONE's; the query string only carries the first departure date
  next: z.literal([2, 4, 6, 8]).default(8),
  from: locode.default(HPL_FROM),
  to: locode.default(HPL_TO),
  /** One column each, e.g. ["AA7", "US4"]; none gives a single column named after the route */
  services: z.array(serviceCode).default([]),
})

/** Hapag-Lloyd's search for a port pair as a query string per service, e.g. HPL-06102026.csv */
export const postHlagWeeklySchedule: RequestHandler = async (req, res) => {
  const { filename, csv } = await hlagWeeklyCsv(hlagWeeklyBodySchema.parse(req.body ?? {}))
  sendFile(res, filename, csv)
}

/** Vercel Cron entry point: VNVUT → USNYC from today, next 8 weeks, saved for GET /hpl/weekly/latest */
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

// Hapag-Lloyd's site blocks automated browsers, so no sailings are read: the file holds the header
// and the QueryString row with the search to run on hapag-lloyd.com, and no week rows
async function hlagWeeklyCsv(body: z.output<typeof hlagWeeklyBodySchema>): Promise<StoredSchedule> {
  const from = body.date ?? today()
  const route = `${body.from.slice(2)} - ${body.to.slice(2)}`
  const url = hplQueryString(body.from, body.to, from)
  const labels = body.services.length > 0 ? body.services.map((service) => `${service}\n(${route})`) : [route]
  const columns = labels.map((label) => ({ label, url, sailings: [] }))

  return { filename: `HPL-${ddmmyyyy(from)}.csv`, csv: weeklyScheduleCsv(columns, from, 'HPL') }
}
