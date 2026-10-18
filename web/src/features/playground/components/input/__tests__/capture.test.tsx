import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlaygroundCapture } from '../playground-capture'

afterEach(() => vi.unstubAllGlobals())
describe('capture permissions and cleanup', () => {
  it('stops camera tracks when the capture dialog unmounts', async () => {
    const stop = vi.fn()
    const stream = { getTracks: () => [{ stop }] }
    vi.stubGlobal('isSecureContext', true)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const close = vi.fn()
    const { unmount } = render(
      <PlaygroundCapture mode='camera' onClose={close} onCapture={vi.fn()} />
    )
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled()
    )
    unmount()
    expect(stop).toHaveBeenCalled()
  })
  it('closes cleanly after permission is denied without creating an attachment', async () => {
    vi.stubGlobal('isSecureContext', true)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
      },
    })
    const close = vi.fn()
    const capture = vi.fn()
    render(
      <PlaygroundCapture mode='camera' onClose={close} onCapture={capture} />
    )
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(capture).not.toHaveBeenCalled()
  })
})
