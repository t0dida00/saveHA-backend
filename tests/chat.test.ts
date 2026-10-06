import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { askScheduleBot } from '../src/modules/chat/scheduleBot.ts'
import { runScheduleTool, servicesTable, weekTable } from '../src/modules/chat/scheduleTools.ts'
import { parseWeeklyCsv, type WeeklySchedule } from '../src/modules/schedules/parseWeeklyCsv.ts'
import { diffSchedules } from '../src/modules/schedules/scheduleDiff.ts'
import { readRecentWeeklySchedules } from '../src/modules/schedules/scheduleStore.ts'
import { type ScheduleColumn, weeklyScheduleCsv } from '../src/modules/schedules/weeklySchedule.ts'

vi.mock('../src/modules/schedules/scheduleStore.ts', () => ({ readRecentWeeklySchedules: vi.fn() }))
vi.mock('../src/modules/chat/scheduleBot.ts', () => ({ askScheduleBot: vi.fn() }))

const column = (label: string, sailings: [string, string][], placeholder?: string): ScheduleColumn => ({
  label,
  url: 'https://www.one-line.com/schedule',
  placeholder,
  sailings: sailings.map(([departure, vessel]) => ({ departure, vessel })),
})

// Written with the same function the cron uses, so the parser is tested against the real layout
function scheduleFile(date: string, columns: ScheduleColumn[]): WeeklySchedule {
  const [year, month, day] = date.split('-')
  const file = `ONE-${day}${month}${year}.csv`
  return parseWeeklyCsv(file, weeklyScheduleCsv(columns, date))
}

const OCT_05 = scheduleFile('2026-10-05', [
  column('PS7\n(HPH/VUT - LAX/LGB/OAK)', [
    ['2026-10-08', 'WAN HAI A03 E018'],
    ['2026-10-19', 'HYUNDAI NEPTUNE 046E'],
    ['2026-10-25', 'WAN HAI A19 E009'],
  ]),
  column('MS2\n(VUT - LGB/OAK)', [['2026-10-09', 'HMM GAON 024E']]),
  column('EC3\n(VUT - ORF/CHS/SAV/NYC/JAX)', [], 'N/A'),
])

const OCT_10 = scheduleFile('2026-10-10', [
  column('PS7\n(HPH/VUT - LAX/LGB/OAK)', [
    ['2026-10-21', 'HYUNDAI NEPTUNE 046E'], // moved from Oct 19
    ['2026-10-25', 'WAN HAI A19 E009'],
    ['2026-10-26', 'ONE SINGAPORE 521E'], // new
  ]),
  column('MS2\n(VUT - LGB/OAK)', [['2026-11-03', 'ONE FRIENDSHIP 013E']]), // HMM GAON already sailed
  column('EC3\n(VUT - ORF/CHS/SAV/NYC/JAX)', [], 'ERROR'),
])

describe('parseWeeklyCsv', () => {
  it('reads services, routes, statuses and voyages back from the CSV', () => {
    expect(OCT_05.file).toBe('ONE-05102026.csv')
    expect(OCT_05.date).toBe('2026-10-05')
    expect(OCT_05.weeks).toEqual([
      { week: 'W41/2026', dates: '05/10-11/10' },
      { week: 'W42/2026', dates: '12/10-18/10' },
      { week: 'W43/2026', dates: '19/10-25/10' },
    ])
    expect(OCT_05.services.map((s) => [s.service, s.route, s.status, s.voyages.length])).toEqual([
      ['PS7', 'HPH/VUT - LAX/LGB/OAK', 'ok', 3],
      ['MS2', 'VUT - LGB/OAK', 'ok', 1],
      ['EC3', 'VUT - ORF/CHS/SAV/NYC/JAX', 'N/A', 0],
    ])
    expect(OCT_05.services[0]!.voyages[0]).toEqual({
      vessel: 'WAN HAI A03',
      voyage: 'E018',
      departure: '2026-10-08',
      week: 'W41/2026',
    })
  })

  it('splits weeks with several sailings', () => {
    const schedule = scheduleFile('2026-10-05', [
      column('EC2\n(VUT - ORF)', [
        ['2026-10-15', 'YM WINNER 050E'],
        ['2026-10-16', 'YM WAYFINDER 002E'],
      ]),
    ])
    expect(schedule.services[0]!.voyages.map((v) => `${v.vessel} ${v.voyage} ${v.departure}`)).toEqual([
      'YM WINNER 050E 2026-10-15',
      'YM WAYFINDER 002E 2026-10-16',
    ])
  })

  it('gives sailings in a week spanning New Year the right year', () => {
    // W53/2026 runs 28/12/2026-03/01/2027
    const schedule = scheduleFile('2026-12-28', [
      column('PS7\n(HPH - LAX)', [
        ['2026-12-30', 'WAN HAI A03 E020'],
        ['2027-01-02', 'WAN HAI A19 E011'],
      ]),
    ])
    expect(schedule.services[0]!.voyages.map((v) => [v.week, v.departure])).toEqual([
      ['W53/2026', '2026-12-30'],
      ['W53/2026', '2027-01-02'],
    ])
  })
})

