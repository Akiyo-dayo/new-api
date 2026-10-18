import type {
  Message,
  ParameterEnabled,
  PlaygroundConfig,
  PlaygroundUsage,
} from '../../types'
import { buildChatCompletionPayload } from './payload-builder'

export function buildResponsesPayload(
  messages: Message[],
  config: PlaygroundConfig,
  enabled: ParameterEnabled
): Record<string, unknown> {
  const input = messages
    .filter(
      (message) => message.from !== 'assistant' || message.versions[0].content
    )
    .map((message) => {
      const content: Record<string, unknown>[] = []
      const text = message.versions[0].content
      if (text) {
        content.push({
          type: message.from === 'assistant' ? 'output_text' : 'input_text',
          text,
        })
      }
      for (const file of message.attachments ?? []) {
        if (!file.data) {
          throw new Error(
            'Attachment is unavailable. Remove it or attach it again.'
          )
        }
        if (file.kind === 'image') {
          content.push({ type: 'input_image', image_url: file.data })
        } else if (file.kind === 'pdf') {
          content.push({
            type: 'input_file',
            filename: file.name,
            file_data: file.data,
          })
        } else {
          content.push({
            type: 'input_text',
            text: `[${file.name}]\n${file.data}`,
          })
        }
      }
      return { role: message.from, content }
    })
  const payload: Record<string, unknown> = {
    model: config.model,
    group: config.group,
    input,
    stream: config.stream,
    store: false,
  }
  if (config.systemPrompt) payload.instructions = config.systemPrompt
  if (config.reasoningEffort) {
    payload.reasoning = { effort: config.reasoningEffort }
  }
  if (config.webSearch) payload.tools = [{ type: 'web_search' }]
  if (enabled.max_tokens) payload.max_output_tokens = config.max_tokens
  if (enabled.temperature) payload.temperature = config.temperature
  if (enabled.top_p) payload.top_p = config.top_p
  return payload
}
export function buildPlaygroundPayload(
  messages: Message[],
  config: PlaygroundConfig,
  enabled: ParameterEnabled
) {
  if (config.webSearch && config.protocol !== 'responses') {
    throw new Error('Web search requires the Responses protocol')
  }
  return config.protocol === 'responses'
    ? buildResponsesPayload(messages, config, enabled)
    : buildChatCompletionPayload(messages, config, enabled)
}
export function parseUsage(value: unknown): PlaygroundUsage | undefined {
  if (!value || typeof value !== 'object') return
  const usage = value as Record<string, unknown>
  const input = usage.input_tokens ?? usage.prompt_tokens
  const output = usage.output_tokens ?? usage.completion_tokens
  if (
    typeof input !== 'number' ||
    typeof output !== 'number' ||
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  ) {
    return
  }
  return {
    input,
    output,
    total:
      typeof usage.total_tokens === 'number'
        ? usage.total_tokens
        : input + output,
  }
}
export function parseResponsesResult(value: Record<string, unknown>): {
  text: string
  reasoning: string
  sources: { href: string; title: string }[]
  usage?: PlaygroundUsage
} {
  let text = ''
  let reasoning = ''
  const sources: { href: string; title: string }[] = []
  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      if (!item || typeof item !== 'object') continue
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (typeof part.text === 'string') text += part.text
          if (Array.isArray(part.annotations)) {
            for (const citation of part.annotations) {
              if (
                citation.type === 'url_citation' &&
                typeof citation.url === 'string' &&
                /^https?:\/\//.test(citation.url)
              ) {
                sources.push({
                  href: citation.url,
                  title: String(citation.title ?? citation.url),
                })
              }
            }
          }
        }
      }
      if (item.type === 'reasoning' && Array.isArray(item.summary)) {
        reasoning += item.summary
          .map((part: { text?: string }) => part.text ?? '')
          .join('')
      }
    }
  }
  return { text, reasoning, sources, usage: parseUsage(value.usage) }
}
export function redactDebug(value: unknown): unknown {
  const raw = JSON.stringify(value, (key, item: unknown) => {
    if (/authorization|api[_-]?key|cookie|token_key/i.test(key)) {
      return '[redacted]'
    }
    if (typeof item === 'string' && item.startsWith('data:')) {
      return `${item.slice(0, item.indexOf(',') + 1)}[attachment omitted]`
    }
    if (typeof item === 'string' && item.length > 12_000) {
      return `${item.slice(0, 12_000)}\n[truncated]`
    }
    return item
  })
  if (!raw) return null
  if (raw.length > 250_000) return '[response exceeds debug limit]'
  return JSON.parse(raw) as unknown
}
