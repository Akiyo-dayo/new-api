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
  MATCH_CONTAINS,
  MATCH_EQ,
  MATCH_EXISTS,
  SOURCE_HEADER,
  SOURCE_PARAM,
  SOURCE_TIME,
  buildRequestRuleExpr,
  combineBillingExpr,
  getRequestRuleMatchOptions,
  parseTiersFromExpr,
  tryParseRequestRuleExpr,
  type RequestCondition,
  type RequestRuleGroup,
} from '../billing-expr'
import { getDynamicPricingSummary } from '../dynamic-price'

// 构造端（buildRequestRuleExpr 那一路）此前零覆盖，于是「解析器认得、构造器写不出来」
// 的运算符可以一直躺着不被发现:可视化编辑器挂载即执行 buildRequestRuleExpr 并写回表单，
// 管理员什么都没点，`hour<=6 ? 0.5 : 1`（深夜半价）就被改写成 `hour>=6`（白天半价）。
// 往返测试是唯一能挡住这一类改写的形状：允许空格归一化，不允许运算符变化。
function roundTrip(expr: string): string {
  const parsed = tryParseRequestRuleExpr(expr)
  assert.ok(parsed, `expected to parse: ${expr}`)
  return buildRequestRuleExpr(parsed)
}

function withoutSpaces(expr: string): string {
  return expr.replaceAll(/\s+/g, '')
}

function sampleCondition(source: string, mode: string): RequestCondition {
  if (source === SOURCE_TIME) {
    return {
      source: 'time',
      timeFunc: 'hour',
      timezone: 'Asia/Shanghai',
      mode,
      value: '7',
      rangeStart: '22',
      rangeEnd: '6',
    }
  }
  let value = '4'
  if (mode === MATCH_EXISTS) {
    value = ''
  } else if (mode === MATCH_CONTAINS) {
    value = 'thinking'
  } else if (mode === MATCH_EQ) {
    value = 'fast'
  }
  return { source: source as 'param' | 'header', path: 'k', mode, value }
}

function dynamicModel(billingExpr: string): PricingModel {
  return {
    id: 1,
    model_name: 'roundtrip-probe',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    billing_mode: 'tiered_expr',
    billing_expr: billingExpr,
  }
}

