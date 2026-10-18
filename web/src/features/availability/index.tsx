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
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import { getAvailabilityMatrix } from './api'
import { DetailSheet } from './components/detail-sheet'
import { ModelRow } from './components/model-row'
import { SummaryStats } from './components/summary-stats'
import {
  DEGRADED_THRESHOLD,
  LEVEL_DOT_CLASS,
  aggregateByModel,
  sortAggregates,
  type ModelAggregate,
  type SortMode,
} from './lib/aggregate'

const WINDOW_OPTIONS = [
  { value: '1', label: '1h' },
  { value: '6', label: '6h' },
  { value: '24', label: '24h' },
  { value: '72', label: '72h' },
  { value: '168', label: '7d' },
] as const

function formatTimestamp(ts: number): string {
  if (!ts) return '—'
  return dayjs.unix(ts).format('YYYY-MM-DD HH:mm:ss')
}

export function AvailabilityBoard() {
  const { t } = useTranslation()
  const [hours, setHours] = useState(24)
  const [modelFilter, setModelFilter] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('volume')
  const [degradedOnly, setDegradedOnly] = useState(false)
  const [selected, setSelected] = useState<ModelAggregate | null>(null)

  const matrixQuery = useQuery({
    queryKey: ['availability', 'matrix', hours],
    queryFn: () => getAvailabilityMatrix(hours),
  })
  const data = matrixQuery.data?.data

  const aggregates = useMemo(() => {
    const all = aggregateByModel(data?.cells ?? [])
    const keyword = modelFilter.trim().toLowerCase()
    const filtered = keyword
      ? all.filter((a) => a.model.toLowerCase().includes(keyword))
      : all
    const visible = degradedOnly
      ? filtered.filter((a) => a.availability < DEGRADED_THRESHOLD)
      : filtered
    return sortAggregates(visible, sortMode)
  }, [data?.cells, modelFilter, degradedOnly, sortMode])

  const allAggregates = useMemo(
    () => aggregateByModel(data?.cells ?? []),
    [data?.cells]
  )

  const hasData = (data?.cells?.length ?? 0) > 0

  const legend = [
    { key: 'good', label: t('≥ 99%') },
    { key: 'fair', label: '95% – 99%' },
    { key: 'degraded', label: '80% – 95%' },
    { key: 'critical', label: '< 80%' },
  ] as const

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Model Availability')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-6xl space-y-4 pb-10'>
          {/* Toolbar */}
          <div className='flex flex-wrap items-center gap-3'>
            <Tabs
              value={String(hours)}
              onValueChange={(value) => setHours(Number(value))}
            >
              <TabsList aria-label={t('Time window')}>
                {WINDOW_OPTIONS.map((option) => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className='relative min-w-48 flex-1 sm:max-w-xs'>
              <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
              <Input
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                placeholder={t('Search models')}
                aria-label={t('Search models')}
                className='pl-8'
              />
            </div>
            <Select
              value={sortMode}
              onValueChange={(value) => setSortMode(value as SortMode)}
            >
              <SelectTrigger className='w-40' aria-label={t('Sort by')}>
                <SelectValue>
                  {t(
                    {
                      worst: 'By success rate',
                      volume: 'By popularity',
                      name: 'Name',
                    }[sortMode]
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='worst'>{t('By success rate')}</SelectItem>
                <SelectItem value='volume'>{t('By popularity')}</SelectItem>
                <SelectItem value='name'>{t('Name')}</SelectItem>
              </SelectContent>
            </Select>
            <div className='flex items-center gap-2'>
              <Switch
                id='availability-degraded-only'
                checked={degradedOnly}
                onCheckedChange={setDegradedOnly}
              />
              <Label
                htmlFor='availability-degraded-only'
                className='text-sm whitespace-nowrap'
              >
                {t('Degraded only')}
              </Label>
            </div>
            <Button
              variant='outline'
              size='sm'
              disabled={matrixQuery.isFetching}
              onClick={() => void matrixQuery.refetch()}
            >
              <RefreshCw
                className={cn(
                  'size-4',
                  matrixQuery.isFetching && 'animate-spin'
                )}
              />
              {t('Refresh')}
            </Button>
            {data && (
              <span className='text-muted-foreground text-xs'>
                {t('Generated at')}: {formatTimestamp(data.generated_at)}
              </span>
            )}
          </div>

          {matrixQuery.isError && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Failed to load availability data')}
            </p>
          )}

          {matrixQuery.isLoading && (
            <div className='space-y-3' data-testid='availability-loading'>
              <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
                {['models', 'groups', 'requests', 'availability'].map((key) => (
                  <Skeleton key={key} className='h-24 w-full' />
                ))}
              </div>
              <Skeleton className='h-64 w-full' />
            </div>
          )}

          {!matrixQuery.isLoading && !hasData && !matrixQuery.isError && (
            <Card className='py-0'>
              <p className='text-muted-foreground py-12 text-center text-sm'>
                {t('No availability data in this window')}
              </p>
            </Card>
          )}

          {!matrixQuery.isLoading && hasData && (
            <>
              <SummaryStats
                aggregates={allAggregates}
                groupCount={data?.groups?.length ?? 0}
              />

              {/* Legend */}
              <div
                className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'
                data-testid='availability-legend'
              >
                {legend.map((item) => (
                  <span key={item.key} className='flex items-center gap-1.5'>
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        LEVEL_DOT_CLASS[item.key]
                      )}
                    />
                    {item.label}
                  </span>
                ))}
                <span className='ml-auto'>
                  {t('{{shown}} of {{total}} models', {
                    shown: aggregates.length,
                    total: allAggregates.length,
                  })}
                </span>
              </div>

              {/* Model list */}
              {aggregates.length === 0 ? (
                <Card className='py-0'>
                  <p className='text-muted-foreground py-12 text-center text-sm'>
                    {t('No models match the current filters')}
                  </p>
                </Card>
              ) : (
                <Card
                  className='divide-border divide-y py-0'
                  data-testid='availability-model-list'
                >
                  {aggregates.map((aggregate) => (
                    <ModelRow
                      key={aggregate.model}
                      aggregate={aggregate}
                      onSelect={setSelected}
                    />
                  ))}
                </Card>
              )}
            </>
          )}

          <DetailSheet
            aggregate={selected}
            sortMode={sortMode}
            onClose={() => setSelected(null)}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
