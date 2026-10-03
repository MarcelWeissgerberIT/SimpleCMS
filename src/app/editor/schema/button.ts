/**
 * `button` block (schema only). A keycap in the document that runs its actions in order.
 * attrs: label (string), variant ('signal' | 'ink' | 'ghost'), actions (ButtonAction[] — JSON).
 * The React node view lives in ../views/ButtonView.tsx, the runtime in ../lib/buttonRun.ts.
 */
import { Extension, Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { PropertyValue } from '../../store/types'
import { escapeMarkdownText } from '../lib/mdText'

export type ButtonVariant = 'signal' | 'ink' | 'ghost'
export const BUTTON_VARIANTS: ButtonVariant[] = ['signal', 'ink', 'ghost']

/**
 * A preset property value. Besides stored PropertyValues: "@today" / "@now" (dates) and
 * "@toggle" (checkbox, edit mode). Text values may contain {{date}} {{time}} {{user}}.
 */
export interface PropertyPreset {
  propertyId: string
  value: PropertyValue
}

export type ButtonAction =
  | { id: string; type: 'insert_blocks'; content: JSONContent[] }
  | { id: string; type: 'add_page'; databaseId: string | null; title: string; values: PropertyPreset[]; open: boolean }
  | { id: string; type: 'edit_properties'; values: PropertyPreset[] }
  | { id: string; type: 'webhook'; url: string; method: 'POST' | 'PUT' }
  | { id: string; type: 'open'; url: string; pageId: string | null }
  | { id: string; type: 'message'; text: string }

export type ButtonActionType = ButtonAction['type']
export const ACTION_TYPES: ButtonActionType[] = ['insert_blocks', 'add_page', 'edit_properties', 'webhook', 'open', 'message']

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

export function asVariant(v: unknown): ButtonVariant {
  return BUTTON_VARIANTS.includes(v as ButtonVariant) ? (v as ButtonVariant) : 'signal'
}

function isPropertyValue(v: unknown): v is PropertyValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string')
  return !!v && typeof v === 'object' && typeof (v as { start?: unknown }).start === 'string'
}

function presets(raw: unknown): PropertyPreset[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p) => (p && typeof p === 'object' && typeof p.propertyId === 'string' && isPropertyValue(p.value) ? [{ propertyId: p.propertyId, value: p.value }] : []))
}

let seq = 0
export const actionId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * Validate a stored / pasted actions array: unknown entries are dropped, missing fields filled,
 * duplicate ids replaced. `freshIds` gives every action a new id (a pasted copy is a new button).
 */
export function normalizeActions(raw: unknown, opts: { freshIds?: boolean } = {}): ButtonAction[] {
  if (!Array.isArray(raw)) return []
  const out: ButtonAction[] = []
  const seen = new Set<string>()
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    let id = opts.freshIds ? '' : str(a.id).slice(0, 64)
    if (!id || seen.has(id)) id = actionId()
    seen.add(id)
    switch (a.type) {
      case 'insert_blocks':
        out.push({ id, type: 'insert_blocks', content: Array.isArray(a.content) ? a.content.filter((n: unknown) => !!n && typeof n === 'object') : [] })
        break
      case 'add_page':
        out.push({ id, type: 'add_page', databaseId: strOrNull(a.databaseId), title: str(a.title), values: presets(a.values), open: !!a.open })
        break
      case 'edit_properties':
        out.push({ id, type: 'edit_properties', values: presets(a.values) })
        break
      case 'webhook':
        out.push({ id, type: 'webhook', url: str(a.url), method: a.method === 'PUT' ? 'PUT' : 'POST' })
        break
      case 'open':
        out.push({ id, type: 'open', url: str(a.url), pageId: strOrNull(a.pageId) })
        break
      case 'message':
        out.push({ id, type: 'message', text: str(a.text) })
        break
    }
  }
  return out
}

/** A fresh, empty action of a type. */
export function newAction(type: ButtonActionType): ButtonAction {
  const id = actionId()
  switch (type) {
    case 'insert_blocks':
      return { id, type, content: [{ type: 'paragraph' }] }
    case 'add_page':
      return { id, type, databaseId: null, title: '', values: [], open: false }
    case 'edit_properties':
      return { id, type, values: [] }
    case 'webhook':
      return { id, type, url: '', method: 'POST' }
    case 'open':
      return { id, type, url: '', pageId: null }
    case 'message':
      return { id, type, text: '' }
  }
}

/* ------------------------------------------------------------------ */
/* Copy marker: actions survive only an in-app copy / paste            */
/* ------------------------------------------------------------------ */

