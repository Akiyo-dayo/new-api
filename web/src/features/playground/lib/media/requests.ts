import { getFreshAuthHeaders } from '@/lib/api'

export async function playgroundRequest(
  path: string,
  body?: Record<string, unknown> | FormData,
  signal?: AbortSignal
): Promise<Response> {
  if (
    !/^\/pg\/(images\/(generations|edits)|audio\/(speech|transcriptions|translations)|videos(?:\/[A-Za-z0-9_-]+(?:\/content)?)?)$/.test(
      path
    )
  ) {
    throw new Error('Invalid playground endpoint')
  }
  const headers = await getFreshAuthHeaders()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const multipart = body instanceof FormData
  if (multipart || !body) delete headers['Content-Type']
  let payload: BodyInit | undefined
  if (multipart) payload = body
  else if (body) payload = JSON.stringify(body)
  const result = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers:
      multipart || !body
        ? headers
        : { ...headers, 'Content-Type': 'application/json' },
    body: payload,
    signal,
  })
  if (!result.ok) {
    const error: { error?: { message?: string }; message?: string } =
      await result.json().catch(() => ({}))
    throw new Error(
      error.error?.message ?? error.message ?? `HTTP ${result.status}`
    )
  }
  return result
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
