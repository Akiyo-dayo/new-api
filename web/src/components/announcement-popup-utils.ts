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
import {
  type NoticePopupState,
  shouldOpenNoticePopup,
} from './notice-popup-utils'

// Only the home page renders the system notice popup.
const NOTICE_POPUP_PATH = '/'

export type AnnouncementPopupState = {
  announcementKey: string
  loading: boolean
  dismissed: boolean
  closedThisVisit: boolean
  waitingForSystemNotice: boolean
}

/**
 * Picks the most recently published announcement. Items without a valid
 * publish date never beat a dated one, and ties keep the configured order.
 */
export function pickLatestAnnouncement<T extends Record<string, unknown>>(
  items: T[]
): T | null {
  let latest: T | null = null
  let latestTime = Number.NEGATIVE_INFINITY
  for (const item of items) {
    const parsed =
      typeof item.publishDate === 'string'
        ? Date.parse(item.publishDate)
        : Number.NaN
    const time = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
    if (latest === null || time > latestTime) {
      latest = item
      latestTime = time
    }
  }
  return latest
}

/**
 * The announcement queues behind the system notice only when the visit
 * started on the page that shows the notice and the notice is still due.
 */
export function isSystemNoticeAhead(state: {
  entryPath: string
  noticePopupHandled: boolean
  notice: NoticePopupState
}): boolean {
  return (
    state.entryPath === NOTICE_POPUP_PATH &&
    !state.noticePopupHandled &&
    shouldOpenNoticePopup(state.notice)
  )
}

export function shouldOpenAnnouncementPopup(
  state: AnnouncementPopupState
): boolean {
  return (
    !state.loading &&
    state.announcementKey.length > 0 &&
    !state.dismissed &&
    !state.closedThisVisit &&
    !state.waitingForSystemNotice
  )
}