describe('diffSchedules', () => {
  const diff = diffSchedules(OCT_05, OCT_10)

  it('compares only the dates both files cover', () => {
    expect(diff.window).toEqual({ from: '2026-10-10', to: '2026-10-25' })
    // HMM GAON sailed Oct 9, before the newer file starts: not a removal
    expect(diff.services.find((s) => s.service === 'MS2')).toBeUndefined()
  })

  it('finds rescheduled voyages and status changes', () => {
    const ps7 = diff.services.find((s) => s.service === 'PS7')!
    expect(ps7.rescheduled).toEqual([{ vessel: 'HYUNDAI NEPTUNE', voyage: '046E', from: '2026-10-19', to: '2026-10-21' }])
    expect(ps7.added).toEqual([])
    expect(diff.services.find((s) => s.service === 'EC3')!.statusChanged).toEqual({ from: 'N/A', to: 'ERROR' })
  })

  it('lists sailings only the newer file reaches as further ahead, not as added', () => {
    expect(diff.furtherAhead.map((f) => [f.service, f.voyages.map((v) => v.departure)])).toEqual([
      ['PS7', ['2026-10-26']],
      ['MS2', ['2026-11-03']],
    ])
  })

  it('finds added and removed voyages inside the window', () => {
    const older = scheduleFile('2026-10-05', [column('PS7\n(HPH - LAX)', [['2026-10-12', 'A 001E'], ['2026-10-20', 'B 002E']])])
    const newer = scheduleFile('2026-10-06', [column('PS7\n(HPH - LAX)', [['2026-10-14', 'C 003E'], ['2026-10-20', 'B 002E']])])
    const ps7 = diffSchedules(older, newer).services[0]!
    expect(ps7.added.map((v) => v.vessel)).toEqual(['C'])
    expect(ps7.removed.map((v) => v.vessel)).toEqual(['A'])
  })
})

describe('schedule tools', () => {
  const schedules = [OCT_10, OCT_05] // newest first, as the store returns them
  const run = (name: string, args: object) => JSON.parse(runScheduleTool(schedules, name, JSON.stringify(args)).content)

  it('get_voyages counts a service in the newest file', () => {
    const result = runScheduleTool(schedules, 'get_voyages', '{"service":"ps7"}')
    expect(JSON.parse(result.content)).toMatchObject({ file: 'ONE-10102026.csv', service: 'PS7', count: 3 })
    expect(result.files).toEqual(['ONE-10102026.csv'])
  })

  it('get_voyages always reads the newest file, even when asked for an older one', () => {
    // EC3 is N/A in the older file and ERROR in the newest
    expect(run('get_voyages', { service: 'EC3', file: 'ONE-05102026.csv' })).toMatchObject({
      file: 'ONE-10102026.csv',
      status: 'ERROR',
    })
  })

  it('get_voyages lists the available services for an unknown one', () => {
    expect(run('get_voyages', { service: 'MS3' })).toEqual({
      error: 'Service MS3 is not in ONE-10102026.csv',
      availableServices: ['PS7', 'MS2', 'EC3'],
    })
  })

  it('get_voyages builds a week-by-week table in the CSV cell format', () => {
    expect(weekTable(OCT_05, OCT_05.services[0]!)).toBe(
      [
        '| Week | Vessel+Voyage/Departure |',
        '|---|---|',
        '| W41/2026 (05/10-11/10) | WAN HAI A03 E018/ OCT 08 |',
        '| W42/2026 (12/10-18/10) | OMIT |',
        '| W43/2026 (19/10-25/10) | HYUNDAI NEPTUNE 046E/ OCT 19 |',
        '|  | WAN HAI A19 E009/ OCT 25 |',
      ].join('\n'),
    )
    expect(run('get_voyages', { service: 'PS7' }).tablePlaceholder).toBe('[[TABLE PS7]]')
    // No sailings to show for a service ONE doesn't run
    expect(run('get_voyages', { service: 'EC3' }).tablePlaceholder).toBeUndefined()
  })

  it('find_vessel finds a vessel by part of its name across services in the newest file', () => {
    const result = runScheduleTool(schedules, 'find_vessel', '{"vessel":"one friend"}')
    expect(JSON.parse(result.content)).toMatchObject({
      count: 1,
      matches: [{ service: 'MS2', vessel: 'ONE FRIENDSHIP', voyage: '013E', departure: '2026-11-03', cell: 'ONE FRIENDSHIP 013E/ NOV 03' }],
    })
    expect(result.files).toEqual(['ONE-10102026.csv'])
    expect(run('find_vessel', { vessel: 'EVER GIVEN' }).error).toContain('No vessel matching "EVER GIVEN"')
  })

  it('servicesTable lists every service with its route and voyage count', () => {
    expect(servicesTable(OCT_05)).toBe(
      [
        '| Service | Route | Voyages |',
        '|---|---|---|',
        '| PS7 | HPH/VUT - LAX/LGB/OAK | 3 |',
        '| MS2 | VUT - LGB/OAK | 1 |',
        '| EC3 | VUT - ORF/CHS/SAV/NYC/JAX | N/A |',
      ].join('\n'),
    )
  })

  it('compare_files compares the 2 newest files by default, oldest first', () => {
    const result = runScheduleTool(schedules, 'compare_files', '{}')
    expect(JSON.parse(result.content)).toMatchObject({ older: 'ONE-05102026.csv', newer: 'ONE-10102026.csv' })
    expect(result.files).toEqual(['ONE-10102026.csv', 'ONE-05102026.csv'])
    expect(run('compare_files', { older: 'ONE-10102026.csv', newer: 'ONE-05102026.csv' }).older).toBe('ONE-05102026.csv')
  })

  it('compare_files explains when only one file is saved', () => {
    const result = runScheduleTool([OCT_10], 'compare_files', '{}')
    expect(JSON.parse(result.content).error).toContain('Only one schedule file')
    expect(result.files).toEqual([])
  })

  it('returns errors for bad arguments and unknown tools instead of throwing', () => {
    expect(JSON.parse(runScheduleTool(schedules, 'get_voyages', '{not json').content).error).toContain('not valid JSON')
    expect(run('get_voyages', {}).error).toBeDefined()
    expect(run('delete_everything', {}).error).toContain('Unknown tool')
  })
})

