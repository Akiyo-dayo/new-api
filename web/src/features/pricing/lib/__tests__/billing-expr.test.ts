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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  combineBillingExpr,
  parseTiersFromExpr,
  splitBillingExprAndRequestRules,
  tryParseRequestRuleExpr,
} from '../billing-expr'

const productionExpr =
  '(len < 272000 ? tier("默认", p * 5 + c * 30 + cr * 0.5 + cc * 6.25) : tier("大于272k", p * 10 + c * 60 + cr * 1 + cc * 12.5)) * 0.5'

describe('dynamic billing expression parsing', () => {
  test('applies the production outer multiplier to every tier price', () => {
    const tiers = parseTiersFromExpr(productionExpr)

    assert.equal(tiers.length, 2)
    assert.deepEqual(tiers[0], {
      label: '默认',
      conditions: [{ var: 'len', op: '<', value: 272000 }],
      inputPrice: 2.5,
      outputPrice: 15,
      cacheReadPrice: 0.25,
      cacheCreatePrice: 3.125,
      cacheCreate1hPrice: 0,
      imagePrice: 0,
      imageOutputPrice: 0,
      audioInputPrice: 0,
      audioOutputPrice: 0,
    })
    assert.deepEqual(tiers[1], {
      label: '大于272k',
      conditions: [],
      inputPrice: 5,
      outputPrice: 30,
      cacheReadPrice: 0.5,
      cacheCreatePrice: 6.25,
      cacheCreate1hPrice: 0,
      imagePrice: 0,
      imageOutputPrice: 0,
      audioInputPrice: 0,
      audioOutputPrice: 0,
    })
  })

  test('combines numeric factors before and after the tier expression', () => {
    const tiers = parseTiersFromExpr('5e-1*tier("base", p * 8 + c * 20)*.5')

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 2)
    assert.equal(tiers[0].outputPrice, 5)
  })

  test('keeps numeric billing factors while separating request rules', () => {
    const expression =
      'v1:(tier("base", p * 8 + c * 20)) * 0.5 * (param("service_tier") == "fast" ? 2 : 1) * (header("x-note") == "a*(b)" ? 0.8 : 1)'
    const split = splitBillingExprAndRequestRules(expression)
    const tiers = parseTiersFromExpr(expression)
    const rules = tryParseRequestRuleExpr(split.requestRuleExpr)

    assert.match(split.billingExpr, /^v1:/)
    assert.match(split.billingExpr, /\* 0\.5$/)
    assert.equal(tiers[0].inputPrice, 4)
    assert.equal(tiers[0].outputPrice, 10)
    assert.deepEqual(rules, [
      {
        conditions: [
          {
            source: 'param',
            path: 'service_tier',
            mode: 'eq',
            value: 'fast',
          },
        ],
        multiplier: '2',
      },
      {
        conditions: [
          {
            source: 'header',
            path: 'x-note',
            mode: 'eq',
            value: 'a*(b)',
          },
        ],
        multiplier: '0.8',
      },
    ])
  })

  test('applies numeric factors wrapped with the full billing expression', () => {
    const tiers = parseTiersFromExpr('((tier("base", p * 8 + c * 20)) * 0.5)')

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 4)
    assert.equal(tiers[0].outputPrice, 10)
  })

  test('keeps versions outside the combined expression', () => {
    const split = splitBillingExprAndRequestRules(
      'v2:(tier("base", p * 8)) * 0.5 * (header("x-fast") == "yes" ? 2 : 1)'
    )

    assert.equal(split.billingExpr, 'v2:(tier("base", p * 8)) * 0.5')
    assert.equal(
      combineBillingExpr(split.billingExpr, split.requestRuleExpr),
      'v2:((tier("base", p * 8)) * 0.5) * (header("x-fast") == "yes" ? 2 : 1)'
    )
  })

  test('reads coefficients written without spaces around the operators', () => {
    // The `+` that separates two terms must not be read as part of the
    // preceding coefficient: `Number('5+')` is NaN and used to be rendered as
    // a price of 0, so only the last term of a compact expression survived.
    const tiers = parseTiersFromExpr('v1:tier("official", p*5+c*30+cr*0.5)')

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 5)
    assert.equal(tiers[0].outputPrice, 30)
    assert.equal(tiers[0].cacheReadPrice, 0.5)
  })

  test('still reads exponent and leading-dot coefficients', () => {
    const tiers = parseTiersFromExpr('tier("base", p*1e-5+c*.5)')

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 1e-5)
    assert.equal(tiers[0].outputPrice, 0.5)
  })

  test('fails closed for unsupported or ambiguous outer factors', () => {
    const unsupported = [
      'tier("base", p * 8) * discount()',
      '(tier("base", p * 8) / 2) * 0.5',
      '(tier("base", p * 8) + tier("other", p * 2)) * 0.5',
      'len < 272000 ? tier("base", p * 8) : tier("large", p * 16) * 0.5',
      '(tier("base", p * 8) * 0.5',
      'tier("base", p * 8) * "unterminated',
    ]

    for (const expression of unsupported) {
      assert.deepEqual(parseTiersFromExpr(expression), [])
    }
  })
})

