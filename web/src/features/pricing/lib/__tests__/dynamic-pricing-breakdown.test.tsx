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
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'matchMedia',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')

const i18n = createInstance()
// 缺失的 key 原样返回，正好等于本项目「key 就是英文原文」的约定。
await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: {} } })

const { DynamicPricingBreakdown } =
  await import('../../components/dynamic-pricing-breakdown')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

async function renderBreakdown(billingExpr: string): Promise<string> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <DynamicPricingBreakdown billingExpr={billingExpr} />
      </I18nextProvider>
    )
  })

  const text = container.textContent ?? ''
  await act(async () => root.unmount())
  container.remove()
  return text
}

// describeCondition 的 opMap 漏一个运算符不会显示成「读不懂」,会显示成另一条规则。
// 这个组件还被 usage-logs 的详情弹窗复用,用户对账时看到的规则描述就是它。
describe('conditional multiplier descriptions match the stored operator', () => {
  after(() => {
    domWindow.close()
  })

  test('renders <= and > on time conditions instead of = and >=', async () => {
    const text = await renderBreakdown(
      'v1:(tier("base", p*3 + c*15)) * (weekday("Asia/Shanghai")<=5&&hour("Asia/Shanghai")>8?2:1)'
    )

    assert.equal(
      text.includes('Weekday ≤ 5 (Asia/Shanghai) && Hour > 8 (Asia/Shanghai)'),
      true,
      text
    )
    assert.equal(
      text.includes('Weekday = 5'),
      false,
      '曾经被渲染成 Weekday = 5'
    )
    assert.equal(text.includes('Hour ≥ 8'), false, '曾经被渲染成 Hour ≥ 8')
    assert.equal(text.includes('2x'), true)
  })

  test('renders each time operator distinctly', async () => {
    const cases: [string, string][] = [
      ['hour("Asia/Shanghai")==7', 'Hour = 7 (Asia/Shanghai)'],
      ['hour("Asia/Shanghai")>7', 'Hour > 7 (Asia/Shanghai)'],
      ['hour("Asia/Shanghai")>=7', 'Hour ≥ 7 (Asia/Shanghai)'],
      ['hour("Asia/Shanghai")<7', 'Hour < 7 (Asia/Shanghai)'],
      ['hour("Asia/Shanghai")<=7', 'Hour ≤ 7 (Asia/Shanghai)'],
    ]

    for (const [condition, expected] of cases) {
      const text = await renderBreakdown(
        `v1:(tier("base", p*3)) * (${condition}?2:1)`
      )
      assert.equal(text.includes(expected), true, `${condition} → ${text}`)
    }
  })

  test('renders a param comparison the editor generates', async () => {
    const text = await renderBreakdown(
      'v1:(tier("base", p*3 + c*15)) * (param("n") != nil && param("n") >= 4 ? 2 : 1)'
    )

    assert.equal(text.includes('Body param n ≥ 4'), true, text)
    // 规则读得回来，价格表也必须还在（B2 里这两件事是一起丢的）。
    assert.equal(text.includes('Special billing expression'), false)
    assert.equal(text.includes('$3'), true, text)
    assert.equal(text.includes('$15'), true, text)
  })

  test('falls back to the raw expression when the tier body is unreadable', async () => {
    const text = await renderBreakdown('v1:tier("base", p*3 + c*15/2)')

    assert.equal(text.includes('Special billing expression'), true, text)
    assert.equal(
      text.includes('$3'),
      false,
      '偏低的价格不能当成解析成功显示出来'
    )
  })
})
