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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CLAUDE_STICKERS, useSkinAssets } from '@/hooks/use-skin-assets'

interface SkinEmptyVisualProps {
  /** Small icon pinned to the sprite's bottom-right corner. */
  badge?: ReactNode
  /** Table-like empty states get the whale sticker under the Claude skin. */
  context?: 'table' | 'generic'
}

/**
 * The picture above every empty state: the active skin's sprite with an
 * optional corner badge. Under the Claude skin it is a sticker instead —
 * the whale-snatching one for empty tables, the sleeping one elsewhere.
 */
export function SkinEmptyVisual(props: SkinEmptyVisualProps) {
  const { t } = useTranslation()
  const skin = useSkinAssets()

  if (skin.isClaude) {
    const isTable = props.context === 'table'
    return (
      <div className='-mb-1 flex flex-col items-center gap-1.5'>
        <img
          src={
            isTable ? CLAUDE_STICKERS.emptyTable : CLAUDE_STICKERS.emptyState
          }
          alt=''
          aria-hidden
          className='claude-sticker pointer-events-none h-28 w-auto select-none'
        />
        {isTable && (
          <p className='text-muted-foreground text-xs'>
            {t('This place is empty — even the little whale got carried off')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className='relative -mb-2'>
      <img
        src={skin.sprite}
        alt=''
        aria-hidden
        className='pointer-events-none h-28 w-auto opacity-90 select-none dark:opacity-80'
      />
      {props.badge != null && (
        <span className='bg-background text-muted-foreground absolute -right-1 -bottom-1 rounded-full border p-1.5 shadow-sm'>
          {props.badge}
        </span>
      )}
    </div>
  )
}
