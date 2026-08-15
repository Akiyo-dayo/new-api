import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildNoticeKey } from '../notice-popup-utils'

describe('notice popup identity', () => {
  test('uses the backend revision so reverting content still invalidates dismissal', () => {
    assert.notEqual(
      buildNoticeKey('Maintenance', '12'),
      buildNoticeKey('Maintenance', '13')
    )
  })
})
