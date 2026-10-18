import { nanoid } from 'nanoid'
import { z } from 'zod'

import { useAuthStore } from '@/stores/auth-store'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import type {
  Message,
  PlaygroundConfig,
  ParameterEnabled,
  PlaygroundMode,
} from '../../types'
import { sanitizeMessagesOnLoad } from '../message/message-streaming-utils'
import { loadConfig, loadMessages, loadParameterEnabled } from './storage'
import {
  messagesSchema,
  playgroundConfigSchema,
  parameterEnabledSchema,
} from './storage-schema'

export interface MediaRecord {
  id: string
  mode: 'image' | 'audio' | 'video'
  model: string
  prompt: string
  createdAt: number
  taskId?: string
  status?: string
  text?: string
  assets: { id: string; mime: string; url?: string; blobId?: string }[]
}
export interface PlaygroundSession {
  id: string
  title: string
  updatedAt: number
  mode: PlaygroundMode
  messages: Message[]
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  media: MediaRecord[]
}
const safeURL = z
  .string()
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  })
const mediaSchema = z.object({
  id: z.string().max(128),
  mode: z.enum(['image', 'audio', 'video']),
  model: z.string().max(255),
  prompt: z.string().max(40_000),
  createdAt: z.number(),
  taskId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  status: z.string().max(64).optional(),
  text: z.string().max(120_000).optional(),
  assets: z
    .array(
      z.object({
        id: z.string().max(128),
        mime: z.string().max(128),
        url: safeURL.optional(),
        blobId: z.string().max(128).optional(),
      })
    )
    .max(16),
})
const sessionSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().max(100),
  updatedAt: z.number(),
  mode: z.enum(['chat', 'image', 'audio', 'video']),
  messages: messagesSchema.max(100),
  config: playgroundConfigSchema,
  parameterEnabled: parameterEnabledSchema,
  media: z.array(mediaSchema).max(100).default([]),
})
const envelopeSchema = z.object({
  version: z.literal(2),
  activeId: z.string(),
  sessions: z.array(sessionSchema).min(1).max(50),
})
export interface SessionEnvelope {
  version: 2
  activeId: string
  sessions: PlaygroundSession[]
}
export function newSession(): PlaygroundSession {
  return {
    id: nanoid(),
    title: '',
    updatedAt: Date.now(),
    mode: 'chat',
    messages: [],
    config: { ...DEFAULT_CONFIG },
    parameterEnabled: { ...DEFAULT_PARAMETER_ENABLED },
    media: [],
  }
}
export function sessionStorageKey(): string {
  const userId = useAuthStore.getState().auth.user?.id
  if (userId == null) throw new Error('A signed-in account is required')
  return `playground_sessions:${userId}`
}
export function parseSessions(
  raw: string,
  maxBytes = 4 * 1024 * 1024
): SessionEnvelope {
  if (raw.length > maxBytes) {
    throw new Error('Conversation import is too large')
  }
  const parsed = envelopeSchema.parse(JSON.parse(raw))
  const ids = new Set(parsed.sessions.map((item) => item.id))
  if (ids.size !== parsed.sessions.length || !ids.has(parsed.activeId)) {
    throw new Error('Invalid conversation identifiers')
  }
  return {
    ...parsed,
    sessions: parsed.sessions.map((item) => ({
      ...item,
      messages: sanitizeMessagesOnLoad(item.messages),
      config: { ...DEFAULT_CONFIG, ...item.config },
      parameterEnabled: {
        ...DEFAULT_PARAMETER_ENABLED,
        ...item.parameterEnabled,
      },
    })),
  }
}
export function loadSessions(): SessionEnvelope {
  const saved = localStorage.getItem(sessionStorageKey())
  if (saved) return parseSessions(saved)
  const initial = newSession()
  initial.messages = loadMessages() ?? []
  initial.config = { ...DEFAULT_CONFIG, ...loadConfig() }
  initial.parameterEnabled = {
    ...DEFAULT_PARAMETER_ENABLED,
    ...loadParameterEnabled(),
  }
  if (initial.messages.length) {
    initial.title = initial.messages[0].versions[0].content.slice(0, 60)
  }
  // Keep the owned legacy source until the new envelope is successfully written.
  return { version: 2, activeId: initial.id, sessions: [initial] }
}
export function saveSessions(value: SessionEnvelope): void {
  const raw = JSON.stringify(value)
  parseSessions(raw)
  localStorage.setItem(sessionStorageKey(), raw)
}
export function sessionMarkdown(session: PlaygroundSession): string {
  return `# ${session.title || 'Conversation'}\n\n${session.messages.map((message) => `## ${message.from}\n\n${message.versions[0].content}\n${(message.attachments ?? []).map((file) => `[Attachment: ${file.name}]`).join('\n')}`).join('\n\n')}`
}
