import { describe, expect, it, vi } from 'vitest'

import { collectSamples } from '../lib/collect'

const challenges = [1, 2, 3].map((i) => ({
  id: String(i),
  prompt: `challenge ${i}`,
  expected_count: 300,
}))
const text = Array.from({ length: 300 }, (_, i) => String(i + 1)).join(', ')

describe('fingerprint collection', () => {
  it('collects three sequential answers using the selected group and model', async () => {
    const request = vi.fn().mockResolvedValue(text)
    const update = vi.fn()
    const outputs = await collectSamples(
      challenges,
      'test-model',
      'vip',
      new AbortController().signal,
      update,
      request
    )
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[0].slice(0, 3)).toEqual([
      'test-model',
      'vip',
      'challenge 1',
    ])
    expect(outputs.map((o) => o.text)).toEqual([text, text, text])
    expect(update).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({ status: 'done', count: 300 })
    )
  })

  it('does not send further requests after cancellation', async () => {
    const controller = new AbortController()
    const request = vi.fn().mockImplementation(async () => {
      controller.abort()
      return text
    })
    await expect(
      collectSamples(challenges, 'm', 'g', controller.signal, vi.fn(), request)
    ).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retains valid answers and marks an insufficient answer without retrying', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(text)
      .mockResolvedValueOnce('1 2 3')
      .mockRejectedValueOnce(new Error('HTTP 429'))
    const update = vi.fn()
    const outputs = await collectSamples(
      challenges,
      'm',
      'g',
      new AbortController().signal,
      update,
      request
    )
    expect(outputs[0].text).toBe(text)
    expect(update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'insufficient', count: 3 })
    )
    expect(update).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ status: 'failed', error: 'HTTP 429' })
    )
    expect(request).toHaveBeenCalledTimes(3)
  })
})