// 后端用 expr-lang 求值，空格对它没有任何意义；展示层的解析器却曾经把空格当成语法的一部分。
// 于是站长按最自然的写法配出来的表达式，后端算得好好的，广场上却显示成一串原始表达式、
// 一个价格都没有。3011 上 86 条表达式里有 12 条中招（7 个 Claude + 5 个 DeepSeek）。
describe('request rule parsing tolerates real-world formatting', () => {
  const GEO_SPACED =
    'v1:(tier("official", p * 3 + c * 15)) * (param("inference_geo") == "us" ? 1.1 : 1)'
  const GEO_COMPACT =
    'v1:(tier("official", p * 3 + c * 15)) * (param("inference_geo")=="us"?1.1:1)'

  test('reads a request rule whether or not it is written with spaces', () => {
    for (const expression of [GEO_SPACED, GEO_COMPACT]) {
      const split = splitBillingExprAndRequestRules(expression)
      const tiers = parseTiersFromExpr(split.billingExpr)
      const rules = tryParseRequestRuleExpr(split.requestRuleExpr)

      assert.equal(tiers.length, 1, expression)
      assert.equal(tiers[0].inputPrice, 3)
      assert.equal(rules?.length, 1, expression)
      assert.equal(rules?.[0].multiplier, '1.1')
      assert.equal(rules?.[0].conditions[0].value, 'us')
    }
  })

  test('reads a condition that is wrapped in its own parentheses', () => {
    const expression =
      'v1:(tier("official_cn", p * 1.5 + c * 4.5)) * ((hour("Asia/Shanghai")>=9&&hour("Asia/Shanghai")<12)?2:1)'

    const split = splitBillingExprAndRequestRules(expression)
    const tiers = parseTiersFromExpr(split.billingExpr)
    const rules = tryParseRequestRuleExpr(split.requestRuleExpr)

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 1.5)
    assert.equal(rules?.length, 1)
    assert.equal(rules?.[0].conditions.length, 2, '两个 && 分支都要拆出来')
  })

  // 时间条件原来只认 == / >= / <，于是「周一到周五」最自然的写法 weekday(tz) <= 5
  // 解析不出来，而它在后端完全合法。
  test('reads <= and > on time conditions', () => {
    const expression =
      'v1:tier("base", p * 2) * (weekday("Asia/Shanghai")<=5&&hour("Asia/Shanghai")>8?2:1)'

    const split = splitBillingExprAndRequestRules(expression)
    const rules = tryParseRequestRuleExpr(split.requestRuleExpr)

    assert.equal(rules?.length, 1)
    assert.equal(rules?.[0].conditions.length, 2)
    assert.equal(rules?.[0].conditions[0].mode, 'lte')
    assert.equal(rules?.[0].conditions[1].mode, 'gt')
  })

  // 反证：放宽空格不等于放宽语义。else 分支必须仍然是 1，否则那个因子不是"倍率规则"，
  // 把它当规则拆走会改变计费含义。
  test('still refuses a ternary whose else branch is not 1', () => {
    const expression = 'v1:tier("base", p * 2) * (param("x")=="y"?2:3)'

    const split = splitBillingExprAndRequestRules(expression)
    assert.equal(split.requestRuleExpr, '')
  })

  // 已知限制，明确钉住：条件里的 OR 仍然不支持。写成两个互斥乘数即可，
  // 语义完全相同（两个时段不重叠，最多一个乘数为 2）。
  test('does not expand an OR inside a condition, but the split rewrite does', () => {
    const withOr =
      'v1:(tier("official_cn", p * 1.5)) * ((weekday("Asia/Shanghai")>=1&&weekday("Asia/Shanghai")<=5&&((hour("Asia/Shanghai")>=9&&hour("Asia/Shanghai")<12)||(hour("Asia/Shanghai")>=14&&hour("Asia/Shanghai")<18)))?2:1)'
    assert.deepEqual(
      parseTiersFromExpr(splitBillingExprAndRequestRules(withOr).billingExpr),
      []
    )

    const rewritten =
      'v1:(tier("official_cn", p * 1.5)) * ((weekday("Asia/Shanghai")>=1&&weekday("Asia/Shanghai")<=5&&hour("Asia/Shanghai")>=9&&hour("Asia/Shanghai")<12)?2:1) * ((weekday("Asia/Shanghai")>=1&&weekday("Asia/Shanghai")<=5&&hour("Asia/Shanghai")>=14&&hour("Asia/Shanghai")<18)?2:1)'
    const split = splitBillingExprAndRequestRules(rewritten)
    const tiers = parseTiersFromExpr(split.billingExpr)
    const rules = tryParseRequestRuleExpr(split.requestRuleExpr)

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 1.5)
    assert.equal(rules?.length, 2, '两个时段各是一条规则')
  })
})
