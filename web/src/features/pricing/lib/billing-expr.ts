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
/**
 * Billing expression parsing utilities.
 *
 * Parses the dynamic billing expression format so that the pricing breakdown
 * UI can be rendered from the same backend expressions.
 *
 * Display adapters intentionally accept fewer shapes than the shared
 * simulator. Existing ordered-tier, task-unit and request-rule contracts
 * stay intact; executable custom expressions do not imply fixed unit prices.
 */

import type { BillingUsageSchema } from '../types'
import {
  readTokenTierChain,
  readTaskTierChain,
  readTimeTokenPricing,
  type TokenTier,
} from './billing-expression/display'
import { compileBillingExpression } from './billing-expression/parser'
import {
  splitExpressionAtTopLevel,
  unwrapExpressionParens,
} from './billing-expression/structure'

// ---------------------------------------------------------------------------
// Variable registry
// ---------------------------------------------------------------------------

export type BillingVar = {
  key: string
  field: string | null
  tierField: string | null
  label: string
  shortLabel: string
  side: 'input' | 'output' | 'condition'
  isBase?: boolean
  isConditionOnly?: boolean
  group?: string
}

export const BILLING_VARS: BillingVar[] = [
  {
    key: 'p',
    field: 'inputPrice',
    tierField: 'input_unit_cost',
    label: 'Input price',
    shortLabel: 'Input',
    side: 'input',
    isBase: true,
  },
  {
    key: 'c',
    field: 'outputPrice',
    tierField: 'output_unit_cost',
    label: 'Completion price',
    shortLabel: 'Output',
    side: 'output',
    isBase: true,
  },
  {
    key: 'len',
    field: null,
    tierField: null,
    label: 'Input length',
    shortLabel: 'Length',
    side: 'condition',
    isConditionOnly: true,
  },
  {
    key: 'cr',
    field: 'cacheReadPrice',
    tierField: 'cache_read_unit_cost',
    label: 'Cache read price',
    shortLabel: 'Cache Read',
    side: 'input',
    group: 'cache',
  },
  {
    key: 'cc',
    field: 'cacheCreatePrice',
    tierField: 'cache_create_unit_cost',
    label: 'Cache create price',
    shortLabel: 'Cache Write',
    side: 'input',
    group: 'cache',
  },
  {
    key: 'img_cr',
    field: 'imageCachePrice',
    tierField: 'image_cache_unit_cost',
    label: 'Image cache input price',
    shortLabel: 'Image Cache',
    side: 'input',
    group: 'cache',
  },
  {
    key: 'cc1h',
    field: 'cacheCreate1hPrice',
    tierField: 'cache_create_1h_unit_cost',
    label: 'Cache create (1h) price',
    shortLabel: 'Cache Write (1h)',
    side: 'input',
    group: 'cache',
  },
  {
    key: 'img',
    field: 'imagePrice',
    tierField: 'image_unit_cost',
    label: 'Image input price',
    shortLabel: 'Image In',
    side: 'input',
    group: 'media',
  },
  {
    key: 'img_o',
    field: 'imageOutputPrice',
    tierField: 'image_output_unit_cost',
    label: 'Image output price',
    shortLabel: 'Image Out',
    side: 'output',
    group: 'media',
  },
  {
    key: 'ai',
    field: 'audioInputPrice',
    tierField: 'audio_input_unit_cost',
    label: 'Audio input price',
    shortLabel: 'Audio In',
    side: 'input',
    group: 'media',
  },
  {
    key: 'ao',
    field: 'audioOutputPrice',
    tierField: 'audio_output_unit_cost',
    label: 'Audio output price',
    shortLabel: 'Audio Out',
    side: 'output',
    group: 'media',
  },
]

/** Vars that have real price fields (excludes condition-only vars like `len`) */
export const BILLING_PRICING_VARS: BillingVar[] = BILLING_VARS.filter(
  (v) => !v.isConditionOnly
)

/** Vars valid in tier conditions (`p`, `c`, `len`) */
export const BILLING_CONDITION_VARS: string[] = BILLING_VARS.filter(
  (v) => v.isBase || v.isConditionOnly
).map((v) => v.key)

const BILLING_VAR_KEY_TO_FIELD = Object.fromEntries(
  BILLING_PRICING_VARS.map((v) => [v.key, v.field as string])
) as Record<string, string>

export const BILLING_EXTRA_VARS: BillingVar[] = BILLING_VARS.filter(
  (v) => !v.isBase && !v.isConditionOnly
)

