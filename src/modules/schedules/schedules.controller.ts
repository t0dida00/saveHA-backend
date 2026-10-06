import path from 'node:path'
import { styleText } from 'node:util'
import type { RequestHandler, Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.ts'
import { HttpError } from '../../lib/HttpError.ts'
import type { Browser } from 'puppeteer'
import { buildScheduleUrl, downloadOneP2pSchedule, launchBrowser, ServiceNotOnRouteError } from './one.scraper.ts'
import { ONE_LOCATIONS } from './oneLocations.ts'
import { ONE_SERVICE_ROUTES, type OneServiceRoute } from './oneServices.ts'
import { readSailings } from './scheduleXlsx.ts'
import { readLatestWeeklySchedule, saveLatestWeeklySchedule } from './scheduleStore.ts'
import { type ScheduleColumn, weeklyScheduleCsv } from './weeklySchedule.ts'

// Downloads share one Chrome, one tab each; cap the open tabs to stay within memory
const MAX_PARALLEL_DOWNLOADS = 3

const locode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{3}$/, 'Expected a UN/LOCODE like VNHPH')
const locationName = z.string().trim().toUpperCase().min(1).optional()
const fromDate = z.iso.date().optional()
const weeks = z.coerce.number().int().min(1).max(8).default(8)

const oneP2pQuerySchema = z
  .object({
    origin: locode.default('VNHPH'),
    originName: locationName,
    destination: locode.default('USLAX'),
    destinationName: locationName,
    service: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,5}$/, 'Expected a service code like PS7').default('PS7'),
    from: fromDate,
    weeks,
    format: z.enum(['csv', 'xlsx']).default('csv'),
  })
  .transform((query, ctx) => {
    const originName = query.originName ?? ONE_LOCATIONS[query.origin]
    const destinationName = query.destinationName ?? ONE_LOCATIONS[query.destination]
    if (!originName) ctx.addIssue({ code: 'custom', path: ['originName'], message: `Required for ${query.origin}` })
    if (!destinationName) {
      ctx.addIssue({ code: 'custom', path: ['destinationName'], message: `Required for ${query.destination}` })
    }
    return { ...query, originName: originName!, destinationName: destinationName! }
  })

const serviceCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,5}$/, 'Expected a service code like PS7')
// ONE's page needs the location name, so only locations in ONE_LOCATIONS can be searched here
const knownLocode = locode.refine((code) => code in ONE_LOCATIONS, {
  message: `Unknown location. Known: ${Object.keys(ONE_LOCATIONS).join(', ')}`,
})

const oneWeeklyBodySchema = z.object({
  date: fromDate,
  next: z.literal([2, 4, 6, 8]).default(8),
  /** "all" for ONE_SERVICE_ROUTES, or e.g. { "PS3": { "from": "VNCMP", "to": "USLAX" } } */
  services_routes: z
    .union([
      z.literal('all'),
      z
        .record(serviceCode, z.object({ from: knownLocode, to: knownLocode }))
        .refine((routes) => Object.keys(routes).length > 0, 'Add at least one service, or send "all"'),
    ])
    .default('all'),
})

export const getOneP2pSchedule: RequestHandler = async (req, res) => {
  const query = oneP2pQuerySchema.parse(req.query)
  const from = query.from ?? today()
  const search = {
    origin: query.origin,
    originName: query.originName,
    destination: query.destination,
    destinationName: query.destinationName,
    service: query.service,
    fromDate: from,
    weeks: query.weeks,
  }
  const file = await downloadOneP2pSchedule(search)

  // e.g. ONE-HPH-LAX-06102026: port codes without the country prefix, departure date as ddmmyyyy
  const originPort = query.origin.slice(2)
  const destinationPort = query.destination.slice(2)
  const basename = `ONE-${originPort}-${destinationPort}-${ddmmyyyy(from)}`

  if (query.format === 'xlsx') {
    sendFile(res, `${basename}.xlsx`, file.data)
    return
  }

  const column = {
    label: `${query.service}\n(${originPort} - ${destinationPort})`,
    url: buildScheduleUrl(search),
    sailings: await readSailings(file.data),
  }
  sendFile(res, `${basename}.csv`, weeklyScheduleCsv([column], from))
}

/** The requested services side by side, one column each, e.g. ONE-06102026.csv */
export const postOneWeeklySchedule: RequestHandler = async (req, res) => {
  const { filename, csv } = await oneWeeklyCsv(oneWeeklyBodySchema.parse(req.body ?? {}))
  sendFile(res, filename, csv)
}

