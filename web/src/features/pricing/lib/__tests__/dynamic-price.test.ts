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

import type { PricingModel } from '../../types'
import {
  formatDynamicUnitPrice,
  getDynamicPriceEntries,
  getDynamicPricingTiers,
} from '../dynamic-price'

const model: PricingModel = {
  id: 1,
  model_name: 'jw-gpt-5.6-sol',
  quota_type: 0,
  model_ratio: 1.25,
  completion_ratio: 6,
  enable_groups: ['浅夜专属号池'],
  billing_mode: 'tiered_expr',
  billing_expr:
    '(len < 272000 ? tier("默认", p * 5 + c * 30 + cr * 0.5 + cc * 6.25) : tier("大于272k", p * 10 + c * 60 + cr * 1 + cc * 12.5)) * 0.5',
}

describe('dynamic group pricing', () => {
  test('applies expression multiplier before the shallow-night group ratio', () => {
    const tiers = getDynamicPricingTiers(model)
    const entries = getDynamicPriceEntries(tiers[0], {
      tokenUnit: 'M',
      groupRatioMultiplier: 0.55,
    })
    const prices = Object.fromEntries(
      entries.map((entry) => [
        entry.field,
        Number((entry.value * 0.55).toFixed(8)),
      ])
    )

    assert.deepEqual(prices, {
      inputPrice: 1.375,
      outputPrice: 8.25,
      cacheReadPrice: 0.1375,
      cacheCreatePrice: 1.71875,
    })
    assert.equal(
      formatDynamicUnitPrice(2.5, {
        tokenUnit: 'M',
        groupRatioMultiplier: 0.55,
      }),
      '$1.375'
    )

    const highTierPrices = Object.fromEntries(
      getDynamicPriceEntries(tiers[1], {
        tokenUnit: 'M',
        groupRatioMultiplier: 0.55,
      }).map((entry) => [entry.field, Number((entry.value * 0.55).toFixed(8))])
    )
    assert.deepEqual(highTierPrices, {
      inputPrice: 2.75,
      outputPrice: 16.5,
      cacheReadPrice: 0.275,
      cacheCreatePrice: 3.4375,
    })
  })
})
