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

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  LEVEL_BAR_CLASS,
  formatCount,
  formatPercent,
  levelOf,
} from '../lib/aggregate'
import type { AvailabilityCell } from '../types'

interface GroupStripProps {
  cells: AvailabilityCell[]
}

/**
 * One segment per group, width proportional to request volume, so a quick
 * glance shows both health and where the traffic actually went.
 */
export function GroupStrip({ cells }: GroupStripProps) {
  const { t } = useTranslation()
  const total = cells.reduce((sum, c) => sum + c.success + c.errors, 0)

  return (
    <TooltipProvider delay={0}>
      <div
        className='bg-muted flex h-2 w-full overflow-hidden rounded-full'
        data-testid='availability-group-strip'
      >
        {cells.map((cell) => {
          const requests = cell.success + cell.errors
          const weight = total > 0 ? (requests / total) * 100 : 0
          return (
            <Tooltip key={cell.group || '—'}>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      'h-full min-w-1.5 transition-opacity hover:opacity-70',
                      LEVEL_BAR_CLASS[levelOf(cell.availability)]
                    )}
                    style={{ width: `${Math.max(weight, 1.5)}%` }}
                  />
                }
              />
              <TooltipContent>
                <div className='space-y-0.5 text-xs'>
                  <p className='font-medium'>{cell.group || '—'}</p>
                  <p>
                    {t('Availability')}: {formatPercent(cell.availability)} ·{' '}
                    {t('{{count}} requests', {
                      count: formatCount(requests),
                    })}
                  </p>
                  <p>
                    {t('Success')}: {formatCount(cell.success)} · {t('Errors')}:{' '}
                    {formatCount(cell.errors)}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
