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
import { Check, ChevronDown, Minus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import type { ApiKeyFormValues } from '../lib'
import {
  buildPriceLadder,
  formatRatioBound,
  formatRatioRange,
  isRatioRangeGroup,
  parseRatioRange,
  resolveRatioRange,
  toggleLadderBound,
  type PriceTier,
  type RatioRangeBounds,
  type ResolvedModel,
} from '../lib/ratio-range'
import {
  ApiKeyGroupCombobox,
  type ApiKeyGroupOption,
} from './api-key-group-combobox'

type ApiKeyGroupModeFieldsProps = {
  form: UseFormReturn<ApiKeyFormValues>
  /** Concrete groups the user may bill to, from `/api/user/self/groups`. */
  groupOptions: ApiKeyGroupOption[]
  /** `group -> models`, inverted from `/api/pricing`. */
  groupModels: Record<string, string[]>
  /** True while the pricing catalogue is still loading. */
  loadingModels: boolean
}

/**
 * The group dimension of the key form: bill to one group, or accept any group
 * inside a price range.
 *
 * The range mode is driven by a price ladder rather than by two free-text
 * numbers. Typing bounds by hand fails in a way nothing on screen explains: a
 * `0.14` upper bound silently drops the `0.1375` group the user was aiming at.
 * Clicking rungs can only ever produce bounds that are real group ratios.
 *
 * The model allow-list lives here too rather than under Advanced Settings: a
 * range spans several groups, so its model list is the union of all of them —
 * without a way to narrow it right here, the key ends up able to call every
 * odd model any group in the range happens to carry.
 */
export function ApiKeyGroupModeFields(props: ApiKeyGroupModeFieldsProps) {
  const { t } = useTranslation()
  const selectedGroup = props.form.watch('group') ?? ''
  // `watch` hands back a fresh array every render, so the preview is keyed on
  // its contents instead. A comma is a safe joiner: the key's model list is
  // itself stored comma-joined, so no model name can contain one.
  const modelLimitsKey = (props.form.watch('model_limits') ?? []).join(',')
  const modelLimits = useMemo(
    () => (modelLimitsKey === '' ? [] : modelLimitsKey.split(',')),
    [modelLimitsKey]
  )
  const bounds = parseRatioRange(selectedGroup)
  const mode = bounds ? 'range' : 'group'

  // Remember the concrete group so flipping to the range mode and back does not
  // quietly move the key to another group. Tracked in an effect rather than as
  // initial state because this drawer stays mounted between keys.
  const [lastConcreteGroup, setLastConcreteGroup] = useState('')
  useEffect(() => {
    if (selectedGroup && !isRatioRangeGroup(selectedGroup)) {
      setLastConcreteGroup(selectedGroup)
    }
  }, [selectedGroup])

  const ladder = useMemo(
    () =>
      buildPriceLadder(
        Object.fromEntries(
          props.groupOptions.map((option) => [
            option.value,
            typeof option.ratio === 'number' ? option.ratio : undefined,
          ])
        ),
        props.groupModels
      ),
    [props.groupOptions, props.groupModels]
  )

  // Everything the range can reach, before the allow-list is applied. The
  // picker has to offer this rather than the narrowed set, or choosing one
  // model would collapse the list to that single option.
  const reachable = useMemo(
    () =>
      resolveRatioRange(
        ladder,
        bounds ?? { min: '', max: '' },
        props.groupModels
      ),
    [ladder, bounds, props.groupModels]
  )

  const allowed = new Set(modelLimits)
  const chosen = modelLimits.length
    ? reachable.models.filter((item) => allowed.has(item.model))
    : reachable.models
  // Picked models the range cannot serve: the key would list them (the model
  // limit drives /v1/models) and then fail every call to them.
  const unreachable = modelLimits.filter(
    (name) => !reachable.models.some((item) => item.model === name)
  )

  const setBounds = (next: RatioRangeBounds) =>
    props.form.setValue('group', formatRatioRange(next.min, next.max), {
      shouldDirty: true,
    })

  const setModels = (next: string[]) =>
    props.form.setValue('model_limits', next, { shouldDirty: true })

  const switchMode = (next: 'group' | 'range') => {
    if (next === mode) return
    if (next === 'group') {
      const fallback =
        lastConcreteGroup ||
        props.groupOptions.find((option) => option.value === 'default')
          ?.value ||
        props.groupOptions[0]?.value ||
        ''
      props.form.setValue('group', fallback, { shouldDirty: true })
      return
    }
    const lowest = ladder[0]?.ratio
    const highest = ladder.at(-1)?.ratio
    // Default to the whole ladder: with cheapest-first routing that reads as
    // "always give me the best price available", which is what a user reaching
    // for a range wants before they start trimming.
    setBounds({
      min: lowest === undefined ? '0' : formatRatioBound(lowest),
      max: highest === undefined ? '1' : formatRatioBound(highest),
    })
  }

  return (
    <>
      <FormField
        control={props.form.control}
        name='group'
        render={() => (
          <FormItem>
            <FormLabel>{t('Group')}</FormLabel>
            <FormControl>
              <ToggleGroup
                value={[mode]}
                onValueChange={(value) => {
                  const next = value.find((item) => item !== mode)
                  if (next === 'group' || next === 'range') switchMode(next)
                }}
                aria-label={t('Billing group mode')}
                variant='outline'
                spacing={0}
              >
                <ToggleGroupItem value='group' className='px-3 text-xs'>
                  {t('Single group')}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value='range'
                  className='px-3 text-xs'
                  disabled={ladder.length === 0}
                >
                  {t('Price range')}
                </ToggleGroupItem>
              </ToggleGroup>
            </FormControl>
            <FormDescription className='text-xs'>
              {mode === 'group'
                ? t('Every request bills to the one group you pick.')
                : t(
                    'Each request takes the cheapest group in range that serves the model, rotating between groups that charge the same.'
                  )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {mode === 'group' && (
        <FormField
          control={props.form.control}
          name='group'
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <ApiKeyGroupCombobox
                  options={props.groupOptions}
                  value={field.value}
                  onValueChange={field.onChange}
                  placeholder={t('Select a group')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {mode === 'range' && bounds && (
        <div className='space-y-3'>
          <PriceLadder
            ladder={ladder}
            bounds={bounds}
            chosen={chosen}
            hasSelection={modelLimits.length > 0}
            onPick={(ratio) =>
              setBounds(toggleLadderBound(ladder, bounds, ratio))
            }
          />

          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Accepted ratio')}
            </span>
            <Input
              value={bounds.min}
              inputMode='decimal'
              aria-label={t('Minimum ratio')}
              className='h-8 w-24'
              onChange={(e) => setBounds({ ...bounds, min: e.target.value })}
            />
            <Minus className='text-muted-foreground size-3' aria-hidden />
            <Input
              value={bounds.max}
              inputMode='decimal'
              aria-label={t('Maximum ratio')}
              className='h-8 w-24'
              onChange={(e) => setBounds({ ...bounds, max: e.target.value })}
            />
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-8 text-xs'
              onClick={() => {
                const lowest = ladder[0]?.ratio
                const highest = ladder.at(-1)?.ratio
                if (lowest === undefined || highest === undefined) return
                setBounds({
                  min: formatRatioBound(lowest),
                  max: formatRatioBound(highest),
                })
              }}
            >
              {t('All tiers')}
            </Button>
          </div>

          <FormField
            control={props.form.control}
            name='model_limits'
            render={() => (
              <FormItem>
                <div className='flex items-center justify-between gap-2'>
                  <FormLabel>{t('Allowed models')}</FormLabel>
                  <div className='flex items-center gap-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 text-xs'
                      disabled={reachable.models.length === 0}
                      onClick={() =>
                        setModels(reachable.models.map((item) => item.model))
                      }
                    >
                      {t('Select all')}
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 text-xs'
                      disabled={modelLimits.length === 0}
                      onClick={() => setModels([])}
                    >
                      {t('Clear')}
                    </Button>
                  </div>
                </div>
                <FormControl>
                  <MultiSelect
                    options={reachable.models.map((item) => ({
                      label: item.model,
                      value: item.model,
                    }))}
                    selected={modelLimits}
                    onChange={setModels}
                    maxVisibleChips={6}
                    disabled={props.loadingModels}
                    placeholder={t('Leave empty to allow every model in range')}
                  />
                </FormControl>
                <FormDescription className='text-xs'>
                  {modelLimits.length === 0
                    ? t(
                        'Empty means all {{count}} models the range reaches, including whatever the cheaper groups happen to carry.',
                        { count: reachable.models.length }
                      )
                    : t('{{selected}} of {{total}} models in range', {
                        selected: chosen.length,
                        total: reachable.models.length,
                      })}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {unreachable.length > 0 && (
            <div className='text-destructive bg-destructive/5 flex items-start gap-2 rounded-lg px-3 py-2 text-xs'>
              <span className='min-w-0 flex-1'>
                {t(
                  '{{count}} picked models are outside this range and every call to them would fail: {{models}}',
                  {
                    count: unreachable.length,
                    models: unreachable.join(', '),
                  }
                )}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-6 shrink-0 text-xs'
                onClick={() =>
                  setModels(
                    modelLimits.filter((name) => !unreachable.includes(name))
                  )
                }
              >
                {t('Remove them')}
              </Button>
            </div>
          )}

          <RangeSummary
            tierCount={reachable.tiers.length}
            groupCount={reachable.groups.length}
            models={chosen}
            hasSelection={modelLimits.length > 0}
            validBounds={reachable.valid}
          />
        </div>
      )}
    </>
  )
}

function ratioLabel(ratio: number) {
  return `x${ratio}`
}

function PriceLadder(props: {
  ladder: PriceTier[]
  bounds: RatioRangeBounds
  /** Models the key will actually be able to call, with their billing tier. */
  chosen: ResolvedModel[]
  hasSelection: boolean
  onPick: (ratio: number) => void
}) {
  const { t } = useTranslation()
  const min = Number(props.bounds.min)
  const max = Number(props.bounds.max)
  const validBounds = Number.isFinite(min) && Number.isFinite(max) && min <= max

  return (
    <div className='rounded-lg border'>
      <div className='text-muted-foreground flex items-center justify-between border-b px-3 py-1.5 text-[11px]'>
        <span>{t('Click a tier to set the range')}</span>
        <span>{t('cheapest first')}</span>
      </div>
      <div className='max-h-56 overflow-y-auto'>
        {props.ladder.map((tier) => {
          const inRange = validBounds && tier.ratio >= min && tier.ratio <= max
          // How many of the key's models this tier is the billing tier for, and
          // how many it merely carries — a tier that carries a model but is not
          // its cheapest is only ever reached when the cheaper one is down.
          const billedHere = props.chosen.filter(
            (item) => item.ratio === tier.ratio
          ).length
          const carried = props.chosen.filter((item) =>
            tier.models.includes(item.model)
          ).length

          let coverage = t('{{count}} models', { count: tier.models.length })
          if (props.hasSelection && inRange) {
            if (billedHere > 0) {
              coverage = t('{{count}} billed here', { count: billedHere })
            } else if (carried > 0) {
              coverage = t('fallback only')
            } else {
              coverage = t('none of them')
            }
          }

          return (
            <button
              key={tier.ratio}
              type='button'
              onClick={() => props.onPick(tier.ratio)}
              className={cn(
                'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs transition-colors last:border-b-0',
                inRange ? 'bg-primary/5' : 'hover:bg-muted/50',
                props.hasSelection && inRange && carried === 0 && 'opacity-45'
              )}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                  inRange
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40'
                )}
              >
                {inRange && <Check className='size-3' aria-hidden />}
              </span>
              <Badge
                variant='outline'
                className='w-16 shrink-0 justify-center font-mono text-[10px]'
              >
                {ratioLabel(tier.ratio)}
              </Badge>
              <span className='min-w-0 flex-1 truncate'>
                {tier.groups.join(' · ')}
              </span>
              <span
                className={cn(
                  'shrink-0 tabular-nums',
                  billedHere > 0 && props.hasSelection && inRange
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {coverage}
              </span>
            </button>
          )
        })}
        {props.ladder.length === 0 && (
          <p className='text-muted-foreground px-3 py-4 text-center text-xs'>
            {t('No group has a configured ratio.')}
          </p>
        )}
      </div>
    </div>
  )
}

function RangeSummary(props: {
  tierCount: number
  groupCount: number
  models: ResolvedModel[]
  hasSelection: boolean
  validBounds: boolean
}) {
  const { t } = useTranslation()

  if (!props.validBounds) {
    return (
      <p className='text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 text-xs'>
        {t('Enter a valid range to preview what this key can call.')}
      </p>
    )
  }

  if (props.tierCount === 0) {
    return (
      <p className='text-destructive bg-destructive/5 rounded-lg px-3 py-2 text-xs'>
        {t(
          'No usable group falls in this range, so this key cannot call anything.'
        )}
      </p>
    )
  }

  const splitPriced = props.models.filter(
    (item) => item.tierCount < props.tierCount
  ).length

  return (
    // Opened by default once models are picked: that list is then short, and it
    // is the only place the per-model price is visible.
    <Collapsible
      className='bg-muted/40 rounded-lg'
      defaultOpen={props.hasSelection}
    >
      <CollapsibleTrigger className='group/summary flex w-full items-center gap-2 px-3 py-2 text-left text-xs'>
        <ChevronDown className='size-3 shrink-0 transition-transform group-data-[panel-open]/summary:rotate-180' />
        <span className='min-w-0 flex-1'>
          {t('{{groups}} groups · {{models}} models callable', {
            groups: props.groupCount,
            models: props.models.length,
          })}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {splitPriced > 0 && (
          <p className='text-muted-foreground px-3 pb-1.5 text-[11px]'>
            {t(
              '{{count}} of them are not served by every tier, so their price is fixed by whichever tier has them.',
              { count: splitPriced }
            )}
          </p>
        )}
        <div className='max-h-48 space-y-0.5 overflow-y-auto px-3 pb-2'>
          {props.models.map((item) => (
            <div
              key={item.model}
              className='flex items-center gap-2 text-[11px]'
            >
              <Badge
                variant='outline'
                className='w-14 shrink-0 justify-center font-mono text-[10px]'
              >
                {ratioLabel(item.ratio)}
              </Badge>
              <span className='min-w-0 flex-1 truncate'>{item.model}</span>
              <span className='text-muted-foreground shrink-0 truncate'>
                {item.groups.join(', ')}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
