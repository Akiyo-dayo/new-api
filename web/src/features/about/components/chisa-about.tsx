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

import { ChisaAmbient } from '@/components/chisa-ambient'
import { PublicLayout } from '@/components/layout'
import { useSkinAssets } from '@/hooks/use-skin-assets'
import { useStatus } from '@/hooks/use-status'

import { ServerStatusPanel } from './server-status-panel'

/**
 * Default Phoebe-themed About view, shown when the admin has not configured
 * custom about content. Centers on the live server status panel and keeps
 * the upstream attribution line.
 */
export function ChisaAbout() {
  const { t } = useTranslation()
  const skin = useSkinAssets()
  const { status } = useStatus()
  const systemName = (status?.system_name as string | undefined) || 'New API'
  const currentYear = new Date().getFullYear()

  let pill = {
    box: 'border-rose-500/20 bg-rose-500/5',
    ring: 'ring-rose-500/25',
    text: 'text-rose-500 dark:text-rose-400',
  }
  if (skin.isLightSkin) {
    pill = {
      box: 'border-sky-500/20 bg-sky-500/5',
      ring: 'ring-sky-500/25',
      text: 'text-sky-600 dark:text-sky-400',
    }
  }
  if (skin.usesThemeTokens) {
    pill = {
      box: 'border-primary/20 bg-primary/5',
      ring: 'ring-primary/25',
      text: 'text-primary',
    }
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <ChisaAmbient />
        <div className='relative mx-auto w-full max-w-3xl px-4 pt-24 pb-16 sm:px-6 sm:pt-28'>
          <header className='mb-8 text-center sm:mb-10'>
            <div
              className={`landing-animate-fade-up mb-5 inline-flex items-center gap-2.5 rounded-full border py-1.5 pr-4 pl-1.5 opacity-0 ${pill.box}`}
              style={{ animationDelay: '0ms' }}
            >
              <img
                src={skin.icon}
                alt=''
                aria-hidden
                className={`size-6 rounded-full ring-1 ${pill.ring}`}
              />
              <span
                className={`text-[11px] font-semibold tracking-[0.24em] uppercase ${pill.text}`}
              >
                {t(skin.copy.edition)}
              </span>
            </div>
            <h1
              className='landing-animate-fade-up text-[clamp(1.9rem,4.5vw,2.75rem)] leading-[1.15] font-bold tracking-tight opacity-0'
              style={{ animationDelay: '60ms' }}
            >
              {t('Server Status')}
            </h1>
            <p
              className='landing-animate-fade-up text-muted-foreground/80 mx-auto mt-3 max-w-xl text-sm opacity-0 sm:text-base'
              style={{ animationDelay: '120ms' }}
            >
              {t('Live health of the {{name}} service node', {
                name: systemName,
              })}
            </p>
          </header>

          <ServerStatusPanel />

          <p className='text-muted-foreground/50 mt-10 text-center text-xs leading-relaxed'>
            <a
              href='https://github.com/QuantumNous/new-api'
              target='_blank'
              rel='noopener noreferrer'
              className='text-muted-foreground/70 hover:text-foreground transition-colors'
            >
              New API
            </a>{' '}
            © {currentYear} QuantumNous · {t('Based on')}{' '}
            <a
              href='https://github.com/songquanpeng/one-api'
              target='_blank'
              rel='noopener noreferrer'
              className='text-muted-foreground/70 hover:text-foreground transition-colors'
            >
              One API
            </a>{' '}
            © 2023 JustSong · AGPL v3.0
          </p>
        </div>
      </div>
    </PublicLayout>
  )
}
