import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { newSession, saveSessions } from '../../lib/storage/sessions'
import { usePlaygroundSessions } from '../use-playground-sessions'

vi.mock('../../lib/storage/assets', () => ({
  loadAsset: vi.fn(),
  saveAsset: vi.fn(),
  deleteSessionAssets: vi.fn(),
  blobDataURL: vi.fn(),
}))
beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'one', role: 1 })
})
afterEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})
describe('conversation management', () => {
  it('keeps messages when switching between sessions and returning', async () => {
    const first = newSession()
    first.title = 'First'
    const second = newSession()
    second.title = 'Second'
    saveSessions({ version: 2, activeId: first.id, sessions: [first, second] })
    const { result } = renderHook(usePlaygroundSessions)
    await waitFor(() => expect(result.current.active?.id).toBe(first.id))
    act(() =>
      result.current.update({
        ...first,
        messages: [
          {
            key: 'm',
            from: 'user',
            versions: [{ id: 'v', content: 'Saved message' }],
          },
        ],
      })
    )
    await act(async () => {
      await result.current.select(second.id)
    })
    await act(async () => {
      await result.current.select(first.id)
    })
    expect(result.current.active?.messages[0].versions[0].content).toBe(
      'Saved message'
    )
  })
  it('adds imported sessions without removing the existing history', async () => {
    const { result } = renderHook(usePlaygroundSessions)
    await waitFor(() => expect(result.current.active).not.toBeNull())
    const oldId = result.current.active?.id
    const imported = newSession()
    imported.title = 'Imported'
    act(() =>
      result.current.importJSON(
        JSON.stringify({
          version: 2,
          activeId: imported.id,
          sessions: [imported],
        })
      )
    )
    expect(result.current.envelope?.sessions).toHaveLength(2)
    expect(
      result.current.envelope?.sessions.some((session) => session.id === oldId)
    ).toBe(true)
    expect(result.current.active?.title).toBe('Imported')
  })
  it('switches the workspace identity on account changes', async () => {
    const { result } = renderHook(usePlaygroundSessions)
    await waitFor(() => expect(result.current.active).not.toBeNull())
    const firstId = result.current.active?.id
    act(() =>
      useAuthStore.getState().auth.setUser({ id: 2, username: 'two', role: 1 })
    )
    await waitFor(() => {
      expect(result.current.active).not.toBeNull()
      expect(result.current.active?.id).not.toBe(firstId)
    })
    expect(result.current.active?.messages).toEqual([])
  })
})