describe('time conditions survive a parse → build round trip', () => {
  // 实测过的两条：放宽解析正则时新增了 lte/gt 两个 mode,但选项表、normalizeCondition
  // 和 buildTimeConditionExpr 三处消费端都没跟上，于是运算符在往返里被静默换掉。
  test('keeps <= and > instead of rewriting them to >=', () => {
    const weekday = '(weekday("Asia/Shanghai")<=5&&hour("Asia/Shanghai")>8?2:1)'
    assert.equal(
      roundTrip(weekday),
      '(weekday("Asia/Shanghai") <= 5 && hour("Asia/Shanghai") > 8 ? 2 : 1)'
    )
    assert.equal(withoutSpaces(roundTrip(weekday)), withoutSpaces(weekday))

    // 深夜半价。运算符翻向的话这条规则从「0 点到 6 点半价」变成「6 点之后半价」。
    const midnight = '(hour("Asia/Shanghai")<=6?0.5:1)'
    assert.equal(roundTrip(midnight), '(hour("Asia/Shanghai") <= 6 ? 0.5 : 1)')
    assert.equal(withoutSpaces(roundTrip(midnight)), withoutSpaces(midnight))
  })

  test('parses <= and > into their own modes rather than falling back to gte', () => {
    const parsed = tryParseRequestRuleExpr(
      '(weekday("Asia/Shanghai")<=5&&hour("Asia/Shanghai")>8?2:1)'
    )
    assert.deepEqual(parsed?.[0].conditions, [
      {
        source: 'time',
        timeFunc: 'weekday',
        timezone: 'Asia/Shanghai',
        mode: 'lte',
        value: '5',
        rangeStart: '',
        rangeEnd: '',
      },
      {
        source: 'time',
        timeFunc: 'hour',
        timezone: 'Asia/Shanghai',
        mode: 'gt',
        value: '8',
        rangeStart: '',
        rangeEnd: '',
      },
    ])
  })

  // 真正的不变量是「解析端能产出的每个 mode，选项表里都得有」。
  //
  // 这条用例原来写成「遍历**选项表**、断言 normalizeCondition 保留它们」——而
  // normalizeCondition 当时的判据就是「在不在选项表里」，等于拿同一张表验它自己：
  // 选项表漏一项照样全绿，正好漏掉 B1 那个场景。所以这里的 mode **必须从实际解析里取**，
  // 不能从选项表取：放宽解析正则却忘了同步选项表时，这条会红。
  test('every mode the time parser can produce is offered by the editor', () => {
    const parsedModes = new Set<string>()
    const samples = [
      '(hour("Asia/Shanghai") == 7 ? 2 : 1)',
      '(hour("Asia/Shanghai") > 7 ? 2 : 1)',
      '(hour("Asia/Shanghai") >= 7 ? 2 : 1)',
      '(hour("Asia/Shanghai") < 7 ? 2 : 1)',
      '(hour("Asia/Shanghai") <= 7 ? 2 : 1)',
      '(hour("Asia/Shanghai") >= 22 || hour("Asia/Shanghai") < 6 ? 2 : 1)',
    ]
    for (const sample of samples) {
      const parsed = tryParseRequestRuleExpr(sample)
      assert.ok(parsed, `解析不出来就说明这条语料写错了: ${sample}`)
      parsedModes.add(parsed[0].conditions[0].mode)
    }
    // 六条语料必须落到六个**不同**的 mode，否则说明解析端把两个运算符读成了同一个。
    assert.equal(parsedModes.size, samples.length)

    const offered = new Set(
      getRequestRuleMatchOptions(SOURCE_TIME).map((o) => o.value)
    )
    for (const mode of parsedModes) {
      assert.ok(offered.has(mode), `解析端能产出 ${mode}，选项表里却没有`)
    }
  })

  // 认不出的 mode 必须构造成空串，而不是被悄悄换成另一个运算符。
  // normalizeCondition 原来会把它回落成 gte / eq，于是构造端的 fail-closed 是死代码。
  test('fails closed instead of silently substituting an operator', () => {
    for (const source of [SOURCE_TIME, SOURCE_PARAM, SOURCE_HEADER]) {
      for (const bogus of ['ne', 'gte2', 'GTE']) {
        const built = buildRequestRuleExpr([
          { conditions: [sampleCondition(source, bogus)], multiplier: '2' },
        ])
        assert.equal(built, '', `${source}/${bogus}`)
      }
    }
    // 反证：同样的形状换一个认得的 mode 就写得出来。
    assert.notEqual(
      buildRequestRuleExpr([
        { conditions: [sampleCondition(SOURCE_TIME, 'gte')], multiplier: '2' },
      ]),
      ''
    )
  })

  // 选项表和 buildTimeConditionExpr 的 opMap 是两张必须对齐的表。
  // 这张期望表把对齐关系钉死：漏一项 → 构造出空串 → 红；写错一项 → 运算符对不上 → 红；
  // 两个 mode 映射到同一个运算符 → 也红。
  test('every time match option builds its own distinct operator', () => {
    const expected: Record<string, string> = {
      eq: '(hour("Asia/Shanghai") == 7 ? 2 : 1)',
      gt: '(hour("Asia/Shanghai") > 7 ? 2 : 1)',
      gte: '(hour("Asia/Shanghai") >= 7 ? 2 : 1)',
      lt: '(hour("Asia/Shanghai") < 7 ? 2 : 1)',
      lte: '(hour("Asia/Shanghai") <= 7 ? 2 : 1)',
      range:
        '(hour("Asia/Shanghai") >= 22 || hour("Asia/Shanghai") < 6 ? 2 : 1)',
    }
    const options = getRequestRuleMatchOptions(SOURCE_TIME).map((o) => o.value)
    assert.deepEqual(options, ['eq', 'gt', 'gte', 'lt', 'lte', 'range'])
    assert.deepEqual(Object.keys(expected).sort(), [...options].sort())

    const built = options.map((mode) =>
      buildRequestRuleExpr([
        {
          conditions: [sampleCondition(SOURCE_TIME, mode)],
          multiplier: '2',
        },
      ])
    )
    options.forEach((mode, index) => {
      assert.equal(built[index], expected[mode], mode)
    })
    assert.equal(
      new Set(built).size,
      options.length,
      '每个 mode 必须写出不同的表达式'
    )
  })
})

