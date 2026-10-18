import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../../constants'
import { createUserMessage } from '../../message/message-utils'
import { buildChatCompletionPayload } from '../payload-builder'

describe('playground request payload', () => {
  it('sends the system prompt before conversation messages', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('hello')],
      { ...DEFAULT_CONFIG, systemPrompt: 'Be concise' },
      DEFAULT_PARAMETER_ENABLED
    )
    expect(payload.messages[0]).toEqual({
      role: 'system',
      content: 'Be concise',
    })
  })
  it('preserves an attachment-only image message', () => {
    const message = {
      ...createUserMessage(''),
      attachments: [
        {
          id: 'image',
          name: 'example.png',
          mime: 'image/png',
          size: 8,
          kind: 'image' as const,
          data: 'data:image/png;base64,aGVsbG8=',
        },
      ],
    }
    const payload = buildChatCompletionPayload(
      [message],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED
    )
    expect(payload.messages[0].content).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,aGVsbG8=' },
      },
    ])
  })
  it('sends explicit zero sampling values without enabling unspecified parameters', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('hello')],
      { ...DEFAULT_CONFIG, temperature: 0 },
      { ...DEFAULT_PARAMETER_ENABLED, temperature: true, max_tokens: false }
    )
    expect(payload.temperature).toBe(0)
    expect(payload).not.toHaveProperty('max_tokens')
  })
})
