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
 * The grammar is intentionally narrow: we only support the shapes that the
 * server emits (tiered pricing + request-rule conditional multipliers), so
 * the regular expressions are exact rather than tolerant of arbitrary
 * expression syntax.
 */

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

const BILLING_NUMBER_SOURCE = '\\d*\\.?\\d+(?:[eE][+-]?\\d+)?'
const BILLING_VAR_ALTERNATION = BILLING_PRICING_VARS.map((v) => v.key).join('|')

// The coefficient must be a real number literal. A looser character class such
// as `[\d.eE+-]+` swallows the `+` that separates two terms, so the compact
// `p*5+c*30` yields `Number('5+')` — NaN, which `parseTierBody` then silently
// turns into a price of 0. Only spaced expressions survived that.
//
// 系数写在变量前后都是合法的：`p * 3` 与 `3 * p` 对 expr-lang 完全等价，raw 模式手写时
// 后一种很自然。只认前一种的话 `p*3 + 15*c` 会丢掉 Output——而且不告警。
// 数字分支前不能加 `\b`：`.5*cr` 的 `\b` 卡在小数点上，会从 `5` 重新起匹配，
// 把 0.5 悄悄读成 5。变量分支后需要 `\b`，否则 `3*price` 会被读成 `3*p`。
const BILLING_VAR_REGEX = new RegExp(
  `(?:\\b(${BILLING_VAR_ALTERNATION})\\s*\\*\\s*(${BILLING_NUMBER_SOURCE})` +
    `|(${BILLING_NUMBER_SOURCE})\\s*\\*\\s*(${BILLING_VAR_ALTERNATION})\\b)`,
  'g'
)

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
}

export type TierCondition = {
  var: 'p' | 'c' | 'len'
  op: '<' | '<=' | '>' | '>='
  value: number
}

export type ParsedTier = {
  label: string
  conditions: TierCondition[]
  [field: string]: unknown
}

// ---------------------------------------------------------------------------
// Tier parser
// ---------------------------------------------------------------------------

function stripExprVersion(exprStr: string): {
  version: number
  prefix: string
  body: string
} {
  if (!exprStr) return { version: 1, prefix: '', body: '' }
  // 只认 v1:，与后端 billingexpr.ParseExprVersion 逐字对齐——它也只 strings.HasPrefix("v1:")。
  // 原来的 /^v(\d+):/ 会把 v2: 也剥掉、然后按 v1 语义给它标价，而后端拿到 `v2:tier(...)`
  // 是整串丢进 expr.Compile，在那个冒号上语法错误。expr.md 把版本前缀写成「不破坏存量表达式的
  // 演进手段」，真出 v2 的那天，放宽的这一版会给每个 v2 表达式标一个 v1 的价。
  const m = exprStr.match(/^v1:([\s\S]*)$/)
  if (m) {
    return { version: 1, prefix: 'v1:', body: m[1] }
  }
  return { version: 1, prefix: '', body: exprStr }
}

// parseTierBody 解析 `tier("名字", <这里>)` 的第二个参数，解析不出全貌时返回 null。
//
// 旧实现「取到多少算多少、其余按 0 计」：`p*3 + p*5` 只记 3、`c*15/2` 只记 15、
// `img*qty` 直接当没写。价格偏低且 isSpecialExpression 为 false，卡片上连个警告都没有——
// 站长以为配置生效了，实际按另一个价在收钱。归因不到变量的剩余项一律让整个 tier 失败，
// 让上层退回「特殊计费表达式 / 无法解析」。
function parseTierBody(
  bodyStr: string,
  outerMultiplier: number
): Record<string, number> | null {
  const coeffs: Record<string, number> = {}
  const re = new RegExp(BILLING_VAR_REGEX.source, 'g')
  let unmatched = ''
  let cursor = 0
  let m
  while ((m = re.exec(bodyStr)) !== null) {
    unmatched += bodyStr.slice(cursor, m.index)
    cursor = re.lastIndex
    // A non-finite coefficient must not reach `tier` below: `|| 0` there would
    // render it as a free price rather than as an unparsable expression.
    const coefficient = Number(m[2] ?? m[3])
    if (!Number.isFinite(coefficient)) return null
    // 同一变量可以出现多次，后端是相加（`p*3 + p*5` 等于 `p*8`），展示层也必须相加。
    const varName = (m[1] ?? m[4]) as string
    coeffs[varName] = (coeffs[varName] || 0) + coefficient
  }
  unmatched += bodyStr.slice(cursor)

  // 剩余项检查，形状照 parseTiersFromExpr 的 unmatched 校验。
  // 只有空白、`+` 和括号算合法填充；`*`、`/`、`-`、任何标识符，以及**没有绑到变量上的
  // 裸数字**都算剩余项。
  //
  // 裸数字算剩余项是有意的：`tier("base", p*3 + c*15 + 15)` 里那个 15 是一笔固定附加费，
  // 后端照收，而展示层没有任何字段能承载它。放行的话卡片会标着 $3/$15、实收更高，
  // 而且 isSpecialExpression 为 false —— 用户连"这个价可能不准"的提示都得不到。
  // 宁可整条退回"特殊计费表达式"让人看见，也不要静默给一个偏低的数。
  // pkg/billingexpr/expr.md 里的示例表达式全部是 `变量 * 系数` 的和，没有一个用裸常数，
  // 所以这条收紧在现有配置上是空转的，防的是以后新写的表达式。
  const leftover = unmatched.replaceAll(/[\s+()]+/g, '')
  if (leftover) return null

  const tier: Record<string, number> = {}
  for (const [varName, field] of Object.entries(BILLING_VAR_KEY_TO_FIELD)) {
    tier[field] = (coeffs[varName] || 0) * outerMultiplier
  }
  return tier
}

