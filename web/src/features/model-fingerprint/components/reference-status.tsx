import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import {
  referenceVersion,
  type ReferenceVersion,
} from '../lib/reference-version'

export function ReferenceStatus(props: {
  loaded?: ReferenceVersion
  busy: boolean
  onReload: () => void
}) {
  const { t } = useTranslation()
  const status = useQuery({
    queryKey: ['fingerprint', 'reference-status'],
    queryFn: referenceVersion,
    refetchInterval: 60_000,
  })
  const current = status.data
  return (
    <Card
      className='border-primary/20 h-full'
      aria-label={t('Reference update status')}
    >
      <CardHeader>
        <CardTitle className='text-base'>
          {t('Reference update status')}
        </CardTitle>
      </CardHeader>
      <CardContent className='text-muted-foreground space-y-2 text-xs'>
        <p>
          {t(
            'Reference updates: every day at 00:00 Asia/Shanghai. Only public reference files are downloaded; no API keys or samples are uploaded.'
          )}
        </p>
        {current && (
          <>
            <p>
              {t('Current reference version')}:{' '}
              {props.loaded?.commit.slice(0, 8) ?? current.commit.slice(0, 8)} ·{' '}
              {props.loaded?.built_at || current.built_at || '—'}
            </p>
            <p>
              {t('Automatic updates')}:{' '}
              {t(current.enabled ? 'Enabled' : 'Disabled')} · {t(current.state)}
            </p>
            <p>
              {t('Last update check')}:{' '}
              {current.last_check && !current.last_check.startsWith('0001')
                ? current.last_check
                : '—'}{' '}
              · {t('Next update check')}: {current.next_check || '—'}
            </p>
            {current.commit !== props.loaded?.commit && props.loaded && (
              <Button
                variant='outline'
                disabled={props.busy}
                onClick={props.onReload}
              >
                {t('Load updated reference for a new inspection')}
              </Button>
            )}
          </>
        )}
        <p>
          {t(
            'Compatible reference data updates automatically. Algorithm changes require a tested application upgrade; failed updates keep the previous version. A fresh library still cannot prove model identity.'
          )}
        </p>
        {status.isError && (
          <p role='status'>{t('Reference update status unavailable')}</p>
        )}
      </CardContent>
    </Card>
  )
}
