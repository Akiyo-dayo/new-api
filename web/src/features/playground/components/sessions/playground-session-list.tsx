import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { handleServerError } from '@/lib/handle-server-error'

import { downloadBlob } from '../../lib/media/requests'
import { blobDataURL, loadAsset } from '../../lib/storage/assets'
import {
  sessionMarkdown,
  type SessionEnvelope,
} from '../../lib/storage/sessions'

export function PlaygroundSessionList(props: {
  envelope: SessionEnvelope
  onSelect: (id: string) => Promise<void>
  onCreate: () => void
  onRemove: (id: string) => Promise<void>
  onRename: (id: string, title: string) => void
  onImport: (raw: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const active =
    props.envelope.sessions.find(
      (item) => item.id === props.envelope.activeId
    ) ?? props.envelope.sessions[0]
  const exportJSON = async () => {
    const messages = await Promise.all(
      active.messages.map(async (message) => ({
        ...message,
        attachments: await Promise.all(
          (message.attachments ?? []).map(async (file) => {
            if (file.data || !file.blobId) return file
            const blob = await loadAsset(active.id, file.blobId)
            if (!blob) {
              throw new Error(
                'Attachment is unavailable. Remove it or attach it again.'
              )
            }
            return { ...file, data: await blobDataURL(blob), blobId: undefined }
          })
        ),
      }))
    )
    const raw = JSON.stringify(
      { version: 2, activeId: active.id, sessions: [{ ...active, messages }] },
      null,
      2
    )
    if (raw.length > 32 * 1024 * 1024) {
      throw new Error('Conversation export is too large')
    }
    downloadBlob(
      new Blob([raw], { type: 'application/json' }),
      'conversation.json'
    )
  }
  const sessionItems = props.envelope.sessions.filter((session) =>
    (session.title || t('New conversation'))
      .toLowerCase()
      .includes(query.toLowerCase())
  )
  return (
    <>
      <aside
        className='hidden w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3 lg:flex'
        aria-label={t('Conversations')}
      >
        <Button
          size='sm'
          onClick={() => {
            try {
              props.onCreate()
            } catch (error) {
              handleServerError(error)
            }
          }}
        >
          {t('New conversation')}
        </Button>
        <Input
          aria-label={t('Search conversations')}
          placeholder={t('Search conversations')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {sessionItems.map((session) => (
          <Button
            key={session.id}
            variant={
              session.id === props.envelope.activeId ? 'secondary' : 'ghost'
            }
            className='justify-start truncate'
            aria-pressed={session.id === props.envelope.activeId}
            onClick={() => {
              void props.onSelect(session.id).catch(handleServerError)
            }}
          >
            {session.title || t('New conversation')}
          </Button>
        ))}
        <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
          {t('Manage conversations')}
        </Button>
      </aside>
      <div className='flex shrink-0 gap-2 border-b p-2 lg:hidden'>
        <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
          {t('Conversations')}
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            try {
              props.onCreate()
            } catch (error) {
              handleServerError(error)
            }
          }}
        >
          {t('New conversation')}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={t('Conversations')}>
        <div className='space-y-3'>
          <Input
            aria-label={t('Search conversations')}
            placeholder={t('Search conversations')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className='max-h-80 space-y-2 overflow-auto'>
            {props.envelope.sessions
              .filter((session) =>
                (session.title || t('New conversation'))
                  .toLowerCase()
                  .includes(query.toLowerCase())
              )
              .map((session) => (
                <div
                  key={session.id}
                  className='flex items-center gap-1 rounded-lg border p-1'
                >
                  <Button
                    className='min-w-0 flex-1 justify-start truncate'
                    variant={
                      session.id === props.envelope.activeId
                        ? 'secondary'
                        : 'ghost'
                    }
                    aria-pressed={session.id === props.envelope.activeId}
                    onClick={() => {
                      void props
                        .onSelect(session.id)
                        .then(() => setOpen(false))
                        .catch(handleServerError)
                    }}
                  >
                    {session.title || t('New conversation')}
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => {
                      setRenameId(session.id)
                      setTitle(session.title)
                    }}
                  >
                    {t('Rename')}
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => setRemoveId(session.id)}
                  >
                    {t('Delete')}
                  </Button>
                </div>
              ))}
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              onClick={() => {
                void exportJSON().catch(handleServerError)
              }}
            >
              {t('Export JSON')}
            </Button>
            <Button
              variant='outline'
              onClick={() =>
                downloadBlob(
                  new Blob([sessionMarkdown(active)], {
                    type: 'text/markdown',
                  }),
                  'conversation.md'
                )
              }
            >
              {t('Export Markdown')}
            </Button>
            <Button variant='outline' onClick={() => input.current?.click()}>
              {t('Import JSON')}
            </Button>
            <input
              type='file'
              accept='.json,application/json'
              ref={input}
              className='hidden'
              aria-label={t('Import JSON')}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (file.size > 32 * 1024 * 1024) {
                  handleServerError(
                    new Error('Conversation import is too large')
                  )
                  return
                }
                void file.text().then(props.onImport).catch(handleServerError)
              }}
            />
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Conversations are stored in this browser, separately for each account. Export files may contain private messages.'
            )}
          </p>
        </div>
      </Dialog>
      <Dialog
        open={!!renameId}
        onOpenChange={(value) => {
          if (!value) setRenameId(null)
        }}
        title={t('Rename conversation')}
        footer={
          <Button
            onClick={() => {
              if (renameId) props.onRename(renameId, title)
              setRenameId(null)
            }}
          >
            {t('Save')}
          </Button>
        }
      >
        <Input
          aria-label={t('Conversation title')}
          value={title}
          maxLength={100}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Dialog>
      <ConfirmDialog
        open={!!removeId}
        onOpenChange={(value) => {
          if (!value) setRemoveId(null)
        }}
        title={t('Delete conversation?')}
        desc={t(
          'This conversation and its saved attachments will be deleted from this browser.'
        )}
        destructive
        confirmText={t('Delete')}
        handleConfirm={() => {
          if (removeId) {
            void props
              .onRemove(removeId)
              .then(() => setRemoveId(null))
              .catch(handleServerError)
          }
        }}
      />
    </>
  )
}
