import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG } from '../../../constants'
import { PlaygroundMedia } from '../playground-media'

vi.mock('@/features/pricing/api', () => ({
  getPricing: async () => ({ success: true, data: [] }),
}))
vi.mock('@/lib/api', () => ({
  getFreshAuthHeaders: async () => ({
    Authorization: 'Bearer local-test',
    'Content-Type': 'application/json',
  }),
}))
vi.mock('../../../lib/storage/assets', () => ({
  saveAsset: vi.fn(),
  loadAsset: vi.fn(),
}))
function show(mode: 'image' | 'audio' | 'video') {
  const onRecordsChange = vi.fn()
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={query}>
      <PlaygroundMedia
        sessionId='session'
        mode={mode}
        config={{ ...DEFAULT_CONFIG, model: 'test' }}
        models={[{ value: 'test', label: 'test' }]}
        groups={[{ value: 'default', label: 'default', ratio: 1 }]}
        records={[]}
        onRecordsChange={onRecordsChange}
        onModelChange={vi.fn()}
        onGroupChange={vi.fn()}
      />
    </QueryClientProvider>
  )
  return onRecordsChange
}
beforeEach(() => {
  vi.unstubAllGlobals()
})
describe('media workbench request contracts', () => {
  it('submits a bounded image request and saves its returned asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (path: string) =>
          path.startsWith('data:')
            ? new Response(new Blob(['image'], { type: 'image/png' }))
            : new Response(
                JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }),
                { headers: { 'Content-Type': 'application/json' } }
              )
        )
    )
    const onRecords = show('image')
    fireEvent.change(screen.getByLabelText('Prompt / text'), {
      target: { value: 'fixture image' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }))
    await waitFor(() => expect(onRecords).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith(
      '/pg/images/generations',
      expect.objectContaining({ body: expect.stringContaining('"n":1') })
    )
    expect(onRecords.mock.calls[0][0][0].assets).toHaveLength(1)
  })
  it('submits transcription as multipart and preserves the returned text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ text: 'transcribed text' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )
    const onRecords = show('audio')
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe audio' }))
    fireEvent.change(screen.getByLabelText('Input file'), {
      target: {
        files: [new File(['audio'], 'voice.wav', { type: 'audio/wav' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }))
    await waitFor(() => expect(onRecords).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith(
      '/pg/audio/transcriptions',
      expect.objectContaining({ body: expect.any(FormData) })
    )
    expect(onRecords.mock.calls[0][0][0].text).toBe('transcribed text')
  })
  it('persists the returned video task identity for later polling', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ id: 'task_fixture', status: 'queued' }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        )
    )
    const onRecords = show('video')
    fireEvent.change(screen.getByLabelText('Prompt / text'), {
      target: { value: 'fixture video' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }))
    await waitFor(() => expect(onRecords).toHaveBeenCalledOnce())
    expect(onRecords.mock.calls[0][0][0]).toMatchObject({
      taskId: 'task_fixture',
      status: 'queued',
    })
  })
})