describe('every match mode the editor offers survives build → parse → build', () => {
  const combos = [SOURCE_PARAM, SOURCE_HEADER, SOURCE_TIME].flatMap((source) =>
    getRequestRuleMatchOptions(source).map((option) => ({
      source,
      mode: option.value,
    }))
  )

  test('covers the full match-option matrix', () => {
    assert.equal(combos.length, 16)
  })

  test('is byte-stable for every source and match mode', () => {
    for (const { source, mode } of combos) {
      const group: RequestRuleGroup = {
        conditions: [sampleCondition(source, mode)],
        multiplier: '2',
      }
      const built = buildRequestRuleExpr([group])
      assert.notEqual(built, '', `${source}/${mode} built nothing`)
      assert.equal(roundTrip(built), built, `${source}/${mode}`)
    }
  })

  // B2:构造端对 contains 和数值比较发出的是两项 &&,拆开后第二项单独匹配不上任何模式，
  // 整条规则判 null，广场上该模型一个价格都没有（tiers=0、special=true）。
  test('the pricing page reads back every rule the editor can write', () => {
    for (const { source, mode } of combos) {
      const ruleExpr = buildRequestRuleExpr([
        { conditions: [sampleCondition(source, mode)], multiplier: '2' },
      ])
      const summary = getDynamicPricingSummary(
        dynamicModel(
          combineBillingExpr('v1:tier("base", p*3 + c*15)', ruleExpr)
        ),
        { tokenUnit: 'M' }
      )

      const label = `${source}/${mode}`
      assert.equal(summary?.tierCount, 1, label)
      assert.equal(summary?.isSpecialExpression, false, label)
      assert.equal(summary?.hasRequestRules, true, label)
      assert.equal(summary?.tier?.inputPrice, 3, label)
      assert.equal(summary?.tier?.outputPrice, 15, label)
      assert.equal(summary?.primaryEntries.length, 2, label)
    }
  })

  test('reads the two param shapes that used to blank the whole card', () => {
    const numeric = getDynamicPricingSummary(
      dynamicModel(
        'v1:(tier("base", p*3 + c*15)) * (param("n") != nil && param("n") >= 4 ? 2 : 1)'
      ),
      { tokenUnit: 'M' }
    )
    assert.equal(numeric?.tierCount, 1)
    assert.equal(numeric?.tier?.inputPrice, 3)
    assert.equal(numeric?.tier?.outputPrice, 15)
    assert.equal(numeric?.hasRequestRules, true)
    assert.equal(numeric?.isSpecialExpression, false)

    const contains = getDynamicPricingSummary(
      dynamicModel(
        'v1:(tier("base", p*3 + c*15)) * (param("x") != nil && has(param("x"), "thinking") ? 2 : 1)'
      ),
      { tokenUnit: 'M' }
    )
    assert.equal(contains?.tierCount, 1)
    assert.equal(contains?.tier?.outputPrice, 15)
    assert.equal(contains?.hasRequestRules, true)
    assert.equal(contains?.isSpecialExpression, false)
  })

  // 反证：合并只吃掉「守卫 + 紧随其后的同名条件」，用户真的只想判存在的那条不能被吞掉。
  test('does not swallow a standalone exists condition', () => {
    const parsed = tryParseRequestRuleExpr(
      '(param("x") != nil && param("x") != nil && param("x") >= 4 ? 2 : 1)'
    )
    assert.deepEqual(parsed?.[0].conditions, [
      { source: 'param', path: 'x', mode: 'exists', value: '' },
      { source: 'param', path: 'x', mode: 'gte', value: '4' },
    ])

    const trailing = tryParseRequestRuleExpr(
      '(param("x") != nil && has(param("x"), "a") && param("x") != nil ? 2 : 1)'
    )
    assert.deepEqual(trailing?.[0].conditions, [
      { source: 'param', path: 'x', mode: 'contains', value: 'a' },
      { source: 'param', path: 'x', mode: 'exists', value: '' },
    ])

    const mixed = tryParseRequestRuleExpr(
      '(param("x") != nil && header("h") == "v" ? 2 : 1)'
    )
    assert.deepEqual(mixed?.[0].conditions, [
      { source: 'param', path: 'x', mode: 'exists', value: '' },
      { source: 'header', path: 'h', mode: 'eq', value: 'v', valueQuoted: true },
    ])
  })

  test('reads a range written on both sides of the same param', () => {
    const parsed = tryParseRequestRuleExpr(
      '(param("n") != nil && param("n") >= 4 && param("n") != nil && param("n") <= 10 ? 2 : 1)'
    )
    assert.deepEqual(parsed?.[0].conditions, [
      { source: 'param', path: 'n', mode: 'gte', value: '4' },
      { source: 'param', path: 'n', mode: 'lte', value: '10' },
    ])
  })

  // 只丢掉构造失败的那一条、把剩下的拼起来,会得到一条更宽的规则——对所有请求都乘 2。
  // 少收钱可见，多收钱不可见，所以整组一起失败。
  test('drops the whole group when one condition cannot be built', () => {
    const partial: RequestRuleGroup = {
      conditions: [
        sampleCondition(SOURCE_TIME, 'lte'),
        { source: 'param', path: 'n', mode: 'gte', value: 'not-a-number' },
      ],
      multiplier: '2',
    }
    assert.equal(buildRequestRuleExpr([partial]), '')

    const blankPath: RequestRuleGroup = {
      conditions: [
        sampleCondition(SOURCE_TIME, 'lte'),
        { source: 'param', path: '', mode: 'eq', value: 'x' },
      ],
      multiplier: '2',
    }
    assert.equal(buildRequestRuleExpr([blankPath]), '')
  })
})

