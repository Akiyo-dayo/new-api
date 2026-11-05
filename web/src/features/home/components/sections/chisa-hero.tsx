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

import { AtriTideGauge } from '@/components/atri-skin-details'
import { LumenMotes } from '@/components/lumen-skin-details'
import { Button } from '@/components/ui/button'
import { useSkinAssets } from '@/hooks/use-skin-assets'
import { useStatus } from '@/hooks/use-status'

interface ChisaHeroProps {
  isAuthenticated?: boolean
}

/**
 * Skin-themed landing — a single immersive poster-style screen with splash
 * art on the right and minimal copy. Chisa (千咲, crimson/gold/ink) is the
 * default skin; the Phoebe (菲比, sapphire/gold/midnight-nave) preset swaps
 * palette, artwork and copy. Aemeath and Lumen take every decorative color
 * from the active theme tokens instead.
 */
export function ChisaHero({ isAuthenticated }: ChisaHeroProps) {
  const { t } = useTranslation()
  const skin = useSkinAssets()
  const { status } = useStatus()
  const siteName = (status?.system_name as string | undefined) || 'New API'
  const year = new Date().getFullYear()

  let primaryBtn = skin.isLightSkin
    ? 'group h-11 rounded-lg border-none bg-gradient-to-r from-[#3b6fe8] to-[#6fa9ff] px-6 text-sm font-medium text-white shadow-[0_8px_28px_-8px_rgba(59,111,232,0.55)] transition-shadow hover:shadow-[0_10px_36px_-6px_rgba(59,111,232,0.7)]'
    : 'group h-11 rounded-lg border-none bg-gradient-to-r from-[#e8234a] to-[#ff6b4a] px-6 text-sm font-medium text-white shadow-[0_8px_28px_-8px_rgba(232,35,74,0.6)] transition-shadow hover:shadow-[0_10px_36px_-6px_rgba(232,35,74,0.75)]'
  let titleGradient = skin.isLightSkin
    ? 'from-[#2f56c4] via-[#4878e8] to-[#c75b93] dark:from-[#6ea8ff] dark:via-[#a8c6ff] dark:to-[#ffd1e4]'
    : 'from-[#ff4d6d] via-[#ff7a59] to-[#ffc46b]'
  if (skin.isAtri) {
    primaryBtn =
      'group h-11 rounded-lg border-none bg-gradient-to-r from-[#168ca5] via-[#28aebc] to-[#51c6c2] px-6 text-sm font-medium text-white shadow-[0_8px_28px_-8px_rgba(22,140,165,0.55)] transition-shadow hover:shadow-[0_10px_36px_-6px_rgba(22,140,165,0.7)] dark:text-[#102d3c]'
    titleGradient =
      'from-[#168ca5] via-[#35b8bd] to-[#e77b6c] dark:from-[#79e2e2] dark:via-[#a4edf0] dark:to-[#ffad99]'
  }
  let outlineBtn = skin.isLightSkin
    ? 'h-11 rounded-lg border-[#1a2440]/15 bg-white/40 px-6 text-sm font-medium text-[#1a2440]/75 backdrop-blur-sm hover:border-[#1a2440]/30 hover:bg-white/70 hover:text-[#1a2440] dark:border-white/15 dark:bg-white/[0.03] dark:text-white/80 dark:hover:border-white/30 dark:hover:bg-white/[0.08] dark:hover:text-white'
    : 'h-11 rounded-lg border-white/15 bg-white/[0.03] px-6 text-sm font-medium text-white/80 backdrop-blur-sm hover:border-white/30 hover:bg-white/[0.08] hover:text-white'
  if (skin.usesThemeTokens) {
    primaryBtn =
      'group h-11 rounded-lg border-none bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[0_8px_28px_-8px_color-mix(in_oklch,var(--primary)_55%,transparent)] transition-shadow hover:bg-primary hover:shadow-[0_10px_36px_-6px_color-mix(in_oklch,var(--primary)_70%,transparent)]'
    titleGradient =
      'from-primary via-[color-mix(in_oklch,var(--primary)_55%,var(--chart-2))] to-chart-2'
    outlineBtn =
      'h-11 rounded-lg border-border bg-background/40 px-6 text-sm font-medium text-foreground/75 backdrop-blur-sm hover:border-foreground/30 hover:bg-background/70 hover:text-foreground'
  }
  let atmosphere = skin.isLightSkin
    ? [
        'radial-gradient(ellipse 55% 60% at 72% 48%, oklch(0.5 0.14 258 / 42%) 0%, transparent 68%)',
        'radial-gradient(ellipse 35% 30% at 85% 18%, oklch(0.8 0.07 245 / 22%) 0%, transparent 70%)',
        'radial-gradient(ellipse 45% 40% at 12% 8%, oklch(0.45 0.1 235 / 38%) 0%, transparent 70%)',
        'radial-gradient(ellipse 60% 45% at 30% 100%, oklch(0.42 0.12 265 / 25%) 0%, transparent 70%)',
      ]
    : [
        'radial-gradient(ellipse 55% 60% at 72% 48%, oklch(0.52 0.22 15 / 42%) 0%, transparent 68%)',
        'radial-gradient(ellipse 35% 30% at 85% 18%, oklch(0.72 0.12 75 / 22%) 0%, transparent 70%)',
        'radial-gradient(ellipse 45% 40% at 12% 8%, oklch(0.42 0.1 310 / 38%) 0%, transparent 70%)',
        'radial-gradient(ellipse 60% 45% at 30% 100%, oklch(0.38 0.14 20 / 25%) 0%, transparent 70%)',
      ]
  if (skin.isAtri) {
    atmosphere = [
      'radial-gradient(ellipse 60% 62% at 74% 45%, oklch(0.65 0.12 211 / 40%) 0%, transparent 68%)',
      'radial-gradient(ellipse 38% 32% at 86% 16%, oklch(0.82 0.09 184 / 28%) 0%, transparent 70%)',
      'radial-gradient(ellipse 45% 40% at 12% 8%, oklch(0.65 0.1 222 / 30%) 0%, transparent 70%)',
      'radial-gradient(ellipse 58% 42% at 30% 100%, oklch(0.7 0.12 28 / 18%) 0%, transparent 70%)',
    ]
  }
  if (skin.isAemeath) {
    atmosphere = [
      'radial-gradient(ellipse 55% 60% at 72% 48%, color-mix(in oklch, var(--primary) 34%, transparent) 0%, transparent 68%)',
      'radial-gradient(ellipse 35% 30% at 85% 18%, color-mix(in oklch, var(--secondary) 40%, transparent) 0%, transparent 70%)',
      'radial-gradient(ellipse 45% 40% at 12% 8%, color-mix(in oklch, var(--chart-3) 28%, transparent) 0%, transparent 70%)',
      'radial-gradient(ellipse 60% 45% at 30% 100%, color-mix(in oklch, var(--primary) 18%, transparent) 0%, transparent 70%)',
    ]
  }
  if (skin.isLumen) {
    // One desk lamp, top-left; a faint dawn-rose warmth at the far corner.
    atmosphere = [
      'radial-gradient(ellipse 70% 60% at 6% 0%, color-mix(in oklch, var(--primary) 30%, transparent) 0%, color-mix(in oklch, var(--primary) 8%, transparent) 45%, transparent 72%)',
      'radial-gradient(ellipse 45% 40% at 90% 94%, color-mix(in oklch, var(--chart-2) 14%, transparent) 0%, transparent 70%)',
    ]
  }

  // Small decorative slots: badge pill, status dot, quiet text, seal.
  let decor = {
    badge:
      'border-white/12 bg-white/[0.04] shadow-[0_0_24px_-6px_oklch(0.55_0.22_15/45%)]',
    iconRing: 'ring-white/25',
    badgeText: 'text-white/75',
    ping: 'bg-rose-400',
    dot: 'bg-rose-500',
    tagline: 'text-white/55',
    capability: 'text-white/35',
    seal: '',
    emblemShadow: 'drop-shadow-[0_0_6px_rgba(255,196,107,0.45)]',
    footer: 'text-white/30',
  }
  if (skin.isLightSkin) {
    decor = {
      badge:
        'border-[#1a2440]/12 bg-white/50 shadow-[0_0_24px_-6px_oklch(0.55_0.14_258/45%)] dark:border-white/12 dark:bg-white/[0.04]',
      iconRing: 'ring-[#1a2440]/15 dark:ring-white/25',
      badgeText: 'text-[#1a2440]/70 dark:text-white/75',
      ping: 'bg-sky-300',
      dot: 'bg-sky-400',
      tagline: 'text-foreground/65 dark:text-white/65',
      capability: 'text-foreground/55 dark:text-white/45',
      seal: 'text-[#42548a] dark:text-[#c4daff]',
      emblemShadow: 'drop-shadow-[0_0_6px_rgba(170,205,255,0.5)]',
      footer: 'text-[#1a2440]/45 dark:text-white/30',
    }
  }
  if (skin.usesThemeTokens) {
    decor = {
      badge:
        'border-primary/20 bg-primary/5 shadow-[0_0_24px_-6px_color-mix(in_oklch,var(--primary)_45%,transparent)]',
      iconRing: 'ring-primary/25',
      badgeText: 'text-primary',
      ping: 'bg-primary/70',
      dot: 'bg-primary',
      tagline: 'text-foreground/65',
      capability: 'text-foreground/55',
      seal: 'text-primary',
      emblemShadow:
        'drop-shadow-[0_0_6px_color-mix(in_oklch,var(--primary)_50%,transparent)]',
      footer: 'text-foreground/45',
    }
  }
  // The Lumen scene keeps its lamp on the left edge, so only the bottom
  // melts into the page; character splashes fade on the left as well.
  let splashClass =
    'chisa-float h-[min(86vh,52rem)] w-auto max-w-none [mask-image:linear-gradient(to_right,transparent_0%,black_32%),linear-gradient(to_top,transparent_2%,black_30%)] [mask-composite:intersect]'
  if (skin.isLumen) {
    splashClass =
      'h-[min(86vh,52rem)] w-auto max-w-none [mask-image:linear-gradient(to_top,transparent_0%,black_12%)]'
  }

  return (
    <section
      className={`relative flex min-h-svh flex-col overflow-hidden ${
        skin.isLightSkin
          ? 'bg-background text-foreground'
          : 'bg-[#0a0910] text-white'
      }`}
    >
      {/* ── Atmosphere: skin-tinted glows ───────────────────────────── */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{ background: atmosphere.join(', ') }}
      />
      {/* Faint blueprint grid, dissolving toward the edges. The Lumen study
       * keeps its empty space quiet, so it skips the grid. */}
      {!skin.isLumen && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_65%_60%_at_50%_40%,black_15%,transparent_100%)] bg-[size:4rem_4rem] ${
            skin.isLightSkin
              ? 'bg-[linear-gradient(to_right,rgb(26_36_64/0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgb(26_36_64/0.06)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)]'
              : 'bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)]'
          }`}
        />
      )}
      <AtriTideGauge />
      <LumenMotes />

      {/* ── Splash art ──────────────────────────────────────────────── */}
      {/* Mobile: soft backdrop behind the copy */}
      <img
        src={skin.splash}
        alt=''
        aria-hidden
        className='pointer-events-none absolute top-1/2 left-1/2 w-[36rem] max-w-none -translate-x-1/2 -translate-y-1/2 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,black_30%,transparent_75%)] opacity-20 sm:opacity-25 lg:hidden'
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
        <img src={skin.splash} alt='' className={splashClass} />
      </div>
      {/* Bottom vignette so the art melts into the page */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t to-transparent ${
          skin.isLightSkin ? 'from-background' : 'from-[#0a0910]'
        }`}
      />

      {/* ── Copy ────────────────────────────────────────────────────── */}
      <div className='relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 pt-28 pb-16 md:px-10'>
        <div className='max-w-xl'>
          {/* Badge */}
          <div
            className={`landing-animate-fade-up mb-7 inline-flex items-center gap-2.5 rounded-full border py-1.5 pr-4 pl-1.5 backdrop-blur-sm ${decor.badge}`}
            style={{ animationDelay: '0ms' }}
          >
            <img
              src={skin.icon}
              alt=''
              aria-hidden
              className={`size-6 rounded-full ring-1 ${decor.iconRing}`}
            />
            <span
              className={`text-[11px] font-semibold tracking-[0.24em] uppercase ${decor.badgeText}`}
            >
              {t(skin.copy.badge)}
            </span>
            <span className='relative flex size-1.5'>
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-70 ${decor.ping}`}
              />
              <span
                className={`relative inline-flex size-1.5 rounded-full ${decor.dot}`}
              />
            </span>
          </div>

          {/* Title */}
          <h1
            className='landing-animate-fade-up lumen-display text-[clamp(2.5rem,5.6vw,4.25rem)] leading-[1.1] font-bold tracking-tight'
            style={{ animationDelay: '70ms' }}
          >
            {siteName}
            <br />
            <span
              className={`bg-gradient-to-r bg-clip-text text-transparent ${titleGradient}`}
            >
              {skin.isAtri ? t(skin.copy.motto) : t('One Pass, Every Model')}
            </span>
          </h1>

          {/* Tagline */}
          <p
            className={`landing-animate-fade-up mt-5 max-w-md text-[15px] leading-relaxed md:text-base ${decor.tagline}`}
            style={{ animationDelay: '140ms' }}
          >
            {t(skin.copy.tagline)}
          </p>

          {/* Actions */}
          <div
            className='landing-animate-fade-up mt-9 flex flex-wrap items-center gap-3'
            style={{ animationDelay: '210ms' }}
          >
            {isAuthenticated ? (
              <>
                <Button
                  className={primaryBtn}
                  render={<Link to='/dashboard' />}
                >
                  {t(skin.copy.enterAction)}
                  <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
                </Button>
                <Button
                  variant='outline'
                  className={outlineBtn}
                  render={<Link to='/pricing' />}
                >
                  {t(skin.copy.pricingAction)}
                </Button>
              </>
            ) : (
              <>
                <Button className={primaryBtn} render={<Link to='/sign-up' />}>
                  {t(skin.copy.joinAction)}
                  <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
                </Button>
                <Button
                  variant='outline'
                  className={outlineBtn}
                  render={<Link to='/pricing' />}
                >
                  {t(skin.copy.pricingAction)}
                </Button>
              </>
            )}
          </div>

          {/* Quiet capability line */}
          <p
            className={`landing-animate-fade-up mt-10 text-xs tracking-wide ${decor.capability}`}
            style={{ animationDelay: '280ms' }}
          >
            {t(skin.copy.capability)}
          </p>
        </div>
      </div>

      {/* ── Skin seal — rotating stamp, bottom-left ─────────────────── */}
      <div
        aria-hidden
        className='pointer-events-none absolute bottom-20 left-6 z-10 hidden md:left-10 lg:block'
      >
        <div className='relative size-28 opacity-80'>
          <svg
            viewBox='0 0 100 100'
            className={`chisa-seal-spin absolute inset-0 h-full w-full ${decor.seal}`}
          >
            <defs>
              <path
                id='sta-seal-circle'
                d='M 50,50 m -38,0 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0'
              />
            </defs>
            <text
              style={
                skin.isLightSkin
                  ? {
                      fill: 'currentColor',
                      opacity: 0.8,
                      fontSize: '7.6px',
                      letterSpacing: '1.4px',
                    }
                  : {
                      fill: 'rgba(255,196,107,0.72)',
                      fontSize: '7.6px',
                      letterSpacing: '1.4px',
                    }
              }
            >
              <textPath href='#sta-seal-circle'>{t(skin.copy.seal)}</textPath>
            </text>
            <circle
              cx='50'
              cy='50'
              r='27'
              fill='none'
              stroke={
                skin.isLightSkin ? 'currentColor' : 'rgba(255,196,107,0.35)'
              }
              strokeOpacity={skin.isLightSkin ? '0.45' : undefined}
              strokeWidth='0.75'
            />
          </svg>
          <img
            src={skin.emblem}
            alt=''
            className={`absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 object-contain ${decor.emblemShadow}`}
          />
        </div>
      </div>

      {/* ── Minimal footer ──────────────────────────────────────────── */}
      <footer
        className={`relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pb-6 text-[11px] md:px-10 ${decor.footer}`}
      >
        <span>
          © {year} {siteName}
        </span>
        <span className='tracking-[0.2em] uppercase'>{t(skin.copy.duty)}</span>
      </footer>
    </section>
  )
}
