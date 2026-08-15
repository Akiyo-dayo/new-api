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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/hooks/use-notifications'

import { shouldOpenNoticePopup } from './notice-popup-utils'

export function NoticePopup() {
  const { t } = useTranslation()
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const isNoticeDismissed = notifications.isNoticeDismissed
  const notice = notifications.notice
  const noticeKey = notifications.noticeKey
  const noticePopupEnabled = notifications.noticePopupEnabled
  const loading = notifications.loading

  useEffect(() => {
    const dismissed = noticeKey ? isNoticeDismissed(noticeKey) : false
    setOpen(
      shouldOpenNoticePopup({
        notice,
        noticeKey,
        popupEnabled: noticePopupEnabled,
        loading,
        dismissed,
      })
    )
  }, [isNoticeDismissed, loading, notice, noticeKey, noticePopupEnabled])

  if (!notice) return null

  const closeToday = () => {
    if (noticeKey) {
      notifications.closeNoticeToday(noticeKey)
    }
    setOpen(false)
  }

  const closeForever = () => {
    if (noticeKey) {
      notifications.closeNoticeForever(noticeKey)
    }
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('System Notice')}
      description={t('Important information from the administrator')}
      contentClassName='sm:max-w-lg'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button variant='outline' onClick={closeToday}>
            {t('Close for today')}
          </Button>
          <Button onClick={closeForever}>{t('Never show again')}</Button>
        </>
      }
    >
      <RichContent breaks content={notice} />
    </Dialog>
  )
}