// B3:旧实现「取到多少算多少、其余按 0 计」，价格偏低且 isSpecialExpression 为 false，
// 卡片上连个警告都没有——比显示「无法解析」危险得多。
describe('tier bodies are read in full or not at all', () => {
  test('reads a coefficient written before the variable', () => {
    const tiers = parseTiersFromExpr('tier("base", p*3 + 15*c)')

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 3)
    assert.equal(tiers[0].outputPrice, 15)
  })

  test('sums a variable that appears more than once', () => {
    const tiers = parseTiersFromExpr('tier("base", p*3 + p*5 + c*15)')

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 8)
    assert.equal(tiers[0].outputPrice, 15)
  })

  test('reads number-first coefficients for the extra price variables', () => {
    const tiers = parseTiersFromExpr(
      'tier("base", p*3 + c*15 + 0.3*cr + 3*cc1h + 2*img_o)'
    )

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].cacheReadPrice, 0.3)
    assert.equal(tiers[0].cacheCreate1hPrice, 3)
    assert.equal(tiers[0].imageOutputPrice, 2)
  })

  // 数字分支前不能加 \b，否则 `.5*cr` 会从 `5` 重新起匹配，把 0.5 悄悄读成 5。
  test('keeps a leading-dot coefficient at its real magnitude', () => {
    const tiers = parseTiersFromExpr('tier("base", .5*cr + 1e-5*p)')

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].cacheReadPrice, 0.5)
    assert.equal(tiers[0].inputPrice, 1e-5)
  })

  test('still applies the outer multiplier to number-first coefficients', () => {
    const tiers = parseTiersFromExpr('tier("base", 3*p + 15*c) * 0.5')

    assert.equal(tiers.length, 1)
    assert.equal(tiers[0].inputPrice, 1.5)
    assert.equal(tiers[0].outputPrice, 7.5)
  })

  test('fails closed on a term that cannot be attributed to a variable', () => {
    const unattributable = [
      'tier("base", p*3*2)',
      'tier("base", p*3 + c*15/2)',
      'tier("base", p*3 - c*15)',
      'tier("base", p*3 + img*qty)',
      'tier("base", p*3 + 2c)',
      'tier("base", 2*3*p)',
    ]

    for (const expression of unattributable) {
      assert.deepEqual(parseTiersFromExpr(expression), [], expression)
    }
  })

  test('surfaces an unreadable tier body as a special expression', () => {
    const summary = getDynamicPricingSummary(
      dynamicModel('v1:tier("base", p*3 + c*15/2)'),
      { tokenUnit: 'M' }
    )

    assert.equal(summary?.tierCount, 0)
    assert.equal(summary?.isSpecialExpression, true)
    assert.deepEqual(summary?.entries, [])
  })

  // 反证：收紧不等于把合法写法一起挡掉。常数项、空白和多余空格都不是剩余项。
  // 裸常数是一笔固定附加费，后端照收，展示层没有字段能承载它。
  // 放行会让卡片标着 $3/$15、实收更高，而且因为 tiers.length === 1，
  // isSpecialExpression 是 false —— 连"这个价可能不准"的提示都没有。
  test('fails closed on a flat surcharge it cannot display', () => {
    assert.deepEqual(parseTiersFromExpr('tier("base", p*3 + c*15 + 0.5)'), [])
    assert.deepEqual(parseTiersFromExpr('tier("base", p*3 + c*15 + 15)'), [])
  })

  // 反证：系数里的数字本来就被变量项吃掉了，多余空格也不算剩余项——
  // 上面那条 fail-closed 不能把正常表达式一起拖下水。
  test('does not mistake coefficient digits or whitespace for an unreadable term', () => {
    const spaced = parseTiersFromExpr('tier("base",   p  *  3   +   c  *  15 )')
    assert.equal(spaced.length, 1)
    assert.equal(spaced[0].inputPrice, 3)
    assert.equal(spaced[0].outputPrice, 15)

    // 带小数、科学计数法、以及会撞上变量名的 cc1h/img_o 都必须照常读出来。
    const wide = parseTiersFromExpr(
      'tier("base", p*0.43 + c*3.06 + cr*0.3 + cc*3.75 + cc1h*6 + img*2.5 + img_o*1e0 + ai*3.81 + ao*15.11)'
    )
    assert.equal(wide.length, 1)
    assert.equal(wide[0].inputPrice, 0.43)
    assert.equal(wide[0].outputPrice, 3.06)
  })
})

