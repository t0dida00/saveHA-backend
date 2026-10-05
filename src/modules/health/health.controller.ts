import type { RequestHandler } from 'express'

export const getHealth: RequestHandler = (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() })
}
