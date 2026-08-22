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

import type { PricingModel } from '../../types'
import {
  formatDynamicUnitPrice,
  getDynamicPriceEntries,
  getDynamicPricingTiers,
  type DynamicPriceOptions,
} from '../dynamic-price'

const pricingOptions: DynamicPriceOptions = {
  tokenUnit: 'M',
  groupRatioMultiplier: 0.55,
}

function formattedPrices(tierIndex: number) {
  return Object.fromEntries(
    getDynamicPriceEntries(
      getDynamicPricingTiers(model)[tierIndex],
      pricingOptions
    ).map((entry) => [entry.field, entry.formatted])
  )
}

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
    expect(formattedPrices(0)).toEqual({
      inputPrice: '$1.375',
      outputPrice: '$8.25',
      cacheReadPrice: '$0.1375',
      cacheCreatePrice: '$1.7188',
    })
    expect(formatDynamicUnitPrice(2.5, pricingOptions)).toBe('$1.375')

    expect(formattedPrices(1)).toEqual({
      inputPrice: '$2.75',
      outputPrice: '$16.5',
      cacheReadPrice: '$0.275',
      cacheCreatePrice: '$3.4375',
    })
  })
})
