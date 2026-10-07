import { get, put } from '@vercel/blob'

/** Each carrier's weekly files live apart: schedules/one-weekly/…, schedules/hpl-weekly/… */
export type Carrier = 'one' | 'hpl'

// The newest cron run always overwrites latest.json, so readers never have to list the store.
// JSON rather than CSV so the dated filename travels with it.
const latestPath = (carrier: Carrier) => `schedules/${carrier}-weekly/latest.json`
const historyDir = (carrier: Carrier) => `schedules/${carrier}-weekly/history`
const HEALTH_PATH = 'schedules/one-health/latest.json'

export interface StoredSchedule {
  filename: string
  csv: string
}

/** Saves the CSV as the latest run, plus a dated copy, e.g. history/ONE-06102026.csv */
export async function saveLatestWeeklySchedule(schedule: StoredSchedule, carrier: Carrier = 'one'): Promise<void> {
  const options = { access: 'private', addRandomSuffix: false, allowOverwrite: true } as const
  await Promise.all([
    put(latestPath(carrier), JSON.stringify(schedule), { ...options, contentType: 'application/json' }),
    put(`${historyDir(carrier)}/${schedule.filename}`, schedule.csv, {
      ...options,
      contentType: 'text/csv; charset=utf-8',
    }),
  ])
}

/** The CSV from the last cron run, or null before the first one */
export async function readLatestWeeklySchedule(carrier: Carrier = 'one'): Promise<StoredSchedule | null> {
  const result = await get(latestPath(carrier), { access: 'private', useCache: false })
  if (!result || result.statusCode !== 200) return null
  return (await new Response(result.stream).json()) as StoredSchedule
}

export interface StoredHealthCheck {
  alive: boolean
  /** ISO timestamp of when the check finished */
  checkedAt: string
  seconds: number
}

/** Overwrites the result of the last health check */
export async function saveLatestHealthCheck(check: StoredHealthCheck): Promise<void> {
  await put(HEALTH_PATH, JSON.stringify(check), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

/** The result of the last health check, or null before the first one */
export async function readLatestHealthCheck(): Promise<StoredHealthCheck | null> {
  const result = await get(HEALTH_PATH, { access: 'private', useCache: false })
  if (!result || result.statusCode !== 200) return null
  return (await new Response(result.stream).json()) as StoredHealthCheck
}