export const BILLING_CACHE_VAR_MAP = BILLING_EXTRA_VARS.map((v) => ({
  field: v.tierField as string,
  exprVar: v.key,
}))

// ---------------------------------------------------------------------------
// Request rule constants
// ---------------------------------------------------------------------------

export const SOURCE_PARAM = 'param'
export const SOURCE_HEADER = 'header'
export const SOURCE_TIME = 'time'

export const MATCH_EQ = 'eq'
export const MATCH_CONTAINS = 'contains'
export const MATCH_GT = 'gt'
export const MATCH_GTE = 'gte'
export const MATCH_LT = 'lt'
export const MATCH_LTE = 'lte'
export const MATCH_EXISTS = 'exists'
export const MATCH_RANGE = 'range'

export const TIME_FUNCS = ['hour', 'minute', 'weekday', 'month', 'day'] as const
export type TimeFunc = (typeof TIME_FUNCS)[number]

export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: 'Asia/Shanghai', label: 'UTC+8 Shanghai (Asia/Shanghai)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'UTC-5 New York (America/New_York)' },
  {
    value: 'America/Los_Angeles',
    label: 'UTC-8 Los Angeles (America/Los_Angeles)',
  },
  { value: 'America/Chicago', label: 'UTC-6 Chicago (America/Chicago)' },
  { value: 'Europe/London', label: 'UTC+0 London (Europe/London)' },
  { value: 'Europe/Berlin', label: 'UTC+1 Berlin (Europe/Berlin)' },
  { value: 'Asia/Tokyo', label: 'UTC+9 Tokyo (Asia/Tokyo)' },
  { value: 'Asia/Singapore', label: 'UTC+8 Singapore (Asia/Singapore)' },
  { value: 'Asia/Seoul', label: 'UTC+9 Seoul (Asia/Seoul)' },
  { value: 'Australia/Sydney', label: 'UTC+10 Sydney (Australia/Sydney)' },
]

const NUMERIC_LITERAL_REGEX = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

export type ParamHeaderCondition = {
  source: 'param' | 'header'
  path: string
  mode: string
  value: string
  // 解析这条条件时，原文里的字面量带不带引号。只有等值比较用得上：
  // `param("x") == "5"`（字符串 5）与 `param("x") == 5`（数字 5）是两条不同的规则，
  // 而输入框里都只显示 5。不记住这一位，打开一次编辑器就会把前者改写成后者。
  // 用户新建的条件不带这个字段，沿用「看着像数字就写裸数字」的老行为。
  valueQuoted?: boolean
}

export type TimeCondition = {
  source: 'time'
  timeFunc: TimeFunc
  timezone: string
  mode: string
  value: string
  rangeStart: string
  rangeEnd: string
}

export type RequestCondition = TimeCondition | ParamHeaderCondition

export type RequestRuleGroup = {
  conditions: RequestCondition[]
  multiplier: string
  conditionText?: string
  matched?: boolean
}

export type RequestRuleTrace = {
  cond: string
  multiplier: number
  matched: boolean
}

export function requestRuleGroupsFromTrace(
  requestRules: RequestRuleTrace[]
): RequestRuleGroup[] {
  return requestRules.map((rule) => ({
    conditions:
      tryParseRuleGroupFactor(`(${rule.cond} ? 1 : 1)`)?.conditions ?? [],
    multiplier: String(rule.multiplier),
    conditionText: rule.cond.trim(),
    matched: rule.matched,
  }))
}

export type TierCondition = {
  var: 'p' | 'c' | 'len'
  op: '<' | '<=' | '>' | '>='
  value: number
}

export type ParsedTier = {
  billingUnit?: 'token' | 'request'
  fixedPrice?: number
  conditionText?: string
  label: string
  conditions: TierCondition[]
  [field: string]: unknown
}

export type TaskTierCondition = {
  field: string
  value: string
}

export type ParsedTaskTier = {
  conditionText?: string
  label: string
  conditions: TaskTierCondition[]
  constant: number
  unitPrices: Record<string, number>
}

// ---------------------------------------------------------------------------
// Tier parser
// ---------------------------------------------------------------------------

