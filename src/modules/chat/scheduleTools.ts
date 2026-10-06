import type { ChatCompletionInput } from '@huggingface/tasks'
import { z } from 'zod'
import type { WeeklySchedule } from '../schedules/parseWeeklyCsv.ts'
import { diffSchedules } from '../schedules/scheduleDiff.ts'

// A file can be named as on disk (ONE-06102026.csv) or by its date (2026-10-06)
const fileRef = z.string().trim().optional().describe('File name like ONE-06102026.csv, or its date like 2026-10-06')
type ToolDefinition = NonNullable<ChatCompletionInput['tools']>[number]

const serviceCode = z.string().trim().toUpperCase().describe('Service code like PS7 or MS2')

const getVoyagesInput = z.object({
  service: serviceCode,
  file: fileRef.describe('File to read; defaults to the newest'),
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
        'Lists every voyage (sailing) of one service in one schedule file, with the exact count. ' +
        'Use it for any question about how many voyages, which vessels, or departure dates.',
      parameters: z.toJSONSchema(getVoyagesInput),
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

/**
 * Runs a tool call from the model over the loaded schedules (newest first). Always returns
 * JSON for the model: bad arguments or unknown names come back as { error } so it can recover.
 */
export function runScheduleTool(schedules: WeeklySchedule[], name: string, argsJson: string): string {
  let args: unknown
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return JSON.stringify({ error: 'Arguments are not valid JSON' })
  }

  if (name === 'get_voyages') {
    const input = getVoyagesInput.safeParse(args)
    if (!input.success) return JSON.stringify({ error: z.prettifyError(input.error) })
    return JSON.stringify(getVoyages(schedules, input.data))
  }
  if (name === 'compare_files') {
    const input = compareFilesInput.safeParse(args)
    if (!input.success) return JSON.stringify({ error: z.prettifyError(input.error) })
    return JSON.stringify(compareFiles(schedules, input.data))
  }
  return JSON.stringify({ error: `Unknown tool ${name}. Use get_voyages or compare_files.` })
}

function getVoyages(schedules: WeeklySchedule[], input: z.output<typeof getVoyagesInput>) {
  const schedule = input.file ? findFile(schedules, input.file) : schedules[0]
  if (!schedule) return { error: `No file ${input.file}`, availableFiles: schedules.map((s) => s.file) }

  const service = schedule.services.find((s) => s.service === input.service)
  if (!service) {
    return {
      error: `Service ${input.service} is not in ${schedule.file}`,
      availableServices: schedule.services.map((s) => s.service),
    }
  }
  return {
    file: schedule.file,
    service: service.service,
    route: service.route,
    status: service.status,
    count: service.voyages.length,
    voyages: service.voyages,
  }
}

function compareFiles(schedules: WeeklySchedule[], input: z.output<typeof compareFilesInput>) {
  if (schedules.length < 2) {
    return { error: 'Only one schedule file is saved so far, so there is nothing to compare yet' }
  }
  const newer = input.newer ? findFile(schedules, input.newer) : schedules[0]
  const older = input.older ? findFile(schedules, input.older) : schedules[schedules.indexOf(newer!) + 1]
  if (!newer || !older) return { error: 'File not found', availableFiles: schedules.map((s) => s.file) }
  if (input.service && !newer.services.some((s) => s.service === input.service)) {
    return { error: `Service ${input.service} is not in the files`, availableServices: newer.services.map((s) => s.service) }
  }
  // Keep the comparison in time order whichever way round the model named them
  const [from, to] = older.date <= newer.date ? [older, newer] : [newer, older]
  return diffSchedules(from, to, input.service)
}

function findFile(schedules: WeeklySchedule[], ref: string): WeeklySchedule | undefined {
  return schedules.find((s) => s.file === ref || s.date === ref || s.file === `${ref}.csv`)
}
