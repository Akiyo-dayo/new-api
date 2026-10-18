import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelGroupSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getPricing } from '@/features/pricing/api'
import { handleServerError } from '@/lib/handle-server-error'

import { playgroundRequest } from '../../lib/media/requests'
import { saveAsset } from '../../lib/storage/assets'
import type { MediaRecord } from '../../lib/storage/sessions'
import type {
  GroupOption,
  ModelOption,
  PlaygroundConfig,
  PlaygroundMode,
} from '../../types'
import { PlaygroundMediaResults } from './playground-media-results'

export function PlaygroundMedia(props: {
  sessionId: string
  mode: PlaygroundMode
  models: ModelOption[]
  groups: GroupOption[]
  config: PlaygroundConfig
  records: MediaRecord[]
  onRecordsChange: (records: MediaRecord[]) => void
  onModelChange: (value: string) => void
  onGroupChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const [operation, setOperation] = useState('generate')
  const [file, setFile] = useState<File | null>(null)
  const [count, setCount] = useState(1)
  const [seconds, setSeconds] = useState(4)
  const [size, setSize] = useState('')
  const [voice, setVoice] = useState('alloy')
  const [audioFormat, setAudioFormat] = useState('mp3')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const records = useRef(props.records)
  records.current = props.records
  const pricing = useQuery({
    queryKey: ['playground-capabilities'],
    queryFn: getPricing,
    staleTime: 60_000,
  })
  const endpoints: Record<string, string[]> = {
    image: ['image-generation', 'image'],
    audio: [
      'openai',
      'audio-speech',
      'audio-transcription',
      'audio-translation',
      'audio',
    ],
    video: ['openai-video', 'video'],
  }
  const available = props.models.filter((model) => {
    const metadata = pricing.data?.data.find(
      (item) => item.model_name === model.value
    )
    return (
      !metadata?.supported_endpoint_types?.length ||
      metadata.supported_endpoint_types.some((endpoint) =>
        endpoints[props.mode]?.includes(endpoint)
      )
    )
  })
  const selectedEndpoints = pricing.data?.data.find(
    (item) => item.model_name === props.config.model
  )?.supported_endpoint_types
  const selectedKnown = props.mode !== 'audio' && !!selectedEndpoints?.length
  const selectedAvailable = available.some(
    (model) => model.value === props.config.model
  )
  useEffect(() => () => abort.current?.abort(), [])
  const onRecordsChange = props.onRecordsChange
  const updateRecord = useCallback(
    (record: MediaRecord) => {
      onRecordsChange(
        records.current.map((item) => (item.id === record.id ? record : item))
      )
    },
    [onRecordsChange]
  )
  const generate = async () => {
    if (busy || !selectedAvailable) return
    const controller = new AbortController()
    abort.current = controller
    setBusy(true)
    const record: MediaRecord = {
      id: crypto.randomUUID(),
      mode: props.mode as MediaRecord['mode'],
      model: props.config.model,
      prompt,
      createdAt: Date.now(),
      assets: [],
    }
    try {
      if (file && file.size > 20 * 1024 * 1024) {
        throw new Error('File exceeds the size limit')
      }
      let response: Response
      if (props.mode === 'image') {
        if (operation === 'edit') {
          if (!file || !file.type.startsWith('image/')) {
            throw new Error('Select an image to edit')
          }
          const body = new FormData()
          body.set('image', file)
          body.set('model', props.config.model)
          body.set('group', props.config.group)
          body.set('prompt', prompt)
          body.set('n', String(count))
          if (size) body.set('size', size)
          response = await playgroundRequest(
            '/pg/images/edits',
            body,
            controller.signal
          )
        } else {
          response = await playgroundRequest(
            '/pg/images/generations',
            {
              model: props.config.model,
              group: props.config.group,
              prompt,
              n: count,
              ...(size ? { size } : {}),
            },
            controller.signal
          )
        }
        const result = await response.json()
        const data = Array.isArray(result.data)
          ? result.data
          : [result.data].filter(Boolean)
        for (const entry of data) {
          const id = crypto.randomUUID()
          if (entry.b64_json) {
            const blob = await (
              await fetch(`data:image/png;base64,${entry.b64_json}`)
            ).blob()
            await saveAsset(props.sessionId, id, blob)
            record.assets.push({ id, blobId: id, mime: blob.type })
          } else if (
            typeof entry.url === 'string' &&
            /^https?:\/\//.test(entry.url)
          ) {
            record.assets.push({ id, url: entry.url, mime: 'image/png' })
          }
        }
        if (!record.assets.length) {
          throw new Error('The provider returned no images')
        }
      } else if (props.mode === 'audio') {
        if (operation === 'transcribe' || operation === 'translate') {
          if (!file) throw new Error('Select an audio file')
          const body = new FormData()
          body.set('file', file)
          body.set('model', props.config.model)
          body.set('group', props.config.group)
          body.set('response_format', 'json')
          response = await playgroundRequest(
            operation === 'transcribe'
              ? '/pg/audio/transcriptions'
              : '/pg/audio/translations',
            body,
            controller.signal
          )
          const result = await response.json()
          record.text = String(result.text ?? '')
          if (!record.text) {
            throw new Error('The provider returned no transcription')
          }
        } else {
          response = await playgroundRequest(
            '/pg/audio/speech',
            {
              model: props.config.model,
              group: props.config.group,
              input: prompt,
              voice,
              response_format: audioFormat,
            },
            controller.signal
          )
          const blob = await response.blob()
          if (
            !blob.type.startsWith('audio/') &&
            blob.type !== 'application/octet-stream'
          ) {
            throw new Error('The provider did not return audio')
          }
          await saveAsset(props.sessionId, record.id, blob)
          record.assets.push({
            id: record.id,
            blobId: record.id,
            mime: blob.type.startsWith('audio/') ? blob.type : 'audio/mpeg',
          })
        }
      } else {
        const body = new FormData()
        body.set('model', props.config.model)
        body.set('group', props.config.group)
        body.set('prompt', prompt)
        body.set('seconds', String(seconds))
        if (size) body.set('size', size)
        if (file) body.set('input_reference', file)
        response = await playgroundRequest(
          '/pg/videos',
          body,
          controller.signal
        )
        const task = await response.json()
        if (
          typeof task.id !== 'string' ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(task.id)
        ) {
          throw new Error('The provider returned no task identifier')
        }
        record.taskId = task.id
        record.status = String(task.status ?? 'queued')
      }
      if (!controller.signal.aborted) {
        props.onRecordsChange([...records.current, record])
      }
    } catch (error) {
      if (!controller.signal.aborted) handleServerError(error)
    } finally {
      if (abort.current === controller) {
        setBusy(false)
        abort.current = null
      }
    }
  }
  return (
    <div className='mx-auto w-full max-w-4xl space-y-5 p-3 md:p-5'>
      <div className='bg-card space-y-4 rounded-xl border p-4'>
        <ModelGroupSelector
          models={available}
          selectedModel={props.config.model}
          onModelChange={props.onModelChange}
          groups={props.groups}
          selectedGroup={props.config.group}
          onGroupChange={props.onGroupChange}
          disabled={busy}
        />
        {!selectedKnown && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Model capabilities are unconfirmed. The provider may reject unsupported operations.'
            )}
          </p>
        )}
        {!selectedAvailable && (
          <p role='status' className='text-destructive text-sm'>
            {t('Select an available model for this mode.')}
          </p>
        )}
        {props.mode !== 'video' && (
          <div className='flex flex-wrap gap-2'>
            {(props.mode === 'image'
              ? ['generate', 'edit']
              : ['speech', 'transcribe', 'translate']
            ).map((value) => (
              <Button
                key={value}
                size='sm'
                variant={
                  operation === value ||
                  (value === 'speech' && operation === 'generate')
                    ? 'default'
                    : 'outline'
                }
                disabled={busy}
                onClick={() => setOperation(value)}
              >
                {t(
                  {
                    generate: 'Generate image',
                    edit: 'Edit image',
                    speech: 'Text to speech',
                    transcribe: 'Transcribe audio',
                    translate: 'Translate audio',
                  }[value] ?? value
                )}
              </Button>
            ))}
          </div>
        )}
        <div className='space-y-2'>
          <Label htmlFor='pg-media-prompt'>{t('Prompt / text')}</Label>
          <Textarea
            id='pg-media-prompt'
            value={prompt}
            maxLength={40_000}
            disabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        {(operation === 'edit' ||
          operation === 'transcribe' ||
          operation === 'translate' ||
          props.mode === 'video') && (
          <div className='space-y-2'>
            <Label htmlFor='pg-media-file'>
              {t(
                props.mode === 'video'
                  ? 'Reference image (optional)'
                  : 'Input file'
              )}
            </Label>
            <Input
              id='pg-media-file'
              type='file'
              accept={
                props.mode === 'audio'
                  ? 'audio/*,video/*'
                  : 'image/png,image/jpeg,image/webp'
              }
              disabled={busy}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file && <p className='text-xs'>{file.name}</p>}
          </div>
        )}
        <div className='grid gap-3 sm:grid-cols-2'>
          {props.mode === 'image' && (
            <div>
              <Label htmlFor='pg-count'>{t('Image count')}</Label>
              <Input
                id='pg-count'
                type='number'
                min={1}
                max={4}
                step={1}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </div>
          )}
          {props.mode === 'video' && (
            <div>
              <Label htmlFor='pg-seconds'>{t('Duration (seconds)')}</Label>
              <Input
                id='pg-seconds'
                type='number'
                min={1}
                max={60}
                step={1}
                value={seconds}
                onChange={(event) => setSeconds(Number(event.target.value))}
              />
            </div>
          )}
          {props.mode !== 'audio' && (
            <div>
              <Label htmlFor='pg-size'>
                {t('Size (blank for provider default)')}
              </Label>
              <Input
                id='pg-size'
                placeholder={props.mode === 'video' ? '1280x720' : '1024x1024'}
                value={size}
                onChange={(event) => setSize(event.target.value)}
              />
            </div>
          )}
          {props.mode === 'audio' &&
            !['transcribe', 'translate'].includes(operation) && (
              <div>
                <Label htmlFor='pg-voice'>{t('Voice')}</Label>
                <Input
                  id='pg-voice'
                  value={voice}
                  onChange={(event) => setVoice(event.target.value)}
                />
              </div>
            )}
        </div>
        {props.mode === 'audio' &&
          !['transcribe', 'translate'].includes(operation) && (
            <fieldset className='flex flex-wrap gap-2' disabled={busy}>
              <legend className='mb-2 text-sm'>{t('Audio format')}</legend>
              {['mp3', 'wav', 'opus', 'flac', 'aac'].map((format) => (
                <Button
                  key={format}
                  variant={audioFormat === format ? 'secondary' : 'outline'}
                  size='sm'
                  aria-pressed={audioFormat === format}
                  onClick={() => setAudioFormat(format)}
                >
                  {format}
                </Button>
              ))}
            </fieldset>
          )}
        <p className='text-muted-foreground text-xs'>
          {t(
            'Generation uses your account quota. Supported parameters depend on the selected model; requests are not automatically retried.'
          )}
        </p>
        <Button
          disabled={
            busy ||
            !selectedAvailable ||
            (!prompt.trim() &&
              !['transcribe', 'translate'].includes(operation)) ||
            !Number.isInteger(count) ||
            count < 1 ||
            count > 4 ||
            !Number.isInteger(seconds) ||
            seconds < 1 ||
            seconds > 60
          }
          onClick={() => {
            void generate()
          }}
        >
          {t(busy ? 'Generating...' : 'Generate')}
        </Button>
        {busy && (
          <Button variant='outline' onClick={() => abort.current?.abort()}>
            {t('Stop waiting')}
          </Button>
        )}
      </div>
      <PlaygroundMediaResults
        sessionId={props.sessionId}
        records={props.records.filter((record) => record.mode === props.mode)}
        onUpdate={updateRecord}
      />
    </div>
  )
}
