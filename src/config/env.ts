import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Shared secret Vercel Cron sends as a Bearer token; when unset the cron route is open */
  CRON_SECRET: z.string().min(1).optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors)
  process.exit(1)
}

export const env = parsed.data
