import { InferenceClient } from '@huggingface/inference'
import type { ChatCompletionInputMessage } from '@huggingface/tasks'
import { env } from '../../config/env.ts'
import type { WeeklySchedule } from '../schedules/parseWeeklyCsv.ts'
import { runScheduleTool, SCHEDULE_TOOL_DEFINITIONS } from './scheduleTools.ts'

// Enough for "compare, then list one service" with room to retry a bad call
const MAX_ROUNDS = 5

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Answers a question about the saved schedules (newest first). The model picks a tool;
 * counting and comparing happen in code, so numbers in the answer come from the data.
 */
export async function askScheduleBot(turns: ChatTurn[], schedules: WeeklySchedule[]): Promise<string> {
  const client = new InferenceClient(env.HF_TOKEN)
  const messages: ChatCompletionInputMessage[] = [{ role: 'system', content: systemPrompt(schedules) }, ...turns]

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.chatCompletion({
      model: env.HF_MODEL,
      provider: 'auto',
      messages,
      tools: SCHEDULE_TOOL_DEFINITIONS,
      tool_choice: 'auto',
      max_tokens: 4096,
    })
    const message = response.choices[0]?.message
    if (!message?.tool_calls?.length) return message?.content?.trim() || 'Sorry, I could not find an answer.'

    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls })
    for (const call of message.tool_calls) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: runScheduleTool(schedules, call.function.name, call.function.arguments),
      })
    }
  }
  return 'Sorry, that question needed too many steps. Try asking about one service or one comparison at a time.'
}

function systemPrompt(schedules: WeeklySchedule[]): string {
  const files = schedules.map((s, i) => `- ${s.file} (scraped ${s.date}${i === 0 ? ', newest' : ''})`).join('\n')
  const services = schedules[0]?.services.map((s) => `${s.service} (${s.route})`).join(', ')
  return `You answer questions about Ocean Network Express (ONE) weekly sailing schedules from Vietnam to North America.

Saved schedule files, newest first:
${files}

Services: ${services}

Each file lists the voyages of every service for about 8 weeks from its scrape date. A voyage is a vessel name plus a voyage code, e.g. "WAN HAI A03" voyage "E018". Status N/A means ONE doesn't run that service on its route; ERROR means the download failed that week.

Always call a tool for counts, lists, dates and differences; never work them out yourself. "The last 2 files" means the two newest. If a service doesn't exist, say so and list the available ones. Keep answers short, use lists for voyages, give dates as e.g. "Oct 08", and reply in the user's language.`
}
