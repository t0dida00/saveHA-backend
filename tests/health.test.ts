import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'

const app = createApp()

describe('GET /api/v1/health', () => {
  it('reports the API is up', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})

describe('unknown routes', () => {
  it('return 404 with a JSON error', async () => {
    const res = await request(app).get('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('No route for GET /api/v1/nope')
  })
})
