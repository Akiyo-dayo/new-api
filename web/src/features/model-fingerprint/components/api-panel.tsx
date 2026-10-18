import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  downloadFile,
  initialProfile,
  parseProfile,
  type Connection,
  type Profile,
} from '../lib/connection'

interface Props {
  profiles: Profile[]
  profile: Profile
  disabled: boolean
  connection: Connection
  proxy: string
  onProfiles: (profiles: Profile[], selected: string) => void
  onUpdate: (patch: Partial<Profile>) => void
  onConnection: (value: Connection) => void
  onProxy: (value: string) => void
}
export function ApiPanel(props: Props) {
  const { t } = useTranslation()
  const [showKey, setShowKey] = useState(false)
  const [confirm, setConfirm] = useState<'save' | 'export' | null>(null)
  const [error, setError] = useState('')
  const fields = [
    ['name', 'Profile name'],
    ['baseUrl', 'API base URL'],
    ['model', 'API model'],
    ['effort', 'Reasoning effort'],
  ] as const
  const selectProfile = (id: string) => {
    setShowKey(false)
    props.onProfiles(props.profiles, id)
  }
  const addProfile = (duplicate: boolean) => {
    const profile = duplicate
      ? {
          ...props.profile,
          id: crypto.randomUUID(),
          name: `${props.profile.name} (copy)`,
        }
      : initialProfile()
    props.onProfiles([...props.profiles, profile], profile.id)
  }
  const save = (includeKey: boolean) => {
    localStorage.setItem(
      'model-fingerprint-profiles',
      JSON.stringify(
        props.profiles.map((p) => ({
          ...(p.id === props.profile.id ? props.profile : p),
          apiKey:
            includeKey && p.id === props.profile.id ? props.profile.apiKey : '',
        }))
      )
    )
    setConfirm(null)
  }
  const exportProfile = (includeKey: boolean) => {
    downloadFile('fingerprint-api-profile.json', {
      kind: 'fingerpoint-api-profile',
      version: 1,
      ...props.profile,
      name: props.profile.name || props.profile.model || t('Unnamed profile'),
      apiKey: includeKey ? props.profile.apiKey : '',
    })
    setConfirm(null)
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Custom API configuration')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <fieldset disabled={props.disabled} className='min-w-0 space-y-4'>
          <div className='flex flex-wrap gap-2'>
            <Select
              value={props.profile.id}
              onValueChange={(id) => id && selectProfile(id)}
              items={props.profiles.map((p) => ({
                value: p.id,
                label: p.name || p.model || t('Unnamed profile'),
              }))}
            >
              <SelectTrigger
                aria-label={t('API profile')}
                className='w-full sm:w-60'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {props.profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name || p.model || t('Unnamed profile')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant='outline'
              size='sm'
              onClick={() => addProfile(false)}
            >
              {t('New profile')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => addProfile(true)}
            >
              {t('Duplicate profile')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={props.profiles.length < 2}
              onClick={() => {
                const remaining = props.profiles.filter(
                  (p) => p.id !== props.profile.id
                )
                props.onProfiles(remaining, remaining[0].id)
              }}
            >
              {t('Delete profile')}
            </Button>
          </div>
          <div className='grid min-w-0 gap-4 md:grid-cols-2'>
            {fields.map(([field, title]) => (
              <div key={field} className='space-y-2'>
                <Label htmlFor={`fp-api-${field}`}>{t(title)}</Label>
                <Input
                  id={`fp-api-${field}`}
                  value={props.profile[field]}
                  onChange={(event) =>
                    props.onUpdate({ [field]: event.target.value })
                  }
                  autoComplete='off'
                />
              </div>
            ))}
            <div className='space-y-2'>
              <Label htmlFor='fp-api-key'>{t('API key')}</Label>
              <div className='flex gap-2'>
                <Input
                  id='fp-api-key'
                  type={showKey ? 'text' : 'password'}
                  value={props.profile.apiKey}
                  autoComplete='off'
                  onChange={(event) =>
                    props.onUpdate({ apiKey: event.target.value })
                  }
                />
                <Button
                  variant='outline'
                  aria-pressed={showKey}
                  onClick={() => setShowKey(!showKey)}
                >
                  {t(showKey ? 'Hide key' : 'Show key')}
                </Button>
              </div>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'API keys stay in memory unless you explicitly save them. Never share exported credentials.'
                )}
              </p>
            </div>
            <div className='space-y-2'>
              <Label>{t('API format')}</Label>
              <Select
                value={props.profile.format}
                onValueChange={(value) =>
                  props.onUpdate({ format: value as Profile['format'] })
                }
              >
                <SelectTrigger aria-label={t('API format')} className='w-full'>
                  <SelectValue>
                    {
                      {
                        openai: 'Chat Completions',
                        responses: 'Responses',
                        anthropic: 'Messages',
                      }[props.profile.format]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {['openai', 'responses', 'anthropic'].map((value) => (
                    <SelectItem key={value} value={value}>
                      {
                        {
                          openai: 'Chat Completions',
                          responses: 'Responses',
                          anthropic: 'Messages',
                        }[value]
                      }
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label>{t('Service tier')}</Label>
              <Select
                value={props.profile.serviceTier ?? 'default'}
                onValueChange={(value) =>
                  props.onUpdate({
                    serviceTier: value as Profile['serviceTier'],
                  })
                }
              >
                <SelectTrigger
                  aria-label={t('Service tier')}
                  className='w-full'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['flex', 'default', 'fast', 'ultrafast'].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label>{t('Connection route')}</Label>
              <Select
                value={props.connection}
                onValueChange={(value) =>
                  props.onConnection(value as Connection)
                }
              >
                <SelectTrigger
                  aria-label={t('Connection route')}
                  className='w-full'
                >
                  <SelectValue>
                    {t(
                      {
                        auto: 'Auto: direct or this site proxy',
                        direct: 'Browser direct',
                        site: 'This site proxy',
                        worker: 'My proxy worker',
                      }[props.connection]
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='auto'>
                    {t('Auto: direct or this site proxy')}
                  </SelectItem>
                  <SelectItem value='direct'>{t('Browser direct')}</SelectItem>
                  <SelectItem value='site'>{t('This site proxy')}</SelectItem>
                  <SelectItem value='worker'>{t('My proxy worker')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {props.connection === 'worker' && (
              <div className='space-y-2'>
                <Label htmlFor='fp-api-proxy'>{t('Proxy URL')}</Label>
                <Input
                  id='fp-api-proxy'
                  value={props.proxy}
                  onChange={(event) => props.onProxy(event.target.value)}
                />
              </div>
            )}
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Browser direct requires API CORS support. A selected proxy receives the API key; only use a proxy you trust.'
            )}
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' size='sm' onClick={() => save(false)}>
              {t('Save without key')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setConfirm('save')}
            >
              {t('Remember API key')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                save(false)
                props.onProfiles(
                  props.profiles.map((p) => ({ ...p, apiKey: '' })),
                  props.profile.id
                )
              }}
            >
              {t('Clear saved API keys')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => exportProfile(false)}
            >
              {t('Export profile')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setConfirm('export')}
            >
              {t('Export with API key')}
            </Button>
            <label className='text-sm'>
              {t('Import profile')}
              <Input
                type='file'
                accept='.json,application/json'
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  try {
                    if (file.size > 100_000) {
                      throw new Error('Profile file is too large')
                    }
                    const profile = parseProfile(JSON.parse(await file.text()))
                    props.onProfiles([...props.profiles, profile], profile.id)
                    setError('')
                  } catch {
                    setError(t('Invalid API profile'))
                  }
                }}
              />
            </label>
          </div>
          {error && <p role='alert'>{error}</p>}
        </fieldset>
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t('Include secret API key?')}
          desc={t(
            'This stores or exports a usable API credential in plain text. Only continue on a trusted device and keep the file private.'
          )}
          handleConfirm={() =>
            confirm === 'save' ? save(true) : exportProfile(true)
          }
        />
      </CardContent>
    </Card>
  )
}
