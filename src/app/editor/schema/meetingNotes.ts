/**
 * AI meeting notes: `meetingNotes` (content: blocks = the notes; attrs below). Record a meeting
 * (the browser's speech recognition), keep the transcript, let Claude write summary, decisions
 * and action items into the block's content as normal, editable blocks.
 *
 * attrs
 *  - title (string), language (BCP-47, e.g. "de-DE")
 *  - status: 'idle' | 'recording' | 'paused' | 'summarizing' | 'done'
 *  - startedAt / endedAt (epoch ms | null), duration (recorded ms, pauses excluded)
 *  - transcript: TranscriptSegment[] — { t: ms offset into the recording, text } (JSON)
 *  - recordedBy: display name of whoever records right now (team workspaces: "Recording by Ada…")
 *
 * The recording runtime, Claude and the controls live in features/ai/meeting (MeetingDeck);
 * this file is the schema plus the editor rules:
 *  - no meeting notes inside meeting notes: a nested one is unwrapped (its notes kept)
 *  - HTML: <div data-type="meeting-notes"> head + <div class="meeting-notes__body"> notes +
 *    <details> transcript (li[data-t]) — the transcript round-trips through copy / paste
 *  - Markdown: a title line, the notes, the transcript inside <details>
 */
import { Node, mergeAttributes, type Editor, type JSONContent, type Range } from '@tiptap/core'
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { t } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { escapeMarkdownText } from '../lib/mdText'
import { insertBlock } from '../lib/blocks'

export const MEETING = 'meetingNotes'

export type MeetingStatus = 'idle' | 'recording' | 'paused' | 'summarizing' | 'done'
export const MEETING_STATUSES: MeetingStatus[] = ['idle', 'recording', 'paused', 'summarizing', 'done']

export interface TranscriptSegment {
  /** ms offset into the recording (pauses excluded) */
  t: number
  text: string
}

export interface MeetingAttrs {
  id: string | null
  title: string
  status: MeetingStatus
  language: string
  startedAt: number | null
  endedAt: number | null
  duration: number
  transcript: TranscriptSegment[]
  recordedBy: string | null
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

export function asStatus(v: unknown): MeetingStatus {
  return MEETING_STATUSES.includes(v as MeetingStatus) ? (v as MeetingStatus) : 'idle'
}

/** A stored / pasted transcript, validated: segments with text, offsets ≥ 0, in order. */
export function readTranscript(raw: unknown): TranscriptSegment[] {
  let list = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  const out: TranscriptSegment[] = []
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    const text = str((s as { text?: unknown }).text).replace(/\s+/g, ' ').trim()
    if (!text) continue
    const t0 = num((s as { t?: unknown }).t)
    out.push({ t: Math.max(0, Math.round(t0 ?? 0)), text })
  }
  return out
}

/** Typed attrs of a meeting node (anything invalid falls back to its default). */
export function meetingAttrs(node: PMNode | JSONContent): MeetingAttrs {
  const a = (node.attrs ?? {}) as Record<string, unknown>
  return {
    id: str(a.id) || null,
    title: str(a.title),
    status: asStatus(a.status),
    language: str(a.language),
    startedAt: num(a.startedAt),
    endedAt: num(a.endedAt),
    duration: Math.max(0, num(a.duration) ?? 0),
    transcript: readTranscript(a.transcript),
    recordedBy: str(a.recordedBy) || null,
  }
}

