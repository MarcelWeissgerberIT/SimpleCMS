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

/** Validate a stored / pasted actions array: unknown entries are dropped, missing fields filled. */
export function normalizeActions(raw: unknown): ButtonAction[] {
  if (!Array.isArray(raw)) return []
  const out: ButtonAction[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const id = str(a.id) || actionId()
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

function parseActionsAttr(raw: string | null): ButtonAction[] {
  if (!raw) return []
  try {
    return normalizeActions(JSON.parse(raw))
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

/** Click the control of the node-selected button (keyboard path: ↵ runs, ⇧↵ configures). */
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
        parseHTML: (el) => parseActionsAttr(el.getAttribute('data-actions')),
        renderHTML: (a) => (Array.isArray(a.actions) && a.actions.length ? { 'data-actions': JSON.stringify(a.actions) } : {}),
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
 * Keyboard path for a node-selected button (live editor only): ↵ / Space run it, ⇧↵ opens its
 * configuration. A separate extension so it can run before the core Enter handling without
 * moving the node itself up in the schema order (the first block type is the default fill).
 */
export const ButtonKeys = Extension.create({
  name: 'buttonKeys',
  // before BlockSelection (1050), which turns ↵ on a selected block into "continue below"
  priority: 1060,
  addKeyboardShortcuts() {
    const view = () => this.editor.view
    return {
      Enter: () => clickSelected(view(), '.ob-key'),
      Space: () => clickSelected(view(), '.ob-key'),
      'Shift-Enter': () => clickSelected(view(), '.ob-edit'),
    }
  },
})
