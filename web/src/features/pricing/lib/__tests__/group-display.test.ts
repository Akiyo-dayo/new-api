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

import { SORT_OPTIONS, FILTER_ALL } from '../../constants'
import type { ModelStat, PricingModel } from '../../types'
import { filterByHiddenGroups, sortModels } from '../filters'
import { getGroupPriceTiers } from '../model-helpers'

const groupRatio = {
  free: 0,
  promo: 0.1375,
  snowA: 0.18,
  snowB: 0.18,
  premium: 0.275,
}

function model(
  name: string,
  groups: string[],
  overrides: Partial<PricingModel> = {}
): PricingModel {
  return {
    id: 1,
    model_name: name,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: groups,
    group_ratio: groupRatio,
    ...overrides,
  }
}

describe('filterByHiddenGroups', () => {
  test('drops models that only live in hidden groups', () => {
    const models = [model('free-only', ['free']), model('paid', ['promo'])]

    const kept = filterByHiddenGroups(models, FILTER_ALL, new Set(['free']))

    assert.deepEqual(
      kept.map((m) => m.model_name),
      ['paid']
    )
  })

  test('keeps a model that is also served by a visible group', () => {
    const models = [model('both', ['free', 'promo'])]

    const kept = filterByHiddenGroups(models, FILTER_ALL, new Set(['free']))

    assert.equal(kept.length, 1)
  })

  test('does nothing once a specific group is selected', () => {
    const models = [model('free-only', ['free'])]

    const kept = filterByHiddenGroups(models, 'free', new Set(['free']))

    assert.equal(kept.length, 1)
  })
})

describe('sortModels', () => {
  const stats: Record<string, ModelStat> = {
    hot: { popularity_rank: 1, success_rate: 0.5 },
    warm: { popularity_rank: 2, success_rate: 0.99 },
  }

  test('popularity puts ranked models first and untracked ones last', () => {
    const models = [model('untracked', []), model('warm', []), model('hot', [])]

    const sorted = sortModels(models, SORT_OPTIONS.POPULAR, stats)

    assert.deepEqual(
      sorted.map((m) => m.model_name),
      ['hot', 'warm', 'untracked']
    )
  })

  test('success rate sorts high to low, unknown rates last', () => {
    const models = [model('hot', []), model('untracked', []), model('warm', [])]

    const sorted = sortModels(models, SORT_OPTIONS.SUCCESS_RATE, stats)

    assert.deepEqual(
      sorted.map((m) => m.model_name),
      ['warm', 'hot', 'untracked']
    )
  })
})

describe('getGroupPriceTiers', () => {
  test('groups equal ratios into one tier, cheapest first', () => {
    const tiers = getGroupPriceTiers(
      model('multi', ['premium', 'snowB', 'promo', 'snowA'])
    )

    assert.deepEqual(
      tiers.map((tier) => tier.ratio),
      [0.1375, 0.18, 0.275]
    )
    assert.deepEqual(tiers[1].groups, ['snowA', 'snowB'])
  })

  test('ignores groups with no configured ratio', () => {
    const tiers = getGroupPriceTiers(model('partial', ['promo', 'unpriced']))

    assert.deepEqual(
      tiers.map((tier) => tier.groups),
      [['promo']]
    )
  })
})
