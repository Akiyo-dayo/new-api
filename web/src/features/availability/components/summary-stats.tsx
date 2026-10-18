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
import { Activity, AlertTriangle, Boxes, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import {
  DEGRADED_THRESHOLD,
  LEVEL_TEXT_CLASS,
  formatCount,
  formatPercent,
  levelOf,
  type ModelAggregate,
} from '../lib/aggregate'

interface SummaryStatsProps {
  aggregates: ModelAggregate[]
  groupCount: number
}

export function SummaryStats({ aggregates, groupCount }: SummaryStatsProps) {
  const { t } = useTranslation()

  const success = aggregates.reduce((sum, a) => sum + a.success, 0)
  const errors = aggregates.reduce((sum, a) => sum + a.errors, 0)
  const total = success + errors
  const overall = total > 0 ? success / total : undefined
  const degraded = aggregates.filter(
    (a) => a.availability < DEGRADED_THRESHOLD
  ).length

  const stats = [
    {
      icon: Activity,
      label: t('Overall availability'),
      value: overall === undefined ? '—' : formatPercent(overall),
      valueClass: LEVEL_TEXT_CLASS[levelOf(overall)],
      hint: t('{{count}} requests', { count: formatCount(total) }),
    },
    {
      icon: Boxes,
      label: t('Monitored models'),
      value: formatCount(aggregates.length),
      valueClass: undefined,
      hint: t('Across {{count}} groups', { count: groupCount }),
    },
    {
      icon: AlertTriangle,
      label: t('Degraded models'),
      value: formatCount(degraded),
      valueClass:
        degraded > 0 ? LEVEL_TEXT_CLASS.degraded : LEVEL_TEXT_CLASS.good,
      hint: t('Below {{threshold}}', {
        threshold: formatPercent(DEGRADED_THRESHOLD),
      }),
    },
    {
      icon: Layers,
      label: t('Failed requests'),
      value: formatCount(errors),
      valueClass:
        errors > 0 ? LEVEL_TEXT_CLASS.critical : LEVEL_TEXT_CLASS.good,
      hint: t('In the selected window'),
    },
  ]

  return (
    <div
      className='grid grid-cols-2 gap-3 lg:grid-cols-4'
      data-testid='availability-summary'
    >
      {stats.map((stat) => (
        <Card key={stat.label} className='py-0'>
          <CardContent className='flex items-start gap-3 p-4'>
            <div className='bg-muted text-muted-foreground mt-0.5 rounded-md p-2'>
              <stat.icon className='size-4' />
            </div>
            <div className='min-w-0'>
              <p className='text-muted-foreground truncate text-xs'>
                {stat.label}
              </p>
              <p
                className={cn(
                  'text-xl font-semibold tabular-nums',
                  stat.valueClass
                )}
              >
                {stat.value}
              </p>
              <p className='text-muted-foreground truncate text-xs'>
                {stat.hint}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
