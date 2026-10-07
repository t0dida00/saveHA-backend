import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Shared secret Vercel Cron sends as a Bearer token; when unset the cron route is open */
  CRON_SECRET: z.string().min(1).optional(),
  /**
   * Hapag-Lloyd Commercial Schedules API (api-portal.hlag.com): the full point-to-point-routes
   * URL and the app's credentials from the portal. Unset means the /hpl routes answer 503.
   */
  HLAG_API_URL: z.url().optional(),
  HLAG_CLIENT_ID: z.string().min(1).optional(),
  HLAG_CLIENT_SECRET: z.string().min(1).optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors)
  process.exit(1)
}

export const env = parsed.data