describe('POST /api/v1/chat', () => {
  const app = createApp()
  const ask = (body: object) => request(app).post('/api/v1/chat').send(body)
  const question = { messages: [{ role: 'user', content: 'How many voyages does PS7 have?' }] }

  beforeEach(() => {
    vi.mocked(readRecentWeeklySchedules).mockReset()
    vi.mocked(askScheduleBot).mockReset()
  })

  it('answers from the saved files and returns the files the answer used', async () => {
    vi.mocked(readRecentWeeklySchedules).mockResolvedValue([
      { filename: 'ONE-10102026.csv', csv: weeklyScheduleCsv([column('PS7\n(HPH - LAX)', [['2026-10-12', 'A 001E']])], '2026-10-10') },
    ])
    vi.mocked(askScheduleBot).mockResolvedValue({ answer: 'PS7 has 1 voyage.', files: ['ONE-10102026.csv'] })

    const res = await ask(question)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ answer: 'PS7 has 1 voyage.', files: ['ONE-10102026.csv'] })
    expect(readRecentWeeklySchedules).toHaveBeenCalledWith(3)
    const [turns, schedules] = vi.mocked(askScheduleBot).mock.calls[0]!
    expect(turns).toEqual(question.messages)
    expect(schedules[0]!.services[0]!.voyages).toHaveLength(1)
  })

  it('returns 404 before the cron has saved any file', async () => {
    vi.mocked(readRecentWeeklySchedules).mockResolvedValue([])
    const res = await ask(question)
    expect(res.status).toBe(404)
    expect(askScheduleBot).not.toHaveBeenCalled()
  })

  it('rejects an empty conversation or one not ending with the user', async () => {
    expect((await ask({ messages: [] })).status).toBe(400)
    const res = await ask({ messages: [...question.messages, { role: 'assistant', content: 'Hi' }] })
    expect(res.status).toBe(400)
    expect(readRecentWeeklySchedules).not.toHaveBeenCalled()
  })
})

// The route tests mock scheduleBot, so load the real module here
const realBot = () => vi.importActual<typeof import('../src/modules/chat/scheduleBot.ts')>('../src/modules/chat/scheduleBot.ts')

describe('fillTables', () => {
  it('swaps the placeholder for the full week-by-week table from the newest file', async () => {
    const { fillTables } = await realBot()
    const used = new Set<string>()
    const text = fillTables('PS7 has 3 voyages:\n[[TABLE PS7]]', [OCT_05], used)
    // Every week, including the OMIT one the model might leave out
    expect(text).toBe(`PS7 has 3 voyages:\n\n${weekTable(OCT_05, OCT_05.services[0]!)}`)
    expect(text).toContain('| W42/2026 (12/10-18/10) | OMIT |')
    expect(used).toEqual(new Set(['ONE-05102026.csv']))
  })

  it('swaps [[SERVICES]] for the list of every service', async () => {
    const { fillTables } = await realBot()
    expect(fillTables('The services are:\n[[SERVICES]]', [OCT_05], new Set())).toBe(
      `The services are:\n\n${servicesTable(OCT_05)}`,
    )
  })

  it('leaves placeholders for unknown or N/A services alone', async () => {
    const { fillTables } = await realBot()
    expect(fillTables('[[TABLE MS3]] [[TABLE EC3]]', [OCT_05], new Set())).toBe('[[TABLE MS3]] [[TABLE EC3]]')
  })
})

describe('plainText', () => {
  it('swaps the narrow spaces and non-breaking hyphens models write for plain ones', async () => {
    const { plainText } = await realBot()
    expect(plainText(' HMM GAON 024E – Oct 09 in ONE‑05102026.csv ')).toBe(
      'HMM GAON 024E – Oct 09 in ONE-05102026.csv',
    )
  })
})
