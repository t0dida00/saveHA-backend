import type { ChatCompletionInput } from '@huggingface/tasks'
import { z } from 'zod'
import type { ServiceSchedule, WeeklySchedule } from '../schedules/parseWeeklyCsv.ts'
import { diffSchedules } from '../schedules/scheduleDiff.ts'

// A file can be named as on disk (ONE-06102026.csv) or by its date (2026-10-06)
const fileRef = z.string().trim().optional().describe('File name like ONE-06102026.csv, or its date like 2026-10-06')
type ToolDefinition = NonNullable<ChatCompletionInput['tools']>[number]

const serviceCode = z.string().trim().toUpperCase().describe('Service code like PS7 or MS2')

// No file option: counts and lists always come from the newest schedule; older files are only for comparing
const getVoyagesInput = z.object({ service: serviceCode })
const findVesselInput = z.object({
  vessel: z.string().trim().min(2).toUpperCase().describe('Vessel name or part of it, e.g. ONE FOCUS or WAN HAI'),
})
const compareFilesInput = z.object({
  older: fileRef.describe('Older file; defaults to the second newest'),
  newer: fileRef.describe('Newer file; defaults to the newest'),
  service: serviceCode.optional().describe('Compare only this service; omit for all'),
})

export const SCHEDULE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_voyages',
      description:
        'Lists every voyage (sailing) of one service in the newest schedule file, with the exact count. ' +
        'Use it for any question about how many voyages, which vessels, or departure dates. ' +
        'To list or preview the voyages, write tablePlaceholder on its own line; it is replaced with the week-by-week table.',
      parameters: z.toJSONSchema(getVoyagesInput),
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_vessel',
      description:
        'Finds a vessel by name (or part of it) across every service in the newest schedule file, ' +
        'with its service, voyage, week and departure. Use it when the user names a vessel.',
      parameters: z.toJSONSchema(findVesselInput),
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_files',
      description:
        'Compares two schedule files and returns the voyages added, removed and rescheduled per service, ' +
        'within the dates both files cover. furtherAhead lists sailings only the newer file shows because ' +
        'it looks further ahead; mention them, but they are not schedule changes. ' +
        'Use it for any question about differences or changes.',
      parameters: z.toJSONSchema(compareFilesInput),
    },
  },
]

export interface ToolResult {
  /** JSON for the model */
  content: string
  /** Schedule files the result was read from, to show the user what the answer is based on */
  files: string[]
}

/**
 * Runs a tool call from the model over the loaded schedules (newest first). Bad arguments
 * or unknown names come back as { error } so the model can recover, never as a throw.
 */
export function runScheduleTool(schedules: WeeklySchedule[], name: string, argsJson: string): ToolResult {
  let args: unknown
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return failed('Arguments are not valid JSON')
  }

  if (name === 'get_voyages') {
    const input = getVoyagesInput.safeParse(args)
    return input.success ? getVoyages(schedules, input.data) : failed(z.prettifyError(input.error))
  }
  if (name === 'find_vessel') {
    const input = findVesselInput.safeParse(args)
    return input.success ? findVessel(schedules, input.data) : failed(z.prettifyError(input.error))
  }
  if (name === 'compare_files') {
    const input = compareFilesInput.safeParse(args)
    return input.success ? compareFiles(schedules, input.data) : failed(z.prettifyError(input.error))
  }
  return failed(`Unknown tool ${name}. Use get_voyages, find_vessel or compare_files.`)
}

function getVoyages(schedules: WeeklySchedule[], input: z.output<typeof getVoyagesInput>): ToolResult {
  const latest = schedules[0]
  if (!latest) return failed('No schedule files are saved yet')

  const service = latest.services.find((s) => s.service === input.service)
  if (!service) {
    return failed(`Service ${input.service} is not in ${latest.file}`, {
      availableServices: latest.services.map((s) => s.service),
    })
  }
  return result([latest.file], {
    file: latest.file,
    service: service.service,
    route: service.route,
    status: service.status,
    count: service.voyages.length,
    voyages: service.voyages,
    tablePlaceholder: service.status === 'ok' ? tablePlaceholder(service.service) : undefined,
  })
}

