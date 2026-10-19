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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  LEVEL_BAR_CLASS,
  LEVEL_DOT_CLASS,
  LEVEL_TEXT_CLASS,
  formatCount,
  formatPercent,
  levelOf,
  type ModelAggregate,
  type SortMode,
} from '../lib/aggregate'

function formatTimestamp(ts: number): string {
  if (!ts) return '—'
  return dayjs.unix(ts).format('YYYY-MM-DD HH:mm:ss')
}

interface DetailSheetProps {
  aggregate: ModelAggregate | null
  sortMode: SortMode
  onClose: () => void
}

export function DetailSheet({
  aggregate,
  sortMode,
  onClose,
}: DetailSheetProps) {
  const { t } = useTranslation()
  const canViewErrors = useAuthStore(
    (state) => (state.auth.user?.role ?? 0) >= ROLE.ADMIN
  )

  // Group list follows the board's current sort mode.
  const sortedCells = useMemo(() => {
    if (!aggregate) return []
    const cells = [...aggregate.cells]
    switch (sortMode) {
      case 'name':
        cells.sort((a, b) => a.group.localeCompare(b.group))
        break
      case 'volume':
        cells.sort((a, b) => b.success + b.errors - (a.success + a.errors))
        break
      case 'worst':
      default:
        // aggregate.cells already arrive worst-first
        break
    }
    return cells
  }, [aggregate, sortMode])

  const recentErrors = useMemo(() => {
    if (!aggregate) return []
    return aggregate.cells
      .flatMap((cell) =>
        cell.recent_errors.map((error) => ({ ...error, group: cell.group }))
      )
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 10)
  }, [aggregate])

  return (
    <Sheet
      open={aggregate !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className='overflow-y-auto sm:max-w-lg'>
        {aggregate && (
          <>
            <SheetHeader>
              <SheetTitle className='wrap-anywhere'>
                {aggregate.model}
              </SheetTitle>
              <SheetDescription>
                {t('Overall availability')}:{' '}
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    LEVEL_TEXT_CLASS[aggregate.level]
                  )}
                >
                  {formatPercent(aggregate.availability)}
                </span>
                {' · '}
                {t('{{count}} requests', {
                  count: formatCount(aggregate.success + aggregate.errors),
                })}
              </SheetDescription>
            </SheetHeader>
            <div className='space-y-6 px-4 pb-6'>
              <section className='space-y-2'>
                <h3 className='text-sm font-medium'>
                  {t('Availability by group')}
                </h3>
                <ul className='divide-border divide-y rounded-lg border'>
                  {sortedCells.map((cell) => {
                    const requests = cell.success + cell.errors
                    const level = levelOf(cell.availability)
                    return (
                      <li key={cell.group || '—'} className='space-y-2 p-3'>
                        <div className='flex items-center justify-between gap-3'>
                          <span className='flex min-w-0 items-center gap-2'>
                            <span
                              className={cn(
                                'size-2 shrink-0 rounded-full',
                                LEVEL_DOT_CLASS[level]
                              )}
                            />
                            <span
                              className='truncate text-sm font-medium'
                              title={cell.group || '—'}
                            >
                              {cell.group || '—'}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'shrink-0 text-sm font-semibold tabular-nums',
                              LEVEL_TEXT_CLASS[level]
                            )}
                          >
                            {formatPercent(cell.availability)}
                          </span>
                        </div>
                        <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
                          <div
                            className={cn('h-full', LEVEL_BAR_CLASS[level])}
                            style={{
                              width: `${Math.max(cell.availability * 100, 1)}%`,
                            }}
                          />
                        </div>
                        <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
                          <span>
                            {t('Success')}: {formatCount(cell.success)}
                          </span>
                          <span>
                            {t('Errors')}: {formatCount(cell.errors)}
                          </span>
                          <span>
                            {t('Requests')}: {formatCount(requests)}
                          </span>
                        </div>
                        <dl className='text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
                          <dt>{t('Last success')}</dt>
                          <dd className='text-right tabular-nums'>
                            {formatTimestamp(cell.last_success_at)}
                          </dd>
                          <dt>{t('Last error')}</dt>
                          <dd className='text-right tabular-nums'>
                            {formatTimestamp(cell.last_error_at)}
                          </dd>
                        </dl>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section className='space-y-2'>
                <h3 className='text-sm font-medium'>{t('Recent errors')}</h3>
                {recentErrors.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>
                    {t('No recent errors')}
                  </p>
                ) : (
                  <ul className='space-y-2'>
                    {recentErrors.map((error) => (
                      <li
                        key={`${error.group}-${error.channel_id}-${error.created_at}-${error.content}`}
                        className='border-border space-y-1.5 rounded-md border p-3'
                      >
                        <div className='flex items-center justify-between gap-2 text-xs'>
                          <span className='flex min-w-0 items-center gap-1.5'>
                            <Badge
                              variant='secondary'
                              className='max-w-40 truncate'
                            >
                              {error.group || '—'}
                            </Badge>
                            {canViewErrors && (
                              <span className='text-muted-foreground shrink-0'>
                                {t('Channel')} #{error.channel_id}
                              </span>
                            )}
                          </span>
                          <time className='text-muted-foreground shrink-0 tabular-nums'>
                            {formatTimestamp(error.created_at)}
                          </time>
                        </div>
                        <p className='text-xs wrap-anywhere whitespace-pre-wrap'>
                          {canViewErrors ? error.content : t(error.content)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