function mapTokenTier(
  tier: TokenTier & { conditionText?: string }
): ParsedTier {
  return {
    label: tier.label,
    ...(tier.imageCount ? { imageCount: true } : {}),
    conditions: tier.conditions,
    ...(tier.billingUnit === 'request'
      ? { billingUnit: tier.billingUnit, fixedPrice: tier.fixedPrice }
      : {}),
    ...(tier.conditionText ? { conditionText: tier.conditionText } : {}),
    ...Object.fromEntries(
      Object.entries(tier.prices).map(([key, price]) => [
        BILLING_VAR_KEY_TO_FIELD[key],
        price,
      ])
    ),
  }
}

function stripExprVersion(expr: string): { prefix: string; body: string } {
  return expr.startsWith('v1:')
    ? { prefix: 'v1:', body: expr.slice(3) }
    : { prefix: '', body: expr }
}

export function parseTiersFromExpr(exprStr: string): ParsedTier[] {
  if (!exprStr) return []
  const { billingExpr } = splitBillingExprAndRequestRules(exprStr)
  const compiled = compileBillingExpression(billingExpr)
  if (compiled.status !== 'ready') return []
  const canonical = readTokenTierChain(compiled.ast)
  if (canonical) return canonical.map(mapTokenTier)
  return readTimeTokenPricing(billingExpr)?.tiers.map(mapTokenTier) ?? []
}

/** Current-time selection is exclusively for summaries; detail and log callers retain all rows. */
export function getCurrentTimePricingTiers(
  exprStr: string,
  now: Date
): ParsedTier[] | null {
  return (
    readTimeTokenPricing(exprStr, now)?.currentTiers.map(mapTokenTier) ?? null
  )
}

export function parseTaskTiersFromExpr(
  exprStr: string,
  schema: BillingUsageSchema | null | undefined,
  includeBooleanConditions = false
): ParsedTaskTier[] {
  if (!exprStr || !schema || Object.keys(schema).length === 0) return []
  const { billingExpr } = splitBillingExprAndRequestRules(exprStr)
  const compiled = compileBillingExpression(billingExpr)
  if (compiled.status !== 'ready') return []
  return readTaskTierChain(compiled.ast, schema, includeBooleanConditions) ?? []
}

export function normalizeTierLabel(label: string | undefined): string {
  if (!label) return ''
  return label
    .replaceAll(/<[=＝]?|≤|＜[=＝]?/g, '<')
    .replaceAll(/>[=＝]?|≥|＞[=＝]?/g, '>')
    .replaceAll(/\s+/g, '')
    .toLowerCase()
}

// ---------------------------------------------------------------------------
// Request rule parser
// ---------------------------------------------------------------------------

function splitTopLevelMultiply(expr: string): string[] {
  return splitExpressionAtTopLevel(expr, '*')
}

// splitTopLevelAnd 按顶层 && 拆条件。
//
// 原来匹配的是四个字符 ' && '（两侧强制带空格），于是后端完全合法的 `a>=1&&a<=5`
// 在前端一个条件都拆不出来，整条规则被判为"无法解析"，连带把基础价一起丢掉。
// 后端用的是 expr-lang，空格对它没有意义；展示层不该比计费层更挑剔。
function splitTopLevelAnd(expr: string): string[] {
  return splitExpressionAtTopLevel(expr, '&&')
}

function parseExprLiteral(raw: string): string | null {
  const text = raw.trim()
  if (text === 'true' || text === 'false') return text
  if (NUMERIC_LITERAL_REGEX.test(text)) return text
  try {
    return JSON.parse(text) as string
  } catch {
    return null
  }
}

// Time function value domains. Values outside these ranges are invalid for
// the corresponding time function (e.g. hour() is 0-23) and would otherwise
// produce always-true conditions like hour >= -1 || hour < -5.
const TIME_FUNC_RANGES: Record<TimeFunc, [number, number]> = {
  hour: [0, 23],
  minute: [0, 59],
  weekday: [0, 6],
  month: [1, 12],
  day: [1, 31],
}

function isTimeValueInRange(timeFunc: TimeFunc, text: string): boolean {
  if (!NUMERIC_LITERAL_REGEX.test(text)) return false
  const value = Number(text)
  if (!Number.isInteger(value)) return false
  const [min, max] = TIME_FUNC_RANGES[timeFunc]
  return value >= min && value <= max
}

