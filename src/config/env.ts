import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Shared secret Vercel Cron sends as a Bearer token; when unset the cron route is open */
  CRON_SECRET: z.string().min(1).optional(),
  /** Hugging Face access token for the schedule chatbot; without it POST /chat answers 503 */
  HF_TOKEN: z.string().min(1).optional(),
  /** Chat model on HF Inference Providers; it must support tool calling */
  HF_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors)
  process.exit(1)
}

export const env = parsed.data
