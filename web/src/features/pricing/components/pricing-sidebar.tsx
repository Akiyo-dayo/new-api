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
import { ChevronDown, EyeOff, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  ENDPOINT_TYPES,
  FILTER_ALL,
  QUOTA_TYPES,
  getEndpointTypeLabels,
  getQuotaTypeLabels,
} from '../constants'
import { parseTags } from '../lib/filters'
import type { GroupDisplay, PricingModel, PricingVendor } from '../types'

type FilterOption = {
  value: string
  label: string
  count?: number
  suffix?: string
  icon?: ReactNode
}

type FilterSectionProps = {
  title: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}

export interface PricingSidebarProps {
  quotaTypeFilter: string
  endpointTypeFilter: string
  vendorFilter: string
  groupFilter: string
  tagFilter: string
  onQuotaTypeChange: (value: string) => void
  onEndpointTypeChange: (value: string) => void
  onVendorChange: (value: string) => void
  onGroupChange: (value: string) => void
  onTagChange: (value: string) => void
  vendors: PricingVendor[]
  groups: string[]
  groupRatios?: Record<string, number>
  groupDisplay?: GroupDisplay
  tags: string[]
  models: PricingModel[]
  hasActiveFilters: boolean
  onClearFilters: () => void
  className?: string
}

function countBy(
  models: PricingModel[],
  predicate: (model: PricingModel) => boolean
): number {
  return models.reduce((count, model) => count + (predicate(model) ? 1 : 0), 0)
}

function formatGroupRatio(ratio: number | undefined): string | undefined {
  if (ratio == null) return undefined
  const formatted = Number.isInteger(ratio)
    ? ratio.toString()
    : ratio.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `x${formatted}`
}

const OTHER_FAMILY = '__other__'

/**
 * Derive a display family for a group name:
 * - Latin prefix followed by CJK or `-` (e.g. `LM-Kiro按次`, `Akiyo免费渠道`) -> uppercased prefix
 * - Leading CJK run (e.g. `浅夜三方渠道`) -> first two characters
 * - Anything else (e.g. `default`) -> OTHER_FAMILY
 */
function groupFamily(name: string): string {
  const latin = name.match(/^[A-Za-z]+/)
  if (latin) {
    return /[-一-鿿]/.test(name.slice(latin[0].length))
      ? latin[0].toUpperCase()
      : OTHER_FAMILY
  }
  const cjk = name.match(/^[一-鿿]{1,2}/)
  return cjk ? cjk[0] : OTHER_FAMILY
}

type GroupFamily = {
  key: string
  label: string
  groups: string[]
  defaultOpen: boolean
}

/**
 * Bucket groups into collapsible families.
 *
 * An admin-assigned category always wins. Groups with no category fall back to
 * `groupFamily`, which is what the square did before categories existed — so an
 * install that never configures anything keeps its current grouping instead of
 * flattening into one long list.
 *
 * Configured groups also lead the list in their configured (drag-sorted) order;
 * everything else follows in zh collation order.
 */
function bucketGroupFamilies(
  groups: string[],
  otherLabel: string,
  display?: GroupDisplay
): GroupFamily[] {
  const configuredIndex = new Map<string, number>()
  const configuredCategory = new Map<string, string>()
  ;(display?.groups ?? []).forEach((item, index) => {
    configuredIndex.set(item.group, index)
    if (item.category) configuredCategory.set(item.group, item.category)
  })
  const categoryExpanded = new Map(
    (display?.categories ?? []).map((c) => [c.name, c.default_expanded])
  )
  const categoryOrder = new Map(
    (display?.categories ?? []).map((c, index) => [c.name, index])
  )

  const collator = new Intl.Collator('zh-Hans-CN')
  const ordered = [...groups].sort((a, b) => {
    const ia = configuredIndex.get(a) ?? Number.POSITIVE_INFINITY
    const ib = configuredIndex.get(b) ?? Number.POSITIVE_INFINITY
    if (ia !== ib) return ia - ib
    return collator.compare(a, b)
  })

  const buckets = new Map<string, string[]>()
  const order: string[] = []
  for (const group of ordered) {
    const key = configuredCategory.get(group) ?? groupFamily(group)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
      order.push(key)
    }
    bucket.push(group)
  }

  const namedCategories = new Set(configuredCategory.values())
  const merged: GroupFamily[] = []
  const other: string[] = []
  for (const key of order) {
    const members = buckets.get(key) ?? []
    const named = namedCategories.has(key)
    // A derived singleton family is noise, so it goes to 其他. A category the
    // admin typed out stays put even with one member — they asked for it.
    if (key === OTHER_FAMILY || (!named && members.length === 1)) {
      other.push(...members)
      continue
    }
    merged.push({
      key,
      label: key,
      groups: members,
      // Derived families keep the always-open behaviour they had before this
      // control existed; named categories default to collapsed, since naming
      // one is an act of tidying up.
      defaultOpen: named ? (categoryExpanded.get(key) ?? false) : true,
    })
  }
  merged.sort((a, b) => {
    const ia = categoryOrder.get(a.key) ?? Number.POSITIVE_INFINITY
    const ib = categoryOrder.get(b.key) ?? Number.POSITIVE_INFINITY
    return ia - ib
  })
  if (other.length > 0) {
    merged.push({
      key: OTHER_FAMILY,
      label: otherLabel,
      groups: other,
      defaultOpen: true,
    })
  }
  return merged
}

