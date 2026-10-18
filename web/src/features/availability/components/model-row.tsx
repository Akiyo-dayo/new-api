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
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import {
  LEVEL_DOT_CLASS,
  LEVEL_TEXT_CLASS,
  formatCount,
  formatPercent,
  type ModelAggregate,
} from '../lib/aggregate'
import { GroupStrip } from './group-strip'

interface ModelRowProps {
  aggregate: ModelAggregate
  onSelect: (aggregate: ModelAggregate) => void
}

export function ModelRow({ aggregate, onSelect }: ModelRowProps) {
  const { t } = useTranslation()
  const requests = aggregate.success + aggregate.errors

  return (
    <button
      type='button'
      onClick={() => onSelect(aggregate)}
      className='hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center gap-4 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none'
      aria-label={aggregate.model}
      data-testid='availability-model-row'
    >
      <span
        className={cn(
          'size-2.5 shrink-0 rounded-full',
          LEVEL_DOT_CLASS[aggregate.level]
        )}
        aria-hidden
      />
      <span className='min-w-0 flex-1'>
        <span
          className='block truncate text-sm font-medium'
          title={aggregate.model}
        >
          {aggregate.model}
        </span>
        <span className='text-muted-foreground mt-0.5 block text-xs'>
          {t('{{groups}} groups · {{requests}} requests · {{errors}} errors', {
            groups: aggregate.cells.length,
            requests: formatCount(requests),
            errors: formatCount(aggregate.errors),
          })}
        </span>
      </span>
      <span className='hidden w-48 shrink-0 sm:block md:w-64'>
        <GroupStrip cells={aggregate.cells} />
      </span>
      <span
        className={cn(
          'w-16 shrink-0 text-right text-sm font-semibold tabular-nums',
          LEVEL_TEXT_CLASS[aggregate.level]
        )}
      >
        {formatPercent(aggregate.availability)}
      </span>
      <ChevronRight className='text-muted-foreground size-4 shrink-0' />
    </button>
  )
}
