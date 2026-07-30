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

import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * Falling crimson petals (立绘中的樱花/花瓣意象). Purely decorative:
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

  return (
    <div className='relative h-svh max-w-none overflow-hidden'>
      {/* Full-viewport Chisa key visual — she sits on the RIGHT of the
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
          src='/chisa/chisa-convene.webp'
          alt=''
          className='h-full w-[106%] max-w-none object-cover object-[left_15%]'
          style={{ filter: 'url(#chisa-sharpen)' }}
        />
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
        <div
          aria-hidden
          className='chisa-grain pointer-events-none absolute inset-0 opacity-[0.055] mix-blend-overlay'
        />
      </div>

      {/* Falling petals */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 overflow-hidden'
      >
        {PETALS.map((petal) => (
          <span
            key={petal.left}
            className='chisa-petal'
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

          {/* Academy footer strip — echoes the landing quiet line */}
          <div className='absolute bottom-8 left-10 hidden items-center gap-3 lg:flex'>
            <img
              src='/chisa/sta-emblem.png'
              alt=''
              aria-hidden
              className='size-10 object-contain drop-shadow-[0_0_6px_rgba(255,196,107,0.5)]'
            />
            <div className='space-y-0.5'>
              <p className='text-muted-foreground/80 text-[11px] font-semibold tracking-[0.26em] uppercase'>
                {t('Star Torch Academy')}
              </p>
              <p className='text-muted-foreground/50 text-xs'>
                {t('Instant enrollment · Pay per credit · All courses open')}
              </p>
            </div>
          </div>
        </div>

        {/* Brand zone — floats over the artwork on the right, desktop only */}
        <div className='relative hidden lg:block'>
          <div className='absolute right-8 bottom-8 space-y-3 rounded-xl bg-black/35 px-5 py-4 text-right backdrop-blur-[2px]'>
            <p className='text-[10px] font-semibold tracking-[0.32em] text-[#ffc46b]/80 uppercase'>
              {t('Star Torch Academy · Office of the Registrar')}
            </p>
            <div aria-hidden className='ml-auto h-px w-10 bg-red-500/80' />
            <p className='text-2xl font-medium tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)]'>
              「{t('Sever the Strings of Fate')}」
            </p>
            <p className='text-xs tracking-[0.3em] text-white/70 uppercase'>
              Chisa · 朽叶千咲
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