/** The model writes this; the bot swaps in weekTable, so the model never copies (or trims) the table */
export function tablePlaceholder(service: string): string {
  return `[[TABLE ${service}]]`
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/**
 * One row per week, sailings written as in the CSV ("WAN HAI A03 E018/ OCT 08") and OMIT for
 * weeks without one. Built here rather than by the model so the format never drifts.
 */
export function weekTable(schedule: WeeklySchedule, service: ServiceSchedule): string {
  const rows = schedule.weeks.flatMap(({ week, dates }) => {
    const label = `${week} (${dates})`
    const sailings = service.voyages.filter((v) => v.week === week)
    if (sailings.length === 0) return [`| ${label} | OMIT |`]
    // A week with several sailings gets a row each; the week only shows on the first
    return sailings.map((v, i) => `| ${i === 0 ? label : ''} | ${v.vessel} ${v.voyage}/ ${monthDay(v.departure)} |`)
  })
  return ['| Week | Vessel+Voyage/Departure |', '|---|---|', ...rows].join('\n')
}

/** Every service in the file with its route and voyage count; built here so none is left out */
export function servicesTable(schedule: WeeklySchedule): string {
  const rows = schedule.services.map(
    (s) => `| ${s.service} | ${s.route} | ${s.status === 'ok' ? s.voyages.length : s.status} |`,
  )
  return ['| Service | Route | Voyages |', '|---|---|---|', ...rows].join('\n')
}

/** "2026-10-08" -> "OCT 08" */
function monthDay(date: string): string {
  const [, month, day] = date.split('-')
  return `${MONTHS[Number(month) - 1]} ${day}`
}

function findVessel(schedules: WeeklySchedule[], input: z.output<typeof findVesselInput>): ToolResult {
  const latest = schedules[0]
  if (!latest) return failed('No schedule files are saved yet')

  const matches = latest.services.flatMap((service) =>
    service.voyages
      .filter((v) => `${v.vessel} ${v.voyage}`.includes(input.vessel))
      .map((v) => ({ service: service.service, ...v, cell: `${v.vessel} ${v.voyage}/ ${monthDay(v.departure)}` })),
  )
  if (matches.length === 0) return failed(`No vessel matching "${input.vessel}" in ${latest.file}`)
  return result([latest.file], { file: latest.file, count: matches.length, matches })
}

function compareFiles(schedules: WeeklySchedule[], input: z.output<typeof compareFilesInput>): ToolResult {
  if (schedules.length < 2) return failed('Only one schedule file is saved so far, so there is nothing to compare yet')

  const newer = input.newer ? findFile(schedules, input.newer) : schedules[0]
  const older = input.older ? findFile(schedules, input.older) : schedules[schedules.indexOf(newer!) + 1]
  if (!newer || !older) return failed('File not found', { availableFiles: schedules.map((s) => s.file) })
  if (input.service && !newer.services.some((s) => s.service === input.service)) {
    return failed(`Service ${input.service} is not in the files`, {
      availableServices: newer.services.map((s) => s.service),
    })
  }
  // Keep the comparison in time order whichever way round the model named them
  const [from, to] = older.date <= newer.date ? [older, newer] : [newer, older]
  return result([to.file, from.file], diffSchedules(from, to, input.service))
}

function result(files: string[], data: object): ToolResult {
  return { content: JSON.stringify(data), files }
}

function failed(error: string, details: object = {}): ToolResult {
  return { content: JSON.stringify({ error, ...details }), files: [] }
}

function findFile(schedules: WeeklySchedule[], ref: string): WeeklySchedule | undefined {
  return schedules.find((s) => s.file === ref || s.date === ref || s.file === `${ref}.csv`)
}
