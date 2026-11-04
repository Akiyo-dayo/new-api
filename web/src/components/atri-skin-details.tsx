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

const ATRI_SIDEBAR_ART = '/atri/atri-starlit.webp?v=atri-r2'

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
          src={ATRI_SIDEBAR_ART}
          alt=''
          aria-hidden='true'
          loading='lazy'
          decoding='async'
          className='absolute inset-0 h-full w-full object-cover object-center'
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
