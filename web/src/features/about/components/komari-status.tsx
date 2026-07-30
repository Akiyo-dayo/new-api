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
import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  Cpu,
  Database,
  Globe,
  HardDrive,
  MemoryStick,
  Monitor,
  Network,
  Timer,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ChisaAmbient } from '@/components/chisa-ambient'
import { PublicLayout } from '@/components/layout'

/* ------------------------------------------------------------------ types */

interface KomariNode {
  uuid: string
  name: string
  cpu_name: string
  virtualization: string
  arch: string
  cpu_cores: number
  os: string
  kernel_version: string
  region: string
  mem_total: number
  disk_total: number
  price: number
  billing_cycle: number
  auto_renewal: boolean
  currency: string
  expired_at: string
  tags: string
  hidden: boolean
  traffic_limit: number
}

interface KomariRecent {
  uuid: string
  cpu: { usage: number }
  ram: { total: number; used: number }
  swap: { total: number; used: number }
  load: { load1: number; load5: number; load15: number }
  disk: { total: number; used: number }
  network: { up: number; down: number; totalUp: number; totalDown: number }
  connections: { tcp: number; udp: number }
  uptime: number
  process: number
  updated_at: string
}

interface NodeLive {
  sample?: KomariRecent
  online: boolean
}

/* ---------------------------------------------------------------- helpers */