function tryParseTimeCondition(expr: string): RequestCondition | null {
  let m = expr.match(
    /^(hour|minute|weekday|month|day)\("([^"]+)"\) >= ([\d.eE+-]+) (?:&&|\|\|) \1\("\2"\) < ([\d.eE+-]+)$/
  )
  if (!m) {
    m = expr.match(
      /^\((hour|minute|weekday|month|day)\("([^"]+)"\) >= ([\d.eE+-]+) (?:&&|\|\|) \1\("\2"\) < ([\d.eE+-]+)\)$/
    )
  }
  if (m) {
    // Reject invalid bounds at parse time too: an unparseable rule keeps the
    // editor in raw mode, while a leniently parsed one would be silently
    // dropped when the visual editor rebuilds the expression.
    if (
      !isTimeValueInRange(m[1] as TimeFunc, m[3]) ||
      !isTimeValueInRange(m[1] as TimeFunc, m[4])
    ) {
      return null
    }
    return {
      source: 'time',
      timeFunc: m[1] as TimeFunc,
      timezone: m[2],
      mode: MATCH_RANGE,
      value: '',
      rangeStart: m[3],
      rangeEnd: m[4],
    }
  }
  m = expr.match(
    /^(hour|minute|weekday|month|day)\("([^"]+)"\)\s*(==|>=|<=|<|>)\s*(\d*\.?\d+(?:[eE][+-]?\d+)?)$/
  )
  if (m) {
    if (!isTimeValueInRange(m[1] as TimeFunc, m[4])) return null
    const opMap: Record<string, string> = {
      '==': MATCH_EQ,
      '>=': MATCH_GTE,
      '<=': MATCH_LTE,
      '<': MATCH_LT,
      '>': MATCH_GT,
    }
    return {
      source: 'time',
      timeFunc: m[1] as TimeFunc,
      timezone: m[2],
      mode: opMap[m[3]] || MATCH_EQ,
      value: m[4],
      rangeStart: '',
      rangeEnd: '',
    }
  }
  return null
}

function tryParseRequestCondition(expr: string): RequestCondition | null {
  const tc = tryParseTimeCondition(expr)
  if (tc) return tc

  let m = expr.match(/^header\("([^"]+)"\)\s*!=\s*""$/)
  if (m) return { source: 'header', path: m[1], mode: MATCH_EXISTS, value: '' }

  m = expr.match(/^param\("([^"]+)"\)\s*!=\s*nil$/)
  if (m) return { source: 'param', path: m[1], mode: MATCH_EXISTS, value: '' }

  m = expr.match(/^has\(header\("([^"]+)"\),\s*((?:"(?:[^"\\]|\\.)*"))\)$/)
  if (m) {
    return {
      source: 'header',
      path: m[1],
      mode: MATCH_CONTAINS,
      value: JSON.parse(m[2]) as string,
    }
  }

  m = expr.match(
    /^param\("([^"]+)"\)\s*!=\s*nil\s*&&\s*has\(param\("([^"]+)"\),\s*((?:"(?:[^"\\]|\\.)*"))\)$/
  )
  if (m && m[1] === m[2]) {
    return {
      source: 'param',
      path: m[1],
      mode: MATCH_CONTAINS,
      value: JSON.parse(m[3]) as string,
    }
  }

  m = expr.match(
    /^param\("([^"]+)"\)\s*!=\s*nil\s*&&\s*param\("([^"]+)"\)\s*(>=|<=|>|<)\s*(\d*\.?\d+(?:[eE][+-]?\d+)?)$/
  )
  if (m && m[1] === m[2]) {
    const opMap: Record<string, string> = {
      '>': MATCH_GT,
      '>=': MATCH_GTE,
      '<': MATCH_LT,
      '<=': MATCH_LTE,
    }
    return { source: 'param', path: m[1], mode: opMap[m[3]], value: m[4] }
  }

  m = expr.match(/^(param|header)\("([^"]+)"\)\s*==\s*(.+)$/)
  if (m) {
    const rawLiteral = m[3].trim()
    const parsedValue = parseExprLiteral(rawLiteral)
    if (parsedValue === null) return null
    return {
      source: m[1] as 'param' | 'header',
      path: m[2],
      mode: MATCH_EQ,
      value: String(parsedValue),
      // 只在为真时带上这一位：它只对「原文是带引号的字符串」有意义，
      // 恒定输出一个 false 会让每个条件对象都多一个不携带信息的字段。
      ...(rawLiteral.startsWith('"') ? { valueQuoted: true } : {}),
    }
  }

  return null
}

