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
import { Layers } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { QUOTA_TYPE_VALUES } from '../constants'
import {
  getDynamicPricingSummary,
  isDynamicPricingModel,
} from '../lib/dynamic-price'
import type { GroupPriceTier } from '../lib/model-helpers'
import { formatFixedPrice, formatGroupPrice } from '../lib/price'
import type { PricingModel, TokenUnit } from '../types'

type ModelPriceTiersProps = {
  model: PricingModel
  /** Cheapest first, as produced by `getGroupPriceTiers`. */
  tiers: GroupPriceTier[]
  tokenUnit: TokenUnit
  showRechargePrice: boolean
  priceRate: number
  usdExchangeRate: number
  /** The group filter currently active on the square, if any. */
  selectedGroup?: string
}

/**
 * The per-tier prices of one model, opened from the card.
 *
 * The card can only show one number, and that number is the cheapest tier — so
 * a model served free by one group and billed by five others reads as "$0".
 * This panel is where the rest of that story lives, in money rather than in
 * multipliers: a viewer cannot convert `x0.275` into a price in their head.
 */
export function ModelPriceTiers(props: ModelPriceTiersProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isRequestPriced = props.model.quota_type === QUOTA_TYPE_VALUES.REQUEST
  const isDynamic = isDynamicPricingModel(props.model)

  const priceCells = (tier: GroupPriceTier) => {
    if (isDynamic) {
      const summary = getDynamicPricingSummary(props.model, {
        tokenUnit: props.tokenUnit,
        showRechargePrice: props.showRechargePrice,
        priceRate: props.priceRate,
        usdExchangeRate: props.usdExchangeRate,
        groupRatioMultiplier: tier.ratio,
      })
      if (!summary || summary.primaryEntries.length === 0) {
        return (
          <span className='text-muted-foreground'>{t('Dynamic Pricing')}</span>
        )
      }
      return summary.primaryEntries.map((entry) => (
        <span key={entry.key} className='font-mono'>
          {entry.formatted}
        </span>
      ))
    }

    // Every group on a rung shares its ratio, so any of them prices the rung.
    const group = tier.groups[0]
    if (isRequestPriced) {
      return (
        <span className='font-mono'>
          {formatFixedPrice(
            props.model,
            group,
            props.showRechargePrice,
            props.priceRate,
            props.usdExchangeRate,
            props.model.group_ratio || {}
          )}
        </span>
      )
    }
    return (['input', 'output'] as const).map((type) => (
      <span key={type} className='font-mono'>
        {formatGroupPrice(
          props.model,
          group,
          type,
          props.tokenUnit,
          props.showRechargePrice,
          props.priceRate,
          props.usdExchangeRate,
          props.model.group_ratio || {}
        )}
      </span>
    ))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type='button'
            onClick={(e) => e.stopPropagation()}
            className='text-muted-foreground hover:text-foreground hover:border-border/80 inline-flex shrink-0 items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-[11px] font-medium transition-colors'
          >
            <Layers className='size-3' aria-hidden />
            {props.tiers[0]?.ratio === 0
              ? t('free tier, {{count}} in total', {
                  count: props.tiers.length,
                })
              : t('from {{count}} tiers', { count: props.tiers.length })}
          </button>
        }
      />
      <PopoverContent
        className='w-80 p-0'
        align='start'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='border-b px-3 py-2'>
          <p className='truncate font-mono text-xs font-semibold'>
            {props.model.model_name}
          </p>
          <p className='text-muted-foreground text-[11px]'>
            {isRequestPriced
              ? t('Price per request, by group')
              : t('Input / output per {{unit}} tokens, by group', {
                  unit: props.tokenUnit === 'K' ? '1K' : '1M',
                })}
          </p>
        </div>
        <div className='max-h-72 divide-y overflow-y-auto'>
          {props.tiers.map((tier) => {
            const isSelected =
              !!props.selectedGroup && tier.groups.includes(props.selectedGroup)
            return (
              <div
                key={tier.ratio}
                className={cn('px-3 py-2', isSelected && 'bg-primary/5')}
              >
                <div className='flex items-center justify-between gap-2'>
                  <Badge
                    variant='outline'
                    className='shrink-0 font-mono text-[10px]'
                  >
                    x{tier.ratio}
                  </Badge>
                  <div className='flex min-w-0 items-center gap-2 text-xs'>
                    {priceCells(tier)}
                  </div>
                </div>
                <p className='text-muted-foreground mt-1 text-[11px] break-words'>
                  {tier.groups.join(' · ')}
                  {isSelected ? ` · ${t('current filter')}` : ''}
                </p>
              </div>
            )
          })}
        </div>
        <p className='text-muted-foreground/70 border-t px-3 py-1.5 text-[10px]'>
          {t(
            'A price-range key always bills at the cheapest tier that has the model.'
          )}
        </p>
      </PopoverContent>
    </Popover>
  )
}
