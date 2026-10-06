import { get, list, put } from '@vercel/blob'

// The newest cron run always overwrites this path, so readers never have to list the store.
// JSON rather than CSV so the dated filename travels with it.
const LATEST_PATH = 'schedules/one-weekly/latest.json'
const HISTORY_DIR = 'schedules/one-weekly/history'
const HEALTH_PATH = 'schedules/one-health/latest.json'

export interface StoredSchedule {
  filename: string
  csv: string
}

/** Saves the CSV as the latest run, plus a dated copy, e.g. history/ONE-06102026.csv */
export async function saveLatestWeeklySchedule(schedule: StoredSchedule): Promise<void> {
  const options = { access: 'private', addRandomSuffix: false, allowOverwrite: true } as const
  await Promise.all([
    put(LATEST_PATH, JSON.stringify(schedule), { ...options, contentType: 'application/json' }),
    put(`${HISTORY_DIR}/${schedule.filename}`, schedule.csv, { ...options, contentType: 'text/csv; charset=utf-8' }),
  ])
}

/** The CSV from the last cron run, or null before the first one */
export async function readLatestWeeklySchedule(): Promise<StoredSchedule | null> {
  const result = await get(LATEST_PATH, { access: 'private', useCache: false })
  if (!result || result.statusCode !== 200) return null
  return (await new Response(result.stream).json()) as StoredSchedule
}

/** The newest dated copies saved by the cron, newest first, e.g. for the schedule chatbot */
export async function readRecentWeeklySchedules(count = 3): Promise<StoredSchedule[]> {
  const { blobs } = await list({ prefix: `${HISTORY_DIR}/` })
  const recent = blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()).slice(0, count)
  return Promise.all(
    recent.map(async (blob) => {
      const result = await get(blob.pathname, { access: 'private', useCache: false })
      if (!result || result.statusCode !== 200) throw new Error(`Saved schedule ${blob.pathname} could not be read`)
      return { filename: blob.pathname.slice(HISTORY_DIR.length + 1), csv: await new Response(result.stream).text() }
    }),
  )
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
