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
         * Artwork is rendered 18% wider than the viewport, anchored left
         * and biased toward the top (15% vertical position): this pans
         * the composition so Chisa's face lands at ~74% viewport width
         * inside the scrim's clear zone, and the vertical bias keeps her
         * hair ribbon fully in frame (no cropped head) at the cost of
         * trimming the platform at the bottom edge.
         */}
        <img
          src='/chisa/chisa-convene.webp'
          alt=''
          className='h-full w-[118%] max-w-none object-cover object-[left_15%]'
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
        className='absolute top-4 left-4 z-10 flex items-center gap-2 transition-opacity hover:opacity-80 sm:top-8 sm:left-8'
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
        <div className='flex items-center justify-center pt-16 sm:pt-0'>
          <div className='mx-auto flex w-full flex-col justify-center space-y-2 px-4 py-8 sm:w-[480px] sm:p-8'>
            {children}
          </div>
        </div>

        {/* Brand zone — floats over the artwork on the right, desktop only */}
        <div className='relative hidden lg:block'>
          <div className='absolute right-8 bottom-8 space-y-3 rounded-xl bg-black/35 px-5 py-4 text-right backdrop-blur-[2px]'>
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