async function fetchKomari<T>(path: string): Promise<T> {
  const res = await fetch(`/komari-api${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`komari ${path}: ${res.status}`)
  const json = await res.json()
  return json.data as T
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(2)} ${units[unit]}`
}

function formatSpeed(bytesPerSec: number) {
  return `${formatBytes(bytesPerSec)}/s`
}

function pad2(value: number) {
  return value.toString().padStart(2, '0')
}

/** Panel-style uptime: "17 天 12 时 20 分 21 秒" / "3 时 4 分 5 秒" */
function formatUptime(totalSeconds: number, zh: boolean) {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  if (zh) {
    const hm = `${hours} 时 ${pad2(minutes)} 分 ${pad2(seconds)} 秒`
    return days > 0 ? `${days} 天 ${hm}` : hm
  }
  const hm = `${hours}h ${pad2(minutes)}m ${pad2(seconds)}s`
  return days > 0 ? `${days}d ${hm}` : hm
}

/** Raw days until expiry (may be negative); undefined when unset/invalid. */
function remainingDays(iso: string) {
  if (!iso) return undefined
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return undefined
  return Math.ceil((target - Date.now()) / 86400_000)
}

/**
 * Region may arrive as a two-letter code ("US") or as a regional-indicator
 * flag emoji ("🇺🇸"). Normalize to a two-letter code so we can render a flag
 * image — Windows browsers can't render flag emoji and show letters instead.
 */
function regionToCode(region: string): string | null {
  const t = region.trim()
  if (/^[A-Za-z]{2}$/.test(t)) return t.toLowerCase()
  const chars = [...t]
  if (
    chars.length === 2 &&
    chars.every((c) => {
      const cp = c.codePointAt(0) ?? 0
      return cp >= 0x1f1e6 && cp <= 0x1f1ff
    })
  ) {
    return chars
      .map((c) => String.fromCharCode((c.codePointAt(0) ?? 0) - 0x1f1e6 + 97))
      .join('')
  }
  return null
}

/** Flag image via flagcdn; falls back to raw region text for exotic values. */
function RegionFlag(props: { region: string }) {
  const code = regionToCode(props.region)
  if (code) {
    return (
      <img
        src={`https://flagcdn.com/w40/${code}.png`}
        alt={props.region}
        aria-hidden
        className='h-4 w-6 shrink-0 rounded-[2px] object-cover'
        loading='lazy'
      />
    )
  }
  return <span className='shrink-0 text-xl leading-none'>{props.region}</span>
}

function splitTags(tags: string) {
  return tags
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Latest sample wins, regardless of array order. */
function latestSample(list: KomariRecent[] | undefined) {
  if (!list || list.length === 0) return undefined
  return list.reduce((a, b) =>
    new Date(a.updated_at).getTime() >= new Date(b.updated_at).getTime()
      ? a
      : b
  )
}

/* ------------------------------------------------------ badge color system */

/**
 * Square-ish, color-coded badges — mirrors the panel's PriceTags exactly:
 * same Radix color rotation for custom tags, same `<color>` suffix parsing.
 * Class names must stay literal so Tailwind doesn't purge them.
 */
const BADGE_STYLES = {
  violet:
    'border-violet-500/30 bg-violet-500/10 text-violet-500 dark:text-violet-400',
  emerald:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400',
  amber:
    'border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-400',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-500 dark:text-sky-400',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400',
  neutral: 'border-border/70 bg-foreground/[0.03] text-muted-foreground/80',
  red: 'border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-400',
  gray: 'border-gray-500/30 bg-gray-500/10 text-gray-500 dark:text-gray-400',
  orange:
    'border-orange-500/30 bg-orange-500/10 text-orange-500 dark:text-orange-400',
  yellow:
    'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  pink: 'border-pink-500/30 bg-pink-500/10 text-pink-500 dark:text-pink-400',
  purple:
    'border-purple-500/30 bg-purple-500/10 text-purple-500 dark:text-purple-400',
  indigo:
    'border-indigo-500/30 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400',
  blue: 'border-blue-500/30 bg-blue-500/10 text-blue-500 dark:text-blue-400',
  cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-500 dark:text-cyan-400',
  teal: 'border-teal-500/30 bg-teal-500/10 text-teal-500 dark:text-teal-400',
  green:
    'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  lime: 'border-lime-500/30 bg-lime-500/10 text-lime-600 dark:text-lime-400',
} as const

type BadgeTone = keyof typeof BADGE_STYLES

/** Radix palette name → our tone (panel's CustomTags color list). */
const RADIX_TONE_MAP: Record<string, BadgeTone> = {
  ruby: 'rose',
  gray: 'gray',
  gold: 'amber',
  bronze: 'orange',
  brown: 'orange',
  yellow: 'yellow',
  amber: 'amber',
  orange: 'orange',
  tomato: 'red',
  red: 'red',
  crimson: 'rose',
  pink: 'pink',
  plum: 'purple',
  purple: 'purple',
  violet: 'violet',
  iris: 'indigo',
  indigo: 'indigo',
  blue: 'blue',
  cyan: 'cyan',
  teal: 'teal',
  jade: 'emerald',
  green: 'green',
  grass: 'green',
  lime: 'lime',
  mint: 'emerald',
  sky: 'sky',
}

/** Same rotation order as the panel's CustomTags. */
const TAG_ROTATION: BadgeTone[] = [
  'rose',
  'gray',
  'amber',
  'orange',
  'orange',
  'yellow',
  'amber',
  'orange',
  'red',
  'red',
  'rose',
  'pink',
  'purple',
  'purple',
  'violet',
  'indigo',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'emerald',
  'green',
  'green',
  'lime',
  'emerald',
  'sky',
]

interface ParsedTag {
  text: string
  tone: BadgeTone | null
}

/** Panel-compatible: "星炬学院API<crimson>" pins a color, otherwise rotation. */
function parseTagWithColor(tag: string): ParsedTag {
  const m = tag.match(/<(\w+)>$/)
  if (m) {
    const tone = RADIX_TONE_MAP[m[1].toLowerCase()]
    if (tone) return { text: tag.replace(/<\w+>$/, ''), tone }
  }
  return { text: tag, tone: null }
}

/** Panel's billing_cycle (days) → suffix label. Special: -1 = 一次性. */
function billingCycleLabel(cycle: number, zh: boolean): string {
  if (cycle >= 27 && cycle <= 32) return zh ? '月' : 'mo'
  if (cycle >= 87 && cycle <= 95) return zh ? '季' : 'qtr'
  if (cycle >= 175 && cycle <= 185) return zh ? '半年' : 'half-yr'
  if (cycle >= 360 && cycle <= 370) return zh ? '年' : 'yr'
  if (cycle >= 720 && cycle <= 750) return zh ? '两年' : '2yr'
  if (cycle >= 1080 && cycle <= 1150) return zh ? '三年' : '3yr'
  if (cycle >= 1800 && cycle <= 1850) return zh ? '五年' : '5yr'
  if (cycle === -1) return zh ? '一次性' : 'once'
  return zh ? `${cycle} 天` : `${cycle}d`
}

function Badge(props: {
  tone: BadgeTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-px text-[11px] leading-5 font-semibold ${BADGE_STYLES[props.tone]} ${props.className ?? ''}`}
    >
      {props.children}
    </span>
  )
}

/* ------------------------------------------------------------- sub pieces */

function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className='text-right'>
      <div className='text-muted-foreground/60 flex items-center justify-end gap-1.5 text-[10px] font-semibold tracking-[0.28em] uppercase'>
        <span className='relative flex size-1.5'>
          <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-70' />
          <span className='relative inline-flex size-1.5 rounded-full bg-rose-500' />
        </span>
        Live
      </div>
      <div className='mt-1 text-2xl font-bold tabular-nums sm:text-3xl'>
        {pad2(now.getHours())}:{pad2(now.getMinutes())}:
        {pad2(now.getSeconds())}
      </div>
      <div className='text-muted-foreground/70 mt-0.5 text-xs tabular-nums'>
        {now.getFullYear()}-{pad2(now.getMonth() + 1)}-{pad2(now.getDate())}
      </div>
    </div>
  )
}

function OverviewStat(props: {
  label: string
  children: React.ReactNode
  delay: number
}) {
  return (
    <div
      className='landing-animate-fade-up opacity-0'
      style={{ animationDelay: `${props.delay}ms` }}
    >
      <div className='text-muted-foreground/60 text-[10px] font-semibold tracking-[0.24em] uppercase'>
        {props.label}
      </div>
      <div className='mt-1.5 text-lg font-bold tabular-nums sm:text-xl'>
        {props.children}
      </div>
    </div>
  )
}

/** Thin gradient meter — same slim bar as the panel. */
function Meter(props: { percent: number }) {
  const pct = Math.max(0, Math.min(100, props.percent))
  return (
    <div className='bg-foreground/8 mt-1.5 h-1 w-full overflow-hidden rounded-[2px]'>
      <div
        className='h-full rounded-[2px] bg-gradient-to-r from-[#e8234a] via-[#ff6b4a] to-[#e8a54b] transition-[width] duration-700 ease-out'
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** Label left (icon + text), value right — the panel's row rhythm. */
function Row(props: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <span className='text-muted-foreground/75 flex shrink-0 items-center gap-1.5 text-xs font-medium'>
        {props.icon}
        {props.label}
      </span>
      <span className='min-w-0 truncate text-right text-[13px] font-medium tabular-nums'>
        {props.children}
      </span>
    </div>
  )
}

/** Meter row: label + percent on top, slim bar below, optional sub-line. */
function MeterRow(props: {
  icon: React.ReactNode
  label: string
  percent: number
  sub?: React.ReactNode
}) {
  return (
    <div>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='text-muted-foreground/75 flex items-center gap-1.5 text-xs font-medium'>
          {props.icon}
          {props.label}
        </span>
        <span className='text-sm font-semibold tabular-nums'>
          {props.percent.toFixed(1)}%
        </span>
      </div>
      <Meter percent={props.percent} />
      {props.sub != null && (
        <div className='text-muted-foreground/60 mt-1 flex items-center justify-between gap-2 text-[11px] tabular-nums'>
          {props.sub}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- node card */

function NodeCard(props: { node: KomariNode; live: NodeLive; index: number }) {
  const { node, live } = props
  const { i18n } = useTranslation()
  const zh = i18n.language.toLowerCase().startsWith('zh')

  const { sample, online } = live

  const cpuPct = online ? (sample?.cpu.usage ?? 0) : 0
  const ramPct =
    online && sample ? (sample.ram.used / Math.max(1, sample.ram.total)) * 100 : 0
  const diskPct =
    online && sample
      ? (sample.disk.used / Math.max(1, sample.disk.total)) * 100
      : 0
  const trafficUsed = sample
    ? sample.network.totalUp + sample.network.totalDown
    : 0
  const hasLimit = node.traffic_limit > 0
  const trafficPct = hasLimit ? (trafficUsed / node.traffic_limit) * 100 : 0

  const remaining = remainingDays(node.expired_at)
  const tags = splitTags(node.tags).map(parseTagWithColor)
  // Panel rule: price == 0 → only custom tags; otherwise price + remaining + tags.
  const hasBadges = node.price !== 0 || tags.length > 0

  return (
    <article
      className={`landing-animate-fade-up border-border/60 bg-card/70 rounded-lg border shadow-[0_18px_50px_-24px_oklch(0.55_0.22_15/35%)] backdrop-blur-sm transition-opacity ${
        online ? '' : 'opacity-75'
      }`}
      style={{ animationDelay: `${260 + props.index * 100}ms` }}
    >
      <div className='p-4 sm:p-5'>
        {/* header: flag + name + status */}
        <div className='flex items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <RegionFlag region={node.region} />
            <h2 className='truncate text-[15px] font-bold'>{node.name}</h2>
          </div>
          <Badge tone={online ? 'emerald' : 'rose'} className='shrink-0'>
            <span className='relative flex size-1.5'>
              {online && (
                <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70' />
              )}
              <span
                className={`relative inline-flex size-1.5 rounded-full ${
                  online ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
            </span>
            {online ? (zh ? '在线' : 'Online') : zh ? '离线' : 'Offline'}
          </Badge>
        </div>

        <div className='border-border/50 mt-3 border-t' />

        {/* stats column */}
        <div className='mt-3 space-y-2.5'>
          <Row icon={<Monitor className='size-3.5' />} label='OS'>
            <span className='text-muted-foreground/90'>
              {node.os} / {node.arch}
            </span>
          </Row>

          <MeterRow
            icon={<Cpu className='size-3.5' />}
            label='CPU'
            percent={cpuPct}
          />
          <MeterRow
            icon={<MemoryStick className='size-3.5' />}
            label={zh ? '内存' : 'RAM'}
            percent={ramPct}
            sub={
              sample ? (
                <span>
                  ({formatBytes(sample.ram.used)} / {formatBytes(sample.ram.total)})
                </span>
              ) : (
                <span>—</span>
              )
            }
          />
          <MeterRow
            icon={<HardDrive className='size-3.5' />}
            label={zh ? '磁盘' : 'Disk'}
            percent={diskPct}
            sub={
              sample ? (
                <span>
                  ({formatBytes(sample.disk.used)} / {formatBytes(sample.disk.total)})
                </span>
              ) : (
                <span>—</span>
              )
            }
          />

          {hasLimit ? (
            <MeterRow
              icon={<Database className='size-3.5' />}
              label={zh ? '总流量' : 'Traffic'}
              percent={trafficPct}
              sub={
                <>
                  <span>
                    <span className='text-emerald-500'>↑</span>{' '}
                    {sample ? formatBytes(sample.network.totalUp) : '—'}{' '}
                    <span className='text-sky-500'>↓</span>{' '}
                    {sample ? formatBytes(sample.network.totalDown) : '—'}
                  </span>
                  <span>Max({formatBytes(node.traffic_limit)})</span>
                </>
              }
            />
          ) : (
            <Row icon={<Database className='size-3.5' />} label={zh ? '总流量' : 'Traffic'}>
              <span>
                <span className='text-emerald-500'>↑</span>{' '}
                {sample ? formatBytes(sample.network.totalUp) : '—'}{' '}
                <span className='text-sky-500'>↓</span>{' '}
                {sample ? formatBytes(sample.network.totalDown) : '—'}
              </span>
            </Row>
          )}

          <Row icon={<Network className='size-3.5' />} label={zh ? '网络' : 'Network'}>
            <span>
              <span className='text-emerald-500'>↑</span>{' '}
              {sample ? formatSpeed(sample.network.up) : '—'}{' '}
              <span className='text-sky-500'>↓</span>{' '}
              {sample ? formatSpeed(sample.network.down) : '—'}
            </span>
          </Row>

          <Row icon={<Timer className='size-3.5' />} label={zh ? '运行时间' : 'Uptime'}>
            {sample ? formatUptime(sample.uptime, zh) : '—'}
          </Row>
        </div>

        {/* bottom badges — panel PriceTags logic: price/cycle, remaining, custom tags */}
        {hasBadges && (
          <div className='mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-rose-500/15 pt-3'>
            {node.price !== 0 && (
              <Badge tone='violet'>
                {node.price === -1
                  ? zh
                    ? '免费'
                    : 'Free'
                  : `${node.currency}${node.price}`}
                /{billingCycleLabel(node.billing_cycle, zh)}
              </Badge>
            )}
            {node.price !== 0 && remaining != null && (
              <Badge
                tone={
                  remaining <= 7
                    ? 'red'
                    : remaining <= 15
                      ? 'orange'
                      : 'emerald'
                }
              >
                {remaining <= 0
                  ? zh
                    ? '已过期'
                    : 'Expired'
                  : remaining > 36500
                    ? zh
                      ? '长期'
                      : 'Long-term'
                    : zh
                      ? `余${remaining}天`
                      : `${remaining}d left`}
              </Badge>
            )}
            {tags.map((tag, i) => (
              <Badge key={i} tone={tag.tone ?? TAG_ROTATION[i % TAG_ROTATION.length]}>
                {tag.text}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------- page */

export function KomariStatus() {
  const { i18n, t } = useTranslation()
  const zh = i18n.language.toLowerCase().startsWith('zh')

  const nodesQuery = useQuery({
    queryKey: ['komari-nodes'],
    queryFn: () => fetchKomari<KomariNode[]>('/nodes'),
    refetchInterval: 60_000,
    retry: 1,
  })

  const nodes = useMemo(
    () => (nodesQuery.data ?? []).filter((n) => !n.hidden),
    [nodesQuery.data]
  )

  // One live-data query per node, aggregated at page level so the overview
  // strip and the cards share the same samples.
  const recentQueries = useQueries({
    queries: nodes.map((node) => ({
      queryKey: ['komari-recent', node.uuid],
      queryFn: () => fetchKomari<KomariRecent[]>(`/recent/${node.uuid}`),
      refetchInterval: 5_000,
      retry: 1,
    })),
  })

  const liveByUuid = useMemo(() => {
    const map = new Map<string, NodeLive>()
    nodes.forEach((node, i) => {
      const sample = latestSample(recentQueries[i]?.data)
      const online =
        !!sample && Date.now() - new Date(sample.updated_at).getTime() < 60_000
      map.set(node.uuid, { sample, online })
    })
    return map
  }, [nodes, recentQueries])

  const overview = useMemo(() => {
    let onlineCount = 0
    let totalUp = 0
    let totalDown = 0
    let speedUp = 0
    let speedDown = 0
    const regions = new Set<string>()
    nodes.forEach((node) => {
      const live = liveByUuid.get(node.uuid)
      if (!live?.online || !live.sample) return
      onlineCount += 1
      regions.add(node.region)
      totalUp += live.sample.network.totalUp
      totalDown += live.sample.network.totalDown
      speedUp += live.sample.network.up
      speedDown += live.sample.network.down
    })
    return { onlineCount, regions: regions.size, totalUp, totalDown, speedUp, speedDown }
  }, [nodes, liveByUuid])

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <ChisaAmbient />
        <div className='relative mx-auto w-full max-w-6xl px-4 pt-24 pb-14 sm:px-6 sm:pt-28'>
          {/* page header */}
          <header className='flex flex-wrap items-end justify-between gap-6'>
            <div>
              <div
                className='landing-animate-fade-up mb-4 inline-flex items-center gap-2.5 rounded-full border border-rose-500/20 bg-rose-500/5 py-1.5 pr-4 pl-1.5 opacity-0'
                style={{ animationDelay: '0ms' }}
              >
                <img
                  src='/chisa/chisa-icon.webp'
                  alt=''
                  aria-hidden
                  className='size-6 rounded-full ring-1 ring-rose-500/25'
                />
                <span className='text-[11px] font-semibold tracking-[0.24em] text-rose-500 uppercase dark:text-rose-400'>
                  Server Status
                </span>
              </div>
              <h1
                className='landing-animate-fade-up text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.15] font-bold tracking-tight opacity-0'
                style={{ animationDelay: '60ms' }}
              >
                {t('Server Status')}
              </h1>
              <p
                className='landing-animate-fade-up text-muted-foreground/80 mt-2 max-w-xl text-sm opacity-0 sm:text-base'
                style={{ animationDelay: '120ms' }}
              >
                {zh
                  ? '星炬学院全球节点实时运行状态'
                  : 'Live status of Star Matrix Academy nodes'}
              </p>
            </div>
            <div
              className='landing-animate-fade-up opacity-0'
              style={{ animationDelay: '160ms' }}
            >
              <LiveClock />
            </div>
          </header>

          {/* overview strip — aggregate across all nodes */}
          <div className='border-border/50 mt-9 grid grid-cols-2 gap-x-6 gap-y-5 border-y py-5 sm:grid-cols-4'>
            <OverviewStat label={zh ? '当前在线' : 'Online'} delay={180}>
              <span className='text-emerald-500'>{overview.onlineCount}</span>
              <span className='text-muted-foreground/50 text-base font-medium'>
                {' '}
                / {nodes.length}
              </span>
            </OverviewStat>
            <OverviewStat label={zh ? '点亮地区' : 'Regions'} delay={220}>
              {overview.regions}
            </OverviewStat>
            <OverviewStat label={zh ? '流量概览' : 'Traffic'} delay={260}>
              <span className='text-sm sm:text-lg'>
                <span className='text-emerald-500'>↑</span>
                {formatBytes(overview.totalUp)}{' '}
                <span className='text-sky-500'>↓</span>
                {formatBytes(overview.totalDown)}
              </span>
            </OverviewStat>
            <OverviewStat label={zh ? '网络速率' : 'Network'} delay={300}>
              <span className='text-sm sm:text-lg'>
                <span className='text-emerald-500'>↑</span>
                {formatSpeed(overview.speedUp)}{' '}
                <span className='text-sky-500'>↓</span>
                {formatSpeed(overview.speedDown)}
              </span>
            </OverviewStat>
          </div>

          {/* node grid — two per row on desktop, one on mobile */}
          {nodesQuery.isLoading ? (
            <div className='mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2'>
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className='border-border/60 bg-card/50 h-64 animate-pulse rounded-lg border'
                />
              ))}
            </div>
          ) : nodesQuery.isError ? (
            <div className='border-border/60 bg-card/60 mt-8 rounded-lg border px-6 py-14 text-center'>
              <Globe className='text-muted-foreground/40 mx-auto size-8' />
              <p className='text-muted-foreground/70 mt-3 text-sm'>
                {zh
                  ? '监控数据暂时不可用，请稍后再试'
                  : 'Monitoring data is temporarily unavailable'}
              </p>
            </div>
          ) : (
            <div
              className={`mt-8 grid grid-cols-1 gap-5 ${
                nodes.length === 1 ? 'lg:max-w-3xl' : 'lg:grid-cols-2'
              }`}
            >
              {nodes.map((node, i) => (
                <NodeCard
                  key={node.uuid}
                  node={node}
                  live={liveByUuid.get(node.uuid) ?? { online: false }}
                  index={i}
                />
              ))}
            </div>
          )}

          {/* footer quote */}
          <footer
            className='landing-animate-fade-up mt-14 text-center opacity-0'
            style={{ animationDelay: '420ms' }}
          >
            <p className='text-muted-foreground/70 font-serif text-base tracking-wide sm:text-lg'>
              「 纵使长夜湮灭，星光自有其矩。 」
            </p>
            <p className='mt-3 text-[11px] font-semibold tracking-[0.3em] text-rose-500/70 uppercase'>
              千咲 · 湮灭之夜 ｜ 星炬学院 Star Matrix Academy
            </p>
          </footer>
        </div>
      </div>
    </PublicLayout>
  )
}
