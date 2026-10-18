import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { PlaygroundUsage } from '../../types'

export function PlaygroundTokenUsage(props: { usage: PlaygroundUsage }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <p className='text-muted-foreground mb-1 text-xs'>
      {t('Tokens')}: {formatNumber(props.usage.input, locale)} /{' '}
      {formatNumber(props.usage.output, locale)} /{' '}
      {formatNumber(props.usage.total, locale)}
    </p>
  )
}
