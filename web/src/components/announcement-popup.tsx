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
import { useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getAnnouncementKey, useNotifications } from '@/hooks/use-notifications'
import { formatDateTimeObject } from '@/lib/time'
import { useNotificationStore } from '@/stores/notification-store'

import {
  isSystemNoticeAhead,
  pickLatestAnnouncement,
  shouldOpenAnnouncementPopup,
} from './announcement-popup-utils'

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Shows the latest console announcement once per visit on whichever page the
 * visit starts. A visit that starts on the home page waits until the system
 * notice popup has been closed, and the two popups keep separate
 * "close for today" / "never show again" state.
 */
export function AnnouncementPopup() {
  const { t } = useTranslation()
  const notifications = useNotifications()
  const store = useNotificationStore()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [entryPath] = useState(pathname)
  const [closedKey, setClosedKey] = useState('')

  const latest = pickLatestAnnouncement(notifications.announcements)
  const announcementKey = latest ? getAnnouncementKey(latest) : ''
  const noticeKey = notifications.noticeKey
  const waitingForSystemNotice = isSystemNoticeAhead({
    entryPath,
    noticePopupHandled: store.noticePopupHandled,
    notice: {
      notice: notifications.notice,
      noticeKey,
      popupEnabled: notifications.noticePopupEnabled,
      loading: notifications.loading,
      dismissed: noticeKey ? store.isNoticeDismissed(noticeKey) : false,
    },
  })
  const open = shouldOpenAnnouncementPopup({
    announcementKey,
    loading: notifications.loading,
    dismissed: announcementKey
      ? store.isAnnouncementPopupDismissed(announcementKey)
      : false,
    closedThisVisit: closedKey === announcementKey,
    waitingForSystemNotice,
  })

  if (!latest) return null

  const content = textField(latest.content)
  const extra = textField(latest.extra)
  const publishDate = textField(latest.publishDate)

  const close = (dismiss?: (key: string) => void) => {
    dismiss?.(announcementKey)
    store.markAnnouncementsRead([announcementKey])
    setClosedKey(announcementKey)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title={t('Latest Announcement')}
      description={
        publishDate
          ? `${t('Published:')} ${formatDateTimeObject(new Date(publishDate))}`
          : undefined
      }
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => close(store.closeAnnouncementToday)}
          >
            {t('Close for today')}
          </Button>
          <Button onClick={() => close(store.closeAnnouncementForever)}>
            {t('Never show again')}
          </Button>
        </>
      }
    >
      <ScrollArea className='max-h-[min(58vh,520px)] pr-4'>
        <div className='space-y-4'>
          {content && <RichContent breaks content={content} />}
          {extra && (
            <div>
              <h4 className='mb-2 font-medium'>
                {t('Additional Information')}
              </h4>
              <RichContent
                breaks
                content={extra}
                className='text-muted-foreground'
              />
            </div>
          )}
        </div>
      </ScrollArea>
    </Dialog>
  )
}
