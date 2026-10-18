import { describe, expect, it, vi } from 'vitest'

import { parseProfile, safeError } from '../lib/connection'
import { complete, testApi } from '../vendor/detection'

const challenges = [1, 2, 3].map((i) => ({
  id: String(i),
  prompt: `prompt ${i}`,
  expected_count: 100,
}))
const text = Array.from({ length: 100 }, (_, i) => i + 1).join(', ')
const config = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'private-key',
  model: 'example',
  effort: 'default',
  format: 'openai' as const,
  parallel: true,
  stream: false,
}
const response = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )

describe('fingerprint upstream workflow', () => {
  it('keeps an empty-key site failure readable and still redacts nonempty credentials', async () => {
    const transport = vi
      .fn()
      .mockRejectedValue(new Error('Upstream DNS failed'))
    await expect(
      complete(
        { ...config, apiKey: '' },
        'prompt',
        '',
        undefined,
        undefined,
        transport
      )
    ).rejects.toThrow('Upstream DNS failed')
    transport.mockRejectedValue(new Error('Rejected private-key'))
    await expect(
      complete(config, 'prompt', '', undefined, undefined, transport)
    ).rejects.toThrow('Rejected [REDACTED]')
  })
  it('starts all three requests before any parallel answer resolves', async () => {
    const resolve: ((value: Response) => void)[] = []
    const transport = vi.fn(() => new Promise<Response>((r) => resolve.push(r)))
    const result = testApi(config, challenges, vi.fn(), undefined, transport)
    expect(transport).toHaveBeenCalledTimes(3)
    resolve.forEach((r) => r(response()))
    expect((await result).map((o) => o.text)).toEqual([text, text, text])
  })
  it('waits for each serial answer and retains other results after a failure', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('limited'))
      .mockResolvedValueOnce(response())
    const progress = vi.fn()
    const result = await testApi(
      { ...config, parallel: false },
      challenges,
      progress,
      undefined,
      transport
    )
    expect(result.map((o) => o.text)).toEqual([text, '', text])
    expect(progress.mock.calls.at(-1)?.[0].challenges[1].state).toBe('rejected')
  })
  it('redacts keys and rejects arbitrary profile objects', () => {
    expect(
      safeError(new Error('authorization: Bearer private-key'), config.apiKey)
    ).not.toContain('private-key')
    expect(() => parseProfile({ model: 1 })).toThrow()
    expect(
      parseProfile({
        model: 'm',
        baseUrl: 'https://example.com',
        format: 'unexpected',
      }).format
    ).toBe('openai')
  })
})
