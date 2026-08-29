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

import { parseTiersFromExpr } from '../billing-expr'
import { generateExprFromVisualConfig, type VisualTier } from '../tier-expr'

function tier(label: string, input: number, output: number, conds: VisualTier['conditions'] = []): VisualTier {
  return {
    label,
    conditions: conds,
    input_unit_cost: input,
    output_unit_cost: output,
    cache_mode: 'generic',
  } as VisualTier
}

describe('the visual editor never writes an expression the backend cannot compile', () => {
  // 多档表达式是一条 `c1 ? t1 : c2 ? t2 : t3` 的三元链。少掉一个 `cond ?`，
  // `parts.join(' : ')` 拼出来的就是 `t1 : t2` —— 一个没有 `?` 的裸冒号，
  // expr-lang 在那里直接语法错误（unexpected token Operator(":")），
  // 该模型的计费表达式整个作废、阶梯计费退到预扣兜底价。
  //
  // 而广场的 leftover 校验把 `:` 当合法填充，两个 tier 照样读得出来，
  // 卡片上标着 $3/$15 —— 标价与实扣彻底脱节，且没有任何告警。
  // 删条件那条路径（handleConditionRemove）对非末档没有任何拦截，所以只能在这里 fail-closed。
  test('fails closed when a non-final tier lost its condition', () => {
    const twoTiers = generateExprFromVisualConfig({
      tiers: [tier('a', 3, 15), tier('b', 6, 30)],
    })
    assert.equal(twoTiers, '')

    const threeTiers = generateExprFromVisualConfig({
      tiers: [
        tier('a', 3, 15, [{ var: 'len', op: '<', value: 200000 }]),
        tier('b', 6, 30),
        tier('c', 9, 45),
      ],
    })
    assert.equal(threeTiers, '')
  })

  // 反证：条件齐全时照常产出，而且产出的串能被广场读回同样的价——
  // 上面两条 '' 不是因为构造器整个坏掉了。
  test('still writes a complete chain when every non-final tier has a condition', () => {
    const expr = generateExprFromVisualConfig({
      tiers: [
        tier('a', 3, 15, [{ var: 'len', op: '<=', value: 200000 }]),
        tier('b', 6, 30),
      ],
    })
    assert.equal(
      expr,
      'len <= 200000 ? tier("a", p * 3 + c * 15) : tier("b", p * 6 + c * 30)'
    )
    assert.ok(!expr.includes(') : ') || expr.includes('? '))

    const tiers = parseTiersFromExpr(expr)
    assert.equal(tiers.length, 2)
    assert.equal(tiers[0].inputPrice, 3)
    assert.equal(tiers[1].outputPrice, 30)
  })

  // 末档不需要条件——它是三元链的 else 分支。这条防止上面的 fail-closed 收得过紧。
  test('does not require a condition on the final tier', () => {
    const single = generateExprFromVisualConfig({ tiers: [tier('only', 3, 15)] })
    assert.equal(single, 'tier("only", p * 3 + c * 15)')
  })
})