/**
 * Vercel Cron entry point (cron jobs can only send GET): every service in ONE_SERVICE_ROUTES,
 * from today, next 8 weeks, saved to Vercel Blob for GET /one/weekly/latest. Vercel sends `Authorization: Bearer $CRON_SECRET` when that env var is set.
 */
export const getOneWeeklyScheduleCron: RequestHandler = async (req, res) => {
  if (env.CRON_SECRET && req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    throw new HttpError(401, 'Unauthorized')
  }
  const schedule = await oneWeeklyCsv({ date: today(), next: 8, services_routes: 'all' })
  await saveLatestWeeklySchedule(schedule)
  console.log(styleText('green', `saved ${schedule.filename} as the latest weekly schedule`))
  res.json({ saved: schedule.filename })
}

/** The CSV saved by the last cron run: instant, unlike POST /one/weekly which scrapes ONE live */
export const getLatestOneWeeklySchedule: RequestHandler = async (_req, res) => {
  const schedule = await readLatestWeeklySchedule()
  if (!schedule) throw new HttpError(404, 'No saved schedule yet: the cron job has not run')
  sendFile(res, schedule.filename, schedule.csv)
}

async function oneWeeklyCsv(body: z.output<typeof oneWeeklyBodySchema>): Promise<{ filename: string; csv: string }> {
  const from = body.date ?? today()
  const routes: OneServiceRoute[] =
    body.services_routes === 'all'
      ? ONE_SERVICE_ROUTES
      : Object.entries(body.services_routes).map(([service, { from: origin, to: destination }]) => ({
          service,
          route: `${origin.slice(2)} - ${destination.slice(2)}`,
          origin,
          destination,
        }))

  const browser = await launchBrowser()
  let columns: ScheduleColumn[]
  try {
    columns = await mapWithLimit(routes, MAX_PARALLEL_DOWNLOADS, (route) =>
      serviceColumn(browser, route, from, body.next),
    )
  } finally {
    await browser.close()
  }

  // Sailings found per service, or N/A / ERROR when there was nothing to count
  const summary = Object.fromEntries(
    routes.map((route, i) => [route.service, columns[i]!.placeholder ?? columns[i]!.sailings.length]),
  )
  console.table({ sailings: summary })

  return { filename: `ONE-${ddmmyyyy(from)}.csv`, csv: weeklyScheduleCsv(columns, from) }
}

async function serviceColumn(
  browser: Browser,
  route: OneServiceRoute,
  from: string,
  weeks: number,
): Promise<ScheduleColumn> {
  const label = `${route.service}\n(${route.route})`
  const search = {
    origin: route.origin,
    originName: ONE_LOCATIONS[route.origin]!,
    destination: route.destination,
    destinationName: ONE_LOCATIONS[route.destination]!,
    service: route.service,
    fromDate: from,
    weeks,
  }
  const url = buildScheduleUrl(search)
  const name = `${route.service} ${route.origin}-${route.destination}`

  // One retry: under load the ONE page can be slow enough to look like an empty route
  for (let attempt = 1; ; attempt++) {
    const started = Date.now()
    console.log(`calling to service ${name}${attempt > 1 ? ` (retry ${attempt - 1})` : ''}`)
    try {
      const file = await downloadOneP2pSchedule(search, browser)
      const sailings = await readSailings(file.data)
      console.log(styleText('green', `service ${name}: ${sailings.length} sailings in ${seconds(started)}`))
      return { label, url, sailings }
    } catch (err) {
      // ONE doesn't run this service on the route in this window
      if (err instanceof ServiceNotOnRouteError) {
        console.log(styleText('yellow', `service ${name}: not on this route (${seconds(started)})`))
        return { label, url, placeholder: 'N/A', sailings: [] }
      }
      console.log(
        styleText('red', `service ${name}: failed after ${seconds(started)}: ${err instanceof Error ? err.message : err}`),
      )
      if (attempt === 2) {
        console.error(styleText('red', `ONE ${name} failed:`), err)
        // Still no results after a retry: treat the route as having no schedule
        const noSchedule = err instanceof HttpError && err.status === 404
        return { label, url, placeholder: noSchedule ? 'N/A' : 'ERROR', sailings: [] }
      }
    }
  }
}

function sendFile(res: Response, filename: string, data: Buffer | string) {
  res.attachment(filename)
  res.type(path.extname(filename)).send(data)
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function seconds(since: number): string {
  return `${((Date.now() - since) / 1000).toFixed(1)}s`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** "2026-10-06" -> "06102026" */
function ddmmyyyy(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}${month}${year}`
}