function tryParseTimeRangePair(
  lower: string,
  upper: string
): RequestCondition | null {
  const a = tryParseTimeCondition(lower)
  const b = tryParseTimeCondition(upper)
  if (!a || !b || a.source !== 'time' || b.source !== 'time') return null
  const ta = a as TimeCondition
  const tb = b as TimeCondition
  if (ta.timeFunc !== tb.timeFunc || ta.timezone !== tb.timezone) return null
  if (ta.mode !== MATCH_GTE || tb.mode !== MATCH_LT) return null
  return {
    source: 'time',
    timeFunc: ta.timeFunc,
    timezone: ta.timezone,
    mode: MATCH_RANGE,
    value: '',
    rangeStart: ta.value,
    rangeEnd: tb.value,
  }
}

function tryParseRequestConditions(
  conditionStr: string
): RequestCondition[] | null {
  // A single time range like hour(tz) >= 9 && hour(tz) < 12 must stay one
  // MATCH_RANGE condition instead of being split into two scalar conditions.
  const wholeTimeCond = tryParseTimeCondition(conditionStr.trim())
  if (wholeTimeCond) return [wholeTimeCond]

  const andParts = splitTopLevelAnd(conditionStr).map(unwrapOuterParens)
  const conditions: RequestCondition[] = []
  for (let i = 0; i < andParts.length; i += 1) {
    const part = andParts[i].trim()
    // Adjacent matching time bounds (fn >= X && fn < Y) form one range; merge
    // them so the visual editor keeps a single MATCH_RANGE row even when
    // other conditions follow in the same group.
    const next = i + 1 < andParts.length ? andParts[i + 1].trim() : ''
    const merged = next ? tryParseTimeRangePair(part, next) : null
    if (merged) {
      conditions.push(merged)
      i += 1
      continue
    }
    const guarded = next ? tryParseRequestCondition(`${part} && ${next}`) : null
    if (guarded && part.startsWith('param(') && /!=\s*nil$/.test(part)) {
      conditions.push(guarded)
      i += 1
      continue
    }
    const condition = tryParseRequestCondition(part)
    if (!condition) return null
    conditions.push(condition)
  }
  return conditions.length > 0 ? conditions : null
}

function tryParseRuleGroupFactor(part: string): RequestRuleGroup | null {
  // 空格一律可选：`(cond ? 2 : 1)` 与 `(cond?2:1)` 对后端是同一个表达式。
  // 系数用真正的数字字面量，理由同 BILLING_VAR_REGEX：`[\d.eE+-]+` 会吞掉相邻符号。
  const m = part.match(
    /^\(\s*([\s\S]+?)\s*\?\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*:\s*1\s*\)$/
  )
  if (!m) return null

  // 条件整体常被再包一层括号（`((a && b) ? 2 : 1)`），每个 && 分支也可能自带括号。
  // 不脱掉的话 splitTopLevelAnd 在括号里永远拆不出顶层 &&，整条规则就被判成无法解析，
  // 连带把基础价一起丢掉——3011 上 5 个 DeepSeek 模型就是这么显示成一串表达式的。
  const conditionStr = unwrapOuterParens(m[1])
  const multiplier = m[2]

  const conditions = tryParseRequestConditions(conditionStr)
  if (!conditions) return null
  return { conditions, multiplier }
}