function hasTopLevelConditional(expr: string): boolean {
  let depth = 0
  let quote = ''
  let escaped = false

  for (const char of expr) {
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth < 0) return true
    } else if (char === '?' && depth === 0) {
      return true
    }
  }

  return false
}

function getTierExpressionParts(exprStr: string): {
  body: string
  multiplier: number
} | null {
  const split = splitBillingExprAndRequestRules(exprStr)
  const { body } = stripExprVersion(split.billingExpr)
  const factors = splitTopLevelMultiply(unwrapOuterParens(body))
  if (!factors) return null

  let multiplier = 1
  let numericFactorCount = 0
  const structuralFactors: string[] = []

  for (const factor of factors) {
    const unwrapped = unwrapOuterParens(factor)
    if (NUMERIC_LITERAL_REGEX.test(unwrapped)) {
      const value = Number(unwrapped)
      if (!Number.isFinite(value) || value < 0) return null
      multiplier *= value
      numericFactorCount += 1
    } else {
      structuralFactors.push(factor)
    }
  }

  if (
    structuralFactors.length !== 1 ||
    !Number.isFinite(multiplier) ||
    (numericFactorCount > 0 && hasTopLevelConditional(structuralFactors[0]))
  ) {
    return null
  }

  return {
    body: unwrapOuterParens(structuralFactors[0]),
    multiplier,
  }
}

export function parseTiersFromExpr(exprStr: string): ParsedTier[] {
  if (!exprStr) return []
  try {
    const expression = getTierExpressionParts(exprStr)
    if (!expression) return []
    const { body, multiplier } = expression
    const condGroup =
      `((?:(?:p|c|len)\\s*(?:<|<=|>|>=)\\s*[\\d.eE+]+)` +
      `(?:\\s*&&\\s*(?:p|c|len)\\s*(?:<|<=|>|>=)\\s*[\\d.eE+]+)*)`
    const tierRe = new RegExp(
      `(?:${condGroup}\\s*\\?\\s*)?tier\\("([^"]*)",\\s*([^)]+)\\)`,
      'g'
    )
    const tiers: ParsedTier[] = []
    const matchedRanges: Array<[number, number]> = []
    let m
    while ((m = tierRe.exec(body)) !== null) {
      matchedRanges.push([m.index, tierRe.lastIndex])
      const condStr = m[1] || ''
      const conditions: TierCondition[] = []
      if (condStr) {
        for (const cp of condStr.split(/\s*&&\s*/)) {
          const cm = cp.trim().match(/^(p|c|len)\s*(<|<=|>|>=)\s*([\d.eE+]+)$/)
          if (cm) {
            conditions.push({
              var: cm[1] as TierCondition['var'],
              op: cm[2] as TierCondition['op'],
              value: Number(cm[3]),
            })
          }
        }
      }
      const parsedBody = parseTierBody(m[3], multiplier)
      if (!parsedBody) return []
      const tier = parsedBody as ParsedTier
      tier.label = m[2]
      tier.conditions = conditions
      tiers.push(tier)
    }

    const unmatched = body
      .split('')
      .map((char, index) =>
        matchedRanges.some(([start, end]) => index >= start && index < end)
          ? ''
          : char
      )
      .join('')
      .replaceAll(/[\s():?]+/g, '')
    if (unmatched) return []

    return tiers
  } catch {
    return []
  }
}

export function normalizeTierLabel(label: string | undefined): string {
  if (!label) return ''
  return label
    .replace(/<[=＝]?|≤|＜[=＝]?/g, '<')
    .replace(/>[=＝]?|≥|＞[=＝]?/g, '>')
    .replace(/\s+/g, '')
    .toLowerCase()
}

// ---------------------------------------------------------------------------
// Request rule parser
// ---------------------------------------------------------------------------

function splitTopLevelMultiply(expr: string): string[] | null {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  let escaped = false

  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(') {
      depth += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth < 0) return null
      continue
    }
    if (depth === 0 && char === '*') {
      const part = expr.slice(start, index).trim()
      if (!part) return null
      parts.push(part)
      start = index + 1
    }
  }

  if (quote || depth !== 0) return null
  const finalPart = expr.slice(start).trim()
  if (!finalPart) return null
  parts.push(finalPart)
  return parts
}

