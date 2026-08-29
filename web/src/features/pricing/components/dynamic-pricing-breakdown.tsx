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
import { Tag as TagIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { TokenUnit } from '../types'
import { formatDynamicUnitPrice } from '../lib/dynamic-price'
import {
  BILLING_PRICING_VARS,
  MATCH_CONTAINS,
  MATCH_EQ,
  MATCH_EXISTS,
  MATCH_GT,
  MATCH_GTE,
  MATCH_LT,
  MATCH_LTE,
  MATCH_RANGE,
  SOURCE_TIME,
  normalizeTierLabel,
  parseTiersFromExpr,
  splitBillingExprAndRequestRules,
  tryParseRequestRuleExpr,
  type ParsedTier,
  type RequestCondition,
  type RequestRuleGroup,
  type TierCondition,
} from '../lib/billing-expr'

type DynamicPricingBreakdownProps = {
  billingExpr: string | null | undefined
  /**
   * Label of the tier that fired for the current request. When provided,
   * the corresponding row is highlighted and tagged as "Matched". Used by
   * the usage-log details dialog to show which tier the engine selected.
   */
  matchedTierLabel?: string | null
  /**
   * Hide cache-pricing columns regardless of the per-tier values. The log
   * details dialog passes this when the actual request did not consume any
   * cache tokens, so users only see pricing rows that were relevant to the
   * call they are inspecting. Defaults to false (show all configured prices).
   */
  hideCacheColumns?: boolean
  /**
   * Dense rendering for the usage-log details dialog: drops the colored
   * icon header and uses the dialog's small text sizes. Defaults to false.
   */
  compact?: boolean
  /**
   * Pricing-toolbar state, forwarded by the model detail panel so the tier
   * table agrees with the "Base price" card sitting directly above it.
   *
   * 不传时按 $/1M、不含充值折算渲染——用量日志的详情弹窗就是这个语境：那里展示的是
   * 一次已经发生的调用，没有定价页的单位/充值价开关。
   */
  tokenUnit?: TokenUnit
  showRechargePrice?: boolean
  priceRate?: number
  usdExchangeRate?: number
}

const VAR_LABELS: Record<string, string> = {
  p: 'Input',
  c: 'Output',
  len: 'Length',
}
const OP_LABELS: Record<string, string> = {
  '<': '<',
  '<=': '≤',
  '>': '>',
  '>=': '≥',
}
const TIME_FUNC_LABELS: Record<string, string> = {
  hour: 'Hour',
  minute: 'Minute',
  weekday: 'Weekday',
  month: 'Month',
  day: 'Day',
}

function formatTokenHint(value: string | number): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  }
  return String(n)
}

function formatConditionSummary(
  conditions: TierCondition[],
  t: (key: string) => string
): string {
  return conditions
    .map((c) => {
      const varLabel = t(VAR_LABELS[c.var] || c.var)
      const hint = formatTokenHint(c.value)
      return `${varLabel} ${OP_LABELS[c.op] || c.op} ${hint || c.value}`
    })
    .filter(Boolean)
    .join(' && ')
}

function describeCondition(
  cond: RequestCondition,
  t: (key: string) => string
): string {
  if (cond.source === SOURCE_TIME) {
    const fn = t(TIME_FUNC_LABELS[cond.timeFunc] || cond.timeFunc)
    const tz = cond.timezone || 'UTC'
    if (cond.mode === MATCH_RANGE) {
      return `${fn} ${cond.rangeStart}:00~${cond.rangeEnd}:00 (${tz})`
    }
    // 少一个运算符不会显示成「读不懂」，会显示成另一条规则：`weekday <= 5` 曾被渲染成
    // `Weekday = 5`。这个描述也被用量日志的详情弹窗复用，用户对账时看到的就是它，
    // 所以认不出来时宁可原样打出 mode，也不要默认成 `=`。
    const opMap: Record<string, string> = {
      [MATCH_EQ]: '=',
      [MATCH_GT]: '>',
      [MATCH_GTE]: '≥',
      [MATCH_LT]: '<',
      [MATCH_LTE]: '≤',
    }
    return `${fn} ${opMap[cond.mode] || cond.mode} ${cond.value} (${tz})`
  }
  const src = cond.source === 'header' ? t('Header') : t('Body param')
  const path = cond.path || ''
  if (cond.mode === MATCH_EXISTS) return `${src} ${path} ${t('Exists')}`
  if (cond.mode === MATCH_CONTAINS) {
    return `${src} ${path} ${t('Contains')} "${cond.value}"`
  }
  const opMap: Record<string, string> = {
    [MATCH_EQ]: '=',
    [MATCH_GT]: '>',
    [MATCH_GTE]: '≥',
    [MATCH_LT]: '<',
    [MATCH_LTE]: '≤',
  }
  return `${src} ${path} ${opMap[cond.mode] || cond.mode} ${cond.value}`
}

