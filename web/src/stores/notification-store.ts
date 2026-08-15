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
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NotificationState {
  // Last read Notice content signature (full trimmed message)
  lastReadNotice: string
  // Array of read announcement keys (id or content hash)
  readAnnouncementKeys: string[]
  // Timestamp of last "Close Today" action
  closedUntilDate: string | null
  // Notice-specific dismissal state keyed by notice content fingerprint
  closedNoticeToday: { key: string; date: string } | null
  permanentlyClosedNoticeKeys: string[]

  // Actions
  markNoticeRead: (noticeContent: string) => void
  markAnnouncementsRead: (keys: string[]) => void
  setClosedUntilDate: (date: string | null) => void
  closeNoticeToday: (key: string) => void
  closeNoticeForever: (key: string) => void
  isNoticeDismissed: (key: string) => boolean
  isAnnouncementRead: (key: string) => boolean
  isNoticeClosed: () => boolean
}

/**
 * Notification store for tracking read status of Notice and Announcements
 * Persists to localStorage to maintain state across sessions
 */
export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      lastReadNotice: '',
      readAnnouncementKeys: [],
      closedUntilDate: null,
      closedNoticeToday: null,
      permanentlyClosedNoticeKeys: [],

      markNoticeRead: (noticeContent: string) => {
        // Persist the full trimmed content so edits beyond 100 chars register
        const normalizedContent = noticeContent.trim()
        set({ lastReadNotice: normalizedContent })
      },

      markAnnouncementsRead: (keys: string[]) => {
        set((state) => ({
          readAnnouncementKeys: [
            ...new Set([...state.readAnnouncementKeys, ...keys]),
          ],
        }))
      },

      setClosedUntilDate: (date: string | null) => {
        set({ closedUntilDate: date })
      },

      closeNoticeToday: (key: string) => {
        set({
          closedNoticeToday: { key, date: new Date().toDateString() },
        })
      },

      closeNoticeForever: (key: string) => {
        set((state) => ({
          permanentlyClosedNoticeKeys: [
            ...new Set([...state.permanentlyClosedNoticeKeys, key]),
          ],
        }))
      },

      isAnnouncementRead: (key: string) => {
        return get().readAnnouncementKeys.includes(key)
      },

      isNoticeClosed: () => {
        const { closedUntilDate } = get()
        if (!closedUntilDate) return false

        const today = new Date().toDateString()
        return closedUntilDate === today
      },

      isNoticeDismissed: (key: string) => {
        const state = get()
        if (state.permanentlyClosedNoticeKeys.includes(key)) return true
        return (
          state.closedNoticeToday?.key === key &&
          state.closedNoticeToday.date === new Date().toDateString()
        )
      },
    }),
    {
      name: 'notification-storage',
      partialize: (state) => ({
        lastReadNotice: state.lastReadNotice,
        readAnnouncementKeys: state.readAnnouncementKeys,
        closedUntilDate: state.closedUntilDate,
        closedNoticeToday: state.closedNoticeToday,
        permanentlyClosedNoticeKeys: state.permanentlyClosedNoticeKeys,
      }),
    }
  )
)
