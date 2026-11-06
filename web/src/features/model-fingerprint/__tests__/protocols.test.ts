import { describe, expect, it } from 'vitest'

import { readCompletion } from '../vendor/completion'
import { completionBody } from '../vendor/completion-request'

const content = '1, 2, 3'
const configs = ['openai', 'responses', 'anthropic'] as const
const sse = (events: unknown[]) =>
  new Response(
    `${events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('')}data: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } }
  )
describe('source protocol compatibility', () => {
  it.each(configs)(
    '%s keeps the exact prompt and protocol settings',
    (format) => {
      const prompt = 'exact upstream prompt\n300 integers'
      const body = completionBody(
        {
          format,
          model: 'test',
          effort: 'high',
          stream: true,
          serviceTier: 'fast',
        },
        prompt
      )
      expect(JSON.stringify(body)).toContain(
        JSON.stringify(prompt).slice(1, -1)
      )
      expect(body[format === 'anthropic' ? 'speed' : 'service_tier']).toBe(
        'fast'
      )
    }
  )
  it('turns openPangu thinking off through chat template kwargs on Chat Completions', () => {
    const body = completionBody(
      { format: 'openai', model: 'openPangu-2.0-Pro', effort: 'none' },
      'count'
    )

    expect(body.chat_template_kwargs).toEqual({ thinking: false })
    expect(body).not.toHaveProperty('reasoning_effort')
  })
  it('keeps reasoning_effort for other models when effort is none', () => {
    const body = completionBody(
      { format: 'openai', model: 'gpt-6.1-terra', effort: 'none' },
      'count'
    )

    expect(body.reasoning_effort).toBe('none')
    expect(body).not.toHaveProperty('chat_template_kwargs')
  })
  it.each([
    [
      'openai',
      [
        { choices: [{ index: 0, delta: { content }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ],
    ],
    [
      'responses',
      [
        { type: 'response.output_text.delta', delta: content },
        { type: 'response.completed', response: { status: 'completed' } },
      ],
    ],
    [
      'anthropic',
      [
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: content },
        },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ],
    ],
  ] as const)('%s reads its complete SSE stream', async (format, events) => {
    expect((await readCompletion(sse([...events]), format)).text).toBe(content)
  })
  it('rejects truncated output instead of accepting a fake completed sample', async () => {
    await expect(
      readCompletion(
        sse([{ choices: [{ delta: { content }, finish_reason: 'length' }] }]),
        'openai'
      )
    ).rejects.toThrow('输出未完整结束')
  })
})