/** "04:12" / "1:04:12" */
export function formatOffset(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`
}

export function transcriptWords(segments: TranscriptSegment[]): number {
  let n = 0
  for (const s of segments) n += s.text.split(/\s+/).filter(Boolean).length
  return n
}

/** The transcript as plain lines ("[04:12] text"). */
export function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => `[${formatOffset(s.t)}] ${s.text}`).join('\n')
}

/** Default recognition language for new blocks: the UI language (the browser's English variant for English). */
export function defaultMeetingLanguage(): string {
  const ui = useWorkspace.getState().settings.language
  if (ui === 'de') return 'de-DE'
  // "en-US@posix" and friends: keep the BCP-47 part
  const nav = (typeof navigator !== 'undefined' ? navigator.language : '').split(/[@.]/)[0]
  return /^en-[A-Za-z]{2}$/.test(nav) ? nav : 'en-US'
}

function fmtLocale(): string {
  return useWorkspace.getState().settings.language === 'de' ? 'de-DE' : 'en-GB'
}

/** "Fri 3 Oct 2026 · 14:02–14:48" (static renders and Markdown). */
export function meetingWhen(a: Pick<MeetingAttrs, 'startedAt' | 'endedAt'>, locale = fmtLocale()): string {
  if (!a.startedAt) return ''
  try {
    const start = new Date(a.startedAt)
    const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(start)
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    const end = a.endedAt && a.endedAt > a.startedAt ? `–${time.format(new Date(a.endedAt))}` : ''
    return `${day} · ${time.format(start)}${end}`
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ */
/* Lookup + insertion                                                  */
/* ------------------------------------------------------------------ */

const isMeeting = (n: PMNode | null | undefined): boolean => !!n && n.type.name === MEETING

/** The meeting block around a position (they never nest, so there is at most one). */
export function meetingAround($pos: ResolvedPos): { pos: number; node: PMNode } | null {
  for (let d = $pos.depth; d > 0; d--) if (isMeeting($pos.node(d))) return { pos: $pos.before(d), node: $pos.node(d) }
  return null
}

/** A meeting block by its block id. */
export function findMeeting(doc: PMNode, id: string): { pos: number; node: PMNode } | null {
  let hit: { pos: number; node: PMNode } | null = null
  doc.descendants((node, pos) => {
    if (hit) return false
    if (isMeeting(node)) {
      if (node.attrs.id === id) hit = { pos, node }
      return false
    }
    return !node.isTextblock && !node.isAtom
  })
  return hit
}

export function newMeetingJson(): JSONContent {
  return { type: MEETING, attrs: { language: defaultMeetingLanguage() }, content: [{ type: 'paragraph' }] }
}

/** Slash menu: a new meeting block (below the current one when the caret is inside meeting notes). */
export function insertMeetingNotes(editor: Editor, range?: Range | null): void {
  const outer = meetingAround(editor.state.selection.$from)
  if (!outer) return void insertBlock(editor, newMeetingJson(), range)
  const tr = editor.state.tr
  if (range) tr.delete(range.from, range.to)
  const at = tr.mapping.map(outer.pos + outer.node.nodeSize)
  tr.insert(at, editor.schema.nodeFromJSON(newMeetingJson()))
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2)))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
}

/* ------------------------------------------------------------------ */
/* No meeting notes inside meeting notes                               */
/* ------------------------------------------------------------------ */

function nestedMeetings(doc: PMNode): Array<{ pos: number; node: PMNode }> {
  const hits: Array<{ pos: number; node: PMNode }> = []
  doc.descendants((node, pos) => {
    if (!isMeeting(node)) return !node.isTextblock && !node.isAtom
    node.descendants((inner, ip) => {
      if (isMeeting(inner)) {
        hits.push({ pos: pos + 1 + ip, node: inner })
        return false
      }
      return !inner.isTextblock && !inner.isAtom
    })
    return false
  })
  return hits
}

function insertsMeeting(tr: Transaction): boolean {
  return tr.steps.some((step) => {
    const slice = (step as unknown as { slice?: { content: Fragment } }).slice
    let found = false
    slice?.content.descendants((n) => {
      if (isMeeting(n)) found = true
      return !found
    })
    return found
  })
}

/* ------------------------------------------------------------------ */
/* Node                                                                */
/* ------------------------------------------------------------------ */

function parseTranscriptDom(el: HTMLElement): TranscriptSegment[] {
  const items = el.querySelectorAll<HTMLElement>(':scope > details.meeting-notes__transcript li[data-t]')
  return readTranscript(
    Array.from(items, (li) => ({ t: Number(li.getAttribute('data-t')), text: li.querySelector('.meeting-notes__text')?.textContent ?? li.textContent ?? '' })),
  )
}

const dataAttr = (name: string, read: (v: string | null) => unknown, write: (v: unknown) => string | null, def: unknown) => ({
  default: def,
  parseHTML: (el: HTMLElement) => read(el.getAttribute(`data-${name}`)),
  renderHTML: (a: Record<string, unknown>) => {
    const v = write(a[camel(name)])
    return v === null ? {} : { [`data-${name}`]: v }
  },
})

const camel = (s: string) => s.replace(/-(\w)/g, (_m, c: string) => c.toUpperCase())
const numOrNull = (v: string | null) => num(v)
const numText = (v: unknown) => (num(v) === null ? null : String(num(v)))

export const MeetingNotes = Node.create({
  name: MEETING,
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      title: dataAttr('title', (v) => v ?? '', (v) => str(v) || null, ''),
      status: dataAttr('status', (v) => asStatus(v), (v) => asStatus(v), 'idle'),
      language: dataAttr('language', (v) => v ?? '', (v) => str(v) || null, ''),
      startedAt: dataAttr('started-at', numOrNull, numText, null),
      endedAt: dataAttr('ended-at', numOrNull, numText, null),
      duration: dataAttr('duration', (v) => num(v) ?? 0, numText, 0),
      recordedBy: dataAttr('recorded-by', (v) => v || null, (v) => str(v) || null, null),
      transcript: {
        default: [],
        parseHTML: (el: HTMLElement) => parseTranscriptDom(el),
        // rendered as the <details> list (see renderHTML)
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="meeting-notes"]',
        contentElement: (dom) => (dom as HTMLElement).querySelector<HTMLElement>(':scope > .meeting-notes__body') ?? (dom as HTMLElement),
      },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    const a = meetingAttrs(node)
    const when = meetingWhen(a)
    const head: unknown[] = ['div', { class: 'meeting-notes__head' }, ['span', { class: 'meeting-notes__label' }, t('editor.meeting.label')]]
    if (a.title) head.push(['strong', { class: 'meeting-notes__title' }, a.title])
    if (when) head.push(['span', { class: 'meeting-notes__when' }, when])
    const out: unknown[] = ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'meeting-notes', class: 'meeting-notes' }), head, ['div', { class: 'meeting-notes__body' }, 0]]
    if (a.transcript.length) {
      out.push([
        'details',
        { class: 'meeting-notes__transcript' },
        ['summary', {}, t('editor.meeting.transcript', { words: transcriptWords(a.transcript).toLocaleString(fmtLocale()) })],
        ['ol', {}, ...a.transcript.map((s) => ['li', { 'data-t': String(s.t) }, ['time', {}, formatOffset(s.t)], ' ', ['span', { class: 'meeting-notes__text' }, s.text]])],
      ])
    }
    return out as never
  },
  renderMarkdown(node, h) {
    const a = meetingAttrs(node)
    const when = meetingWhen(a)
    const head = `**${escapeMarkdownText(a.title || t('editor.meeting.label'))}**${when ? ` · ${when}` : ''}`
    const notes = h.renderChildren(node.content ?? [], '\n\n').trim()
    const parts = [head, notes]
    if (a.transcript.length) {
      const lines = a.transcript.map((s) => `- \`${formatOffset(s.t)}\` ${escapeMarkdownText(s.text)}`)
      parts.push(`<details>\n<summary>${t('editor.meeting.transcript', { words: transcriptWords(a.transcript) })}</summary>\n\n${lines.join('\n')}\n\n</details>`)
    }
    return parts.filter(Boolean).join('\n\n')
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('meetingNotes'),
        appendTransaction(trs, _old, state) {
          if (!trs.some((tr) => tr.docChanged && insertsMeeting(tr))) return null
          const hits = nestedMeetings(state.doc)
          if (!hits.length) return null
          const tr = state.tr
          for (const { pos, node } of hits.reverse()) tr.replaceWith(pos, pos + node.nodeSize, node.content)
          return tr
        },
      }),
    ]
  },
})
