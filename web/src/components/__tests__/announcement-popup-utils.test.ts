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
import { describe, expect, test } from 'vitest'

import {
  isSystemNoticeAhead,
  pickLatestAnnouncement,
  shouldOpenAnnouncementPopup,
} from '../announcement-popup-utils'

const dueNotice = {
  notice: 'Maintenance tonight',
  noticeKey: 'notice:1:abc',
  popupEnabled: true,
  loading: false,
  dismissed: false,
}

const readyPopup = {
  announcementKey: 'id:14',
  loading: false,
  dismissed: false,
  closedThisVisit: false,
  waitingForSystemNotice: false,
}

describe('latest announcement selection', () => {
  test('picks the newest publish date regardless of configured order', () => {
    const latest = pickLatestAnnouncement([
      { id: 12, publishDate: '2026-10-08T00:21:27.716Z' },
      { id: 14, publishDate: '2026-11-05T06:05:54.000Z' },
      { id: 13, publishDate: '2026-10-19T14:11:53.085Z' },
    ])

    expect(latest?.id).toBe(14)
  })

  test('keeps the first item when no publish date is valid', () => {
    const latest = pickLatestAnnouncement([
      { id: 1, publishDate: 'not a date' },
      { id: 2 },
    ])

    expect(latest?.id).toBe(1)
  })

  test('returns null for an empty list', () => {
    expect(pickLatestAnnouncement([])).toBeNull()
  })
})

describe('latest announcement popup queue', () => {
  test('waits behind a due system notice on a home-page entry', () => {
    expect(
      isSystemNoticeAhead({
        entryPath: '/',
        noticePopupHandled: false,
        notice: dueNotice,
      })
    ).toBe(true)
  })

  test('opens after the system notice was closed in this visit', () => {
    expect(
      isSystemNoticeAhead({
        entryPath: '/',
        noticePopupHandled: true,
        notice: dueNotice,
      })
    ).toBe(false)
  })

  test('does not wait for a system notice the visitor already dismissed', () => {
    expect(
      isSystemNoticeAhead({
        entryPath: '/',
        noticePopupHandled: false,
        notice: { ...dueNotice, dismissed: true },
      })
    ).toBe(false)
  })

  test('does not wait on a console entry where the notice never shows', () => {
    expect(
      isSystemNoticeAhead({
        entryPath: '/dashboard',
        noticePopupHandled: false,
        notice: dueNotice,
      })
    ).toBe(false)
  })
})

describe('latest announcement popup visibility', () => {
  test('opens once data is loaded and nothing blocks it', () => {
    expect(shouldOpenAnnouncementPopup(readyPopup)).toBe(true)
  })

  test('stays closed while notice and status queries load', () => {
    expect(shouldOpenAnnouncementPopup({ ...readyPopup, loading: true })).toBe(
      false
    )
  })

  test('stays closed while the system notice is ahead in the queue', () => {
    expect(
      shouldOpenAnnouncementPopup({
        ...readyPopup,
        waitingForSystemNotice: true,
      })
    ).toBe(false)
  })

  test('stays closed after being dismissed or closed in this visit', () => {
    expect(
      shouldOpenAnnouncementPopup({ ...readyPopup, dismissed: true })
    ).toBe(false)
    expect(
      shouldOpenAnnouncementPopup({ ...readyPopup, closedThisVisit: true })
    ).toBe(false)
  })

  test('stays closed when there is no announcement', () => {
    expect(
      shouldOpenAnnouncementPopup({ ...readyPopup, announcementKey: '' })
    ).toBe(false)
  })
})
