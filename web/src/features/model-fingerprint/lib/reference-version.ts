export const builtinCommit = '50a364bc686279094265f34f18f5501eac1d73f4'
export interface ReferenceVersion {
  commit: string
  built_at: string
  models: number
  state: string
  last_check: string
  next_check: string
  timezone: string
  enabled: boolean
  files: Record<string, string>
}
export async function referenceVersion(): Promise<ReferenceVersion> {
  const response = await fetch('/api/fingerprint/reference/status', {
    cache: 'no-store',
    credentials: 'omit',
  })
  if (!response.ok) throw new Error('Reference update status unavailable')
  const version = (await response.json()) as ReferenceVersion
  if (!/^[a-f0-9]{40}$/.test(version.commit)) {
    throw new Error('Invalid reference version')
  }
  return version
}
export function referenceURL(
  version: Pick<ReferenceVersion, 'commit'>,
  name: string
): string {
  return `/api/fingerprint/reference/${version.commit}/${name}`
}
export async function referenceFile(
  version: ReferenceVersion,
  name: string
): Promise<Response> {
  const response = await fetch(referenceURL(version, name), {
    credentials: 'omit',
  })
  if (!response.ok) throw new Error('Reference download failed')
  if (version.files[name]) {
    const bytes = await response.clone().arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const actual = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    if (actual !== version.files[name]) {
      throw new Error('Reference checksum mismatch')
    }
  }
  return response
}
