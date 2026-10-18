import { useCallback, useEffect, useRef, useState } from 'react'

import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import {
  blobDataURL,
  deleteSessionAssets,
  loadAsset,
  saveAsset,
} from '../lib/storage/assets'
import {
  type SessionEnvelope,
  type PlaygroundSession,
  loadSessions,
  newSession,
  parseSessions,
  saveSessions,
} from '../lib/storage/sessions'

async function persistEnvelope(
  envelope: SessionEnvelope,
  owner: number | undefined
): Promise<void> {
  const sessions: PlaygroundSession[] = []
  for (const session of envelope.sessions) {
    if (owner !== useAuthStore.getState().auth.user?.id) return
    const messages = []
    for (const message of session.messages) {
      const attachments = []
      for (const attachment of message.attachments ?? []) {
        if (
          attachment.data &&
          attachment.kind !== 'text' &&
          !attachment.blobId
        ) {
          const blob = await (await fetch(attachment.data)).blob()
          if (owner !== useAuthStore.getState().auth.user?.id) return
          await saveAsset(session.id, attachment.id, blob)
        }
        attachments.push(
          attachment.kind === 'text'
            ? attachment
            : { ...attachment, data: undefined, blobId: attachment.id }
        )
      }
      messages.push({ ...message, attachments })
    }
    sessions.push({ ...session, messages })
  }
  if (owner !== useAuthStore.getState().auth.user?.id) return
  saveSessions({ ...envelope, sessions })
}
async function hydrateSession(
  session: PlaygroundSession
): Promise<PlaygroundSession> {
  const messages = await Promise.all(
    session.messages.map(async (message) => ({
      ...message,
      attachments: await Promise.all(
        (message.attachments ?? []).map(async (attachment) => {
          if (!attachment.blobId || attachment.data) return attachment
          const blob = await loadAsset(session.id, attachment.blobId)
          return {
            ...attachment,
            data: blob ? await blobDataURL(blob) : undefined,
          }
        })
      ),
    }))
  )
  return { ...session, messages }
}
export function usePlaygroundSessions() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [envelope, setEnvelope] = useState<SessionEnvelope | null>(null)
  const [active, setActive] = useState<PlaygroundSession | null>(null)
  const latest = useRef(envelope)
  const queue = useRef(Promise.resolve())
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setEnvelope(null)
    setActive(null)
    if (userId == null) return
    try {
      const initial = loadSessions()
      latest.current = initial
      setEnvelope(initial)
      void hydrateSession(
        initial.sessions.find((item) => item.id === initial.activeId) ??
          initial.sessions[0]
      )
        .then((session) => {
          if (current === generation.current) setActive(session)
        })
        .catch(handleServerError)
    } catch (error) {
      handleServerError(error)
    }
    return () => {
      if (current === generation.current) generation.current = current + 1
    }
  }, [userId])
  const commit = useCallback((next: SessionEnvelope) => {
    latest.current = next
    setEnvelope(next)
    const owner = useAuthStore.getState().auth.user?.id
    const previous = queue.current
    const persistNext = async () => {
      await previous.catch(() => {})
      if (owner !== useAuthStore.getState().auth.user?.id) return
      await persistEnvelope(next, owner)
    }
    queue.current = persistNext().catch(handleServerError)
  }, [])
  const update = useCallback(
    (session: PlaygroundSession) => {
      const current = latest.current
      if (!current || current.activeId !== session.id) return
      commit({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === session.id ? session : item
        ),
      })
    },
    [commit]
  )
  const select = useCallback(
    async (id: string) => {
      const current = latest.current
      const session = current?.sessions.find((item) => item.id === id)
      if (!current || !session) return
      const selected = ++generation.current
      setActive(null)
      const hydrated = await hydrateSession(session)
      if (selected !== generation.current) return
      commit({ ...current, activeId: id })
      setActive(hydrated)
    },
    [commit]
  )
  const create = useCallback(() => {
    const current = latest.current
    if (!current) return
    if (current.sessions.length >= 50) {
      throw new Error('Conversation limit reached')
    }
    const session = newSession()
    generation.current++
    commit({
      ...current,
      activeId: session.id,
      sessions: [session, ...current.sessions],
    })
    setActive(session)
  }, [commit])
  const remove = useCallback(
    async (id: string) => {
      const current = latest.current
      if (!current) return
      const sessions = current.sessions.filter((item) => item.id !== id)
      if (!sessions.length) sessions.push(newSession())
      const activeId =
        current.activeId === id ? sessions[0].id : current.activeId
      generation.current++
      setActive(null)
      const hydrated = await hydrateSession(
        sessions.find((item) => item.id === activeId) ?? sessions[0]
      )
      commit({ ...current, activeId, sessions })
      setActive(hydrated)
      await queue.current
      await deleteSessionAssets(id)
    },
    [commit]
  )
  const rename = useCallback(
    (id: string, title: string) => {
      const current = latest.current
      if (current) {
        setActive((previous) =>
          previous?.id === id
            ? { ...previous, title: title.trim().slice(0, 100) }
            : previous
        )
        commit({
          ...current,
          sessions: current.sessions.map((item) =>
            item.id === id
              ? { ...item, title: title.trim().slice(0, 100) }
              : item
          ),
        })
      }
    },
    [commit]
  )
  const importJSON = useCallback(
    (raw: string) => {
      const imported = parseSessions(raw, 32 * 1024 * 1024)
      // Imports never reuse foreign blob references or task identities.
      for (const session of imported.sessions) {
        if (
          session.messages.some((message) =>
            message.attachments?.some((file) => !file.data)
          )
        ) {
          throw new Error('Import contains missing attachments')
        }
        session.id = crypto.randomUUID()
        session.messages = session.messages.map((message) => ({
          ...message,
          attachments: message.attachments?.map((file) => ({
            ...file,
            id: crypto.randomUUID(),
            blobId: undefined,
          })),
        }))
        session.media = session.media.map((record) => ({
          ...record,
          taskId: undefined,
          status: 'imported',
          assets: record.assets
            .filter((asset) => asset.url)
            .map((asset) => ({ ...asset, blobId: undefined })),
        }))
      }
      const current = latest.current
      if (!current) return
      if (current.sessions.length + imported.sessions.length > 50) {
        throw new Error('Conversation limit reached')
      }
      imported.activeId = imported.sessions[0].id
      imported.sessions.push(...current.sessions)
      generation.current++
      commit(imported)
      setActive(imported.sessions[0])
    },
    [commit]
  )
  return {
    envelope,
    active,
    update,
    select,
    create,
    remove,
    rename,
    importJSON,
  }
}
