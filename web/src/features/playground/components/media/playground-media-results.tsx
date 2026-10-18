import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { downloadBlob, playgroundRequest } from '../../lib/media/requests'
import { loadAsset, saveAsset } from '../../lib/storage/assets'
import type { MediaRecord } from '../../lib/storage/sessions'

function MediaAsset(props: {
  sessionId: string
  record: MediaRecord
  asset: MediaRecord['assets'][number]
}) {
  const { t } = useTranslation()
  const [url, setURL] = useState(props.asset.url)
  useEffect(() => {
    let cancelled = false
    let objectURL: string | undefined
    if (!props.asset.blobId) {
      setURL(props.asset.url)
      return
    }
    void loadAsset(props.sessionId, props.asset.blobId)
      .then((blob) => {
        if (cancelled || !blob) return
        objectURL = URL.createObjectURL(blob)
        setURL(objectURL)
      })
      .catch(handleServerError)
    return () => {
      cancelled = true
      if (objectURL) URL.revokeObjectURL(objectURL)
    }
  }, [props.asset, props.sessionId])
  if (!url) {
    return (
      <p className='text-muted-foreground text-sm'>
        {t('Saved media is unavailable in this browser.')}
      </p>
    )
  }
  return (
    <div className='space-y-2'>
      {props.asset.mime.startsWith('image/') && (
        <img
          src={url}
          alt={props.record.prompt}
          className='max-h-96 max-w-full rounded-lg object-contain'
        />
      )}
      {props.asset.mime.startsWith('audio/') && (
        <audio src={url} controls className='max-w-full' />
      )}
      {props.asset.mime.startsWith('video/') && (
        <video src={url} controls className='max-h-96 max-w-full rounded-lg' />
      )}
      <Button
        size='sm'
        variant='outline'
        onClick={() => {
          if (url.startsWith('blob:')) {
            void fetch(url)
              .then((result) => result.blob())
              .then((blob) =>
                downloadBlob(blob, `playground-${props.asset.id}`)
              )
              .catch(handleServerError)
          } else window.open(url, '_blank', 'noopener,noreferrer')
        }}
      >
        {t('Download')}
      </Button>
    </div>
  )
}
export function PlaygroundMediaResults(props: {
  sessionId: string
  records: MediaRecord[]
  onUpdate: (record: MediaRecord) => void
}) {
  const { t } = useTranslation()
  const [polling, setPolling] = useState(true)
  const onUpdate = props.onUpdate
  const downloads = useRef(new Set<AbortController>())
  useEffect(() => {
    const active = downloads.current
    return () => active.forEach((controller) => controller.abort())
  }, [])
  const pending = props.records.filter(
    (record) =>
      record.taskId &&
      !['completed', 'failed', 'SUCCESS', 'FAILURE'].includes(
        record.status ?? ''
      )
  )
  useEffect(() => {
    if (!polling || !pending.length) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void Promise.all(
        pending.map(async (record) => {
          const result = await playgroundRequest(
            `/pg/videos/${record.taskId}`,
            undefined,
            controller.signal
          )
          const task = await result.json()
          if (controller.signal.aborted) return
          onUpdate({
            ...record,
            status: String(task.status ?? 'unknown'),
            text: task.error?.message ?? task.fail_reason,
          })
        })
      ).catch((error) => {
        if (!controller.signal.aborted) {
          setPolling(false)
          handleServerError(error)
        }
      })
    }, 4000)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [pending, polling, onUpdate])
  const loadVideo = async (record: MediaRecord) => {
    const controller = new AbortController()
    downloads.current.add(controller)
    try {
      const result = await playgroundRequest(
        `/pg/videos/${record.taskId}/content`,
        undefined,
        controller.signal
      )
      const blob = await result.blob()
      if (!blob.type.startsWith('video/')) {
        throw new Error('The task did not return video content')
      }
      if (blob.size > 128 * 1024 * 1024) {
        throw new Error('Video exceeds the browser storage limit')
      }
      if (controller.signal.aborted) return
      await saveAsset(props.sessionId, record.id, blob)
      if (controller.signal.aborted) return
      onUpdate({
        ...record,
        assets: [{ id: record.id, blobId: record.id, mime: blob.type }],
      })
    } finally {
      downloads.current.delete(controller)
    }
  }
  return (
    <div className='space-y-4'>
      {!!pending.length && (
        <div className='space-y-2 rounded-lg border p-3 text-sm'>
          <p>
            {t(
              'Stopping polling does not cancel a submitted task or refund its charge.'
            )}
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPolling(!polling)}
          >
            {t(polling ? 'Stop polling' : 'Resume polling')}
          </Button>
        </div>
      )}
      {[...props.records].reverse().map((record) => (
        <article
          key={record.id}
          className='bg-card space-y-3 rounded-xl border p-4'
        >
          <header className='flex flex-wrap justify-between gap-2 text-sm'>
            <span className='font-medium'>{record.model}</span>
            <span className='text-muted-foreground'>
              {record.status ?? t('Completed')}
            </span>
          </header>
          <p className='text-sm break-words whitespace-pre-wrap'>
            {record.prompt}
          </p>
          {record.text && (
            <div className='bg-muted rounded-lg p-3'>
              <CopyButton value={record.text} />
              <Button
                variant='ghost'
                size='sm'
                onClick={() =>
                  downloadBlob(
                    new Blob([record.text ?? ''], { type: 'text/plain' }),
                    'transcription.txt'
                  )
                }
              >
                {t('Download')}
              </Button>
              <p className='text-sm break-words whitespace-pre-wrap'>
                {record.text}
              </p>
            </div>
          )}
          {record.assets.map((asset) => (
            <MediaAsset
              key={asset.id}
              sessionId={props.sessionId}
              record={record}
              asset={asset}
            />
          ))}
          {record.taskId &&
            ['completed', 'SUCCESS'].includes(record.status ?? '') &&
            !record.assets.length && (
              <Button
                onClick={() => {
                  void loadVideo(record).catch(handleServerError)
                }}
              >
                {t('Load video')}
              </Button>
            )}
        </article>
      ))}
    </div>
  )
}
