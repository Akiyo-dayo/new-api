import type { AxiosResponse } from 'axios'

export function inspectionResponse(
  response: AxiosResponse<ReadableStream>
): Response {
  return new Response(response.data, {
    status: response.status,
    headers: {
      'Content-Type': String(
        response.headers['content-type'] ?? 'application/json'
      ),
    },
  })
}
