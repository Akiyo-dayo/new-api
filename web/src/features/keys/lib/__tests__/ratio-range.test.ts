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
  buildGroupModels,
  buildPriceLadder,
  parseRatioRange,
  resolveRatioRange,
  toggleLadderBound,
} from '../ratio-range'

// The shape of the 3011 test instance: one model served at five different
// prices, one served by a single group, and two groups sharing a price.
const GROUP_RATIOS = {
  promo: 0.1375,
  gemini: 0.15,
  snowA: 0.18,
  snowB: 0.18,
  premium: 1.1,
  unpriced: undefined,
}

const PRICING_MODELS = [
  {
    model_name: 'gpt-5.5',
    enable_groups: ['promo', 'snowA', 'snowB', 'premium'],
  },
  { model_name: 'gemini-3-flash', enable_groups: ['gemini'] },
  { model_name: 'claude-opus', enable_groups: ['premium'] },
  { model_name: 'hidden-model', enable_groups: ['not-mine'] },
  {
    model_name: 'unpriced-model',
    enable_groups: ['promo', 'snowA'],
    price_configured: false,
  },
]

const USABLE = ['promo', 'gemini', 'snowA', 'snowB', 'premium', 'unpriced']

function ladder() {
  return buildPriceLadder(
    GROUP_RATIOS,
    buildGroupModels(PRICING_MODELS, USABLE)
  )
}

describe('parseRatioRange', () => {
  // Group names commonly contain a hyphen, and a negative bound must survive as
  // a negative bound so the backend can reject it with a readable message.
  test('reads the separator from index 1 so a leading minus stays a sign', () => {
    assert.deepEqual(parseRatioRange('ratio:-0.1-0.3'), {
      min: '-0.1',
      max: '0.3',
    })
    assert.deepEqual(parseRatioRange('ratio:0.1375-0.3'), {
      min: '0.1375',
      max: '0.3',
    })
    assert.equal(parseRatioRange('promo-group'), null)
  })
})

describe('buildGroupModels', () => {
  // /api/pricing filters the model list by usable groups but leaves
  // enable_groups untrimmed, so a model can name a group this user cannot use.
  test('drops groups the user cannot use', () => {
    const byGroup = buildGroupModels(PRICING_MODELS, USABLE)
    assert.equal(byGroup['not-mine'], undefined)
    assert.deepEqual(byGroup.promo, ['gpt-5.5'])
  })

  // /v1/models hides unpriced models and calling one is refused, so offering
  // them here produces a key whose allow-list contains models it cannot call.
  test('drops models with no configured price', () => {
    const byGroup = buildGroupModels(PRICING_MODELS, USABLE)
    for (const names of Object.values(byGroup)) {
      assert.ok(!names.includes('unpriced-model'))
    }
  })
})

describe('buildPriceLadder', () => {
  test('merges same-ratio groups into one rung, cheapest first', () => {
    const rungs = ladder()
    assert.deepEqual(
      rungs.map((rung) => rung.ratio),
      [0.1375, 0.15, 0.18, 1.1]
    )
    assert.deepEqual(rungs[2].groups, ['snowA', 'snowB'])
  })

  // A group with no ratio has no position on a price scale;
  // GetUserGroupsInRatioRange skips it for the same reason.
  test('leaves out groups with no configured ratio', () => {
    assert.ok(!ladder().some((rung) => rung.groups.includes('unpriced')))
  })
})

describe('resolveRatioRange', () => {
  const groupModels = buildGroupModels(PRICING_MODELS, USABLE)

  // This is the whole point of the preview: the range spans four prices, but
  // each model has exactly one price it will actually bill at.
  test('bills each model at the cheapest in-range tier that serves it', () => {
    const resolved = resolveRatioRange(
      ladder(),
      { min: '0.1', max: '0.2' },
      groupModels
    )
    assert.equal(resolved.valid, true)
    assert.deepEqual(
      resolved.models.map((item) => [item.model, item.ratio]),
      [
        ['gpt-5.5', 0.1375],
        ['gemini-3-flash', 0.15],
      ]
    )
    assert.deepEqual(resolved.models[0].groups, ['promo'])
  })

  // "How many tiers serve this model" is what tells the user whether widening
  // the range bought them anything: a model on one tier has a fixed price.
  test('counts the tiers serving each model and the fully shared ones', () => {
    const resolved = resolveRatioRange(
      ladder(),
      { min: '0.1375', max: '0.18' },
      groupModels
    )
    const byName = new Map(resolved.models.map((item) => [item.model, item]))
    assert.equal(byName.get('gpt-5.5')?.tierCount, 2)
    assert.equal(byName.get('gemini-3-flash')?.tierCount, 1)
    // Three tiers in range, no model is on all three.
    assert.equal(resolved.tiers.length, 3)
    assert.equal(resolved.sharedModelCount, 0)
  })

  test('excludes tiers outside the range', () => {
    const resolved = resolveRatioRange(
      ladder(),
      { min: '0.1', max: '0.2' },
      groupModels
    )
    assert.ok(!resolved.groups.includes('premium'))
    assert.ok(!resolved.models.some((item) => item.model === 'claude-opus'))
  })

  // A half-typed or inverted range must read as "cannot say", never as "no
  // groups match" — the second would push the user to widen a fine range.
  test('reports invalid bounds instead of an empty match', () => {
    const rungs = ladder()
    assert.equal(
      resolveRatioRange(rungs, { min: '0.3', max: '0.1' }, groupModels).valid,
      false
    )
    assert.equal(
      resolveRatioRange(rungs, { min: '0.1', max: '' }, groupModels).valid,
      false
    )
    assert.equal(
      resolveRatioRange(rungs, { min: '0.1', max: 'abc' }, groupModels).valid,
      false
    )
  })

  test('narrows the preview to the key own model allow-list', () => {
    const resolved = resolveRatioRange(
      ladder(),
      { min: '0', max: '2' },
      groupModels,
      ['gpt-5.5']
    )
    assert.deepEqual(
      resolved.models.map((item) => item.model),
      ['gpt-5.5']
    )
  })
})

describe('toggleLadderBound', () => {
  // Bounds must be real rung ratios: 0.1375 typed as 0.14 excludes the very
  // group the user was aiming at, and nothing on screen says why.
  test('pins exact rung ratios and spans on the second click', () => {
    const rungs = ladder()
    const first = toggleLadderBound(rungs, null, 0.1375)
    assert.deepEqual(first, { min: '0.1375', max: '0.1375' })

    const spanned = toggleLadderBound(rungs, first, 0.18)
    assert.deepEqual(spanned, { min: '0.1375', max: '0.18' })

    const extendedDown = toggleLadderBound(
      rungs,
      { min: '0.18', max: '0.18' },
      0.15
    )
    assert.deepEqual(extendedDown, { min: '0.15', max: '0.18' })
  })

  test('restarts the span when a range is already complete', () => {
    const rungs = ladder()
    assert.deepEqual(
      toggleLadderBound(rungs, { min: '0.1375', max: '1.1' }, 0.15),
      { min: '0.15', max: '0.15' }
    )
  })
})