function FilterChip(props: {
  option: FilterOption
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-all',
        props.active
          ? 'border-foreground/30 bg-foreground/5 text-foreground shadow-sm'
          : 'border-border/70 bg-background text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground'
      )}
      title={props.option.label}
    >
      {props.option.icon && (
        <span className='shrink-0'>{props.option.icon}</span>
      )}
      <span className='truncate'>{props.option.label}</span>
      {(props.option.suffix || props.option.count != null) && (
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[12px]',
            props.active
              ? 'bg-background text-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {props.option.suffix ?? props.option.count}
        </span>
      )}
    </button>
  )
}

function FilterSection(props: FilterSectionProps) {
  return (
    <Collapsible
      defaultOpen
      className='border-border/70 border-b pb-3 last:border-b-0'
    >
      <CollapsibleTrigger className='group flex w-full items-center justify-between py-2.5 text-left'>
        <span className='text-foreground text-sm font-semibold'>
          {props.title}
        </span>
        <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='flex flex-wrap gap-1.5'>
          {props.options.map((option) => (
            <FilterChip
              key={option.value}
              option={option}
              active={props.value === option.value}
              onClick={() => props.onChange(option.value)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function GroupRatioBadge(props: {
  ratio: number | undefined
  active: boolean
}) {
  const text = formatGroupRatio(props.ratio)
  if (!text) return null
  let tone: string
  if (props.ratio === 0) {
    tone = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
  } else if (props.ratio != null && props.ratio < 1) {
    tone = 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  } else if (props.active) {
    tone = 'bg-foreground/10 text-foreground'
  } else {
    tone = 'bg-muted text-muted-foreground'
  }
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
        tone
      )}
    >
      {text}
    </span>
  )
}

function GroupRow(props: {
  label: string
  ratio?: number
  active: boolean
  /** Explains why the group's models are missing from the "all groups" list. */
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={props.onClick}
      title={props.hint ? `${props.label} · ${props.hint}` : props.label}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all',
        props.active
          ? 'border-primary/45 bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:border-border/70 hover:bg-muted/50 hover:text-foreground border-transparent'
      )}
    >
      <span className='flex min-w-0 items-center gap-1'>
        {props.hint ? (
          <EyeOff className='size-3 shrink-0 opacity-60' aria-hidden />
        ) : null}
        <span className='truncate'>{props.label}</span>
      </span>
      <GroupRatioBadge ratio={props.ratio} active={props.active} />
    </button>
  )
}

type GroupFilterSectionProps = {
  title: string
  otherLabel: string
  value: string
  groups: string[]
  groupRatios?: Record<string, number>
  groupDisplay?: GroupDisplay
  hiddenLabel: string
  onChange: (value: string) => void
}

function GroupFilterSection(
  props: GroupFilterSectionProps & { allLabel: string }
) {
  const families = bucketGroupFamilies(
    props.groups,
    props.otherLabel,
    props.groupDisplay
  )
  const hiddenGroups = new Set(
    (props.groupDisplay?.groups ?? [])
      .filter((item) => item.hidden_by_default)
      .map((item) => item.group)
  )
  return (
    <Collapsible
      defaultOpen
      className='border-border/70 border-b pb-3 last:border-b-0'
    >
      <CollapsibleTrigger className='group flex w-full items-center justify-between py-2.5 text-left'>
        <span className='text-foreground text-sm font-semibold'>
          {props.title}
        </span>
        <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='space-y-0.5'>
          <GroupRow
            label={props.allLabel}
            active={props.value === FILTER_ALL}
            onClick={() => props.onChange(FILTER_ALL)}
          />
        </div>
        {families.map((family) => (
          <Collapsible
            key={family.key}
            defaultOpen={family.defaultOpen}
            className='mt-2.5'
          >
            <CollapsibleTrigger className='group/family text-muted-foreground/80 flex w-full items-center gap-1.5 px-1 pb-1.5 text-left text-[10.5px] font-semibold tracking-wider uppercase'>
              <ChevronDown className='size-3 shrink-0 transition-transform group-data-[panel-open]/family:rotate-180' />
              <span>{family.label}</span>
              <span className='font-medium tracking-normal normal-case opacity-70'>
                {family.groups.length}
              </span>
              <span className='bg-border/60 h-px flex-1' />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className='space-y-0.5'>
                {family.groups.map((group) => (
                  <GroupRow
                    key={group}
                    label={group}
                    ratio={props.groupRatios?.[group]}
                    active={props.value === group}
                    hint={
                      hiddenGroups.has(group) ? props.hiddenLabel : undefined
                    }
                    onClick={() => props.onChange(group)}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function PricingSidebar(props: PricingSidebarProps) {
  const { t } = useTranslation()
  const quotaTypeLabels = getQuotaTypeLabels(t)
  const endpointTypeLabels = getEndpointTypeLabels(t)

  const vendorOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Vendors'),
      count: props.models.length,
    },
    ...props.vendors
      .map((vendor) => ({
        value: vendor.name,
        label: vendor.name,
        count: countBy(
          props.models,
          (model) => model.vendor_name === vendor.name
        ),
        icon: vendor.icon ? getLobeIcon(vendor.icon, 14) : undefined,
      }))
      .filter((vendor) => vendor.count > 0),
  ]

  const quotaOptions: FilterOption[] = [
    {
      value: QUOTA_TYPES.ALL,
      label: quotaTypeLabels[QUOTA_TYPES.ALL],
      count: props.models.length,
    },
    {
      value: QUOTA_TYPES.TOKEN,
      label: quotaTypeLabels[QUOTA_TYPES.TOKEN],
      count: countBy(props.models, (model) => model.quota_type === 0),
    },
    {
      value: QUOTA_TYPES.REQUEST,
      label: quotaTypeLabels[QUOTA_TYPES.REQUEST],
      count: countBy(props.models, (model) => model.quota_type === 1),
    },
  ]

  const tagOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Tags'),
      count: props.models.length,
    },
    ...props.tags.map((tag) => ({
      value: tag,
      label: tag,
      count: countBy(props.models, (model) =>
        parseTags(model.tags)
          .map((item) => item.toLowerCase())
          .includes(tag.toLowerCase())
      ),
    })),
  ]

  const endpointOptions: FilterOption[] = [
    {
      value: ENDPOINT_TYPES.ALL,
      label: endpointTypeLabels[ENDPOINT_TYPES.ALL],
      count: props.models.length,
    },
    ...Object.entries(endpointTypeLabels)
      .filter(([value]) => value !== ENDPOINT_TYPES.ALL)
      .map(([value, label]) => ({
        value,
        label,
        count: countBy(
          props.models,
          (model) => model.supported_endpoint_types?.includes(value) ?? false
        ),
      })),
  ]

  return (
    <aside className={cn('rounded-xl border p-3', props.className)}>
      <div className='mb-2.5 flex items-start justify-between gap-2'>
        <div>
          <h2 className='text-foreground flex items-center gap-1.5 text-sm font-bold'>
            {t('Filter')}
            {props.hasActiveFilters && (
              <span
                className='bg-primary inline-block size-1.5 shrink-0 rounded-full'
                title={t('Filters active')}
              />
            )}
          </h2>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Refine models by provider, group, type, and tags.')}
          </p>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={props.onClearFilters}
          disabled={!props.hasActiveFilters}
          className={cn(
            'h-7 shrink-0 gap-1.5 px-2 text-xs',
            props.hasActiveFilters && 'text-primary hover:text-primary'
          )}
        >
          <RotateCcw className='size-3.5' />
          {t('Reset')}
        </Button>
      </div>

      <div className='space-y-1'>
        <GroupFilterSection
          title={t('Groups')}
          allLabel={t('All Groups')}
          otherLabel={t('Other')}
          value={props.groupFilter}
          groups={props.groups}
          groupRatios={props.groupRatios}
          groupDisplay={props.groupDisplay}
          hiddenLabel={t('Hidden from the all-groups list')}
          onChange={props.onGroupChange}
        />
        <FilterSection
          title={t('All Vendors')}
          value={props.vendorFilter}
          options={vendorOptions}
          onChange={props.onVendorChange}
        />
        <FilterSection
          title={t('Model Tags')}
          value={props.tagFilter}
          options={tagOptions}
          onChange={props.onTagChange}
        />
        <FilterSection
          title={t('Pricing Type')}
          value={props.quotaTypeFilter}
          options={quotaOptions}
          onChange={props.onQuotaTypeChange}
        />
        <FilterSection
          title={t('Endpoint Type')}
          value={props.endpointTypeFilter}
          options={endpointOptions}
          onChange={props.onEndpointTypeChange}
        />
      </div>
    </aside>
  )
}
