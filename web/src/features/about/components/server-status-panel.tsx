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
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Clock3, Globe, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

/** Round-trip time of a fresh /api/status call — a cheap public latency probe. */
function useServerPing() {
  return useQuery({
    queryKey: ['server-ping'],
    queryFn: async () => {
      const started = performance.now()
      const res = await fetch('/api/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`status probe failed: ${res.status}`)
      return Math.round(performance.now() - started)
    },
    refetchInterval: 30_000,
    retry: 1,
  })
}

/** Seconds elapsed since the backend's public start_time, ticking every second. */
function useUptimeSeconds(startTime?: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!startTime || startTime <= 0) return undefined
  return Math.max(0, Math.floor(now / 1000 - startTime))
}

function pad2(value: number) {
  return value.toString().padStart(2, '0')
}

function formatUptime(totalSeconds: number, daysLabel: string) {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  return days > 0 ? `${days}${daysLabel} ${clock}` : clock
}

function MetricTile(props: {
  icon: React.ReactNode
  label: string
  value: string
  delay: number
}) {
  return (
    <div
      className='landing-animate-fade-up border-border/50 bg-background/40 rounded-xl border px-4 py-3.5 opacity-0 backdrop-blur-sm'
      style={{ animationDelay: `${props.delay}ms` }}
    >
      <div className='text-muted-foreground/70 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.12em] uppercase'>
        {props.icon}
        {props.label}
      </div>
      <div className='mt-1.5 truncate text-lg font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

/**
 * Chisa-themed server status panel. Data comes exclusively from the public
 * /api/status payload (start_time / version / system_name) plus a client-side
 * latency probe — no privileged endpoints involved.
 */
export function ServerStatusPanel() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const pingQuery = useServerPing()

  const systemName =
    (status?.system_name as string | undefined) || 'New API'
  const version = (status?.version as string | undefined) || '—'
  const startTime = (status as Record<string, unknown> | null)
    ?.start_time as number | undefined
  const uptimeSeconds = useUptimeSeconds(startTime)

  const online = pingQuery.isSuccess
  const pingMs = pingQuery.data

  return (
    <section
      className='landing-animate-fade-up border-border/60 bg-card/70 relative overflow-hidden rounded-2xl border shadow-[0_18px_50px_-24px_oklch(0.55_0.22_15/35%)] backdrop-blur-sm'
      style={{ animationDelay: '120ms' }}
    >
      {/* Crimson hairline across the top of the card */}
      <div
        aria-hidden
        className='absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#e8234a] via-[#ff6b4a] to-[#e8a54b]'
      />

      <div className='p-5 sm:p-7'>
        {/* Status headline */}
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <span className='relative flex size-3'>
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${online ? 'bg-emerald-400' : 'bg-rose-400'}`}
              />
              <span
                className={`relative inline-flex size-3 rounded-full ${online ? 'bg-emerald-500' : 'bg-rose-500'}`}
              />
            </span>
            <div>
              <h2 className='text-lg leading-tight font-bold sm:text-xl'>
                {online ? t('All systems operational') : t('Status')}
              </h2>
              <p className='text-muted-foreground/80 mt-0.5 text-xs sm:text-sm'>
                {systemName} · {t('US Node')}
              </p>
            </div>
          </div>
          <div className='text-muted-foreground/60 text-right text-[11px] tracking-[0.18em] uppercase'>
            Chisa · 朽叶千咲
          </div>
        </div>

        {/* Metric tiles */}
        <div className='mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4'>
          <MetricTile
            icon={<Activity className='size-3.5' />}
            label={t('Latency')}
            value={pingMs != null ? `${pingMs} ms` : '—'}
            delay={180}
          />
          <MetricTile
            icon={<Clock3 className='size-3.5' />}
            label={t('Uptime')}
            value={
              uptimeSeconds != null
                ? formatUptime(uptimeSeconds, t('days suffix'))
                : '—'
            }
            delay={240}
          />
          <MetricTile
            icon={<Tag className='size-3.5' />}
            label={t('Version')}
            value={version}
            delay={300}
          />
          <MetricTile
            icon={<Globe className='size-3.5' />}
            label={t('Node')}
            value={t('US Node')}
            delay={360}
          />
        </div>

        <p className='text-muted-foreground/50 mt-4 text-[11px] tracking-wide'>
          {t('Refreshes every 30 seconds · public metrics only')}
        </p>
      </div>
    </section>
  )
}
