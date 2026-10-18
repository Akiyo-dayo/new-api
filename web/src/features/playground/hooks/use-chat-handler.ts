import { useCallback, useEffect, useRef, useState } from 'react'

import { getFreshAuthHeaders } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'

import {
  applyChatCompletionResponse,
  applyStreamingChunk,
  completeAssistantMessage,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
} from '../lib'
import {
  buildPlaygroundPayload,
  parseResponsesResult,
  parseUsage,
  redactDebug,
} from '../lib/streaming/responses'
import type {
  Message,
  ParameterEnabled,
  PlaygroundConfig,
  PlaygroundDebug,
} from '../types'

interface UseChatHandlerOptions {
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  onMessageUpdate: (updater: (prev: Message[]) => Message[]) => void
}
export function useChatHandler(options: UseChatHandlerOptions) {
  const config = options.config
  const parameterEnabled = options.parameterEnabled
  const onMessageUpdate = options.onMessageUpdate
  const [isGenerating, setIsGenerating] = useState(false)
  const [debug, setDebug] = useState<PlaygroundDebug | null>(null)
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
      controller.current?.abort()
    },
    []
  )
  const stopGeneration = useCallback(() => {
    generation.current++
    controller.current?.abort()
    controller.current = null
    setIsGenerating(false)
    onMessageUpdate((previous) =>
      updateLastAssistantMessage(previous, completeAssistantMessage)
    )
  }, [onMessageUpdate])
  const sendChat = useCallback(
    async (messages: Message[]) => {
      const current = ++generation.current
      controller.current?.abort()
      const abort = new AbortController()
      controller.current = abort
      const started = performance.now()
      const responses = config.protocol === 'responses'
      const path = responses ? '/pg/responses' : '/pg/chat/completions'
      const update = (apply: (message: Message) => Message) => {
        if (current !== generation.current) return
        onMessageUpdate((previous) =>
          current === generation.current
            ? updateLastAssistantMessage(previous, apply)
            : previous
        )
      }
      let request: unknown
      const events: unknown[] = []
      let httpStatus: number | undefined
      let requestId: string | undefined
      try {
        request = buildPlaygroundPayload(messages, config, parameterEnabled)
        setDebug({ request: redactDebug(request) })
        setIsGenerating(true)
        const headers = await getFreshAuthHeaders()
        if (current !== generation.current) return
        const result = await fetch(path, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: abort.signal,
        })
        if (abort.signal.aborted || current !== generation.current) return
        httpStatus = result.status
        requestId = result.headers.get('X-Request-Id') ?? undefined
        if (!result.ok) {
          const errorBody: unknown = await result.json().catch(() => null)
          events.push(errorBody)
          const error = errorBody as {
            error?: { message?: string }
            message?: string
          } | null
          throw new Error(
            error?.error?.message ?? error?.message ?? `HTTP ${result.status}`
          )
        }
        if (
          !config.stream ||
          !result.headers.get('content-type')?.includes('text/event-stream')
        ) {
          const value = await result.json()
          events.push(value)
          if (responses) {
            const parsed = parseResponsesResult(value)
            if (
              value.error ||
              !['completed', 'incomplete'].includes(String(value.status))
            ) {
              throw new Error(
                value.error?.message ?? 'Response did not complete'
              )
            }
            update((message) => ({
              ...completeAssistantMessage(
                applyStreamingChunk(message, 'content', parsed.text)
              ),
              reasoning: parsed.reasoning
                ? { content: parsed.reasoning, duration: 0 }
                : undefined,
              sources: parsed.sources,
              usage: parsed.usage,
            }))
          } else {
            if (!value.choices?.length) {
              throw new Error('Response contains no message')
            }
            update((message) => ({
              ...(applyChatCompletionResponse(message, value) ?? message),
              usage: parseUsage(value.usage),
            }))
          }
        } else {
          if (!result.body) throw new Error('Response contains no stream')
          const reader = result.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let complete = false
          let receivedContent = false
          const consume = (frame: string) => {
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n')
            if (!data) return
            if (data === '[DONE]') {
              complete = true
              return
            }
            const event = JSON.parse(data)
            if (events.length < 100) events.push(redactDebug(event))
            if (
              event.error ||
              event.type === 'error' ||
              event.type === 'response.failed'
            ) {
              throw new Error(
                event.error?.message ??
                  event.response?.error?.message ??
                  event.message ??
                  'Generation failed'
              )
            }
            if (responses) {
              if (
                event.type === 'response.output_text.delta' ||
                event.type === 'response.reasoning_summary_text.delta'
              ) {
                receivedContent = true
                update((message) =>
                  applyStreamingChunk(
                    message,
                    event.type === 'response.output_text.delta'
                      ? 'content'
                      : 'reasoning',
                    String(event.delta ?? '')
                  )
                )
              }
              if (
                event.type === 'response.completed' ||
                event.type === 'response.incomplete'
              ) {
                if (event.type === 'response.incomplete') {
                  throw new Error('Response was truncated before completion')
                }
                complete = true
                const parsed = parseResponsesResult(event.response ?? {})
                update((message) => {
                  let next = message
                  if (!receivedContent && parsed.text) {
                    next = applyStreamingChunk(next, 'content', parsed.text)
                  }
                  return {
                    ...next,
                    sources: parsed.sources,
                    usage: parsed.usage,
                  }
                })
              }
            } else {
              if (event.choices?.[0]?.finish_reason === 'length') {
                throw new Error('Response was truncated before completion')
              }
              const delta = event.choices?.[0]?.delta
              if (typeof delta?.content === 'string') {
                update((message) =>
                  applyStreamingChunk(message, 'content', delta.content)
                )
              }
              if (typeof delta?.reasoning_content === 'string') {
                update((message) =>
                  applyStreamingChunk(
                    message,
                    'reasoning',
                    delta.reasoning_content
                  )
                )
              }
              const usage = parseUsage(event.usage)
              if (usage) update((message) => ({ ...message, usage }))
            }
          }
          try {
            while (true) {
              const chunk = await reader.read()
              buffer += decoder
                .decode(chunk.value, { stream: !chunk.done })
                .replaceAll('\r\n', '\n')
              if (buffer.length > 4 * 1024 * 1024) {
                throw new Error('Stream event exceeds the size limit')
              }
              let boundary: number
              while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, boundary)
                buffer = buffer.slice(boundary + 2)
                consume(frame)
              }
              if (chunk.done) break
            }
            if (buffer.trim()) consume(buffer)
            if (!complete) {
              throw new Error('Connection closed before generation completed')
            }
            update(completeAssistantMessage)
          } finally {
            await reader.cancel().catch(() => {})
            reader.releaseLock()
          }
        }
      } catch (error) {
        if (abort.signal.aborted || current !== generation.current) return
        handleServerError(error)
        onMessageUpdate((previous) =>
          updateAssistantMessageWithError(
            previous,
            error instanceof Error ? error.message : 'Generation failed'
          )
        )
      } finally {
        if (current === generation.current) {
          setIsGenerating(false)
          controller.current = null
          setDebug({
            request: redactDebug(request),
            response: redactDebug(events),
            status: httpStatus,
            requestId,
            durationMs: Math.round(performance.now() - started),
          })
        }
      }
    },
    [config, parameterEnabled, onMessageUpdate]
  )
  return { sendChat, stopGeneration, isGenerating, debug }
}
