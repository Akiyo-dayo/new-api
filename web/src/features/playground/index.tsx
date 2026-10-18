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
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundAdvanced } from './components/input/playground-advanced'
import { PlaygroundInput } from './components/input/playground-input'
import { PlaygroundMedia } from './components/media/playground-media'
import { PlaygroundSessionList } from './components/sessions/playground-session-list'
import {
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import { usePlaygroundSessions } from './hooks/use-playground-sessions'
import type { PlaygroundSession, MediaRecord } from './lib/storage/sessions'
import type { PlaygroundMode } from './types'

export function Playground() {
  const { t } = useTranslation()
  const sessions = usePlaygroundSessions()
  const userId = useAuthStore((state) => state.auth.user?.id)
  return (
    <div className='flex size-full min-h-0 flex-col overflow-hidden lg:flex-row'>
      {sessions.envelope && (
        <PlaygroundSessionList
          envelope={sessions.envelope}
          onSelect={sessions.select}
          onCreate={sessions.create}
          onRemove={sessions.remove}
          onRename={sessions.rename}
          onImport={sessions.importJSON}
        />
      )}
      {sessions.active ? (
        <PlaygroundWorkspace
          key={`${userId}:${sessions.active.id}`}
          session={sessions.active}
          onSave={sessions.update}
        />
      ) : (
        <p role='status' className='text-muted-foreground p-6 text-sm'>
          {t('Loading conversations...')}
        </p>
      )}
    </div>
  )
}

function PlaygroundWorkspace(props: {
  session: PlaygroundSession
  onSave: (session: PlaygroundSession) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PlaygroundMode>(props.session.mode)
  const [media, setMedia] = useState(props.session.media)
  const {
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    clearMessages,
  } = usePlaygroundState(props.session)

  const { sendChat, stopGeneration, isGenerating, debug } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
  })

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages,
    updateMessages,
    sendChat,
  })

  const handleClearMessages = () => {
    handleEditOpenChange(false)
    clearMessages()
  }

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  const onRecordsChange = useCallback(
    (records: MediaRecord[]) => setMedia(records),
    []
  )
  const latestSession = useRef(props.session)
  const saveSession = props.onSave
  useEffect(() => () => saveSession(latestSession.current), [saveSession])
  useEffect(() => {
    if (isLoadingMessages) return
    latestSession.current = {
      ...props.session,
      title:
        props.session.title ||
        messages
          .find((message) => message.from === 'user')
          ?.versions[0].content.slice(0, 60) ||
        '',
      messages,
      config,
      parameterEnabled,
      mode,
      media,
      updatedAt: Date.now(),
    }
    saveSession(latestSession.current)
  }, [
    messages,
    config,
    parameterEnabled,
    mode,
    media,
    isLoadingMessages,
    props.session,
    saveSession,
  ])

  return (
    <div className='relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
      <div className='flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2'>
        {(['chat', 'image', 'audio', 'video'] as const).map((value) => (
          <Button
            key={value}
            size='sm'
            variant={mode === value ? 'secondary' : 'ghost'}
            aria-pressed={mode === value}
            disabled={isGenerating}
            onClick={() => setMode(value)}
          >
            {t(
              { chat: 'Chat', image: 'Images', audio: 'Audio', video: 'Video' }[
                value
              ]
            )}
          </Button>
        ))}
        <PlaygroundAdvanced
          config={config}
          disabled={isGenerating}
          onChange={updateConfig}
          debug={debug}
        />
      </div>
      {mode !== 'chat' ? (
        <div className='min-h-0 flex-1 overflow-auto'>
          <PlaygroundMedia
            key={mode}
            sessionId={props.session.id}
            mode={mode}
            config={config}
            models={models}
            groups={groups}
            records={media}
            onRecordsChange={onRecordsChange}
            onModelChange={(value) => updateConfig('model', value)}
            onGroupChange={(value) => updateConfig('group', value)}
          />
        </div>
      ) : (
        <>
          <div className='flex shrink-0 justify-end px-3 pt-2'>
            <Button
              variant='ghost'
              size='sm'
              render={<Link to='/model-fingerprint' />}
            >
              {t('Model fingerprint')}
            </Button>
          </div>
          {/* Full-width scroll container: scrolling works even over side whitespace */}
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <PlaygroundChat
              messages={messages}
              isLoadingMessages={isLoadingMessages}
              onRegenerateMessage={handleRegenerateMessage}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onSelectPrompt={handleSendMessage}
              isGenerating={isGenerating}
              editingKey={editingMessageKey}
              onCancelEdit={handleEditOpenChange}
              onSaveEdit={(newContent) => applyEdit(newContent, false)}
              onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
            />
          </div>

          {/* Input area: center content and constrain to the same container width */}
          <div className='mx-auto w-full max-w-4xl'>
            <PlaygroundInput
              config={config}
              disabled={isGenerating}
              groups={groups}
              groupValue={config.group}
              isGenerating={isGenerating}
              isModelLoading={isLoadingModels}
              modelValue={config.model}
              models={models}
              onGroupChange={(value) => updateConfig('group', value)}
              onConfigChange={updateConfig}
              onClearMessages={handleClearMessages}
              onModelChange={(value) => updateConfig('model', value)}
              onParameterEnabledChange={updateParameterEnabled}
              onStop={stopGeneration}
              onSubmit={handleSendMessage}
              parameterEnabled={parameterEnabled}
              hasMessages={messages.length > 0}
            />
          </div>
        </>
      )}
    </div>
  )
}
