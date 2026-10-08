/**
 * Code block view: a bar (language, lines or the JSON check, line numbers, soft wrap, copy) over the code. Line
 * numbers and the current line are widget decorations (extensions/codeLines.ts); this view only says whether
 * they show. Line numbers and wrap are view choices — per device, per block id (localStorage `one.code.blocks`),
 * never in the document: the stored node stays { language }. Numbers show by default from 4 lines on.
 */
import { useMemo, useState, useSyncExternalStore } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Check, ChevronDown, Copy, ListOrdered, WrapText } from 'lucide-react'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { jsonError } from '../../ui/code/tokenizers/json'
import '../../ui/code/syntax.css'
import { useT } from '../../i18n'
import { codeLanguages, languageId, languageLabel, onCodeLanguages } from '../lib/codeLanguages'

export { languageLabel } from '../lib/codeLanguages'

/* ------------------------------------------------------------------ per-device view choices */

const VIEW_KEY = 'one.code.blocks'
const VIEW_MAX = 300
type BlockView = { ln?: boolean; wrap?: boolean }
let views: Record<string, BlockView> | null = null
const viewListeners = new Set<() => void>()

function readViews(): Record<string, BlockView> {
  if (views) return views
  try {
    const v = JSON.parse(safeLocalGet(VIEW_KEY) ?? '{}') as unknown
    views = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, BlockView>) : {}
  } catch {
    views = {}
  }
  return views
}

function setView(id: string, patch: BlockView) {
  const all = { ...readViews() }
  // the newest choice last; the oldest go first when the list is full
  const next = { ...all[id], ...patch }
  delete all[id]
  all[id] = next
  const keys = Object.keys(all)
  for (const k of keys.slice(0, Math.max(0, keys.length - VIEW_MAX))) delete all[k]
  views = all
  safeLocalSet(VIEW_KEY, JSON.stringify(all))
  for (const fn of viewListeners) fn()
}

const subscribeViews = (fn: () => void) => {
  viewListeners.add(fn)
  return () => viewListeners.delete(fn)
}

/* ------------------------------------------------------------------ the view */

export function CodeBlockView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const t = useT()
  const menu = useMenu()
  const [copied, setCopied] = useState(false)
  const langs = useSyncExternalStore(onCodeLanguages, codeLanguages)
  const all = useSyncExternalStore(subscribeViews, readViews)
  const lang = (node.attrs.language as string | null) ?? ''
  const current = languageId(lang)
  const text = node.textContent
  const lines = text.split('\n').length
  const blockId = (node.attrs.id as string | null) ?? null
  const own = blockId ? all[blockId] : undefined
  const ln = own?.ln ?? lines > 3
  const wrap = own?.wrap ?? false
  const json = useMemo(() => (current === 'json' ? jsonError(text) : null), [current, text])
  const label = languageLabel(lang, t('editor.code.plain'))

  const entries = useMemo<MenuEntry[]>(
    () => [
      ...langs.map(({ id, label }) => ({
        label: id ? label : t('editor.code.plain'),
        keywords: id,
        checked: id === current,
        onSelect: () => {
          updateAttributes({ language: id || null })
          editor.commands.focus()
        },
      })),
      { kind: 'separator' as const },
      {
        label: t('editor.code.toMermaid'),
        keywords: 'mermaid diagram',
        onSelect: () => {
          const pos = getPos()
          if (typeof pos !== 'number') return
          editor
            .chain()
            .focus()
            .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: 'mermaid', attrs: { code: node.textContent } })
            .run()
        },
      },
    ],
    [langs, current, t, updateAttributes, editor, getPos, node],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  /** the caret onto the JSON error */
  const toError = () => {
    const pos = getPos()
    if (!json || typeof pos !== 'number' || !editor.isEditable) return
    editor.chain().focus().setTextSelection({ from: pos + 1 + json.start, to: pos + 1 + Math.max(json.start, json.end) }).scrollIntoView().run()
  }

  const toggle = (patch: BlockView) => blockId && setView(blockId, patch)

  return (
    <NodeViewWrapper className="code-block" data-language={current || 'plain'} data-ln={ln ? 'on' : 'off'} data-wrap={wrap ? 'on' : 'off'} style={{ ['--code-digits' as string]: Math.max(2, String(lines).length) }}>
      <div className="code-block__bar" contentEditable={false}>
        <button
          type="button"
          className="code-block__lang"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => editor.isEditable && menu.toggle(e)}
          aria-haspopup="menu"
          aria-label={t('editor.code.language', { name: label })}
          disabled={!editor.isEditable}
        >
          {label}
          {editor.isEditable && <ChevronDown size={12} aria-hidden />}
        </button>
        {json ? (
          <button type="button" className="code-block__check code-block__check--bad" onMouseDown={(e) => e.preventDefault()} onClick={toError} title={t(`ui.code.json.${json.code}`, { found: json.found.slice(0, 24) })} data-testid="code-json-check">
            <span className="led code-block__led--bad" aria-hidden />
            <span className="code-block__check-text">{t('editor.code.jsonError', { line: json.line, col: json.col, msg: t(`ui.code.json.${json.code}`, { found: json.found.slice(0, 24) }) })}</span>
          </button>
        ) : current === 'json' && text.trim() ? (
          <span className="code-block__check" data-testid="code-json-check">
            <span className="led led--ok" aria-hidden />
            {t('ui.code.json.valid')}
          </span>
        ) : (
          <span className="code-block__lines">{t('editor.code.lines', { count: lines })}</span>
        )}
        <span className="code-block__spacer" />
        <button
          type="button"
          className="code-block__tool"
          aria-pressed={ln}
          aria-label={t('ui.code.lineNumbers')}
          title={t('ui.code.lineNumbers')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggle({ ln: !ln })}
          disabled={!blockId}
        >
          <ListOrdered size={14} strokeWidth={1.7} aria-hidden />
        </button>
        <button
          type="button"
          className="code-block__tool"
          aria-pressed={wrap}
          aria-label={t('ui.code.wrap')}
          title={t('ui.code.wrap')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggle({ wrap: !wrap })}
          disabled={!blockId}
        >
          <WrapText size={14} strokeWidth={1.7} aria-hidden />
        </button>
        <button type="button" className="code-block__copy" onMouseDown={(e) => e.preventDefault()} onClick={copy}>
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          <span>{copied ? t('editor.code.copied') : t('editor.code.copy')}</span>
        </button>
        <span className="visually-hidden" role="status">
          {copied ? t('editor.code.copiedLive') : ''}
        </span>
      </div>
      <pre spellCheck={false}>
        {/* NodeViewContent sets white-space: pre-wrap inline; the block decides (wrap off = one row per line) */}
        <NodeViewContent<'code'> as="code" className={current ? `hljs language-${current}` : 'hljs'} style={{ whiteSpace: 'inherit' }} />
      </pre>
      <Menu {...menu.props} entries={entries} searchable searchPlaceholder={t('editor.code.searchLang')} width={220} />
    </NodeViewWrapper>
  )
}
