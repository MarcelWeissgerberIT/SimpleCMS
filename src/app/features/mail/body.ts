/**
 * A mail row's page content: an images notice (when the mail has remote images), the body, the
 * attachments. Written only as setContent(row, doc, 'mail').
 *
 * "Load images" is a `button` block in the notice whose action sets the row's "Show images" checkbox
 * (edit_properties); the mail service sees the change and renders the body again (service.ts).
 * The attachments work the same way: each one is a list item with a "Load" key that writes its key
 * into the hidden "Load attachment" property; the service loads it (attachments.ts) and the item
 * becomes a real block (image, PDF viewer, audio, video, file). Loaded blocks stay when the body is
 * rendered again (`loaded`).
 */
import type { JSONContent } from '@tiptap/core'
import { t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { htmlToBlocks, textToBlocks } from './html'
import { fmtSize, type MailAttachment } from './parse'
import { ATTACHMENT_MAX } from './settings'

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

/** An attachment's key in the page (and in the "Load attachment" property): size + name. */
export const attKey = (a: { name: string; size: number }) => `${a.size}:${a.name}`
/** The "Load all" key's value. */
export const LOAD_ALL = '*'

/** Where the attachments' Load keys write, and what is loaded already (by attKey). */
export interface AttachOpts {
  loadProp?: ID | null
  /** the Gmail message (the "open in Gmail" link of a file over the limit) */
  msgId?: string
  loaded?: Map<string, JSONContent>
}

const gmailLink = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`

/** A ghost key that writes `value` into the "Load attachment" property. */
function loadKey(label: string, value: string, prop: ID): JSONContent {
  return { type: 'button', attrs: { label, variant: 'ghost', actions: [{ id: 'mail-att', type: 'edit_properties', values: [{ propertyId: prop, value }] }] } }
}

function attachmentsBlock(list: MailAttachment[], o: AttachOpts = {}): JSONContent[] {
  if (!list.length) return []
  const lang = useWorkspace.getState().settings.language
  const loaded = o.loaded ?? new Map<string, JSONContent>()
  const done = list.filter((a) => loaded.has(attKey(a))).map((a) => loaded.get(attKey(a))!)
  const open = list.filter((a) => !loaded.has(attKey(a)))
  const prop = o.loadProp ?? null
  const fits = (a: MailAttachment) => a.size <= ATTACHMENT_MAX
  const item = (a: MailAttachment): JSONContent => {
    const line = [text(`${a.name} · `), text(fmtSize(a.size, lang), [{ type: 'code' }])]
    if (!fits(a) && o.msgId) line.push(text(' · '), text(t('features.mail.att.tooBig'), [{ type: 'link', attrs: { href: gmailLink(o.msgId) } }]))
    return { type: 'listItem', content: [para(...line), ...(prop && fits(a) ? [loadKey(t('features.mail.att.load'), attKey(a), prop)] : [])] }
  }
  const loadable = prop ? open.filter(fits) : []
  return [
    { type: 'horizontalRule' },
    para(text(t(list.length === 1 ? 'features.mail.body.attachments.one' : 'features.mail.body.attachments', { n: list.length }), [{ type: 'bold' }])),
    ...done,
    ...(prop && loadable.length >= 2 ? [loadKey(t('features.mail.att.loadAll'), LOAD_ALL, prop)] : []),
    ...(open.length ? [{ type: 'bulletList', content: open.map(item) }] : []),
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
export async function mailDoc(src: BodySource, images: boolean, imagesProp: ID | null, att: AttachOpts = {}): Promise<{ doc: JSONContent; remote: number }> {
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
  let doc: JSONContent = { type: 'doc', content: [...notice, ...blocks, ...attachmentsBlock(src.attachments, att)] }
  if (!(doc.content ?? []).length) doc = { type: 'doc', content: [para()] }
  if (!(await valid(doc))) {
    // the schema refused something: the plain text is always valid
    const fallback = src.text ? textToBlocks(src.text) : src.snippet ? [para(text(src.snippet))] : [para()]
    doc = { type: 'doc', content: [...fallback, ...attachmentsBlock(src.attachments, att)] }
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
