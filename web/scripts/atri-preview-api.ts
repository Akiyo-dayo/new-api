/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { IncomingMessage, ServerResponse } from 'node:http'

const SESSION_COOKIE = 'new_api_has_session=1; Path=/; SameSite=Lax'
const EMPTY_SESSION_COOKIE =
  'new_api_has_session=; Path=/; Max-Age=0; SameSite=Lax'

function payload(data: unknown) {
  return { success: true, message: '', data }
}

function sendJson(
  res: ServerResponse,
  data: unknown,
  status = 200,
  cookie?: string
): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (cookie) res.setHeader('Set-Cookie', cookie)
  res.end(JSON.stringify(data))
}

async function readJson(
  req: IncomingMessage
): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 64 * 1024) throw new Error('Preview request is too large')
  }
  return body ? JSON.parse(body) : {}
}

function createUser(username: string) {
  return {
    id: 1,
    username,
    display_name: 'ATRI Local Preview',
    role: 100,
    status: 1,
    group: 'default',
    quota: 5000000,
    used_quota: 1250000,
    request_count: 42,
    permissions: { sidebar_settings: true },
  }
}

function createBundle(username: string) {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: 'atri-local-preview-token',
    token_type: 'Bearer',
    access_expires_at: now + 3600,
    user: createUser(username),
    session: {
      sid: 'atri-local-preview-session',
      current: true,
      login_method: 'mock',
      ip: '127.0.0.1',
      user_agent: 'ATRI local preview',
      created_at: now,
      last_active_at: now,
      expires_at: now + 86400,
    },
  }
}

const status = {
  system_name: 'ATRI · My Dear Moments',
  logo: '',
  version: 'atri-local-preview',
  price: 1,
  quota_per_unit: 500000,
  usd_exchange_rate: 7.2,
  display_in_currency: true,
  default_theme_preset: 'atri',
  password_login_enabled: true,
  password_login_encryption_enabled: false,
  announcements_enabled: false,
  uptime_kuma_enabled: false,
  faq_enabled: false,
  api_info_enabled: false,
  HeaderNavModules: JSON.stringify({
    home: true,
    console: true,
    pricing: { enabled: true, requireAuth: false },
    rankings: { enabled: true, requireAuth: false },
    docs: false,
    about: true,
  }),
}

const node = {
  uuid: 'atri-local-node',
  name: 'Shiosai Observatory',
  cpu_name: 'Local Preview CPU',
  virtualization: 'KVM',
  arch: 'x86_64',
  cpu_cores: 8,
  os: 'Ubuntu 26.04',
  kernel_version: 'local',
  region: 'JP',
  mem_total: 8589934592,
  disk_total: 107374182400,
  price: -1,
  billing_cycle: -1,
  auto_renewal: true,
  currency: '$',
  expired_at: '',
  tags: 'ATRI<cyan>;Local Preview<teal>',
  hidden: false,
  traffic_limit: 1099511627776,
}

function createNodeSample() {
  return {
    uuid: node.uuid,
    cpu: { usage: 23.5 },
    ram: { total: 8589934592, used: 3221225472 },
    swap: { total: 0, used: 0 },
    load: { load1: 0.4, load5: 0.3, load15: 0.2 },
    disk: { total: 107374182400, used: 53687091200 },
    network: {
      up: 102400,
      down: 204800,
      totalUp: 10737418240,
      totalDown: 53687091200,
    },
    connections: { tcp: 24, udp: 6 },
    uptime: 1500421,
    process: 128,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Development-only API used by the ATRI visual preview. It deliberately accepts
 * any non-empty login and never forwards credentials to another host.
 */
export function createAtriPreviewMiddleware() {
  let username = 'local-preview'

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/komari-api/')) {
      next()
      return
    }

    try {
      if (pathname === '/api/status') {
        sendJson(res, payload(status))
        return
      }
      if (pathname === '/api/setup') {
        sendJson(res, payload({ status: true }))
        return
      }
      if (pathname === '/api/user/login' && req.method === 'POST') {
        const body = await readJson(req)
        username =
          typeof body.username === 'string' && body.username.trim()
            ? body.username.trim().slice(0, 64)
            : 'local-preview'
        sendJson(res, payload(createBundle(username)), 200, SESSION_COOKIE)
        return
      }
      if (pathname === '/api/user/auth/refresh') {
        if (req.headers.cookie?.includes('new_api_has_session=1')) {
          sendJson(res, payload(createBundle(username)))
        } else {
          sendJson(
            res,
            { success: false, message: 'Anonymous local preview', data: null },
            401
          )
        }
        return
      }
      if (pathname === '/api/user/auth/logout') {
        sendJson(res, payload(null), 200, EMPTY_SESSION_COOKIE)
        return
      }
      if (pathname === '/api/user/self' && req.method === 'GET') {
        sendJson(res, payload(createUser(username)))
        return
      }
      if (pathname === '/api/user/models') {
        sendJson(res, payload(['atri-ocean-preview']))
        return
      }
      if (pathname === '/api/user/self/groups') {
        sendJson(res, payload({ default: { desc: 'Default', ratio: 1 } }))
        return
      }
      if (pathname === '/api/token/') {
        sendJson(res, payload({ items: [], total: 0, page: 1, page_size: 10 }))
        return
      }
      if (pathname === '/api/data/self' || pathname === '/api/data') {
        sendJson(res, payload([]))
        return
      }
      if (pathname === '/api/perf-metrics/summary') {
        sendJson(
          res,
          payload({
            summary: {
              avg_latency_ms: 640,
              success_rate: 99.9,
              avg_tps: 38.2,
            },
            models: [],
          })
        )
        return
      }
      if (pathname === '/api/pricing') {
        sendJson(
          res,
          payload({
            data: [],
            vendors: [],
            group_ratio: { default: 1 },
            usable_group: { default: 'Default' },
            supported_endpoint: {},
            auto_groups: [],
            group_display: { groups: [], categories: [] },
            model_stats: {},
            rate_limit: {
              enabled: false,
              duration_minutes: 0,
              groups: [],
            },
          })
        )
        return
      }
      if (pathname === '/api/rankings') {
        sendJson(
          res,
          payload({
            models: [],
            vendors: [],
            top_movers: [],
            top_droppers: [],
            models_history: { points: [], models: [], buckets: 0 },
            vendor_share_history: { points: [], vendors: [], buckets: 0 },
          })
        )
        return
      }
      if (
        pathname === '/api/about' ||
        pathname === '/api/notice' ||
        pathname === '/api/home_page_content'
      ) {
        sendJson(res, payload(''))
        return
      }
      if (pathname === '/api/uptime/status') {
        sendJson(res, payload([]))
        return
      }
      if (pathname === '/komari-api/nodes') {
        sendJson(res, { data: [node] })
        return
      }
      if (pathname.startsWith('/komari-api/')) {
        sendJson(res, { data: [createNodeSample()] })
        return
      }

      // Keep unrelated panels usable without pretending to persist real data.
      sendJson(res, payload({}))
    } catch {
      sendJson(
        res,
        {
          success: false,
          message: 'Invalid local preview request',
          data: null,
        },
        400
      )
    }
  }
}
