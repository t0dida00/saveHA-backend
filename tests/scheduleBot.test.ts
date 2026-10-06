import { beforeEach, describe, expect, it, vi } from 'vitest'
import { askScheduleBot, OUT_OF_SCOPE_REPLY } from '../src/modules/chat/scheduleBot.ts'
import { parseWeeklyCsv } from '../src/modules/schedules/parseWeeklyCsv.ts'
import { weeklyScheduleCsv } from '../src/modules/schedules/weeklySchedule.ts'

// Each test queues the model's replies; the real tool loop runs on them
const chatCompletion = vi.fn()
vi.mock('@huggingface/inference', () => ({
  InferenceClient: class {
    chatCompletion = chatCompletion
  },
}))

const reply = (content: string, toolCalls?: { name: string; arguments: string }[]) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content,
        tool_calls: toolCalls?.map((call, i) => ({ id: `call_${i}`, type: 'function', function: call })),
      },
    },
  ],
})

const schedules = [
  parseWeeklyCsv(
    'ONE-06102026.csv',
    weeklyScheduleCsv(
      [{ label: 'PS7\n(HPH - LAX)', url: 'https://www.one-line.com', sailings: [{ departure: '2026-10-08', vessel: 'WAN HAI A03 E018' }] }],
      '2026-10-06',
    ),
  ),
]
const ask = (content: string) => askScheduleBot([{ role: 'user', content }], schedules)

describe('askScheduleBot scope', () => {
  beforeEach(() => chatCompletion.mockReset())

  it.each(['OUT_OF_SCOPE', 'OUT_OF_SCOPE.', 'Sorry, that is OUT_OF_SCOPE – it is 10:00 now.'])(
    'answers off-topic requests with the fixed reply only (model wrote %j)',
    async (modelText) => {
      chatCompletion.mockResolvedValueOnce(reply(modelText))
      expect(await ask('What time is it?')).toEqual({ answer: OUT_OF_SCOPE_REPLY, files: [] })
    },
  )

  it('tells the model what is out of scope and how to flag it', async () => {
    chatCompletion.mockResolvedValueOnce(reply('OUT_OF_SCOPE'))
    await ask("What's the weather in Hanoi?")
    const system = chatCompletion.mock.calls[0]![0].messages[0].content as string
    expect(system).toContain('reply with exactly OUT_OF_SCOPE')
    expect(system).toMatch(/weather/)
  })

  it('still answers schedule questions through the tools', async () => {
    chatCompletion
      .mockResolvedValueOnce(reply('', [{ name: 'get_voyages', arguments: '{"service":"PS7"}' }]))
      .mockResolvedValueOnce(reply('PS7 has 1 voyage:\n[[TABLE PS7]]'))

    const result = await ask('List the voyages of PS7')
    expect(result.files).toEqual(['ONE-06102026.csv'])
    expect(result.answer).toContain('| W41/2026 (05/10-11/10) | WAN HAI A03 E018/ OCT 08 |')
    // The tool result went back to the model with the call's id
    const toolMessage = chatCompletion.mock.calls[1]![0].messages.at(-1)
    expect(toolMessage).toMatchObject({ role: 'tool', tool_call_id: 'call_0', name: 'get_voyages' })
  })
})
