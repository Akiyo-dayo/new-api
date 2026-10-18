import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

import { isBusy } from '../lib/sample'
import { parseNumbers } from '../vendor/fingerprint-core'
import type { Throughput } from '../vendor/throughput'
import type { Challenge, SampleState } from '../vendor/types'

export interface Sample {
  text: string
  draft?: string
  state: SampleState | 'idle'
  error?: string
  elapsed?: number
  throughput?: Throughput
}
interface Props {
  index: number
  challenge: Challenge
  sample: Sample
  manual: boolean
  locked: boolean
  canSample: boolean
  anomalous: boolean
  onEdit: (text: string) => void
  onSample: () => void
  onStop: () => void
}
export function SampleCard(props: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const busy = isBusy(props.sample.state)
  const text = props.sample.draft ?? props.sample.text
  const count = parseNumbers(text).length
  const minimum = Math.max(80, Math.ceil(props.challenge.expected_count * 0.55))
  return (
    <Card
      className='border-primary/20 min-w-0'
      aria-label={t('Round {{round}}', { round: props.index + 1 })}
    >
      <CardHeader className='flex-row items-center justify-between gap-2'>
        <CardTitle className='flex items-center gap-2.5'>
          <span
            aria-hidden
            className='inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-rose-500/25 bg-gradient-to-br from-rose-500/15 to-amber-500/15 text-[11px] font-bold text-rose-500 dark:text-rose-400'
          >
            {props.index + 1}
          </span>
          {t('Round {{round}}', { round: props.index + 1 })}
        </CardTitle>
        <span role='status' className='text-muted-foreground text-xs'>
          {t(props.sample.state)}
        </span>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-sm font-medium'>{t('Challenge prompt')}</span>
          <CopyButton
            value={props.challenge.prompt}
            tooltip={t('Copy prompt')}
          />
        </div>
        <p
          id={`fingerprint-prompt-${props.index}`}
          className={`text-muted-foreground text-sm wrap-anywhere whitespace-pre-wrap ${expanded ? '' : 'line-clamp-4'}`}
        >
          {props.challenge.prompt}
        </p>
        <Button
          variant='ghost'
          size='sm'
          aria-expanded={expanded}
          aria-controls={`fingerprint-prompt-${props.index}`}
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? 'Collapse prompt' : 'Show full prompt')}
        </Button>
        <label
          className='block text-sm'
          htmlFor={`fingerprint-reply-${props.index}`}
        >
          {t('Numeric response')}
        </label>
        <Textarea
          id={`fingerprint-reply-${props.index}`}
          aria-busy={busy}
          className='h-44 min-w-0 resize-y font-mono text-xs'
          value={text}
          readOnly={busy || props.locked}
          onChange={(event) => props.onEdit(event.target.value)}
          placeholder={t('Paste the original numeric response here')}
        />
        <p className='text-muted-foreground text-xs'>
          {t('{{count}} valid integers', { count })} ·{' '}
          {t('Minimum {{count}} integers', { count: minimum })}
          {props.sample.elapsed !== undefined &&
            ` · ${(props.sample.elapsed / 1000).toFixed(1)}s`}
          {props.sample.throughput &&
            ` · TTFT ${(props.sample.throughput.ttftMs / 1000).toFixed(1)}s · ${props.sample.throughput.tokensPerSecond?.toFixed(1) ?? '—'} tok/s`}
        </p>
        {props.sample.error && (
          <p role='alert' className='text-destructive text-sm wrap-anywhere'>
            {props.sample.error}
            {props.sample.text && ` · ${t('Previous accepted response kept')}`}
          </p>
        )}
        {props.anomalous && (
          <p role='status' className='text-warning text-sm'>
            {t('Abnormal distribution: replace this prompt and sample again.')}
          </p>
        )}
        <div className='flex flex-wrap gap-2'>
          {!props.manual && (
            <Button
              size='sm'
              variant='outline'
              disabled={props.locked || (!busy && !props.canSample)}
              onClick={busy ? props.onStop : props.onSample}
            >
              {t(busy ? 'Stop this request' : 'Sample this round')}
            </Button>
          )}
          <Button
            size='sm'
            variant='ghost'
            disabled={busy || props.locked || !text}
            onClick={() => props.onEdit('')}
          >
            {t('Clear response')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
