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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { shouldOpenNoticePopup } from '../notice-popup-utils'

describe('notice popup visibility', () => {
  test('waits for notice and status queries before opening', () => {
    assert.equal(
      shouldOpenNoticePopup({
        notice: 'Maintenance',
        noticeKey: 'notice:one',
        popupEnabled: true,
        loading: true,
        dismissed: false,
      }),
      false
    )
  })

  test('stays closed when the administrator disables homepage popups', () => {
    assert.equal(
      shouldOpenNoticePopup({
        notice: 'Maintenance',
        noticeKey: 'notice:one',
        popupEnabled: false,
        loading: false,
        dismissed: false,
      }),
      false
    )
  })

  test('content fingerprints invalidate an old dismissal', () => {
    assert.equal(
      shouldOpenNoticePopup({
        notice: 'Updated maintenance',
        noticeKey: 'notice:two',
        popupEnabled: true,
        loading: false,
        dismissed: false,
      }),
      true
    )
  })
})
