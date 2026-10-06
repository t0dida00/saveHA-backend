import ExcelJS from 'exceljs'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { HttpError } from '../src/lib/HttpError.ts'
import { downloadOneP2pSchedule, ServiceNotOnRouteError } from '../src/modules/schedules/one.scraper.ts'
import { ONE_SERVICE_ROUTES } from '../src/modules/schedules/oneServices.ts'
import { readLatestWeeklySchedule, saveLatestWeeklySchedule } from '../src/modules/schedules/scheduleStore.ts'

vi.mock('../src/modules/schedules/one.scraper.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/modules/schedules/one.scraper.ts')>()),
  downloadOneP2pSchedule: vi.fn(),
  launchBrowser: vi.fn(async () => ({ close: vi.fn() })),
}))

vi.mock('../src/modules/schedules/scheduleStore.ts', () => ({
  saveLatestWeeklySchedule: vi.fn(),
  readLatestWeeklySchedule: vi.fn(),
}))

const app = createApp()

// Mirrors the layout of ONE's export: link rows, a two-row header, then data
async function scheduleWorkbook(sailings = PS7_SAILINGS): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Point to Point Schedule')
  sheet.addRow([null, null, { text: 'Go to ONE Schedule Page', hyperlink: 'https://www.one-line.com' }])
  sheet.addRow(['Origin', 'Est. Transit Time', 'Service', 'Vessel/Voyage'])
  sheet.addRow(['Origin', 'Total', 'Service', 'Vessel/Voyage'])
  for (const row of sailings) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const PS7_SAILINGS = [
  ['HAI PHONG\n2026-10-08 (Thu)', '26 day(s)', 'PS7', 'WAN HAI A03 E018'],
  ['HAI PHONG\n    2026-10-25 (Sun)', '26 day(s)', 'PS7', 'WAN HAI A19 E009'],
  ['HAI PHONG\n2026-10-19 (Mon)', '27 day(s)', 'PS7', 'HYUNDAI NEPTUNE 046E'],
  ['HAI PHONG\n2026-11-02 (Mon)', '27 day(s)', 'PS7', 'ONE SINGAPORE 521E'],
]

const PS7_URL =
  'https://www.one-line.com/one-ecom/schedule/point-to-point-schedule?oriLocNmParam=HAI+PHONG%2C+VIETNAM' +
  '&destLocNmParam=LOS+ANGELES%2C+CA%2C+UNITED+STATES&oriLocCdParam=VNHPH&destLocCdParam=USLAX&oriTermCdPara=Y' +
  '&desTermCdPara=Y&frmDtParam=2026-10-06&nextWeekValue=56&cargoNature=GP&isEnabledCO2=false&year=2026&month=10' +
  '&searchType=List&isPolPodOn=false'

const WEEKLY_CSV =
  '\uFEFFONE,"PS7\n(HPH - LAX)"\r\n' +
  `QueryString,${PS7_URL}\r\n` +
  '"W41/2026\n05/10-11/10",WAN HAI A03 E018/ OCT 08\r\n' +
  '"W42/2026\n12/10-18/10",OMIT\r\n' +
  '"W43/2026\n19/10-25/10","HYUNDAI NEPTUNE 046E/ OCT 19\nWAN HAI A19 E009/ OCT 25"\r\n' +
  '"W44/2026\n26/10-01/11",OMIT\r\n' +
  '"W45/2026\n02/11-08/11",ONE SINGAPORE 521E/ NOV 02\r\n'

describe('GET /api/v1/schedules/one/p2p', () => {
  beforeEach(async () => {
    vi.mocked(downloadOneP2pSchedule).mockResolvedValue({
      filename: 'ONE P2P Schedule VNHPH to USLAX 20261006.xlsx',
      data: await scheduleWorkbook(),
    })
  })

  it('returns the PS7 Hai Phong to Los Angeles schedule as CSV by default', async () => {
    const res = await request(app).get('/api/v1/schedules/one/p2p?from=2026-10-06')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('ONE-HPH-LAX-06102026.csv')
    expect(res.text).toBe(WEEKLY_CSV)
    expect(downloadOneP2pSchedule).toHaveBeenCalledWith({
      origin: 'VNHPH',
      originName: 'HAI PHONG, VIETNAM',
      destination: 'USLAX',
      destinationName: 'LOS ANGELES, CA, UNITED STATES',
      service: 'PS7',
      fromDate: '2026-10-06',
      weeks: 8,
    })
  })

  it('returns the original xlsx when asked', async () => {
    const res = await request(app).get('/api/v1/schedules/one/p2p?from=2026-10-06&format=xlsx')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
    expect(res.headers['content-disposition']).toContain('ONE-HPH-LAX-06102026.xlsx')
  })

  it('requires a location name for codes it does not know', async () => {
    const res = await request(app).get('/api/v1/schedules/one/p2p?origin=CNSHA')
    expect(res.status).toBe(400)
    expect(res.body.details.originName).toEqual(['Required for CNSHA'])
  })
})

const postWeekly = (body: object) => request(app).post('/api/v1/schedules/one/weekly').send(body)

