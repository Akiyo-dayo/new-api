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
import { beforeEach, describe, expect, test } from 'vitest'

const { useNotificationStore } = await import('../notification-store')

beforeEach(() => {
  window.localStorage.clear()
  useNotificationStore.setState({
    lastReadNotice: '',
    readAnnouncementKeys: [],
    closedUntilDate: null,
    closedNoticeToday: null,
    permanentlyClosedNoticeKeys: [],
  })
})

describe('notification dismissal persistence', () => {
  test('persists permanent dismissal by notice fingerprint only', () => {
    useNotificationStore.getState().closeNoticeForever('notice:one')

    expect(
      useNotificationStore.getState().isNoticeDismissed('notice:one')
    ).toBe(true)
    expect(
      useNotificationStore.getState().isNoticeDismissed('notice:updated')
    ).toBe(false)

    const persisted = JSON.parse(
      window.localStorage.getItem('notification-storage') ?? '{}'
    ) as { state?: { permanentlyClosedNoticeKeys?: string[] } }
    expect(persisted.state?.permanentlyClosedNoticeKeys).toEqual([
      'notice:one',
    ])
  })

  test('limits today dismissal to the same fingerprint and date', () => {
    useNotificationStore.getState().closeNoticeToday('notice:today')

    expect(
      useNotificationStore.getState().isNoticeDismissed('notice:today')
    ).toBe(true)
    expect(
      useNotificationStore.getState().isNoticeDismissed('notice:updated')
    ).toBe(false)
  })
})
