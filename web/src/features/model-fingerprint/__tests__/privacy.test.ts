import { describe, expect, it } from 'vitest'

import { privacyNotice, storageNotice } from '../lib/privacy'
import { readCompletion } from '../vendor/completion'

describe('inspection privacy and readable failures', () => {
  it('distinguishes local analysis, direct credentials and proxy transmission before a request', () => {
    expect(privacyNotice('manual', 'site')).toContain('No model request')
    expect(privacyNotice('api', 'direct')).toContain('not to this site backend')
    expect(privacyNotice('api', 'site')).toContain('backend memory')
    expect(privacyNotice('api', 'auto')).toContain('real API key')
    expect(privacyNotice('api', 'worker')).toContain(
      'proxy receives your API key'
    )
    expect(storageNotice).toContain('plain text to localStorage')
  })
  it('preserves a bounded HTTP error message rather than displaying a stream object', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: 'Upstream DNS failed' } }),
      { status: 502 }
    )
    await expect(readCompletion(response, 'openai')).rejects.toThrow(
      'HTTP 502：Upstream DNS failed'
    )
  })
})
