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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'

interface ChisaHeroProps {
  isAuthenticated?: boolean
}

/**
 * 菲比 (Phoebe) themed landing — a single immersive poster-style screen.
 * Sapphire / gold / midnight-nave palette, splash art on the right.
 */
export function ChisaHero({ isAuthenticated }: ChisaHeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const siteName =
    (status?.system_name as string | undefined) || 'New API'
  const year = new Date().getFullYear()

  return (
    <section className='relative flex min-h-svh flex-col overflow-hidden bg-[#0a0e17] text-white'>
      {/* ── Atmosphere: sapphire / gold / sky glows ────────────────── */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background: [
            'radial-gradient(ellipse 55% 60% at 72% 48%, oklch(0.5 0.14 258 / 42%) 0%, transparent 68%)',
            'radial-gradient(ellipse 35% 30% at 85% 18%, oklch(0.78 0.11 85 / 22%) 0%, transparent 70%)',
            'radial-gradient(ellipse 45% 40% at 12% 8%, oklch(0.45 0.1 235 / 38%) 0%, transparent 70%)',
            'radial-gradient(ellipse 60% 45% at 30% 100%, oklch(0.42 0.12 265 / 25%) 0%, transparent 70%)',
          ].join(', '),
        }}
      />
      {/* Faint blueprint grid, dissolving toward the edges */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_65%_60%_at_50%_40%,black_15%,transparent_100%)] bg-[size:4rem_4rem]'
      />

      {/* ── Phoebe splash art ───────────────────────────────────────── */}
      {/* Mobile: soft backdrop behind the copy */}
      <img
        src='/phoebe/phoebe-splash.webp'
        alt=''
        aria-hidden
        className='pointer-events-none absolute top-1/2 left-1/2 w-[36rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-20 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,black_30%,transparent_75%)] sm:opacity-25 lg:hidden'
      />
      {/* Desktop: art follows the centered content container (max-w-6xl),
       * NOT the viewport edge — on ultrawide screens it stays beside the
       * copy instead of drifting to the far right. Sized by viewport
       * height so the composition stays identical across aspect ratios. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-y-0 hidden items-center lg:flex'
        style={{
          right: 'max(0px, calc((100vw - 72rem) / 2 - 3rem))',
        }}
      >
        <img
          src='/phoebe/phoebe-splash.webp'
          alt=''
          className='chisa-float h-[min(86vh,52rem)] w-auto max-w-none [mask-image:linear-gradient(to_right,transparent_0%,black_32%),linear-gradient(to_top,transparent_2%,black_30%)] [mask-composite:intersect]'
        />
      </div>
      {/* Bottom vignette so the art melts into the page */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0e17] to-transparent'
      />

      {/* ── Copy ────────────────────────────────────────────────────── */}
      <div className='relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 pt-28 pb-16 md:px-10'>
        <div className='max-w-xl'>
          {/* Badge */}
          <div
            className='landing-animate-fade-up mb-7 inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-white/[0.04] py-1.5 pr-4 pl-1.5 shadow-[0_0_24px_-6px_oklch(0.55_0.14_258/45%)] backdrop-blur-sm'
            style={{ animationDelay: '0ms' }}
          >
            <img
              src='/phoebe/phoebe-icon.webp'
              alt=''
              aria-hidden
              className='size-6 rounded-full ring-1 ring-white/25'
            />
            <span className='text-[11px] font-semibold tracking-[0.24em] text-white/75 uppercase'>
              {t('Order of the Deep · Acolyte')}
            </span>
            <span className='relative flex size-1.5'>
              <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-70' />
              <span className='relative inline-flex size-1.5 rounded-full bg-amber-400' />
            </span>
          </div>

          {/* Title */}
          <h1
            className='landing-animate-fade-up text-[clamp(2.5rem,5.6vw,4.25rem)] leading-[1.1] font-bold tracking-tight'
            style={{ animationDelay: '70ms' }}
          >
            {siteName}
            <br />
            <span className='bg-gradient-to-r from-[#6ea8ff] via-[#a8c6ff] to-[#ffd9a0] bg-clip-text text-transparent'>
              {t('One Pass, Every Model')}
            </span>
          </h1>

          {/* Tagline */}
          <p
            className='landing-animate-fade-up mt-5 max-w-md text-[15px] leading-relaxed text-white/55 md:text-base'
            style={{ animationDelay: '140ms' }}
          >
            {t(
              'May every request find its light — one pass for every model.'
            )}
          </p>

          {/* Actions */}
          <div
            className='landing-animate-fade-up mt-9 flex flex-wrap items-center gap-3'
            style={{ animationDelay: '210ms' }}
          >
            {isAuthenticated ? (
              <>
                <Button
                  className='group h-11 rounded-lg border-none bg-gradient-to-r from-[#2f5fe0] to-[#5b93ff] px-6 text-sm font-medium text-white shadow-[0_8px_28px_-8px_rgba(47,95,224,0.6)] transition-shadow hover:shadow-[0_10px_36px_-6px_rgba(47,95,224,0.75)]'
                  render={<Link to='/dashboard' />}
                >
                  {t('Enter the Sanctum')}
                  <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
                </Button>
                <Button
                  variant='outline'
                  className='h-11 rounded-lg border-white/15 bg-white/[0.03] px-6 text-sm font-medium text-white/80 backdrop-blur-sm hover:border-white/30 hover:bg-white/[0.08] hover:text-white'
                  render={<Link to='/pricing' />}
                >
                  {t('Offerings & Fees')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  className='group h-11 rounded-lg border-none bg-gradient-to-r from-[#2f5fe0] to-[#5b93ff] px-6 text-sm font-medium text-white shadow-[0_8px_28px_-8px_rgba(47,95,224,0.6)] transition-shadow hover:shadow-[0_10px_36px_-6px_rgba(47,95,224,0.75)]'
                  render={<Link to='/sign-up' />}
                >
                  {t('Join the Order')}
                  <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
                </Button>
                <Button
                  variant='outline'
                  className='h-11 rounded-lg border-white/15 bg-white/[0.03] px-6 text-sm font-medium text-white/80 backdrop-blur-sm hover:border-white/30 hover:bg-white/[0.08] hover:text-white'
                  render={<Link to='/pricing' />}
                >
                  {t('Offerings & Fees')}
                </Button>
              </>
            )}
          </div>

          {/* Quiet capability line */}
          <p
            className='landing-animate-fade-up mt-10 text-xs tracking-wide text-white/35'
            style={{ animationDelay: '280ms' }}
          >
            {t('Instant blessing · Pay per token · Every model within reach')}
          </p>
        </div>
      </div>

      {/* ── Order seal — rotating acolyte stamp, bottom-left ────────── */}
      <div
        aria-hidden
        className='pointer-events-none absolute bottom-20 left-6 z-10 hidden md:left-10 lg:block'
      >
        <div className='relative size-28 opacity-80'>
          <svg
            viewBox='0 0 100 100'
            className='chisa-seal-spin absolute inset-0 h-full w-full'
          >
            <defs>
              <path
                id='sta-seal-circle'
                d='M 50,50 m -38,0 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0'
              />
            </defs>
            <text
              style={{
                fill: 'rgba(255,196,107,0.72)',
                fontSize: '7.6px',
                letterSpacing: '1.4px',
              }}
            >
              <textPath href='#sta-seal-circle'>
                ORDER OF THE DEEP · 隐海修会 · ACOLYTE ·
              </textPath>
            </text>
            <circle
              cx='50'
              cy='50'
              r='27'
              fill='none'
              stroke='rgba(255,196,107,0.35)'
              strokeWidth='0.75'
            />
          </svg>
          <img
            src='/phoebe/order-emblem.png'
            alt=''
            className='absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-[0_0_6px_rgba(255,196,107,0.45)]'
          />
        </div>
      </div>

      {/* ── Minimal footer ──────────────────────────────────────────── */}
      <footer className='relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pb-6 text-[11px] text-white/30 md:px-10'>
        <span>
          © {year} {siteName}
        </span>
        <span className='tracking-[0.2em] uppercase'>
          {t('Acolyte on duty · Phoebe')}
        </span>
      </footer>
    </section>
  )
}
