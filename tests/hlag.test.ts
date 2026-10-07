import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { HttpError } from '../src/lib/HttpError.ts'
import { scrapeHplSchedule, type HplSailing } from '../src/modules/schedules/hpl.scraper.ts'
import { saveLatestWeeklySchedule } from '../src/modules/schedules/scheduleStore.ts'

vi.mock('../src/modules/schedules/scheduleStore.ts', () => ({
  saveLatestWeeklySchedule: vi.fn(),
  readLatestWeeklySchedule: vi.fn(),
  saveLatestHealthCheck: vi.fn(),
  readLatestHealthCheck: vi.fn(),
}))

// The browser part needs a person at the security check, so the cards it reads are faked here
vi.mock('../src/modules/schedules/hpl.scraper.ts', () => ({ scrapeHplSchedule: vi.fn() }))

const app = createApp()
const scrape = vi.mocked(scrapeHplSchedule)

// As read from the cards for VNVUT → USNYC: US4 wears the Gemini badge, one card shows no service
const CARDS: HplSailing[] = [
  { service: 'AA7', vessel: 'WAN HAI A15', voyage: 'E010', departure: '2026-10-08' },
  // The same sailing read twice (e.g. from two search windows) counts once
  { service: 'AA7', vessel: 'WAN HAI A15', voyage: 'E010', departure: '2026-10-08' },
  { service: 'AA7', vessel: 'WAN HAI A18', voyage: 'E007', departure: '2026-10-12' },
  { service: 'US4', vessel: 'AIN SNAN EXPRESS', voyage: '640E', departure: '2026-10-09' },
  { service: 'US4', vessel: 'MADRID EXPRESS', voyage: '641E', departure: '2026-10-16' },
]

describe('POST /api/v1/schedules/hpl/weekly', () => {
  beforeEach(() => {
    scrape.mockReset()
    scrape.mockResolvedValue(CARDS)
  })

  it('searches Hapag-Lloyd for the requested route, date and weeks', async () => {
    const res = await request(app)
      .post('/api/v1/schedules/hpl/weekly')
      .send({ date: '2026-10-06', next: 2, from: 'VNVUT', to: 'USNYC' })
    expect(res.status).toBe(200)
    expect(scrape).toHaveBeenCalledWith({ from: 'VNVUT', to: 'USNYC', fromDate: '2026-10-06', weeks: 2 })
  })

  it('returns the weekly CSV with HPL in the corner, one column per service, cells as vessel/ voyage/ date', async () => {
    const res = await request(app)
      .post('/api/v1/schedules/hpl/weekly')
      .send({ date: '2026-10-06', next: 2, from: 'VNVUT', to: 'USNYC' })
    expect(res.headers['content-disposition']).toContain('HPL-06102026.csv')
    const [header, queryString, week41, week42] = res.text.replace('﻿', '').split('\r\n')
    expect(header).toBe('HPL,"AA7\n(VUT - NYC)","US4\n(VUT - NYC)"')
    expect(queryString).toContain('hapag-lloyd.com/solutions/schedule')
    expect(week41).toBe('"W41/2026\n05/10-11/10",WAN HAI A15/ E010/ OCT 08,AIN SNAN EXPRESS/ 640E/ OCT 09')
    expect(week42).toBe('"W42/2026\n12/10-18/10",WAN HAI A18/ E007/ OCT 12,MADRID EXPRESS/ 641E/ OCT 16')
  })

  it('passes on the security-check timeout', async () => {
    scrape.mockRejectedValue(new HttpError(504, 'Hapag-Lloyd security check was not passed in time'))
    const res = await request(app).post('/api/v1/schedules/hpl/weekly').send({})
    expect(res.status).toBe(504)
    expect(res.body.error).toBe('Hapag-Lloyd security check was not passed in time')
  })

  it('rejects a bad port code or week count before opening Hapag-Lloyd', async () => {
    const res = await request(app).post('/api/v1/schedules/hpl/weekly').send({ from: 'VUT', next: 3 })
    expect(res.status).toBe(400)
    expect(res.body.details).toHaveProperty('from')
    expect(res.body.details).toHaveProperty('next')
    expect(scrape).not.toHaveBeenCalled()
  })

  it('cron saves the CSV as the latest Hapag-Lloyd schedule', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T01:30:00Z') })
    const res = await request(app).get('/api/v1/schedules/hpl/weekly/cron').set('Authorization', 'Bearer test-cron-secret')
    vi.useRealTimers()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ saved: 'HPL-06102026.csv' })
    expect(saveLatestWeeklySchedule).toHaveBeenCalledWith(
      { filename: 'HPL-06102026.csv', csv: expect.stringContaining('WAN HAI A15/ E010/ OCT 08') },
      'hpl',
    )
  })
})
