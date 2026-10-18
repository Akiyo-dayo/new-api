import { createInstance } from 'i18next'
import { describe, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zhCN from '@/i18n/locales/zh.json'

const resources = { en, fr, ja, ru, vi, zhTW, zhCN }

describe('fingerprint translations', () => {
  test.each(Object.keys(resources))(
    '%s resolves the fingerprint page and sidebar label',
    async (language) => {
      const i18n = createInstance()
      await i18n.init({
        resources,
        lng: language,
        fallbackLng: 'en',
        nsSeparator: false,
      })
      expect(i18n.exists('Model fingerprint')).toBe(true)
      expect(
        i18n.exists('Reference bank ready: {{count}} model candidates')
      ).toBe(true)
      if (language === 'zhCN') {
        expect(i18n.t('Model fingerprint')).toBe('模型指纹检测')
        expect(
          i18n.t('Reference bank ready: {{count}} model candidates', {
            count: 60,
          })
        ).toBe('参考库已就绪：60 个模型候选')
      }
    }
  )
})
