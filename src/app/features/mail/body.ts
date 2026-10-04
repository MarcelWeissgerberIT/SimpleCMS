/**
 * A mail row's page content: an images notice (when the mail has remote images), the body, the
 * attachments (names and sizes — no download in v1). Written only as setContent(row, doc, 'mail').
 *
 * "Load images" is a `button` block in the notice whose action sets the row's "Show images" checkbox
 * (edit_properties); the mail service sees the change and renders the body again (service.ts).
 */
import type { JSONContent } from '@tiptap/core'
import { t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { htmlToBlocks, textToBlocks } from './html'
import { fmtSize, type MailAttachment } from './parse'

export const MAIL_ORIGIN = 'mail'

export interface BodySource {
  html: string | null
  text: string | null
  snippet?: string
  attachments: MailAttachment[]
}

const text = (s: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text: s, marks } : { type: 'text', text: s })
const para = (...content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })

/** The notice above a mail with remote images: what happened + the button that changes it. */
function imagesNotice(remote: number, shown: boolean, imagesProp: ID): JSONContent {
  return {
    type: 'callout',
    attrs: { icon: shown ? '🖼️' : 'asset:lock', color: 'gray' },
    content: [
      para(text(shown ? t('features.mail.body.imagesShown') : t(remote === 1 ? 'features.mail.body.imagesBlocked.one' : 'features.mail.body.imagesBlocked', { n: remote }))),
      {
        type: 'button',
        attrs: {
          label: shown ? t('features.mail.body.blockImages') : t('features.mail.body.loadImages'),
          variant: 'ghost',
          actions: [{ id: 'mail-images', type: 'edit_properties', values: [{ propertyId: imagesProp, value: !shown }] }],
        },
      },
    ],
  }
}

function attachmentsBlock(list: MailAttachment[]): JSONContent[] {
  if (!list.length) return []
  const lang = useWorkspace.getState().settings.language
  return [
    { type: 'horizontalRule' },
    para(text(t(list.length === 1 ? 'features.mail.body.attachments.one' : 'features.mail.body.attachments', { n: list.length }), [{ type: 'bold' }])),
    {
      type: 'bulletList',
      content: list.map((a) => ({ type: 'listItem', content: [para(text(`${a.name} · `), text(fmtSize(a.size, lang), [{ type: 'code' }]))] })),
    },
  ]
}

async function valid(doc: JSONContent): Promise<boolean> {
  try {
    const { docSchema } = await import('../../editor')
    docSchema().nodeFromJSON(doc).check()
    return true
  } catch {
    return false
  }
}

/**
 * The row document for a mail. `images`: remote images shown (else replaced by their alt text);
 * `imagesProp`: the "Show images" property (no notice without it). Resolves with the number of
 * remote images the mail has (0 = nothing to keep for "Load images").
 */
export async function mailDoc(src: BodySource, images: boolean, imagesProp: ID | null): Promise<{ doc: JSONContent; remote: number }> {
  let blocks: JSONContent[] = []
  let remote = 0
  if (src.html) {
    try {
      const r = await htmlToBlocks(src.html, images)
      blocks = r.content
      remote = r.remote
    } catch (e) {
      // never the mail itself in a log
      console.warn('[one] mail: the HTML body could not be read', e instanceof Error ? e.name : 'error')
    }
  }
  if (!blocks.length && src.text) blocks = textToBlocks(src.text)
  if (!blocks.length && src.snippet) blocks = [para(text(src.snippet))]
  const notice = remote > 0 && imagesProp ? [imagesNotice(remote, images, imagesProp)] : []
  let doc: JSONContent = { type: 'doc', content: [...notice, ...blocks, ...attachmentsBlock(src.attachments)] }
  if (!(doc.content ?? []).length) doc = { type: 'doc', content: [para()] }
  if (!(await valid(doc))) {
    // the schema refused something: the plain text is always valid
    const fallback = src.text ? textToBlocks(src.text) : src.snippet ? [para(text(src.snippet))] : [para()]
    doc = { type: 'doc', content: [...fallback, ...attachmentsBlock(src.attachments)] }
    remote = 0
  }
  return { doc, remote }
}

/** Fingerprint of a body's text (FNV-1a): tells whether someone edited the page after One wrote it. */
export function textHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
