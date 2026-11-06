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
import { useTranslation } from 'react-i18next'

import { SidebarFooter } from '@/components/ui/sidebar'
import {
  CLAUDE_STICKERS,
  getClaudeGreetingSlot,
  useSkinAssets,
} from '@/hooks/use-skin-assets'
import { cn } from '@/lib/utils'

/**
 * The attribution the Claude-chan artist asked for: one small, faint line in
 * a corner of every page that shows her artwork or a sticker.
 */
export function ClaudeArtCredit(props: { className?: string }) {
  const { t } = useTranslation()
  const skin = useSkinAssets()
  if (!skin.isClaude) return null

  return (
    <p
      data-claude-element='credit'
      className={cn(
        'text-muted-foreground/60 text-[10px] leading-none tracking-wide',
        props.className
      )}
    >
      {t('Claude-chan')} ©{' '}
      <a
        href='https://space.bilibili.com/4168597'
        target='_blank'
        rel='noopener noreferrer'
        className='hover:text-foreground underline-offset-2 transition-colors hover:underline'
      >
        ZipZipPipe（胖次狐）
      </a>
      · {t('Stickers by')}{' '}
      <a
        href='https://github.com/lokicorvus/crosspet'
        target='_blank'
        rel='noopener noreferrer'
        className='hover:text-foreground underline-offset-2 transition-colors hover:underline'
      >
        CrossPet
      </a>
    </p>
  )
}

/**
 * Night treatment for her daytime wallpaper: a warm dark wash with a faint
 * lamp glow, painted only in dark mode (see `.claude-night-wash`). Place it
 * right after the image; `soft` is the lighter dashboard-banner strength.
 */
export function ClaudeNightWash(props: { soft?: boolean }) {
  const skin = useSkinAssets()
  if (!skin.isClaude) return null

  return (
    <div
      data-claude-element='night-wash'
      data-strength={props.soft ? 'soft' : 'full'}
      aria-hidden='true'
      className='claude-night-wash pointer-events-none absolute inset-0'
    />
  )
}

/**
 * A handful of lamplight motes drifting up the landing page. Positions are
 * fixed so the scene stays calm; timing is staggered per mote via CSS vars.
 * Purely decorative — `prefers-reduced-motion` freezes them in place.
 */
const MOTES = [
  { left: '18%', top: '26%', size: 7, duration: 15, delay: 0 },
  { left: '9%', top: '44%', size: 5, duration: 19, delay: 4 },
  { left: '27%', top: '58%', size: 4, duration: 17, delay: 8 },
  { left: '14%', top: '72%', size: 6, duration: 21, delay: 2 },
  { left: '58%', top: '34%', size: 4, duration: 18, delay: 6 },
  { left: '66%', top: '62%', size: 5, duration: 16, delay: 11 },
] as const

export function ClaudeMotes() {
  const skin = useSkinAssets()
  if (!skin.isClaude) return null

  return (
    <div
      data-claude-element='motes'
      aria-hidden='true'
      className='pointer-events-none absolute inset-0 overflow-hidden'
    >
      {MOTES.map((mote) => (
        <span
          key={`${mote.left}-${mote.top}`}
          className='claude-mote'
          style={
            {
              left: mote.left,
              top: mote.top,
              width: `${mote.size}px`,
              height: `${mote.size}px`,
              '--mote-duration': `${mote.duration}s`,
              '--mote-delay': `${mote.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** Dashboard banner corner: Claude-chan greets by local time of day. */
export function ClaudeGreeting(props: { className?: string }) {
  const skin = useSkinAssets()
  if (!skin.isClaude) return null
  const slot = getClaudeGreetingSlot(new Date().getHours())

  return (
    <img
      data-claude-element='greeting'
      data-greeting-slot={slot}
      src={CLAUDE_STICKERS.greeting[slot]}
      alt=''
      aria-hidden='true'
      decoding='async'
      className={cn(
        'claude-sticker pointer-events-none select-none',
        props.className
      )}
    />
  )
}

/** About page header: Claude-chan reading. */
export function ClaudeAboutSticker(props: { className?: string }) {
  const skin = useSkinAssets()
  if (!skin.isClaude) return null

  return (
    <img
      data-claude-element='about-sticker'
      src={CLAUDE_STICKERS.about}
      alt=''
      aria-hidden='true'
      decoding='async'
      className={cn(
        'claude-sticker pointer-events-none h-28 w-auto select-none',
        props.className
      )}
    />
  )
}

/** About page footer: the "may I ban your account?" sticker as a small
 * easter egg, followed by the artwork credit. */
export function ClaudeAboutFooter(props: { className?: string }) {
  const skin = useSkinAssets()
  if (!skin.isClaude) return null

  return (
    <div
      data-claude-element='about-footer'
      className={cn('flex flex-col items-center gap-3', props.className)}
    >
      <img
        src={CLAUDE_STICKERS.aboutEasterEgg}
        alt=''
        aria-hidden='true'
        loading='lazy'
        decoding='async'
        className='claude-sticker w-32 -rotate-3 opacity-90 transition-transform duration-300 select-none hover:rotate-0 sm:w-36'
      />
      <ClaudeArtCredit />
    </div>
  )
}

/** A small sticker card anchored to the authenticated sidebar. */
export function ClaudeSidebarCard() {
  const skin = useSkinAssets()
  const { t } = useTranslation()
  if (!skin.isClaude) return null

  return (
    <SidebarFooter className='group-data-[collapsible=icon]:hidden'>
      <div
        data-claude-element='sidebar-card'
        className='border-primary/20 bg-card/70 relative overflow-hidden rounded-2xl border px-3 pt-3 pb-2 shadow-xs'
      >
        <div className='flex items-center gap-3'>
          <img
            src={skin.sprite}
            alt=''
            aria-hidden='true'
            decoding='async'
            className='claude-sticker size-16 shrink-0 object-contain'
          />
          <div className='min-w-0'>
            <p className='text-primary text-[9px] font-semibold tracking-[0.2em] uppercase'>
              {t(skin.copy.organization)}
            </p>
            <p className='mt-1 line-clamp-2 text-xs leading-relaxed font-medium'>
              {t(skin.copy.motto)}
            </p>
          </div>
        </div>
        <ClaudeArtCredit className='mt-2 leading-snug' />
      </div>
    </SidebarFooter>
  )
}
