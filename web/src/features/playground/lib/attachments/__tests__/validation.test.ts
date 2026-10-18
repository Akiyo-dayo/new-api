import { describe, expect, it, vi, afterEach } from 'vitest'

import { getInputControlState } from '../../input/input-control-utils'
import { prepareAttachments, MAX_ATTACHMENTS } from '../attachments'

afterEach(() => vi.unstubAllGlobals())
describe('attachment validation', () => {
  it('allows submitting only an image when a model is selected', () => {
    expect(
      getInputControlState({
        models: [{ label: 'model', value: 'model' }],
        groups: [{ label: 'group', value: 'group', ratio: 1 }],
        text: '',
        attachmentCount: 1,
        hasStopHandler: false,
      }).canSubmit
    ).toBe(true)
  })
  it('rejects unsupported binary files before sending to a model', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Blob(['binary'], { type: 'application/zip' }))
        )
    )
    await expect(
      prepareAttachments(
        {
          files: [
            {
              type: 'file',
              filename: 'archive.zip',
              mediaType: 'application/zip',
              url: 'data:application/zip;base64,YQ==',
            },
          ],
        },
        false
      )
    ).rejects.toThrow('Unsupported attachment format')
  })
  it('rejects too many attachments without loading their bytes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      prepareAttachments(
        {
          files: Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({
            type: 'file',
            filename: 'a.png',
            mediaType: 'image/png',
            url: 'data:image/png;base64,YQ==',
          })),
        },
        false
      )
    ).rejects.toThrow('Too many attachments')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('keeps a text filename and content for the actual request', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('hello', { headers: { 'Content-Type': 'text/plain' } })
        )
    )
    const files = await prepareAttachments(
      {
        files: [
          {
            type: 'file',
            filename: 'notes.txt',
            mediaType: 'text/plain',
            url: 'data:text/plain;base64,aGVsbG8=',
          },
        ],
      },
      false
    )
    expect(files[0]).toMatchObject({
      name: 'notes.txt',
      kind: 'text',
      data: 'hello',
    })
  })
})