/*
 * Button actions run webhooks and write to databases, so pasted HTML must not bring its own:
 * any web page can put a `data-actions` attribute on the clipboard. When this editor serializes
 * a button (copy, cut, drag), it adds `data-actions-key`: a checksum of the actions JSON keyed
 * with a random secret of this session. parseHTML keeps the actions only when that key matches;
 * external HTML (or a copy from another tab or session) pastes a button without actions.
 */
const SESSION_SECRET = (() => {
  const bytes = new Uint8Array(16)
  try {
    crypto.getRandomValues(bytes)
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
})()

/** cyrb53 — a fast 53-bit string hash (not a MAC on its own; the secret prefix makes it one here). */
function cyrb53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The copy marker of an actions JSON string in this session. */
function actionsKey(json: string): string {
  const msg = `${SESSION_SECRET}\n${json}`
  return `${cyrb53(msg, 0x5eed)}.${cyrb53(msg, 0x0b7e)}`
}

function parseActionsAttr(el: HTMLElement): ButtonAction[] {
  const raw = el.getAttribute('data-actions')
  if (!raw) return []
  // not copied from this editor in this session: keep the button, drop what it would do
  if (el.getAttribute('data-actions-key') !== actionsKey(raw)) return []
  try {
    return normalizeActions(JSON.parse(raw), { freshIds: true })
  } catch {
    return []
  }
}

/**
 * The same doc without button actions (webhook URLs, database ids …): for anything that leaves
 * the workspace — HTML export, share links. Returns the input when there is no button inside.
 */
export function stripButtonActions(doc: JSONContent): JSONContent {
  const walk = (n: JSONContent): JSONContent => {
    let out = n
    if (n.type === 'button' && Array.isArray(n.attrs?.actions) && n.attrs.actions.length) out = { ...n, attrs: { ...n.attrs, actions: [] } }
    if (out.content) {
      const kids = out.content.map(walk)
      if (kids.some((k, i) => k !== out.content![i])) out = { ...out, content: kids }
    }
    return out
  }
  return walk(doc)
}

/** Click the control of the node-selected button (keyboard path: ⌘↵ runs, ⇧↵ configures). */
function clickSelected(view: import('@tiptap/pm/view').EditorView, selector: string): boolean {
  const sel = view.state.selection
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'button') return false
  const el = (view.nodeDOM(sel.from) as HTMLElement | null)?.querySelector<HTMLButtonElement>(selector)
  if (!el || el.disabled) return false
  el.click()
  return true
}

export const ButtonNode = Node.create({
  name: 'button',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent?.trim() ?? '',
        renderHTML: (a) => ({ 'data-label': str(a.label) }),
      },
      variant: {
        default: 'signal',
        parseHTML: (el) => asVariant(el.getAttribute('data-variant')),
        renderHTML: (a) => ({ 'data-variant': asVariant(a.variant) }),
      },
      actions: {
        default: [],
        parseHTML: (el) => parseActionsAttr(el),
        renderHTML: (a) => {
          if (!Array.isArray(a.actions) || !a.actions.length) return {}
          const json = JSON.stringify(a.actions)
          return { 'data-actions': json, 'data-actions-key': actionsKey(json) }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="button"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const variant = asVariant(node.attrs.variant)
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'button', class: `one-button one-button--${variant}` }),
      ['button', { type: 'button', class: 'one-button__key', disabled: 'disabled' }, str(node.attrs.label) || 'Button'],
    ]
  },
  renderText({ node }) {
    return `[${str(node.attrs.label) || 'Button'}]`
  },
  renderMarkdown(node) {
    return `[${escapeMarkdownText(str(node.attrs?.label) || 'Button')}]`
  },
})

/**
 * Keyboard path for a node-selected button (live editor only): ⌘↵ / Ctrl+↵ runs it, ⇧↵ opens
 * its configuration. Plain ↵ / Space do not run a merely selected button — arrowing through a
 * page and pressing ↵ must never fire a webhook by accident; they still run the key itself when
 * it has focus (native <button>). A separate extension so it can run before the core Enter
 * handling without moving the node itself up in the schema order (the first block type is the
 * default fill).
 */
export const ButtonKeys = Extension.create({
  name: 'buttonKeys',
  // before BlockSelection (1050), which turns ↵ on a selected block into "continue below"
  priority: 1060,
  addKeyboardShortcuts() {
    const view = () => this.editor.view
    return {
      'Mod-Enter': () => clickSelected(view(), '.ob-key'),
      'Shift-Enter': () => clickSelected(view(), '.ob-edit'),
    }
  },
})
