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
