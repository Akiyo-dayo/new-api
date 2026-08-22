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

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const storage = new MemoryStorage()
Object.assign(globalThis, { window: { localStorage: storage } })
const { useNotificationStore } = await import('../notification-store')

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
      storage.getItem('notification-storage') ?? '{}'
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
