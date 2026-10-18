import { sendChatCompletion } from '@/features/playground/api'

import type { Challenge } from '../vendor/challenge-browser'
import { parseNumbers } from '../vendor/fingerprint-core'
import type { Output } from '../vendor/types'

export type Sample = {
  status: 'pending' | 'requesting' | 'done' | 'insufficient' | 'failed'
  text: string
  count: number
  error?: string
}

type RequestSample = (
  model: string,
  group: string,
  prompt: string,
  signal: AbortSignal
) => Promise<string>

export const requestSample: RequestSample = async (
  model,
  group,
  prompt,
  signal
) => {
  const response = await sendChatCompletion(
    {
      model,
      group,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    },
    AbortSignal.any([signal, AbortSignal.timeout(250_000)])
  )
  const text = response.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('No text returned by the model')
  }
  return text
}

export async function collectSamples(
  challenges: Challenge[],
  model: string,
  group: string,
  signal: AbortSignal,
  onUpdate: (index: number, sample: Sample) => void,
  request: RequestSample = requestSample
): Promise<Output[]> {
  const outputs = challenges.map((c) => ({
    text: '',
    expected_count: c.expected_count,
  }))
  for (const [index, challenge] of challenges.entries()) {
    signal.throwIfAborted()
    onUpdate(index, { status: 'requesting', text: '', count: 0 })
    try {
      const text = await request(model, group, challenge.prompt, signal)
      signal.throwIfAborted()
      const count = parseNumbers(text).length
      outputs[index].text = text
      onUpdate(index, {
        text,
        count,
        status:
          count >= Math.max(80, Math.ceil(challenge.expected_count * 0.55))
            ? 'done'
            : 'insufficient',
      })
    } catch (error) {
      signal.throwIfAborted()
      onUpdate(index, {
        status: 'failed',
        text: '',
        count: 0,
        error: error instanceof Error ? error.message : 'Request failed',
      })
    }
  }
  return outputs
}
