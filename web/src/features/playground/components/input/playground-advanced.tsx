import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import type { PlaygroundConfig, PlaygroundDebug } from '../../types'

export function PlaygroundAdvanced(props: {
  config: PlaygroundConfig
  disabled: boolean
  onChange: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
  debug: PlaygroundDebug | null
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<'settings' | 'debug' | null>(null)
  const debugText = JSON.stringify(props.debug, null, 2)
  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen('settings')}>
        {t('Advanced settings')}
      </Button>
      <Button variant='ghost' size='sm' onClick={() => setOpen('debug')}>
        {t('Request inspector')}
      </Button>
      <Dialog
        open={open === 'settings'}
        onOpenChange={(value) => {
          if (!value) setOpen(null)
        }}
        title={t('Advanced settings')}
      >
        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='pg-system'>{t('System prompt')}</Label>
            <Textarea
              id='pg-system'
              value={props.config.systemPrompt ?? ''}
              maxLength={40_000}
              disabled={props.disabled}
              onChange={(event) =>
                props.onChange('systemPrompt', event.target.value)
              }
            />
          </div>
          <fieldset disabled={props.disabled} className='space-y-2'>
            <legend className='text-sm font-medium'>{t('API protocol')}</legend>
            <div className='flex gap-2'>
              {(['chat', 'responses'] as const).map((protocol) => (
                <Button
                  key={protocol}
                  aria-pressed={(props.config.protocol ?? 'chat') === protocol}
                  variant={
                    (props.config.protocol ?? 'chat') === protocol
                      ? 'default'
                      : 'outline'
                  }
                  onClick={() => {
                    props.onChange('protocol', protocol)
                    if (protocol === 'chat') props.onChange('webSearch', false)
                  }}
                >
                  {protocol === 'chat' ? 'Chat Completions' : 'Responses'}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className='space-y-2'>
            <Label htmlFor='pg-effort'>{t('Reasoning effort')}</Label>
            <Select
              value={props.config.reasoningEffort || 'default'}
              disabled={props.disabled}
              onValueChange={(value) =>
                props.onChange(
                  'reasoningEffort',
                  value === 'default' ? '' : String(value)
                )
              }
            >
              <SelectTrigger id='pg-effort'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  'default',
                  'none',
                  'minimal',
                  'low',
                  'medium',
                  'high',
                  'xhigh',
                ].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === 'default' ? t('Model default') : value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Leave blank to use the model default. Unsupported effort levels are rejected by the provider.'
              )}
            </p>
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Web search uses the Responses web_search tool. Availability depends on the selected channel and model; additional charges may apply.'
            )}
          </p>
        </div>
      </Dialog>
      <Dialog
        open={open === 'debug'}
        onOpenChange={(value) => {
          if (!value) setOpen(null)
        }}
        title={t('Request inspector')}
        description={t(
          'Credentials and attachment bytes are omitted. Debug events are limited to 100.'
        )}
      >
        <CopyButton value={debugText} />
        <pre className='bg-muted max-h-[65vh] overflow-auto rounded-lg p-3 text-xs break-all whitespace-pre-wrap'>
          {props.debug
            ? debugText
            : t('Send a request to inspect its payload and response.')}
        </pre>
      </Dialog>
    </>
  )
}