function describeGroup(
  group: RequestRuleGroup,
  t: (key: string) => string
): string {
  return (group.conditions || [])
    .map((c) => describeCondition(c, t))
    .join(' && ')
}

export function DynamicPricingBreakdown({
  billingExpr,
  matchedTierLabel,
  hideCacheColumns = false,
  compact = false,
  tokenUnit = 'M',
  showRechargePrice = false,
  priceRate,
  usdExchangeRate,
}: DynamicPricingBreakdownProps) {
  const { t } = useTranslation()
  const expr = billingExpr || ''

  // 走和「基础价格」卡片同一个格式化器。原来这里自己算 symbol/rate：只乘
  // usdExchangeRate、不认充值价、`toFixed(4)` 也没有最小非零地板，于是同一屏上同一个
  // $3/1M 系数，上面的卡片显示 ¥12、下面的档位表显示 ¥21.0000，而 ≤5e-5 的价还会
  // 一律显示成 0.0000。共用格式化器之后这三处口径自动一致。
  const priceOptions = useMemo(
    () => ({ tokenUnit, showRechargePrice, priceRate, usdExchangeRate }),
    [tokenUnit, showRechargePrice, priceRate, usdExchangeRate]
  )

  const { tiers, ruleGroups } = useMemo(() => {
    const split = splitBillingExprAndRequestRules(expr)
    const parsedTiers = parseTiersFromExpr(split.billingExpr)
    const parsedRules = tryParseRequestRuleExpr(split.requestRuleExpr || '')
    return {
      tiers: parsedTiers,
      ruleGroups: parsedRules || [],
    }
  }, [expr])

  const hasTiers = tiers.length > 0
  const hasRules = ruleGroups.length > 0
  const normalizedMatchedTierLabel = normalizeTierLabel(
    matchedTierLabel ?? undefined
  )

  if (!expr) return null

  if (!hasTiers) {
    return (
      <section className={cn('min-w-0', !compact && 'py-4')}>
        {!compact && (
          <div className='mb-3 flex items-center gap-2'>
            <span className='inline-flex size-6 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-500/20 dark:text-amber-300'>
              <TagIcon className='size-3.5' />
            </span>
            <div>
              <div className='text-foreground text-base font-medium'>
                {t('Special billing expression')}
              </div>
              <div className='text-muted-foreground text-xs'>
                {t('Unable to parse structured pricing')}
              </div>
            </div>
          </div>
        )}
        <div className='text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase'>
          {t('Raw expression')}
        </div>
        <code className='text-muted-foreground block text-xs break-all'>
          {expr}
        </code>
      </section>
    )
  }

  const visiblePriceFields = BILLING_PRICING_VARS.filter((v) => {
    if (!hasTiers) return false
    if (hideCacheColumns && v.group === 'cache') return false
    return tiers.some(
      (tier) => Number(tier[v.field as string as keyof ParsedTier] || 0) > 0
    )
  })

  return (
    <section className={cn('min-w-0', !compact && 'py-3 sm:py-4')}>
      {!compact && (
        <div className='mb-3 flex items-start gap-2 sm:mb-4'>
          <span className='mt-0.5 inline-flex size-6 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-500/20 dark:text-amber-300'>
            <TagIcon className='size-3.5' />
          </span>
          <div>
            <div className='text-foreground text-base font-medium'>
              {t('Dynamic Pricing')}
            </div>
            <div className='text-muted-foreground text-xs'>
              {t('Prices vary by usage tier and request conditions')}
            </div>
          </div>
        </div>
      )}

      {hasTiers && (
        <div className={cn(compact ? cn(hasRules && 'mb-2') : 'mb-3 sm:mb-4')}>
          <div
            className={
              compact
                ? 'text-muted-foreground mb-1.5 text-xs font-medium'
                : 'text-foreground mb-2 text-sm font-semibold'
            }
          >
            {t('Tiered price table')}
          </div>
          <div className='space-y-1.5 sm:hidden'>
            {tiers.map((tier, i) => {
              const condSummary = formatConditionSummary(tier.conditions, t)
              const isMatched =
                matchedTierLabel != null &&
                matchedTierLabel !== '' &&
                tier.label === matchedTierLabel
              return (
                <div
                  key={`tier-mobile-${i}`}
                  className={cn(
                    'rounded-md border p-2',
                    isMatched && 'border-emerald-500/40 bg-emerald-500/10'
                  )}
                >
                  <div className='mb-1.5 flex flex-wrap items-center gap-1.5'>
                    <Badge
                      variant='secondary'
                      className='bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                    >
                      {tier.label || t('Default')}
                    </Badge>
                    {isMatched && (
                      <Badge
                        variant='secondary'
                        className='bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                      >
                        {t('Matched')}
                      </Badge>
                    )}
                  </div>
                  {condSummary && (
                    <div className='text-muted-foreground mb-1.5 text-xs'>
                      {condSummary}
                    </div>
                  )}
                  <div className='grid grid-cols-2 gap-x-3 gap-y-1.5'>
                    {visiblePriceFields.map((v) => {
                      const value = Number(
                        tier[v.field as string as keyof ParsedTier] || 0
                      )
                      return (
                        <div key={v.field} className='min-w-0'>
                          <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
                            {t(v.shortLabel)}
                          </div>
                          <div
                            className={cn(
                              'truncate font-mono',
                              compact ? 'text-xs' : 'text-sm font-semibold'
                            )}
                          >
                            {value > 0
                              ? formatDynamicUnitPrice(value, priceOptions)
                              : '-'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <StaticDataTable
            className='hidden rounded-none border-0 sm:block'
            tableClassName={
              compact
                ? '[&_td]:text-xs [&_td_*]:text-xs [&_th]:text-xs [&_th_*]:text-xs'
                : 'text-sm'
            }
            headerRowClassName='hover:bg-transparent'
            data={tiers}
            getRowKey={(_tier, index) => `tier-${index}`}
            getRowClassName={(tier) => {
              const isMatched =
                normalizedMatchedTierLabel !== '' &&
                normalizeTierLabel(tier.label) === normalizedMatchedTierLabel
              return cn(
                isMatched &&
                  'bg-emerald-50/70 hover:bg-emerald-50/70 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/10'
              )
            }}
            columns={[
              {
                id: 'tier',
                header: t('Tier'),
                className: cn(
                  'text-muted-foreground py-2 font-medium',
                  compact && 'h-8'
                ),
                cellClassName: cn('align-top', compact ? 'py-2' : 'py-2.5'),
                cell: (tier) => {
                  const condSummary = formatConditionSummary(tier.conditions, t)
                  const isMatched =
                    normalizedMatchedTierLabel !== '' &&
                    normalizeTierLabel(tier.label) ===
                      normalizedMatchedTierLabel
                  return (
                    <>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <Badge
                          variant='secondary'
                          className='bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                        >
                          {tier.label || t('Default')}
                        </Badge>
                        {isMatched && (
                          <Badge
                            variant='secondary'
                            className='bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                          >
                            {t('Matched')}
                          </Badge>
                        )}
                      </div>
                      {condSummary && (
                        <div className='text-muted-foreground mt-1 text-xs'>
                          {condSummary}
                        </div>
                      )}
                    </>
                  )
                },
              },
              ...visiblePriceFields.map((v, index) => ({
                id: v.field ?? `price-${index}`,
                header: t(v.shortLabel),
                className: cn(
                  'text-muted-foreground py-2 text-right font-medium',
                  compact && 'h-8'
                ),
                cellClassName: cn(
                  'text-right align-top font-mono',
                  compact ? 'py-2' : 'py-2.5'
                ),
                cell: (tier: ParsedTier) => {
                  const value = Number(
                    tier[v.field as string as keyof ParsedTier] || 0
                  )
                  return value > 0 ? (
                    <span className={cn(!compact && 'font-semibold')}>
                      {formatDynamicUnitPrice(value, priceOptions)}
                    </span>
                  ) : (
                    '-'
                  )
                },
              })),
            ]}
          />
        </div>
      )}

      {hasRules && (
        <div>
          <div
            className={
              compact
                ? 'text-muted-foreground mb-1.5 text-xs font-medium'
                : 'text-foreground mb-2 text-sm font-semibold'
            }
          >
            {t('Conditional multipliers')}
          </div>
          <ul className='space-y-1.5'>
            {ruleGroups.map((group, gi) => (
              <li
                key={`group-${gi}`}
                className='bg-muted/50 flex items-center justify-between gap-3 rounded-md px-3 py-2'
              >
                <span
                  className={cn(
                    'text-foreground break-all',
                    compact ? 'text-xs' : 'text-sm'
                  )}
                >
                  {describeGroup(group, t)}
                </span>
                <Badge
                  variant='secondary'
                  className='shrink-0 bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300'
                >
                  {group.multiplier}x
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
