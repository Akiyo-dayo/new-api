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
import { useSkinAssets } from '@/hooks/use-skin-assets'

const ATRI_ARTWORK = {
  daylight: '/atri/atri-daylight.webp?v=atri-r2',
  starlit: '/atri/atri-starlit.webp?v=atri-r2',
  crab: '/atri/atri-crab.webp?v=atri-r2',
} as const

const GALLERY_ITEMS = [
  {
    id: '121456290',
    src: ATRI_ARTWORK.daylight,
    href: 'https://www.pixiv.net/artworks/121456290',
    className: 'min-h-64 sm:row-span-2 sm:min-h-80',
  },
  {
    id: '125754402',
    src: ATRI_ARTWORK.starlit,
    href: 'https://www.pixiv.net/artworks/125754402',
    className: 'min-h-36',
  },
  {
    id: '144374678',
    src: ATRI_ARTWORK.crab,
    href: 'https://www.pixiv.net/artworks/144374678',
    className: 'min-h-36',
  },
] as const

function TideGlyph(props: { className?: string }) {
  return (
    <svg
      viewBox='0 0 48 48'
      fill='none'
      aria-hidden='true'
      className={props.className}
    >
      <path
        d='M5 18c5.2 0 5.2-4 10.4-4s5.2 4 10.4 4 5.2-4 10.4-4 5.2 4 7.8 4M5 27c5.2 0 5.2-4 10.4-4s5.2 4 10.4 4 5.2-4 10.4-4 5.2 4 7.8 4M12 35c4.5 0 5-3 9.5-3S26 35 30 35s5-3 8-3'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
      />
      <circle cx='34' cy='10' r='3' stroke='currentColor' strokeWidth='1.3' />
    </svg>
  )
}

/** A maritime instrument-rail motif used only by the ATRI landing page. */
export function AtriTideGauge() {
  const skin = useSkinAssets()
  const { t } = useTranslation()
  if (!skin.isAtri) return null

  return (
    <div
      data-atri-element='tide-gauge'
      aria-hidden='true'
      className='pointer-events-none absolute top-1/2 right-5 z-10 hidden -translate-y-1/2 xl:block'
    >
      <div className='text-primary/55 dark:text-primary/75 flex flex-col items-center gap-4'>
        <TideGlyph className='size-10' />
        <div className='flex items-center gap-3'>
          <span className='text-[9px] font-semibold tracking-[0.28em] uppercase [writing-mode:vertical-rl]'>
            {t(skin.copy.organization)}
          </span>
          <div className='relative h-44 w-px bg-gradient-to-b from-transparent via-current to-transparent opacity-45'>
            {[0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100].map(
              (position, index) => (
                <span
                  key={position}
                  className={`absolute left-1/2 h-px -translate-x-1/2 bg-current ${index % 2 === 0 ? 'w-4' : 'w-2'}`}
                  style={{ top: `${position}%` }}
                />
              )
            )}
          </div>
        </div>
        <span className='text-[8px] tracking-[0.24em] uppercase [writing-mode:vertical-rl]'>
          My Dear Moments
        </span>
      </div>
    </div>
  )
}

/** Three sourced fan-art postcards; only rendered for the ATRI preset. */
export function AtriArchiveGallery() {
  const skin = useSkinAssets()
  const { t } = useTranslation()
  if (!skin.isAtri) return null

  return (
    <section
      data-atri-element='archive-gallery'
      aria-label={t(skin.copy.registry)}
      className='mb-10'
    >
      <div className='mb-4 flex items-end justify-between gap-4 text-left'>
        <div>
          <p className='text-primary text-[10px] font-semibold tracking-[0.24em] uppercase'>
            {t(skin.copy.registry)}
          </p>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(skin.copy.motto)}
          </p>
        </div>
        <img
          src={skin.emblem}
          alt=''
          aria-hidden='true'
          className='size-10 shrink-0 object-contain'
        />
      </div>
      <div className='grid gap-3 sm:grid-cols-2 sm:grid-rows-2'>
        {GALLERY_ITEMS.map((item) => (
          <a
            key={item.id}
            href={item.href}
            target='_blank'
            rel='noopener noreferrer'
            aria-label={`Pixiv ${item.id}`}
            className={`group border-primary/20 bg-card focus-visible:ring-ring relative overflow-hidden rounded-2xl border shadow-sm transition-transform duration-200 outline-none hover:-translate-y-0.5 focus-visible:ring-2 ${item.className}`}
          >
            <img
              src={item.src}
              alt={`${t(skin.copy.character)} — Pixiv ${item.id}`}
              loading='lazy'
              decoding='async'
              className='absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]'
            />
            <span className='absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-[#092f43]/85 to-transparent px-4 pt-10 pb-3 text-[10px] font-medium tracking-[0.18em] text-white uppercase'>
              <span>{t(skin.copy.edition)}</span>
              <span className='text-white/80'>Pixiv · {item.id}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  )
}

/** A compact character journal anchored to the authenticated sidebar. */
export function AtriSidebarJournal() {
  const skin = useSkinAssets()
  const { t } = useTranslation()
  if (!skin.isAtri) return null

  return (
    <SidebarFooter className='group-data-[collapsible=icon]:hidden'>
      <div
        data-atri-element='sidebar-journal'
        className='border-primary/25 relative h-36 overflow-hidden rounded-2xl border shadow-sm'
      >
        <img
          src={ATRI_ARTWORK.crab}
          alt=''
          aria-hidden='true'
          loading='lazy'
          decoding='async'
          className='absolute inset-0 h-full w-full object-cover object-[center_30%]'
        />
        <div
          aria-hidden='true'
          className='absolute inset-0 bg-gradient-to-t from-[#062b40]/95 via-[#07384c]/35 to-transparent'
        />
        <TideGlyph className='absolute top-3 right-3 size-8 text-white/70' />
        <div className='absolute inset-x-3 bottom-3 text-white'>
          <p className='text-[9px] font-semibold tracking-[0.2em] text-white/75 uppercase'>
            {t(skin.copy.organization)}
          </p>
          <p className='mt-1 line-clamp-2 text-xs leading-relaxed font-medium'>
            {t(skin.copy.motto)}
          </p>
        </div>
      </div>
    </SidebarFooter>
  )
}
