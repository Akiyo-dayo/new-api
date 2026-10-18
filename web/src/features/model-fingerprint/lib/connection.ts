import { api } from '@/lib/api'

import { sendsSpeed, SPEED_BETA } from '../vendor/completion-request'
import type { CompletionTransport } from '../vendor/detection'
import { redactPrivateMetadata } from '../vendor/privacy'
import type { ApiConfig } from '../vendor/types'
import { inspectionResponse } from './response'

export type Mode = 'site' | 'api' | 'manual'
export type Connection = 'auto' | 'direct' | 'site' | 'worker'
export interface Profile extends ApiConfig {
  id: string
  name: string
  autoVerify?: boolean
  tokenizerProbe?: boolean
}
export const initialProfile = (): Profile => ({
  id: crypto.randomUUID(),
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  effort: 'default',
  format: 'openai',
  serviceTier: 'default',
  stream: true,
  parallel: true,
  relaxed: false,
})

export function safeError(error: unknown, key = ''): string {
  const message = error instanceof Error ? error.message : String(error)
  return redactPrivateMetadata(
    (key ? message.replaceAll(key, '[REDACTED]') : message)
      .replaceAll(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replaceAll(/\bsk-[\w-]+/g, '[REDACTED]')
      .replaceAll(
        /((?:api[_-]?key|authorization|access_token|refresh_token)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
        '$1[REDACTED]'
      )
  )
}

export function parseProxyEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim())
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      return null
    }
    if (url.username || url.password || url.search || url.hash) return null
    return url.href
  } catch {
    return null
  }
}

export function transportFor(
  connection: Connection,
  proxy: string
): CompletionTransport {
  if (connection === 'auto') {
    let resolved: Promise<CompletionTransport> | undefined
    return async (url, config, body, signal) => {
      resolved ??= (async () => {
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          }
          if (config.format === 'anthropic') {
            headers['x-api-key'] = 'sk-cors-check'
            headers['anthropic-version'] = '2023-06-01'
            headers['anthropic-dangerous-direct-browser-access'] = 'true'
            if (sendsSpeed(config)) headers['anthropic-beta'] = SPEED_BETA
          } else headers.Authorization = 'Bearer sk-cors-check'
          await fetch(url, {
            method: 'POST',
            headers,
            body: '{}',
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
          })
          return transportFor('direct', proxy)
        } catch {
          return transportFor('site', proxy)
        }
      })()
      const transport = await resolved
      signal.throwIfAborted()
      return transport(url, config, body, signal)
    }
  }
  const relay =
    connection === 'site' ? '/api/fingerprint/proxy' : parseProxyEndpoint(proxy)
  return async (url, config, original, signal) => {
    const body = { ...original }
    if (config.format === 'responses') delete body.max_output_tokens
    if (config.format === 'openai') delete body.max_tokens
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: body.stream ? 'text/event-stream' : 'application/json',
    }
    if (connection === 'site') {
      const response = await api.post(
        '/api/fingerprint/proxy',
        { url, format: config.format, body, key: config.apiKey },
        {
          signal,
          adapter: 'fetch',
          responseType: 'stream',
          validateStatus: () => true,
          skipErrorHandler: true,
        } as Record<string, unknown>
      )
      return inspectionResponse(response)
    }
    if (connection !== 'direct') {
      if (!relay) throw new Error('Configure a valid proxy URL')
      headers.Authorization = `Bearer ${config.apiKey}`
      return fetch(relay, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url, format: config.format, body }),
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      })
    }
    if (config.format === 'anthropic') {
      headers['x-api-key'] = config.apiKey
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
      if (sendsSpeed(config)) headers['anthropic-beta'] = SPEED_BETA
    } else headers.Authorization = `Bearer ${config.apiKey}`
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
    }).catch((error) => {
      if (signal.aborted) throw error
      throw new Error(
        'Direct connection failed. Check the API address, network and CORS policy, or select a proxy.'
      )
    })
  }
}

export function downloadFile(name: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function readProfiles(): Profile[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem('model-fingerprint-profiles') ?? '[]'
    )
    if (!Array.isArray(saved)) return [initialProfile()]
    const profiles = saved.map(parseProfile)
    return profiles.length ? profiles : [initialProfile()]
  } catch {
    return [initialProfile()]
  }
}

export function parseProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid API profile')
  }
  const data = value as Record<string, unknown>
  if (typeof data.model !== 'string' || typeof data.baseUrl !== 'string') {
    throw new Error('Invalid API profile')
  }
  const profile = initialProfile()
  for (const field of [
    'name',
    'baseUrl',
    'apiKey',
    'model',
    'effort',
  ] as const) {
    if (typeof data[field] === 'string') profile[field] = data[field]
  }
  if (['openai', 'responses', 'anthropic'].includes(String(data.format))) {
    profile.format = data.format as ApiConfig['format']
  }
  if (
    ['flex', 'default', 'fast', 'ultrafast'].includes(String(data.serviceTier))
  ) {
    profile.serviceTier = data.serviceTier as ApiConfig['serviceTier']
  }
  for (const field of [
    'stream',
    'parallel',
    'relaxed',
    'autoVerify',
    'tokenizerProbe',
  ] as const) {
    if (typeof data[field] === 'boolean') profile[field] = data[field]
  }
  return profile
}