// splitTopLevelAnd 按顶层 && 拆条件。
//
// 原来匹配的是四个字符 ' && '（两侧强制带空格），于是后端完全合法的 `a>=1&&a<=5`
// 在前端一个条件都拆不出来，整条规则被判为"无法解析"，连带把基础价一起丢掉。
// 后端用的是 expr-lang，空格对它没有意义；展示层不该比计费层更挑剔。
function splitTopLevelAnd(expr: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  let escaped = false

  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (c === '\\') {
        escaped = true
      } else if (c === quote) {
        quote = ''
      }
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === '(') depth += 1
    else if (c === ')') depth -= 1
    else if (depth === 0 && c === '&' && expr[i + 1] === '&') {
      parts.push(expr.slice(start, i).trim())
      start = i + 2
      i += 1
    }
  }
  parts.push(expr.slice(start).trim())
  return parts.filter(Boolean)
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

function tryParseTimeCondition(expr: string): RequestCondition | null {
  let m = expr.match(
    /^(hour|minute|weekday|month|day)\("([^"]+)"\)\s*>=\s*(\d*\.?\d+(?:[eE][+-]?\d+)?)\s*\|\|\s*\1\("\2"\)\s*<\s*(\d*\.?\d+(?:[eE][+-]?\d+)?)$/
  )
  if (m) {
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
    /^\((hour|minute|weekday|month|day)\("([^"]+)"\)\s*>=\s*(\d*\.?\d+(?:[eE][+-]?\d+)?)\s*\|\|\s*\1\("\2"\)\s*<\s*(\d*\.?\d+(?:[eE][+-]?\d+)?)\)$/
  )
  if (m) {
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
  if (m)
    return {
      source: 'header',
      path: m[1],
      mode: MATCH_CONTAINS,
      value: JSON.parse(m[2]) as string,
    }

  m = expr.match(
    /^param\("([^"]+)"\)\s*!=\s*nil\s*&&\s*has\(param\("([^"]+)"\),\s*((?:"(?:[^"\\]|\\.)*"))\)$/
  )
  if (m && m[1] === m[2])
    return {
      source: 'param',
      path: m[1],
      mode: MATCH_CONTAINS,
      value: JSON.parse(m[3]) as string,
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

  const andParts = splitTopLevelAnd(conditionStr).map((ap) =>
    unwrapOuterParens(ap.trim())
  )

  // 构造端对 param 的 contains / 数值比较发出的是两项 `&&`：
  // `param("x") != nil && has(param("x"), "y")`、`param("n") != nil && param("n") >= 4`。
  // 按顶层 && 拆开后第二项单独匹配不上任何模式，整条规则判 null，
  // 于是编辑器自己生成的表达式，广场上一个价格都读不出来（tiers=0、special=true）。
  // 这里把守卫和紧随其后的同名条件先拼回去，交给下面那两条本来就为完整串写的组合正则——
  // 它们在拆分之后是永远走不到的死代码。
  //
  // 只在拼起来确实能解析成 contains/数值比较时才吞掉守卫，所以用户真的只想判「存在」的
  // 那条 `param("x") != nil` 不会被误吞（它后面跟的不是对同一个 x 的条件，拼接匹配不上）。
  const conditions: RequestCondition[] = []
  for (let i = 0; i < andParts.length; i += 1) {
    const guarded =
      i + 1 < andParts.length &&
      /^param\("(?:[^"\\]|\\.)*"\)\s*!=\s*nil$/.test(andParts[i])
        ? tryParseRequestCondition(`${andParts[i]} && ${andParts[i + 1]}`)
        : null
    if (guarded) {
      conditions.push(guarded)
      i += 1
      continue
    }
    const cond = tryParseRequestCondition(andParts[i])
    if (!cond) return null
    conditions.push(cond)
  }
  if (conditions.length === 0) return null
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

function hasFullOuterParens(expr: string): boolean {
  if (!expr.startsWith('(') || !expr.endsWith(')')) return false
  let depth = 0
  let quote = ''
  let escaped = false

  for (let i = 0; i < expr.length; i += 1) {
    const char = expr[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth < 0) return false
    }
    if (depth === 0 && i < expr.length - 1) return false
  }

  return !quote && depth === 0
}

function unwrapOuterParens(expr: string): string {
  let current = (expr || '').trim()
  while (hasFullOuterParens(current)) {
    current = current.slice(1, -1).trim()
  }
  return current
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
    if (parsed && parsed.length > 0) {
      ruleParts.push(part)
      return
    }

    billingParts.push(part)
    if (!NUMERIC_LITERAL_REGEX.test(unwrapOuterParens(part))) {
      structuralBillingParts += 1
    }
  })

  if (ruleParts.length === 0 || structuralBillingParts !== 1) {
    return { billingExpr: trimmed, requestRuleExpr: '' }
  }

  return {
    billingExpr: `${prefix}${billingParts.join(' * ')}`,
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
  const source =
    cond?.source === 'time'
      ? 'time'
      : cond?.source === 'header'
        ? 'header'
        : 'param'

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
    if (!NUMERIC_LITERAL_REGEX.test(s) || !NUMERIC_LITERAL_REGEX.test(e)) {
      return ''
    }
    return `${fn} >= ${s} || ${fn} < ${e}`
  }
  const v = normalized.value.trim()
  if (!NUMERIC_LITERAL_REGEX.test(v)) return ''
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
