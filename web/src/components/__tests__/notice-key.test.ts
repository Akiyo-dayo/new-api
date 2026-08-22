import { describe, expect, test } from 'vitest'

import { buildNoticeKey } from '../notice-popup-utils'

describe('notice popup identity', () => {
  test('uses the backend revision so reverting content still invalidates dismissal', () => {
    expect(buildNoticeKey('Maintenance', '12')).not.toBe(
      buildNoticeKey('Maintenance', '13')
    )
  })
})
