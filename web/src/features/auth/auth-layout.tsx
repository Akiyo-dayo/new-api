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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  ClaudeArtCredit,
  ClaudeNightWash,
} from '@/components/claude-skin-details'
import { Skeleton } from '@/components/ui/skeleton'
import { useSkinAssets } from '@/hooks/use-skin-assets'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * Falling white feathers (白羽/圣光意象). Purely decorative:
 * transform/opacity-only animation driven by CSS vars per petal.
 * Positioned over the artwork on the right half of the screen.
 */
const PETALS = [
  { left: '52%', size: 13, duration: 11, delay: 0 },
  { left: '62%', size: 10, duration: 13.5, delay: 2.8 },
  { left: '71%', size: 15, duration: 10, delay: 5.2 },
  { left: '80%', size: 9, duration: 14.5, delay: 1.4 },
  { left: '88%', size: 12, duration: 12, delay: 6.6 },
  { left: '95%', size: 8, duration: 15, delay: 3.9 },
] as const

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()
  const skin = useSkinAssets()
  const { systemName, logo, loading } = useSystemConfig()

  const logoBadge = (
    <div className='relative h-8 w-8'>
      {loading ? (
        <Skeleton className='absolute inset-0 rounded-full' />
      ) : (
        <img
          src={logo}
          alt={t('Logo')}
          className='h-8 w-8 rounded-full object-cover'
        />
      )}
    </div>
  )

  // The sharpen filter only helps upscaled raster art. ATRI opted out, and
  // Aemeath's key visual ships at 2560px — besides, some GPUs refuse to
  // paint a 2560px image through feConvolveMatrix at all. Claude leaves the
  // inline filter unset so its dark-mode dimming class can apply.
  let artFilter: string | undefined = 'url(#chisa-sharpen)'
  if (skin.isAtri || skin.usesThemeTokens) artFilter = 'none'
  if (skin.isClaude) artFilter = undefined

  // Decorative slots: emblem glow, brand box over the artwork.
  let decor = {
    emblemShadow: 'drop-shadow-[0_0_6px_rgba(255,196,107,0.5)]',
    brandBox: 'bg-black/35 backdrop-blur-[2px]',
    registry: 'text-[#ffc46b]/80',
    divider: 'bg-red-500/80',
    motto: 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]',
    character: 'text-white/70',
  }
  if (skin.isLightSkin) {
    decor = {
      ...decor,
      emblemShadow: 'drop-shadow-[0_0_6px_rgba(170,205,255,0.5)]',
      registry: 'text-[#bcd6ff]/80',
      divider: 'bg-sky-400/80',
    }
  }
  if (skin.usesThemeTokens) {
    decor = {
      emblemShadow:
        'drop-shadow-[0_0_6px_color-mix(in_oklch,var(--primary)_50%,transparent)]',
      brandBox: 'border-border/60 bg-card/75 border backdrop-blur-sm',
      registry: 'text-primary/90',
      divider: 'bg-primary/80',
      motto: 'text-foreground',
      character: 'text-muted-foreground',
    }
  }

  return (
    <div className='relative h-svh max-w-none overflow-hidden'>
      {/* Full-viewport skin key visual — she sits on the RIGHT of the
       * artwork, so the form lives on the left and the scrim melts the
       * LEFT edge of the painting into the page background, keeping her
       * completely unobscured. */}
      <div aria-hidden className='absolute inset-0'>
        {/*
         * Subtle unsharp-mask referenced by the artwork below. Mild 3x3
         * kernel (sums to 1, so brightness is preserved) that restores edge
         * crispness lost when the 2560px source is scaled up on 2.5K/4K
         * screens. Kept at zero-size rather than display:none so the
         * filter stays resolvable.
         */}
        <svg aria-hidden className='absolute h-0 w-0' focusable='false'>
          <filter id='chisa-sharpen'>
            <feConvolveMatrix
              order='3'
              kernelMatrix='0 -0.18 0 -0.18 1.72 -0.18 0 -0.18 0'
              preserveAlpha='true'
            />
          </filter>
        </svg>
        {/*
         * Artwork zoom reduced from 118% to 106%: less upscaling of the
         * 2560px source (2560px-wide screens now render it ~1:1), with the
         * mild sharpen filter above recovering the remaining softness.
         * Chisa's face still lands right-of-center, clear of the form.
         */}
        <img
          src={skin.convene}
          alt=''
          className={cn(
            skin.isLightSkin
              ? 'h-full w-full object-cover object-center'
              : 'h-full w-[106%] max-w-none object-cover object-[left_15%]',
            // The Claude wallpaper is a cream daytime scene; at night dim it
            // and warm it toward lamplight (the wash below adds the rest).
            skin.isClaude &&
              'object-[72%_center] dark:brightness-[0.6] dark:saturate-[1.2] dark:sepia-[0.15]'
          )}
          fetchPriority='high'
          decoding='async'
          style={artFilter ? { filter: artFilter } : undefined}
        />
        <ClaudeNightWash />
        {/*
         * Desktop scrim: solid page background on the left (form side),
         * fading out across the middle, fully transparent on the right
         * third where Chisa sits — she stays completely unobscured.
         */}
        <div
          className='absolute inset-0 hidden lg:block'
          style={{
            background:
              'linear-gradient(to left, transparent 0%, transparent 30%, color-mix(in oklch, var(--background) 40%, transparent) 48%, color-mix(in oklch, var(--background) 75%, transparent) 60%, var(--background) 72%, var(--background) 100%)',
          }}
        />
        {/* Mobile scrim: heavy background veil so the form stays readable */}
        <div
          className='absolute inset-0 lg:hidden'
          style={{
            background:
              'color-mix(in oklch, var(--background) 88%, transparent)',
          }}
        />
        {/* Film grain: masks residual upscale softness with an intentional
         * analog texture (also fits the petals / cinematic mood). */}
        {!skin.isAtri && !skin.isClaude && (
          <div
            aria-hidden
            className='chisa-grain pointer-events-none absolute inset-0 opacity-[0.055] mix-blend-overlay'
          />
        )}
      </div>

      {/* Chisa / Phoebe: falling petals. ATRI: rising sea bubbles. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 overflow-hidden'
      >
        {PETALS.map((petal) => (
          <span
            key={petal.left}
            className={skin.isAtri ? 'chisa-petal atri-bubble' : 'chisa-petal'}
            style={
              {
                left: petal.left,
                '--petal-size': `${petal.size}px`,
                '--petal-duration': `${petal.duration}s`,
                '--petal-delay': `${petal.delay}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Logo link — top-left over the page background, so it uses theme
       * foreground colors and stays readable in both light and dark. */}
      <Link
        to='/'
        className='absolute top-4 left-4 z-20 flex items-center gap-2 transition-opacity hover:opacity-80 sm:top-8 sm:left-8'
      >
        {logoBadge}
        {loading ? (
          <Skeleton className='h-6 w-24' />
        ) : (
          <h1 className='text-xl font-medium'>{systemName}</h1>
        )}
      </Link>

      <div className='relative z-10 grid h-full lg:grid-cols-2'>
        {/* Form zone — left column over the melted background, no framing */}
        <div className='relative flex items-center justify-center pt-16 sm:pt-0'>
          <div className='mx-auto flex w-full flex-col justify-center space-y-2 px-4 py-8 sm:w-[480px] sm:p-8'>
            {children}
          </div>

          {/* Skin footer strip — echoes the landing quiet line */}
          <div className='absolute bottom-8 left-10 hidden items-center gap-3 lg:flex'>
            <img
              src={skin.emblem}
              alt=''
              aria-hidden
              className={`size-10 object-contain ${decor.emblemShadow}`}
            />
            <div className='space-y-0.5'>
              <p className='text-muted-foreground/80 text-[11px] font-semibold tracking-[0.26em] uppercase'>
                {t(skin.copy.organization)}
              </p>
              <p className='text-muted-foreground/50 text-xs'>
                {t(skin.copy.capability)}
              </p>
            </div>
          </div>
        </div>

        {/* Brand zone — floats over the artwork on the right, desktop only */}
        <div className='relative hidden lg:block'>
          {/* Claude lifts the card to leave room for the credit pill. */}
          <div
            className={cn(
              'absolute right-8 bottom-8 space-y-3 rounded-xl px-5 py-4 text-right',
              decor.brandBox,
              skin.isClaude && 'bottom-14'
            )}
          >
            <p
              className={`text-[10px] font-semibold tracking-[0.32em] uppercase ${decor.registry}`}
            >
              {t(skin.copy.registry)}
            </p>
            <div aria-hidden className={`ml-auto h-px w-10 ${decor.divider}`} />
            <p
              className={`claude-display text-2xl font-medium tracking-wide ${decor.motto}`}
            >
              {`「${t(skin.copy.motto)}」`}
            </p>
            <p
              className={`text-xs tracking-[0.3em] uppercase ${decor.character}`}
            >
              {t(skin.copy.character)}
            </p>
          </div>
        </div>
      </div>
      {/* On a pill so it stays legible over the wallpaper in both modes. */}
      <ClaudeArtCredit className='text-foreground/85 absolute right-4 bottom-3 z-20 rounded-full bg-white/60 px-2.5 py-1 backdrop-blur-sm lg:right-8 lg:bottom-5 dark:bg-black/35 dark:text-white/80' />
    </div>
  )
}