describe('POST /api/v1/schedules/one/weekly', () => {
  beforeEach(() => {
    vi.mocked(downloadOneP2pSchedule).mockReset()
    vi.mocked(downloadOneP2pSchedule).mockImplementation(async (query) => {
      if (query.service === 'MS2') throw new ServiceNotOnRouteError('MS2', ['PS7'])
      return {
        filename: 'schedule.xlsx',
        data: await scheduleWorkbook(query.service === 'PS7' ? PS7_SAILINGS : []),
      }
    })
  })

  it('searches each service on the first origin and destination of its route', async () => {
    const res = await postWeekly({ date: '2026-10-06', services_routes: 'all' })
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('ONE-06102026.csv')
    expect(downloadOneP2pSchedule).toHaveBeenCalledTimes(ONE_SERVICE_ROUTES.length)
    for (const route of ONE_SERVICE_ROUTES) {
      expect(downloadOneP2pSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ service: route.service, origin: route.origin, destination: route.destination }),
        expect.anything(),
      )
    }
  })

  it('puts each service in its own column and marks ones ONE does not run as N/A', async () => {
    const res = await postWeekly({ date: '2026-10-06', services_routes: 'all' })
    const [header, queryString, firstWeek] = res.text.replace('\uFEFF', '').split('\r\n')
    expect(header).toBe(['ONE', ...ONE_SERVICE_ROUTES.map((r) => `"${r.service}\n(${r.route})"`)].join(','))
    // Every column links to its ONE search, including services ONE doesn't run
    expect(queryString!.split(',')).toHaveLength(ONE_SERVICE_ROUTES.length + 1)
    expect(queryString).toContain(PS7_URL)

    const cells = ONE_SERVICE_ROUTES.map((r) =>
      r.service === 'PS7' ? 'WAN HAI A03 E018/ OCT 08' : r.service === 'MS2' ? 'N/A' : 'OMIT',
    )
    expect(firstWeek).toBe(['"W41/2026\n05/10-11/10"', ...cells].join(','))
  })

  it('retries a route whose page loaded too slowly to show results', async () => {
    const download = vi.mocked(downloadOneP2pSchedule)
    const succeed = download.getMockImplementation()!
    download.mockImplementation(async (query) => {
      if (query.service === 'PS7' && download.mock.calls.filter(([q]) => q.service === 'PS7').length === 1) {
        throw new HttpError(404, 'ONE returned no schedule for this route')
      }
      return succeed(query)
    })

    const res = await postWeekly({ date: '2026-10-06', services_routes: 'all' })
    expect(res.text).toContain('WAN HAI A03 E018/ OCT 08')
  })

  it('searches only the services in services_routes, on the routes given', async () => {
    const res = await postWeekly({
      date: '2026-10-06',
      next: 4,
      services_routes: { PS3: { from: 'VNCMP', to: 'USLAX' }, ps7: { from: 'vnhph', to: 'USLAX' } },
    })
    expect(res.status).toBe(200)
    expect(downloadOneP2pSchedule).toHaveBeenCalledTimes(2)
    expect(downloadOneP2pSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'PS7', origin: 'VNHPH', originName: 'HAI PHONG, VIETNAM', weeks: 4 }),
      expect.anything(),
    )
    expect(res.text.split('\r\n')[0]).toBe('\uFEFFONE,"PS3\n(CMP - LAX)","PS7\n(HPH - LAX)"')
  })

  it('defaults to every service for 8 weeks from today', async () => {
    const res = await postWeekly({})
    expect(res.status).toBe(200)
    expect(downloadOneP2pSchedule).toHaveBeenCalledTimes(ONE_SERVICE_ROUTES.length)
    expect(downloadOneP2pSchedule).toHaveBeenCalledWith(expect.objectContaining({ weeks: 8 }), expect.anything())
  })

  it('rejects an unknown location or a week count other than 2/4/6/8', async () => {
    const res = await postWeekly({ next: 3, services_routes: { PS7: { from: 'VMHPH', to: 'USLAX' } } })
    expect(res.status).toBe(400)
    expect(res.body.details).toHaveProperty('next')
    expect(res.body.details).toHaveProperty('services_routes')
    expect(downloadOneP2pSchedule).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/schedules/one/weekly/cron', () => {
  const runCron = () => request(app).get('/api/v1/schedules/one/weekly/cron')

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T01:00:00Z') })
    vi.mocked(saveLatestWeeklySchedule).mockReset()
    vi.mocked(downloadOneP2pSchedule).mockReset()
    vi.mocked(downloadOneP2pSchedule).mockImplementation(async () => ({
      filename: 'schedule.xlsx',
      data: await scheduleWorkbook([]),
    }))
  })
  afterEach(() => vi.useRealTimers())

  it('scrapes every service from today for 8 weeks and saves the CSV', async () => {
    const res = await runCron().set('Authorization', 'Bearer test-cron-secret')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ saved: 'ONE-06102026.csv' })
    expect(downloadOneP2pSchedule).toHaveBeenCalledTimes(ONE_SERVICE_ROUTES.length)
    expect(downloadOneP2pSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: '2026-10-06', weeks: 8 }),
      expect.anything(),
    )
    expect(saveLatestWeeklySchedule).toHaveBeenCalledWith({
      filename: 'ONE-06102026.csv',
      csv: expect.stringContaining('frmDtParam=2026-10-06'),
    })
  })

  it('rejects a request without the cron secret', async () => {
    const res = await runCron().set('Authorization', 'Bearer wrong')
    expect(res.status).toBe(401)
    expect(downloadOneP2pSchedule).not.toHaveBeenCalled()
    expect(saveLatestWeeklySchedule).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/schedules/one/weekly/latest', () => {
  const getLatest = () => request(app).get('/api/v1/schedules/one/weekly/latest')

  it('downloads the CSV the last cron run saved', async () => {
    vi.mocked(readLatestWeeklySchedule).mockResolvedValue({ filename: 'ONE-06102026.csv', csv: WEEKLY_CSV })
    const res = await getLatest()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('ONE-06102026.csv')
    expect(res.text).toBe(WEEKLY_CSV)
  })

  it('returns 404 before the cron job has run', async () => {
    vi.mocked(readLatestWeeklySchedule).mockResolvedValue(null)
    const res = await getLatest()
    expect(res.status).toBe(404)
  })
})
