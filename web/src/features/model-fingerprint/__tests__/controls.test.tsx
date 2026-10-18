import { act, renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { initialProfile } from '../lib/connection'
import { useInspection } from '../use-inspection'

const analyze = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ results: [], diagnostics: [], used_outputs: 1 })
)
vi.mock('../use-fingerprint-analysis', () => ({
  useFingerprintAnalysis: () => ({ reference: { models: 60 }, analyze }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
const text = Array.from({ length: 400 }, (_, i) => (i % 999) + 1).join(', ')
const response = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
const settings = () => ({
  mode: 'api' as const,
  group: '',
  config: {
    ...initialProfile(),
    baseUrl: 'https://example.com',
    apiKey: 'test-key',
    model: 'm',
    stream: false,
  },
  connection: 'direct' as const,
  proxy: '',
  autoVerify: false,
  tokenizer: false,
})

describe('inspection controls', () => {
  it('runs all three in parallel and stops one without discarding the other answers', async () => {
    const resolvers: ((r: Response) => void)[] = []
    const fetcher = vi.fn(
      (_url, options: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          resolvers.push(resolve)
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useInspection(settings()))
    let job: Promise<void>
    act(() => {
      job = result.current.sample([0, 1, 2])
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    act(() => result.current.stop(1))
    await act(async () => {
      resolvers[0](response())
      resolvers[2](response())
      await job
    })
    expect(result.current.samples.map((s) => s.state)).toEqual([
      'done',
      'stopped',
      'done',
    ])
  })
  it('manual editing and analysis never calls a model API', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() =>
      useInspection({ ...settings(), mode: 'manual' })
    )
    act(() => result.current.edit(0, text))
    await act(async () => {
      await result.current.verify()
    })
    expect(analyze).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ text })])
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('a failed resample retains the previous accepted text', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('limited'))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useInspection(settings()))
    await act(async () => {
      await result.current.sample([0])
    })
    await waitFor(() => expect(result.current.samples[0].state).toBe('done'))
    await act(async () => {
      await result.current.sample([0])
    })
    expect(result.current.samples[0].state).toBe('rejected')
    expect(result.current.samples[0].text).toBe(text)
  })
})
