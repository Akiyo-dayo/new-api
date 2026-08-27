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

import { SORT_OPTIONS } from '../../constants'
import type { PricingModel } from '../../types'
import { sortModels } from '../filters'

const GROUP_RATIO = { free: 0, promo: 0.1375, premium: 1.1 }

function model(
  name: string,
  modelRatio: number,
  groups: string[]
): PricingModel {
  return {
    model_name: name,
    quota_type: 0,
    model_ratio: modelRatio,
    model_price: 0,
    completion_ratio: 1,
    enable_groups: groups,
    group_ratio: GROUP_RATIO,
  } as unknown as PricingModel
}

describe('sortModels by price', () => {
  // The card prints `model_ratio x 2 x groupRatio`. Sorting on model_ratio
  // alone puts a model that is free in one group behind a dearer one, and the
  // list then contradicts the prices printed on it.
  test('orders by the price shown on the card, group ratio included', () => {
    const models = [
      model('dear-model', 1, ['premium']), // 1 x 2 x 1.1  = 2.2
      model('free-but-heavy', 30, ['free']), // 30 x 2 x 0   = 0
      model('promo-model', 5, ['promo']), // 5 x 2 x 0.1375 = 1.375
    ]

    assert.deepEqual(
      sortModels(models, SORT_OPTIONS.PRICE_LOW).map((m) => m.model_name),
      ['free-but-heavy', 'promo-model', 'dear-model']
    )
    assert.deepEqual(
      sortModels(models, SORT_OPTIONS.PRICE_HIGH).map((m) => m.model_name),
      ['dear-model', 'promo-model', 'free-but-heavy']
    )
  })

  // With a group filter on, the cards reprice to that group, so the sort has to
  // follow or the cheapest-looking card stops being first.
  test('prices against the selected group when one is active', () => {
    const models = [
      model('cheap-in-promo', 5, ['promo', 'premium']), // premium: 11
      model('cheap-in-premium', 1, ['premium']), // premium: 2.2
    ]

    assert.deepEqual(
      sortModels(models, SORT_OPTIONS.PRICE_LOW, {}, 'premium').map(
        (m) => m.model_name
      ),
      ['cheap-in-premium', 'cheap-in-promo']
    )
    // Without the filter each model is priced at its own cheapest group, which
    // flips the order.
    assert.deepEqual(
      sortModels(models, SORT_OPTIONS.PRICE_LOW).map((m) => m.model_name),
      ['cheap-in-promo', 'cheap-in-premium']
    )
  })

  // An unpriced model carries the backend's 37.5 `model_ratio` fallback. Sorting
  // on that number would rank it as one of the dearest models on the square,
  // and — worse — cheapest-first would rank it ahead of nothing while the card
  // itself prints "price not configured".
  test('parks models with no configured price at the end, both directions', () => {
    const unpriced = {
      ...model('unpriced-model', 37.5, ['promo']),
      price_configured: false,
    } as PricingModel
    const models = [
      unpriced,
      model('dear-model', 1, ['premium']), // 2.2
      model('promo-model', 5, ['promo']), // 1.375
    ]

    assert.deepEqual(
      sortModels(models, SORT_OPTIONS.PRICE_LOW).map((m) => m.model_name),
      ['promo-model', 'dear-model', 'unpriced-model']
    )
    // Reversing the direction must not float it to the top: it has no price to
    // compare, so it stays last either way.
    assert.deepEqual(
      sortModels(models, SORT_OPTIONS.PRICE_HIGH).map((m) => m.model_name),
      ['dear-model', 'promo-model', 'unpriced-model']
    )
  })
})
