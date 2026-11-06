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
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import { getSkinAssets } from '@/hooks/use-skin-assets'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zhCN from '@/i18n/locales/zh.json'

const resources = { en, fr, ja, ru, vi, zhTW, zhCN }

const SKINS = ['atri', 'aemeath', 'claude'] as const
// UI strings the Claude skin adds outside its copy profile (sticker
// captions and the artwork credit).
const CLAUDE_UI_KEYS = [
  'Claude-chan',
  'Stickers by',
  'This place is empty — even the little whale got carried off',
  "Your account is still here — it's this page that's gone",
] as const
const LANGUAGES = Object.keys(resources) as (keyof typeof resources)[]
const CASES = SKINS.flatMap((skin) =>
  LANGUAGES.map((language) => ({ skin, language }))
)

describe('character skin translations', () => {
  it.each(CASES)(
    '$language resolves every $skin copy key and the preset label',
    async ({ skin, language }) => {
      const i18n = createInstance()
      await i18n.init({
        resources,
        lng: language,
        fallbackLng: 'en',
        nsSeparator: false,
      })
      const copy = getSkinAssets(skin).copy
      // Each language must carry its own entry; `exists()` would silently
      // fall back to English.
      const bundle = i18n.getResourceBundle(language, 'translation')

      for (const key of Object.values(copy)) {
        expect(key in bundle, `${language} is missing: ${key}`).toBe(true)
        expect(
          i18n.t(key).trim().length,
          `${language}: ${key}`
        ).toBeGreaterThan(0)
      }
      expect(`preset.${skin}` in bundle).toBe(true)
    }
  )

  it.each(LANGUAGES)(
    '%s carries the Claude sticker captions and credit',
    async (language) => {
      const i18n = createInstance()
      await i18n.init({ resources, lng: language, nsSeparator: false })
      const bundle = i18n.getResourceBundle(language, 'translation')

      for (const key of CLAUDE_UI_KEYS) {
        expect(key in bundle, `${language} is missing: ${key}`).toBe(true)
      }
    }
  )

  it('keeps Aemeath and Claude copy in Simplified Chinese', async () => {
    const i18n = createInstance()
    await i18n.init({
      resources,
      lng: 'zhCN',
      fallbackLng: 'en',
      nsSeparator: false,
    })
    const aemeath = getSkinAssets('aemeath').copy
    const claude = getSkinAssets('claude').copy

    expect(i18n.t(aemeath.badge)).toBe('拉贝尔学部 · 适格者')
    expect(i18n.t(aemeath.motto)).toBe('一起去拯救世界吧！')
    expect(i18n.t('preset.aemeath')).toBe('爱弥斯')
    expect(i18n.t(claude.badge)).toBe('Claude · 夜读')
    expect(i18n.t(claude.motto)).toBe('想清楚，再温柔地回答。')
    expect(i18n.t(claude.duty)).toBe('灯亮着 · Claude 在，你的号也在')
    expect(i18n.t(claude.signIn)).toBe('欢迎回来，号还在哦')
    expect(
      `${i18n.t('Claude-chan')} © ZipZipPipe（胖次狐）· ${i18n.t('Stickers by')} CrossPet`
    ).toBe('Claude 娘 © ZipZipPipe（胖次狐）· 表情 CrossPet')
  })

  it('keeps ATRI copy in Simplified Chinese without changing other skins', async () => {
    const i18n = createInstance()
    await i18n.init({
      resources,
      lng: 'zhCN',
      fallbackLng: 'en',
      nsSeparator: false,
    })
    const atriCopy = getSkinAssets('atri').copy

    expect(i18n.language).toBe('zhCN')
    expect(i18n.t(atriCopy.badge)).toBe('亚托莉 · 我挚爱的时光')
    expect(i18n.t(atriCopy.motto)).toBe('时间停止吧，你是多么美丽。')
    expect(i18n.t(atriCopy.tagline)).toBe(
      '与亚托莉珍藏盛夏回忆——一次连接，抵达每个模型。'
    )
    expect(i18n.t(atriCopy.joinAction)).toBe('开启我挚爱的时光')
    expect(getSkinAssets('phoebe').copy.motto).toBe('May Light Guide Your Way')
    expect(getSkinAssets('chisa').copy.motto).toBe('Sever the Strings of Fate')
  })
})
