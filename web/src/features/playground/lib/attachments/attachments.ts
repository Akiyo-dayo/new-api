import { nanoid } from 'nanoid'
import { z } from 'zod'

import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'

import type { PlaygroundAttachment } from '../../types'

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
export const MAX_ATTACHMENTS = 4
const textExtension =
  /\.(txt|md|csv|tsv|json|jsonl|ya?ml|xml|html|css|[cm]?[jt]sx?|py|go|rs|java|c|cpp|h|sh|sql|log)$/i
export const attachmentSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().max(255),
    mime: z.string().max(128),
    size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
    kind: z.enum(['image', 'text', 'pdf']),
    data: z
      .string()
      .max(12 * 1024 * 1024)
      .optional(),
    blobId: z.string().max(128).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.data &&
      value.kind === 'image' &&
      !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
        value.data
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid image attachment' })
    }
    if (
      value.data &&
      value.kind === 'pdf' &&
      !/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(value.data)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid PDF attachment' })
    }
    if (value.kind === 'text' && (value.data?.length ?? 0) > 80_000) {
      ctx.addIssue({ code: 'custom', message: 'Text attachment is too large' })
    }
  })

export async function prepareAttachments(
  message: PromptInputMessage,
  responses: boolean
): Promise<PlaygroundAttachment[]> {
  const files = message.files ?? []
  if (files.length > MAX_ATTACHMENTS) throw new Error('Too many attachments')
  let total = 0
  const attachments: PlaygroundAttachment[] = []
  for (const file of files) {
    if (!file.url.startsWith('data:')) throw new Error('Invalid attachment')
    const blob = await (await fetch(file.url)).blob()
    total += blob.size
    if (blob.size > MAX_ATTACHMENT_BYTES || total > 16 * 1024 * 1024) {
      throw new Error('Attachments exceed the size limit')
    }
    const name = file.filename ?? 'attachment'
    const mime = file.mediaType || blob.type
    let kind: PlaygroundAttachment['kind']
    let data = file.url
    if (/^image\/(png|jpeg|webp|gif)$/.test(mime)) kind = 'image'
    else if (mime === 'application/pdf' && responses) kind = 'pdf'
    else if (mime.startsWith('text/') || textExtension.test(name)) {
      kind = 'text'
      data = await blob.text()
      if (data.includes('\u0000')) {
        throw new Error('Unsupported binary attachment')
      }
    } else {
      throw new Error(
        'Unsupported attachment format. Use images, text, or PDF with Responses.'
      )
    }
    attachments.push(
      attachmentSchema.parse({
        id: nanoid(),
        name,
        mime,
        size: blob.size,
        kind,
        data,
      })
    )
  }
  return attachments
}