describe('param match options and the builder operator table stay aligned', () => {
  // 时间条件那张对齐表挡住了 B1，但 param 的数值比较用的是**另一张** opMap，
  // 而 build → parse → build 的字节稳定性测试**看不见**它写错：把 lte 构造成 `>=`
  // 之后，解析端会把 `>=` 读回 gte，再构造仍然是 `>=` —— 往返稳定，语义却已经从
  // 「小于等于」变成了「大于等于」，正是 B1 那一类静默改价。实测这个变异能存活，
  // 所以这里也需要一张写死期望运算符的表。
  test('every param match option builds its own distinct operator', () => {
    const expected: Record<string, string> = {
      eq: '(param("k") == "fast" ? 2 : 1)',
      contains: '(param("k") != nil && has(param("k"), "thinking") ? 2 : 1)',
      exists: '(param("k") != nil ? 2 : 1)',
      gt: '(param("k") != nil && param("k") > 4 ? 2 : 1)',
      gte: '(param("k") != nil && param("k") >= 4 ? 2 : 1)',
      lt: '(param("k") != nil && param("k") < 4 ? 2 : 1)',
      lte: '(param("k") != nil && param("k") <= 4 ? 2 : 1)',
    }
    const options = getRequestRuleMatchOptions(SOURCE_PARAM).map((o) => o.value)
    assert.deepEqual(Object.keys(expected).sort(), [...options].sort())

    const built = options.map((mode) =>
      buildRequestRuleExpr([
        { conditions: [sampleCondition(SOURCE_PARAM, mode)], multiplier: '2' },
      ])
    )
    options.forEach((mode, index) => {
      assert.equal(built[index], expected[mode], mode)
    })
    assert.equal(
      new Set(built).size,
      options.length,
      '每个 mode 必须写出不同的表达式'
    )
  })
})

describe('equality literals keep the type the backend expects', () => {
  // header(...) 在 v1 env 里是 func(string) string。和数字/布尔比较**编译不过**：
  //   header("h") == 1    → invalid operation: == (mismatched types string and int)
  //   header("h") == true → invalid operation: == (mismatched types string and bool)
  // 编译失败 = 整条计费表达式作废 = 阶梯计费退到预扣兜底价。
  // 而这不需要手写表达式：在编辑器里选 Header / Equals / 填 1 就会走到这里。
  test('header equality is always written as a string', () => {
    for (const value of ['1', '0', '3.5', 'true', 'false', '1e3']) {
      const built = buildRequestRuleExpr([
        {
          conditions: [
            { source: 'header', path: 'h', mode: MATCH_EQ, value },
          ] as RequestCondition[],
          multiplier: '2',
        },
      ])
      assert.equal(built, `(header("h") == ${JSON.stringify(value)} ? 2 : 1)`)
    }
  })

  // param(...) 是 interface{}，两种写法都编译得过但语义不同：请求体里是数字 5 要写裸 5，
  // 是字符串 "5" 要写 "5"，写错了规则恒不命中（少收钱且无声）。输入框里两者都只显示 5，
  // 所以解析时记住原文带不带引号，构造回去照原样写。
  test('param equality round-trips the literal type it was written with', () => {
    for (const expr of [
      '(param("x") == "5" ? 2 : 1)',
      '(param("x") == 5 ? 2 : 1)',
      '(param("x") == "true" ? 2 : 1)',
      '(param("x") == true ? 2 : 1)',
      '(param("x") == "fast" ? 2 : 1)',
    ]) {
      const parsed = tryParseRequestRuleExpr(expr)
      assert.ok(parsed, expr)
      assert.equal(buildRequestRuleExpr(parsed), expr)
    }
  })

  // header 侧的往返同样保真——而且不管原文写的是裸字面量还是字符串，都归一成字符串，
  // 因为裸字面量那种后端根本编译不过，保真地写回去等于把坏表达式留在库里。
  test('header equality normalises a bare literal into a string', () => {
    const parsed = tryParseRequestRuleExpr('(header("h") == "1" ? 2 : 1)')
    assert.ok(parsed)
    assert.equal(buildRequestRuleExpr(parsed), '(header("h") == "1" ? 2 : 1)')

    const bare = tryParseRequestRuleExpr('(header("h") == 1 ? 2 : 1)')
    assert.ok(bare)
    assert.equal(buildRequestRuleExpr(bare), '(header("h") == "1" ? 2 : 1)')
  })
})
