import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { saveLatestWeeklySchedule } from '../src/modules/schedules/scheduleStore.ts'

vi.mock('../src/modules/schedules/scheduleStore.ts', () => ({
  saveLatestWeeklySchedule: vi.fn(),
  readLatestWeeklySchedule: vi.fn(),
  saveLatestHealthCheck: vi.fn(),
  readLatestHealthCheck: vi.fn(),
}))

const app = createApp()

const QUERY =
  'sl=VNVUT&el=USNYC&exportHaulage=MH&importHaulage=MH&containerType=45GP&departureDate=2026-10-06&usFlag=false&dg=false&reefer'

const lines = (text: string) => text.replace('﻿', '').split('\r\n').filter(Boolean)

describe('POST /api/v1/schedules/hpl/weekly', () => {
  it('returns HPL-ddmmyyyy.csv with one query string per service and no week rows', async () => {
    const res = await request(app)
      .post('/api/v1/schedules/hpl/weekly')
      .send({ date: '2026-10-06', next: 2, from: 'VNVUT', to: 'USNYC', services: ['AA7', 'US4'] })
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('HPL-06102026.csv')
    expect(lines(res.text)).toEqual(['HPL,"AA7\n(VUT - NYC)","US4\n(VUT - NYC)"', `QueryString,${QUERY},${QUERY}`])
  })

  it('without services, gives one column named after the route, searching VNVUT → USNYC', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T05:00:00Z') })
    const res = await request(app).post('/api/v1/schedules/hpl/weekly').send({})
    vi.useRealTimers()
    expect(lines(res.text)).toEqual(['HPL,VUT - NYC', `QueryString,${QUERY}`])
  })

  it('puts the requested ports and date in the query string', async () => {
    const res = await request(app)
      .post('/api/v1/schedules/hpl/weekly')
      .send({ date: '2026-11-02', from: 'VNVUT', to: 'USLAX', services: ['WC1'] })
    expect(lines(res.text)[1]).toBe(
      'QueryString,sl=VNVUT&el=USLAX&exportHaulage=MH&importHaulage=MH&containerType=45GP&departureDate=2026-11-02&usFlag=false&dg=false&reefer',
    )
  })

  it('rejects a bad port code, week count or service code', async () => {
    const res = await request(app).post('/api/v1/schedules/hpl/weekly').send({ from: 'VUT', next: 3, services: ['A A7'] })
    expect(res.status).toBe(400)
    expect(res.body.details).toHaveProperty('from')
    expect(res.body.details).toHaveProperty('next')
    expect(res.body.details).toHaveProperty('services')
  })

  it('cron saves the query-string CSV as the latest Hapag-Lloyd file', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T01:30:00Z') })
    const res = await request(app).get('/api/v1/schedules/hpl/weekly/cron').set('Authorization', 'Bearer test-cron-secret')
    vi.useRealTimers()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ saved: 'HPL-06102026.csv' })
    expect(saveLatestWeeklySchedule).toHaveBeenCalledWith(
      { filename: 'HPL-06102026.csv', csv: expect.stringContaining(QUERY) },
      'hpl',
    )
  })
})
