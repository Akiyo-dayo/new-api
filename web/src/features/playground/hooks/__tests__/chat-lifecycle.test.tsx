import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import {
  createLoadingAssistantMessage,
  createUserMessage,
} from '../../lib/message/message-utils'
import type { Message } from '../../types'
import { useChatHandler } from '../use-chat-handler'

vi.mock('@/lib/api', () => ({
  getFreshAuthHeaders: async () => ({ Authorization: 'Bearer local-test' }),
}))
vi.mock('@/lib/handle-server-error', () => ({ handleServerError: vi.fn() }))
beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'test', role: 1 })
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})
describe('chat request lifecycle', () => {
  it('renders streamed content and real usage only after a complete stream', async () => {
    const frames = `${[
      `data: ${JSON.stringify({
        choices: [{ delta: { content: 'Streamed answer' } }],
      })}`,
      `data: ${JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      })}`,
      'data: [DONE]',
    ].join('\n\n')}\n\n`
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(frames, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      )
    )
    let messages: Message[] = [
      createUserMessage('hello'),
      createLoadingAssistantMessage(),
    ]
    const { result } = renderHook(() =>
      useChatHandler({
        config: DEFAULT_CONFIG,
        parameterEnabled: DEFAULT_PARAMETER_ENABLED,
        onMessageUpdate: (updater) => {
          messages = updater(messages)
        },
      })
    )
    await act(async () => {
      await result.current.sendChat(messages)
    })
    expect(messages.at(-1)?.versions[0].content).toBe('Streamed answer')
    expect(messages.at(-1)?.usage).toEqual({ input: 3, output: 2, total: 5 })
    expect(messages.at(-1)?.status).toBe('complete')
  })
  it('ignores a late response after the generation was stopped', async () => {
    let resolve: (value: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          })
      )
    )
    let messages: Message[] = [
      createUserMessage('hello'),
      createLoadingAssistantMessage(),
    ]
    const update = (updater: (previous: Message[]) => Message[]) => {
      messages = updater(messages)
    }
    const { result } = renderHook(() =>
      useChatHandler({
        config: { ...DEFAULT_CONFIG, stream: false },
        parameterEnabled: DEFAULT_PARAMETER_ENABLED,
        onMessageUpdate: update,
      })
    )
    let sending: Promise<void> | undefined
    act(() => {
      sending = result.current.sendChat(messages)
    })
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    act(() => result.current.stopGeneration())
    await act(async () => {
      resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'Late secret' } }] })
        )
      )
      await sending
    })
    expect(messages.at(-1)?.versions[0].content).not.toContain('Late secret')
    expect(result.current.isGenerating).toBe(false)
  })
  it('marks a truncated SSE stream as an error instead of claiming completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } }
          )
        )
    )
    let messages: Message[] = [
      createUserMessage('hello'),
      createLoadingAssistantMessage(),
    ]
    const { result } = renderHook(() =>
      useChatHandler({
        config: DEFAULT_CONFIG,
        parameterEnabled: DEFAULT_PARAMETER_ENABLED,
        onMessageUpdate: (updater) => {
          messages = updater(messages)
        },
      })
    )
    await act(async () => {
      await result.current.sendChat(messages)
    })
    expect(messages.at(-1)?.status).toBe('error')
  })
})
