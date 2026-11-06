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
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { ClaudeArtCredit } from '@/components/claude-skin-details'
import { Button } from '@/components/ui/button'
import { CLAUDE_STICKERS, useSkinAssets } from '@/hooks/use-skin-assets'

export function NotFoundError() {
  const { t } = useTranslation()
  const skin = useSkinAssets()
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <div className='relative h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        {skin.isClaude ? (
          // The source sticker is only 170px wide; keep it at 140px or less.
          <figure className='mb-2 flex flex-col items-center gap-2'>
            <img
              src={CLAUDE_STICKERS.notFound}
              alt=''
              aria-hidden
              className='claude-sticker pointer-events-none w-[140px] max-w-full select-none'
            />
            <figcaption className='text-muted-foreground text-xs'>
              {t("Your account is still here — it's this page that's gone")}
            </figcaption>
          </figure>
        ) : (
          <img
            src={skin.sprite}
            alt=''
            aria-hidden
            className='pointer-events-none mb-2 h-40 w-auto opacity-80 select-none'
          />
        )}
        <h1 className='text-[7rem] leading-tight font-bold'>404</h1>
        <span className='font-medium'>{t('Oops! Page Not Found!')}</span>
        <p className='text-muted-foreground text-center'>
          {t("It seems like the page you're looking for")} <br />
          {t('does not exist or might have been removed.')}
        </p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            {t('Go Back')}
          </Button>
          <Button onClick={() => navigate({ to: '/' })}>
            {t('Back to Home')}
          </Button>
        </div>
      </div>
      <ClaudeArtCredit className='absolute right-4 bottom-3' />
    </div>
  )
}
