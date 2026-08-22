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
import { describe, expect, test } from 'vitest'

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

    expect(tiers).toHaveLength(2)
    expect(tiers[0]).toEqual({
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
    expect(tiers[1]).toEqual({
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

    expect(tiers).toHaveLength(1)
    expect(tiers[0].inputPrice).toBe(2)
    expect(tiers[0].outputPrice).toBe(5)
  })

  test('keeps numeric billing factors while separating request rules', () => {
    const expression =
      'v1:(tier("base", p * 8 + c * 20)) * 0.5 * (param("service_tier") == "fast" ? 2 : 1) * (header("x-note") == "a*(b)" ? 0.8 : 1)'
    const split = splitBillingExprAndRequestRules(expression)
    const tiers = parseTiersFromExpr(expression)
    const rules = tryParseRequestRuleExpr(split.requestRuleExpr)

    expect(split.billingExpr).toMatch(/^v1:/)
    expect(split.billingExpr).toMatch(/\* 0\.5$/)
    expect(tiers[0].inputPrice).toBe(4)
    expect(tiers[0].outputPrice).toBe(10)
    expect(rules).toEqual([
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

    expect(tiers).toHaveLength(1)
    expect(tiers[0].inputPrice).toBe(4)
    expect(tiers[0].outputPrice).toBe(10)
  })

  test('keeps versions outside the combined expression', () => {
    const split = splitBillingExprAndRequestRules(
      'v2:(tier("base", p * 8)) * 0.5 * (header("x-fast") == "yes" ? 2 : 1)'
    )

    expect(split.billingExpr).toBe('v2:(tier("base", p * 8)) * 0.5')
    expect(
      combineBillingExpr(split.billingExpr, split.requestRuleExpr)
    ).toBe(
      'v2:((tier("base", p * 8)) * 0.5) * (header("x-fast") == "yes" ? 2 : 1)'
    )
  })

  test('fails closed for unsupported or ambiguous outer factors', () => {
    const unsupported = [
      'tier("base", p * 8) * discount()',
      '(tier("base", p * 8) / 2) * 0.5',
      '(tier("base", p * 8) + tier("other", p * 2)) * 0.5',
      'tier("base", p * 8 + p * 4) * 0.5',
      'tier("base", p * 8 * 0.5)',
      'tier("base", p * -8)',
      'len < 272000 ? tier("base", p * 8) : tier("large", p * 16) * 0.5',
      '(tier("base", p * 8) * 0.5',
      'tier("base", p * 8) * "unterminated',
    ]

    for (const expression of unsupported) {
      expect(parseTiersFromExpr(expression)).toEqual([])
    }
  })
})
