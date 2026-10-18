import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import {
  loadSessions,
  newSession,
  parseSessions,
  saveSessions,
} from '../sessions'
import { saveMessages } from '../storage'

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'one', role: 1 })
})
afterEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})
describe('conversation storage', () => {
  it('migrates the signed-in account messages without deleting the source', () => {
    saveMessages([
      {
        key: 'm',
        from: 'user',
        versions: [{ id: 'v', content: 'owned legacy conversation' }],
      },
    ])
    const envelope = loadSessions()
    expect(envelope.sessions[0].messages[0].versions[0].content).toBe(
      'owned legacy conversation'
    )
    saveSessions(envelope)
    expect(localStorage.getItem('playground_messages:1')).not.toBeNull()
    expect(loadSessions().activeId).toBe(envelope.activeId)
  })
  it('isolates multiple conversations between accounts', () => {
    const first = newSession()
    first.title = 'Private'
    saveSessions({
      version: 2,
      activeId: first.id,
      sessions: [first, newSession()],
    })
    useAuthStore.getState().auth.setUser({ id: 2, username: 'two', role: 1 })
    expect(loadSessions().sessions[0].title).toBe('')
    useAuthStore.getState().auth.setUser({ id: 1, username: 'one', role: 1 })
    expect(loadSessions().sessions).toHaveLength(2)
    expect(loadSessions().sessions[0].title).toBe('Private')
  })
  it('rejects duplicate IDs rather than merging unrelated conversations', () => {
    const session = newSession()
    expect(() =>
      parseSessions(
        JSON.stringify({
          version: 2,
          activeId: session.id,
          sessions: [session, session],
        })
      )
    ).toThrow('Invalid conversation identifiers')
  })
  it('rejects script-bearing image data in imported messages', () => {
    const session = newSession()
    session.messages = [
      {
        key: 'm',
        from: 'user',
        versions: [{ id: 'v', content: '' }],
        attachments: [
          {
            id: 'a',
            name: 'x',
            mime: 'image/svg+xml',
            size: 10,
            kind: 'image',
            data: 'data:image/svg+xml;base64,PHN2Zz4=',
          },
        ],
      },
    ]
    expect(() =>
      parseSessions(
        JSON.stringify({
          version: 2,
          activeId: session.id,
          sessions: [session],
        })
      )
    ).toThrow()
  })
  it('rejects unsafe remote media URLs and oversized envelopes', () => {
    const session = newSession()
    session.media = [
      {
        id: 'x',
        mode: 'image',
        prompt: '',
        model: 'image',
        createdAt: 1,
        assets: [{ id: 'a', mime: 'image/png', url: 'javascript:alert(1)' }],
      },
    ]
    expect(() =>
      parseSessions(
        JSON.stringify({
          version: 2,
          activeId: session.id,
          sessions: [session],
        })
      )
    ).toThrow()
    expect(() => parseSessions(' '.repeat(4 * 1024 * 1024 + 1))).toThrow(
      'Conversation import is too large'
    )
  })
})
