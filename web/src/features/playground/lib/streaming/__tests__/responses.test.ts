import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../../constants'
import { createUserMessage } from '../../message/message-utils'
import {
  buildResponsesPayload,
  buildPlaygroundPayload,
  parseResponsesResult,
  parseUsage,
  redactDebug,
} from '../responses'

describe('Responses protocol', () => {
  it('maps search, reasoning, system prompt and output limits to Responses fields', () => {
    const payload = buildResponsesPayload(
      [createUserMessage('Search sources')],
      {
        ...DEFAULT_CONFIG,
        systemPrompt: 'Use sources',
        protocol: 'responses',
        webSearch: true,
        reasoningEffort: 'high',
      },
      { ...DEFAULT_PARAMETER_ENABLED, max_tokens: true }
    )
    expect(payload).toMatchObject({
      instructions: 'Use sources',
      tools: [{ type: 'web_search' }],
      reasoning: { effort: 'high' },
      max_output_tokens: 4096,
      store: false,
    })
    expect(payload).not.toHaveProperty('max_tokens')
    expect(payload).not.toHaveProperty('frequency_penalty')
  })
  it('rejects search on Chat Completions instead of silently ignoring it', () => {
    expect(() =>
      buildPlaygroundPayload(
        [],
        { ...DEFAULT_CONFIG, protocol: 'chat', webSearch: true },
        DEFAULT_PARAMETER_ENABLED
      )
    ).toThrow('Web search requires')
  })
  it('renders actual citation URLs and token usage from completed output', () => {
    const parsed = parseResponsesResult({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'Answer',
              annotations: [
                {
                  type: 'url_citation',
                  url: 'https://example.com',
                  title: 'Source',
                },
                { type: 'url_citation', url: 'javascript:alert(1)' },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    })
    expect(parsed).toEqual({
      text: 'Answer',
      reasoning: '',
      sources: [{ href: 'https://example.com', title: 'Source' }],
      usage: { input: 10, output: 5, total: 15 },
    })
  })
  it('does not fabricate usage when the provider omitted token counts', () => {
    expect(parseUsage(undefined)).toBeUndefined()
    expect(parseUsage({ input_tokens: -1, output_tokens: 1 })).toBeUndefined()
  })
  it('redacts credentials and inline attachment bytes in debug output', () => {
    expect(
      redactDebug({
        Authorization: 'secret',
        image_url: 'data:image/png;base64,abcd',
        model: 'test',
      })
    ).toEqual({
      Authorization: '[redacted]',
      image_url: 'data:image/png;base64,[attachment omitted]',
      model: 'test',
    })
  })
})
