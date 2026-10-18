import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { builtinCommit } from '../lib/reference-version'

const bank = readFileSync('public/fingerprint/bank.json', 'utf8')
const detector = readFileSync('public/fingerprint/detector.bin')
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})
describe('fingerprint worker reference loading', () => {
  it('retries a failed manifest then binds both files to the same commit', async () => {
    const postMessage = vi.fn()
    const scope = { postMessage, onmessage: undefined as unknown }
    vi.stubGlobal('self', scope)
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ commit: builtinCommit, files: {} }))
      )
      .mockResolvedValueOnce(new Response(bank))
      .mockResolvedValueOnce(new Response(detector))
    vi.stubGlobal('fetch', fetcher)
    await import('../analysis.worker')
    const receive = scope.onmessage as (event: {
      data: { id: number }
    }) => Promise<void>
    await receive({ data: { id: 1 } })
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 1,
        error: expect.stringContaining('status unavailable'),
      })
    )
    await receive({ data: { id: 2 } })
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 2,
        reference: expect.objectContaining({
          models: 60,
          version: expect.objectContaining({ commit: builtinCommit }),
        }),
      })
    )
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      '/api/fingerprint/reference/status',
      '/api/fingerprint/reference/status',
      `/api/fingerprint/reference/${builtinCommit}/bank.json`,
      `/api/fingerprint/reference/${builtinCommit}/detector.bin`,
    ])
  })
})