export function tryParseRequestRuleExpr(
  expr: string
): RequestRuleGroup[] | null {
  const trimmed = (expr || '').trim()
  if (!trimmed) return []

  const parts = splitTopLevelMultiply(trimmed)
  if (!parts) return null
  const groups: RequestRuleGroup[] = []
  for (const part of parts) {
    const group = tryParseRuleGroupFactor(part)
    if (!group) return null
    groups.push(group)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Combine / split billing expr and request rules
// ---------------------------------------------------------------------------

function unwrapOuterParens(expr: string): string {
  return unwrapExpressionParens(expr)
}

// flattenTopLevelFactors 把嵌套的乘法括号摊平。
//
// `((tier(...) * r1 * r2)) * 0.5` 与 `tier(...) * r1 * r2 * 0.5` 是同一个值（乘法可结合），
// 但只看顶层因子的话，前者整段是一个因子：里面的规则拆不出来，tier 也取不到，
// 整张卡片就退化成一串原始表达式。站长在编辑器里多加一层括号、或者在整段外面乘一个
// 折扣系数，就会踩到这个（3011 上 jw-deepseek-* 两个模型正是这个形状）。
//
// 只在括号内确实还是乘法时才展开；`(a / 2)` 这种非乘法的括号原样保留，
// 由后面的"无法解析就整体退回"兜住。
function flattenTopLevelFactors(expr: string): string[] | null {
  const parts = splitTopLevelMultiply(expr)
  if (!parts) return null

  const flat: string[] = []
  for (const part of parts) {
    const inner = unwrapOuterParens(part)
    if (inner !== part.trim()) {
      const nested = splitTopLevelMultiply(inner)
      if (nested && nested.length > 1) {
        const expanded = flattenTopLevelFactors(inner)
        if (!expanded) return null
        flat.push(...expanded)
        continue
      }
    }
    flat.push(part)
  }
  return flat
}

export function splitBillingExprAndRequestRules(expr: string): {
  billingExpr: string
  requestRuleExpr: string
} {
  const trimmed = (expr || '').trim()
  if (!trimmed) return { billingExpr: '', requestRuleExpr: '' }

  const { prefix, body } = stripExprVersion(trimmed)
  const parts = flattenTopLevelFactors(body)
  if (!parts || parts.length <= 1) {
    return { billingExpr: trimmed, requestRuleExpr: '' }
  }

  const ruleParts: string[] = []
  const billingParts: string[] = []
  let structuralBillingParts = 0

  parts.forEach((part) => {
    const parsed = tryParseRequestRuleExpr(part)
    const compiled = compileBillingExpression(part)
    const traced =
      compiled.status === 'ready' &&
      compiled.requestRules.some((rule) => rule.node === compiled.ast)
    if ((parsed && parsed.length > 0) || traced) {
      ruleParts.push(part)
      return
    }

    billingParts.push(part)
    if (!NUMERIC_LITERAL_REGEX.test(unwrapOuterParens(part))) {
      structuralBillingParts += 1
    }
  })

  const quantityParts = billingParts.filter(
    (part) => unwrapOuterParens(part) === 'image_count'
  )
  if (
    ruleParts.length === 0 ||
    structuralBillingParts - quantityParts.length !== 1
  ) {
    return { billingExpr: trimmed, requestRuleExpr: '' }
  }

  return {
    billingExpr: `${prefix}${billingParts.length === 1 ? unwrapOuterParens(billingParts[0]) : billingParts.join(' * ')}`,
    requestRuleExpr: ruleParts.join(' * '),
  }
}

export function combineBillingExpr(
  baseExpr: string,
  requestRuleExpr: string
): string {
  const base = (baseExpr || '').trim()
  const rules = (requestRuleExpr || '').trim()
  if (!base) return ''
  if (!rules) return base
  const { prefix, body } = stripExprVersion(base)
  return `${prefix}(${body}) * ${rules}`
}

// ---------------------------------------------------------------------------
// Editor: empty constructors
// ---------------------------------------------------------------------------

export function createEmptyCondition(): ParamHeaderCondition {
  return { source: 'param', path: '', mode: MATCH_EQ, value: '' }
}

export function createEmptyTimeCondition(): TimeCondition {
  return {
    source: 'time',
    timeFunc: 'hour',
    timezone: 'Asia/Shanghai',
    mode: MATCH_GTE,
    value: '',
    rangeStart: '',
    rangeEnd: '',
  }
}

export function createEmptyRuleGroup(): RequestRuleGroup {
  return { conditions: [createEmptyCondition()], multiplier: '' }
}

export function createEmptyTimeRuleGroup(): RequestRuleGroup {
  return { conditions: [createEmptyTimeCondition()], multiplier: '' }
}

// ---------------------------------------------------------------------------
// Editor: match option helpers
// ---------------------------------------------------------------------------

export type MatchOption = { value: string; labelKey: string }

export function getRequestRuleMatchOptions(source: string): MatchOption[] {
  if (source === SOURCE_TIME) {
    // 解析端认 `<=` / `>`（`weekday(tz) <= 5` 是「周一到周五」最自然的写法），
    // 这里不给出对应选项的话，normalizeCondition 会把解析出来的 lte/gt 判为非法、
    // 回落成 gte，构造端再照 gte 写回去——管理员没动过任何东西，表达式就被改了。
    return [
      { value: MATCH_EQ, labelKey: 'Equals' },
      { value: MATCH_GT, labelKey: 'Greater than' },
      { value: MATCH_GTE, labelKey: 'Greater than or equal' },
      { value: MATCH_LT, labelKey: 'Less than' },
      { value: MATCH_LTE, labelKey: 'Less than or equal' },
      { value: MATCH_RANGE, labelKey: 'Overnight range' },
    ]
  }
  const base: MatchOption[] = [
    { value: MATCH_EQ, labelKey: 'Equals' },
    { value: MATCH_CONTAINS, labelKey: 'Contains' },
    { value: MATCH_EXISTS, labelKey: 'Exists' },
  ]
  if (source === SOURCE_HEADER) return base
  return [
    ...base,
    { value: MATCH_GT, labelKey: 'Greater than' },
    { value: MATCH_GTE, labelKey: 'Greater than or equal' },
    { value: MATCH_LT, labelKey: 'Less than' },
    { value: MATCH_LTE, labelKey: 'Less than or equal' },
  ]
}

// ---------------------------------------------------------------------------
// Editor: normalize a single condition
// ---------------------------------------------------------------------------

function isTimeFunc(value: unknown): value is TimeFunc {
  return typeof value === 'string' && TIME_FUNCS.includes(value as TimeFunc)
}

export function normalizeCondition(
  cond: Partial<RequestCondition> | null | undefined
): RequestCondition {
  let source: 'time' | 'header' | 'param' = 'param'
  if (cond?.source === 'time' || cond?.source === 'header') {
    source = cond.source
  }

  if (source === 'time') {
    const timeCond = cond as Partial<TimeCondition> | null | undefined
    const timeFunc: TimeFunc = isTimeFunc(timeCond?.timeFunc)
      ? timeCond.timeFunc
      : 'hour'
    // mode 缺失时才回落到默认值；**认不出的 mode 保持原样**。
    // 原来这里用「在不在选项表里」当判据、不在就改成 gte，于是构造端 opMap 的
    // fail-closed 永远走不到——解析端一旦新增一个选项表里没有的 mode（B1 的成因就是
    // 放宽了解析正则却没同步选项表），它会被悄悄改成 gte 再写回库，而不是暴露出来。
    const rawMode =
      typeof timeCond?.mode === 'string' ? timeCond.mode.trim() : ''
    const mode = rawMode || MATCH_GTE
    return {
      source: 'time',
      timeFunc,
      timezone: timeCond?.timezone || 'Asia/Shanghai',
      mode,
      value: timeCond?.value == null ? '' : String(timeCond.value),
      rangeStart:
        timeCond?.rangeStart == null ? '' : String(timeCond.rangeStart),
      rangeEnd: timeCond?.rangeEnd == null ? '' : String(timeCond.rangeEnd),
    }
  }

  const phCond = cond as Partial<ParamHeaderCondition> | null | undefined
  // 判据同上：只有 mode 缺失才回落，认不出的保持原样交给构造端 fail-closed。
  const rawMode = typeof phCond?.mode === 'string' ? phCond.mode.trim() : ''
  return {
    source,
    path: phCond?.path || '',
    mode: rawMode || MATCH_EQ,
    value: phCond?.value == null ? '' : String(phCond.value),
    ...(phCond?.valueQuoted === true ? { valueQuoted: true as const } : {}),
  }
}

// ---------------------------------------------------------------------------
// Editor: build expression strings
// ---------------------------------------------------------------------------

function buildExprLiteral(cond: ParamHeaderCondition): string {
  const text = String(cond.value || '').trim()
  if (cond.mode === MATCH_CONTAINS) return JSON.stringify(text)
  // header(...) 在 v1 env 里的类型是 func(string) string，和数字或布尔比较**编译不过**：
  //   header("h") == 1     → invalid operation: == (mismatched types string and int)
  //   header("h") == true  → invalid operation: == (mismatched types string and bool)
  // 编译失败会让整条计费表达式作废、阶梯计费退到预扣兜底价。而这不需要手写表达式就能撞上：
  // 在可视化编辑器里选 Header / Equals / 填 1，旧逻辑就直接写出 `header("h") == 1`。
  // header 一律按字符串写，与 exists 分支的 `!= ""` 口径一致。
  if (cond.source === 'header') return JSON.stringify(text)
  // param(...) 是 interface{}，裸字面量和字符串都编译得过，语义却不同：请求体里是数字 5
  // 要写裸 5，是字符串 "5" 要写 "5"，写错了规则恒不命中（少收钱且无声）。输入框里两者
  // 都只显示 5，所以只能保真：原文带引号的照旧带引号。
  if (cond.valueQuoted) return JSON.stringify(text)
  if (text === 'true' || text === 'false') return text
  if (NUMERIC_LITERAL_REGEX.test(text)) return text
  return JSON.stringify(text)
}

function buildTimeConditionExpr(cond: TimeCondition): string {
  const normalized = normalizeCondition(cond) as TimeCondition
  const { timeFunc, timezone, mode } = normalized
  const tz = JSON.stringify(timezone)
  const fn = `${timeFunc}(${tz})`

  if (mode === MATCH_RANGE) {
    const s = normalized.rangeStart.trim()
    const e = normalized.rangeEnd.trim()
    if (!isTimeValueInRange(timeFunc, s) || !isTimeValueInRange(timeFunc, e)) {
      return ''
    }
    // Overnight range (start > end) crosses the day boundary, e.g. 21-6.
    // A within-day range (start <= end), e.g. 9-12, must use && so the
    // condition is not a tautology that always applies the multiplier.
    const sNum = Number(s)
    const eNum = Number(e)
    if (sNum > eNum) {
      return `${fn} >= ${s} || ${fn} < ${e}`
    }
    return `${fn} >= ${s} && ${fn} < ${e}`
  }
  const v = normalized.value.trim()
  if (!isTimeValueInRange(timeFunc, v)) return ''
  const opMap: Record<string, string> = {
    [MATCH_EQ]: '==',
    [MATCH_GT]: '>',
    [MATCH_GTE]: '>=',
    [MATCH_LT]: '<',
    [MATCH_LTE]: '<=',
  }
  // 未知 mode 必须 fail-closed。之前的 `|| '=='` 会把认不出来的运算符悄悄换成别的一个，
  // 计费含义直接变了（`hour<=6 ? 0.5 : 1` 深夜半价 → `hour>=6` 白天半价）。
  const op = opMap[mode]
  if (!op) return ''
  return `${fn} ${op} ${v}`
}

function buildRequestConditionExpr(cond: RequestCondition): string {
  if (cond.source === 'time') return buildTimeConditionExpr(cond)
  const normalized = normalizeCondition(cond) as ParamHeaderCondition
  const path = normalized.path.trim()
  if (!path) return ''

  const sourceExpr =
    normalized.source === 'header'
      ? `header(${JSON.stringify(path)})`
      : `param(${JSON.stringify(path)})`

  switch (normalized.mode) {
    case MATCH_EXISTS:
      return normalized.source === 'header'
        ? `${sourceExpr} != ""`
        : `${sourceExpr} != nil`
    case MATCH_CONTAINS:
      return normalized.source === 'header'
        ? `has(${sourceExpr}, ${buildExprLiteral(normalized)})`
        : `${sourceExpr} != nil && has(${sourceExpr}, ${buildExprLiteral(normalized)})`
    case MATCH_GT:
    case MATCH_GTE:
    case MATCH_LT:
    case MATCH_LTE: {
      const opMap: Record<string, string> = {
        [MATCH_GT]: '>',
        [MATCH_GTE]: '>=',
        [MATCH_LT]: '<',
        [MATCH_LTE]: '<=',
      }
      const numText = String(normalized.value).trim()
      if (!NUMERIC_LITERAL_REGEX.test(numText)) return ''
      return `${sourceExpr} != nil && ${sourceExpr} ${opMap[normalized.mode]} ${numText}`
    }
    case MATCH_EQ:
      return `${sourceExpr} == ${buildExprLiteral(normalized)}`
    default:
      // 认不出的 mode 一律 fail-closed。原来这里和 MATCH_EQ 共用一个分支，
      // 于是任何没被识别的比较都被静默写成等于号——和时间条件那边把 `<=` 写成 `>=`
      // 是同一个机制，只是换了个源。
      return ''
  }
}

function buildRuleGroupFactor(group: RequestRuleGroup): string {
  const multiplier = (group.multiplier || '').trim()
  if (!NUMERIC_LITERAL_REGEX.test(multiplier)) return ''
  // 只丢掉构造失败的那一条、把剩下的拼起来，会得到一条更宽的规则：
  // `weekday<=5 && param("n")>=4 ? 2 : 1` 少一个条件就变成对所有请求都乘 2。
  // 少收钱是可见的（编辑器里那条规则空着），多收钱是不可见的，所以整组一起失败。
  const condExprs = (group.conditions || []).map(buildRequestConditionExpr)
  if (condExprs.length === 0 || condExprs.some((e) => !e)) return ''

  const combined =
    condExprs.length === 1
      ? condExprs[0]
      : condExprs.map((e) => (e.includes(' || ') ? `(${e})` : e)).join(' && ')
  return `(${combined} ? ${multiplier} : 1)`
}

export function buildRequestRuleExpr(groups: RequestRuleGroup[]): string {
  return (groups || []).map(buildRuleGroupFactor).filter(Boolean).join(' * ')
}
