/**
 * AIMenu — the Claude panel the editor opens for a selection ("Ask AI") or at the cursor
 * block (space on an empty line / slash command). One input line on top (prompt or filter),
 * a keyboard-driven list below (actions → live output → result actions).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor, JSONContent } from '@tiptap/core'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { VirtualElement } from '@floating-ui/react'
import {
  AlignLeft,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRightToLine,
  BookOpenText,
  Check,
  Copy,
  CornerDownLeft,
  KeyRound,
  Languages,
  Lightbulb,
  ListChecks,
  ListTree,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  PenLine,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SpellCheck,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { Kbd } from '../../ui/controls'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { docToMarkdown, markdownToDoc } from '../../editor'
import { AI_MODELS, AIError, resolveModel, runAI, stripFence, verifyKey, type AIAction } from './client'
import { askWorkspace, citationsToLinks, findSource, type WorkspaceSource } from './workspace'
import { MarkdownLite } from './MarkdownLite'
import { snapshotNow } from '../history/snapshots'
import './ai.css'

export interface AIMenuProps {
  editor: Editor
  pageId: string
  /** 'selection' = act on selected text; 'block' = free prompt at cursor ("Ask AI" / space on empty line) */
  mode: 'selection' | 'block'
  onClose: () => void
}

/* ------------------------------------------------------------------ */
/* Target capture                                                      */
/* ------------------------------------------------------------------ */

interface Target {
  mode: 'selection' | 'block'
  from: number
  to: number
  /** selection as Markdown (selection mode) */
  selected: string
  /** selection lies inside one textblock → inline replace */
  inlineOnly: boolean
  blockFrom: number
  blockTo: number
  blockEmpty: boolean
  /** document text before the cursor (for "continue") */
  before: string
}

function sliceToMarkdown(state: EditorState, from: number, to: number): string {
  try {
    const slice = state.doc.slice(from, to)
    const json = slice.content.toJSON() as JSONContent[] | null
    if (!json?.length) return ''
    const first = slice.content.firstChild
    const doc: JSONContent = first?.isInline ? { type: 'doc', content: [{ type: 'paragraph', content: json }] } : { type: 'doc', content: json }
    const md = docToMarkdown(doc).trim()
    if (md) return md
  } catch {
    /* fall through */
  }
  return state.doc.textBetween(from, to, '\n\n', ' ')
}

function captureTarget(editor: Editor, wanted: 'selection' | 'block'): Target {
  const { state } = editor
  const { from, to, empty } = state.selection
  const mode = wanted === 'selection' && !empty ? 'selection' : 'block'
  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  const top = $from.depth >= 1
  const blockFrom = top ? $from.before(1) : from
  const blockTo = $to.depth >= 1 ? $to.after(1) : to
  const blockNode = top ? $from.node(1) : null
  const blockEmpty = !!blockNode && blockNode.isTextblock && blockNode.content.size === 0
  return {
    mode,
    from,
    to,
    selected: mode === 'selection' ? sliceToMarkdown(state, from, to) : '',
    inlineOnly: $from.sameParent($to) && $from.parent.isTextblock,
    blockFrom,
    blockTo,
    blockEmpty,
    before: state.doc.textBetween(0, from, '\n\n', ' ').slice(-12000),
  }
}

function makeAnchor(editor: Editor, target: Target): VirtualElement {
  return {
    contextElement: editor.view.dom,
    getBoundingClientRect() {
      const view = editor.view
      if (editor.isDestroyed) return new DOMRect(0, 0, 0, 0)
      const dom = view.dom.getBoundingClientRect()
      try {
        if (target.mode === 'selection') {
          const a = view.coordsAtPos(target.from, 1)
          const b = view.coordsAtPos(target.to, -1)
          const left = a.top === b.top ? a.left : dom.left
          return new DOMRect(Math.max(dom.left, left), a.top, 1, b.bottom - a.top)
        }
        const node = view.nodeDOM(target.blockFrom) as HTMLElement | null
        const r = node?.getBoundingClientRect?.() ?? view.coordsAtPos(target.from)
        const left = Math.max(dom.left, 'left' in r ? r.left : dom.left)
        // Empty line: cover it (panel replaces the line); otherwise sit below the block.
        return target.blockEmpty ? new DOMRect(left, r.top - 6, 1, 0) : new DOMRect(left, r.top, 1, r.bottom - r.top)
      } catch {
        return new DOMRect(dom.left, dom.top, 1, 0)
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

interface ActionDef {
  id: string
  label: string
  code: string
  icon: LucideIcon
  group: string
  run: () => void
  keywords?: string
}

interface LangDef {
  code: string
  native: string
  english: string
}

const LANGS: LangDef[] = [
  { code: 'EN', native: 'English', english: 'English' },
  { code: 'DE', native: 'Deutsch', english: 'German' },
  { code: 'FR', native: 'Français', english: 'French' },
  { code: 'ES', native: 'Español', english: 'Spanish' },
  { code: 'IT', native: 'Italiano', english: 'Italian' },
  { code: 'PT', native: 'Português', english: 'Portuguese' },
  { code: 'NL', native: 'Nederlands', english: 'Dutch' },
  { code: 'PL', native: 'Polski', english: 'Polish' },
  { code: 'TR', native: 'Türkçe', english: 'Turkish' },
  { code: 'UK', native: 'Українська', english: 'Ukrainian' },
  { code: 'JA', native: '日本語', english: 'Japanese' },
  { code: 'ZH', native: '中文', english: 'Chinese (Simplified)' },
  { code: 'KO', native: '한국어', english: 'Korean' },
]

type Request =
  | { kind: 'action'; action: AIAction; label: string; code: string; instruction?: string; input?: string; refine?: boolean }
  | { kind: 'workspace'; question: string; label: string; code: string }

type Phase = 'idle' | 'streaming' | 'done' | 'error'

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AIMenu({ editor, pageId, mode, onClose }: AIMenuProps) {
  const t = useT()
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const model = resolveModel(useWorkspace((s) => s.settings.aiModel))
  const updateSettings = useWorkspace((s) => s.updateSettings)

  // The target range is captured once and then mapped through every later edit, so the
  // result always lands where the user asked for it — even if they keep typing meanwhile.
  const [target] = useState(() => captureTarget(editor, mode))
  const [targetRev, setTargetRev] = useState(0)
  const anchor = useMemo(() => makeAnchor(editor, target), [editor, target])
  useEffect(() => {
    const onTx = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return
      const m = transaction.mapping
      const from = m.map(target.from, 1)
      const to = Math.max(from, m.map(target.to, -1))
      target.from = from
      target.to = to
      target.blockFrom = m.map(target.blockFrom, 1)
      target.blockTo = Math.max(target.blockFrom, m.map(target.blockTo, -1))
      setTargetRev((r) => r + 1)
    }
    editor.on('transaction', onTx)
    return () => {
      editor.off('transaction', onTx)
    }
  }, [editor, target])

  const [setup, setSetup] = useState(!hasKey)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'actions' | 'translate'>('actions')
  const [wsMode, setWsMode] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<AIError | null>(null)
  const [sources, setSources] = useState<WorkspaceSource[]>([])
  const [run, setRun] = useState<{ req: Request; started: number; ended?: number } | null>(null)
  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const outRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bufRef = useRef('')
  const rafRef = useRef(0)
  const stickRef = useRef(true)

  useEffect(
    () => () => {
      abortRef.current?.abort()
      cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const pageContext = useCallback(() => {
    const p = useWorkspace.getState().pages[pageId]
    return p ? `${p.title.trim() ? `# ${p.title.trim()}\n\n` : ''}${p.plain ?? ''}` : ''
  }, [pageId])

  /* ---------------- running ---------------- */

  const start = useCallback(
    async (req: Request) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      bufRef.current = ''
      stickRef.current = true
      setRun({ req, started: performance.now() })
      setPhase('streaming')
      setOutput('')
      setError(null)
      setSources([])
      setQuery('')
      setActive(0)
      const onToken = (delta: string) => {
        bufRef.current += delta
        if (!rafRef.current)
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0
            if (!ac.signal.aborted) setOutput(bufRef.current)
          })
      }
      try {
        let text: string
        if (req.kind === 'workspace') {
          const res = await askWorkspace({ question: req.question, onToken, signal: ac.signal, onSources: setSources })
          text = res.text
        } else {
          const p = useWorkspace.getState().pages[pageId]
          const isContinue = req.action === 'continue'
          text = await runAI({
            action: req.action,
            input: req.input ?? (isContinue ? target.before : target.selected),
            instruction: req.instruction,
            context: isContinue ? (p?.title ? `# ${p.title}` : '') : pageContext(),
            onToken,
            signal: ac.signal,
          })
        }
        if (ac.signal.aborted) return
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
        setOutput(stripFence(text))
        setPhase('done')
        setRun((r) => (r ? { ...r, ended: performance.now() } : r))
      } catch (e) {
        if (ac.signal.aborted) return
        const err = e instanceof AIError ? e : new AIError('unknown', String(e))
        if (err.code === 'aborted') return
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
        setOutput(bufRef.current)
        setError(err)
        setPhase('error')
        setRun((r) => (r ? { ...r, ended: performance.now() } : r))
        if (err.code === 'no_key') setSetup(true)
      }
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    },
    [pageId, pageContext, target],
  )

  const stop = () => {
    abortRef.current?.abort()
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    const partial = bufRef.current
    setOutput(stripFence(partial))
    setPhase(partial.trim() ? 'done' : 'idle')
    setRun((r) => (r ? { ...r, ended: performance.now() } : r))
    inputRef.current?.focus({ preventScroll: true })
  }

  const retry = () => run && start(run.req)

  /* ---------------- applying ---------------- */

  const resultMarkdown = () => (run?.req.kind === 'workspace' ? citationsToLinks(output, sources) : output)

  const resultBlocks = (): JSONContent[] => {
    const doc = markdownToDoc(resultMarkdown())
    return (doc.content ?? []).filter(Boolean)
  }

  /** The cursor block may have been typed into meanwhile: it is only filled while still empty. */
  const targetBlockEmpty = () => {
    if (!target.blockEmpty || editor.isDestroyed) return false
    const { doc } = editor.state
    const block = target.blockFrom <= doc.content.size ? doc.nodeAt(target.blockFrom) : null
    return !!block && block.isTextblock && block.content.size === 0 && target.blockTo - target.blockFrom === block.nodeSize
  }

  const apply = async (how: 'replace' | 'below' | 'insert') => {
    if (editor.isDestroyed || !output.trim()) return
    const blocks = resultBlocks()
    if (!blocks.length) return
    await snapshotNow(pageId, 'ai')
    if (editor.isDestroyed) return
    const size = editor.state.doc.content.size
    const clamp = (n: number) => Math.max(0, Math.min(n, size))
    const chain = editor.chain().focus()
    const blockStillEmpty = targetBlockEmpty()
    if (how === 'replace' && target.mode === 'selection' && target.to > target.from) {
      const range = { from: clamp(target.from), to: clamp(target.to) }
      const single = blocks.length === 1 && blocks[0].type === 'paragraph'
      chain.insertContentAt(range, single && target.inlineOnly ? (blocks[0].content ?? []) : blocks).run()
    } else if (how === 'insert' && target.blockEmpty && blockStillEmpty) {
      chain.insertContentAt({ from: clamp(target.blockFrom), to: clamp(target.blockTo) }, blocks).run()
    } else {
      chain.insertContentAt(clamp(target.blockTo), blocks).run()
    }
    onClose()
  }

  /** Close and hand the caret (or the original selection) back to the editor, so typing continues. */
  const dismiss = useCallback(() => {
    if (!editor.isDestroyed) {
      try {
        const size = editor.state.doc.content.size
        const from = Math.max(0, Math.min(target.from, size))
        const to = Math.max(from, Math.min(target.mode === 'selection' ? target.to : target.from, size))
        const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to))
        editor.view.dispatch(tr.setMeta('addToHistory', false))
      } catch {
        /* keep whatever selection the editor has */
      }
      editor.view.focus()
    }
    onClose()
  }, [editor, target, onClose])

  // Esc closes with focus back in the editor; a click elsewhere closes and leaves focus where it went.
  const pointerAt = useRef(0)
  useEffect(() => {
    const mark = () => (pointerAt.current = performance.now())
    window.addEventListener('pointerdown', mark, true)
    return () => window.removeEventListener('pointerdown', mark, true)
  }, [])
  const onPopoverClose = () => (performance.now() - pointerAt.current < 120 ? onClose() : dismiss())

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(resultMarkdown())
      useUI.getState().toast({ message: t('common.copied'), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t('features.ai.copyFailed'), kind: 'error' })
    }
  }

  /* ---------------- lists ---------------- */

  const actions: ActionDef[] = useMemo(() => {
    const A = (id: AIAction, label: string, code: string, icon: LucideIcon, group: string, keywords = ''): ActionDef => ({
      id,
      label,
      code,
      icon,
      group,
      keywords,
      run: () => start({ kind: 'action', action: id, label, code }),
    })
    const prefill = (id: string, label: string, code: string, icon: LucideIcon, group: string, text: string): ActionDef => ({
      id,
      label,
      code,
      icon,
      group,
      run: () => {
        setQuery(text)
        requestAnimationFrame(() => inputRef.current?.focus())
      },
    })
    const translate: ActionDef = {
      id: 'translate',
      label: t('features.ai.act.translate'),
      code: 'TRN',
      icon: Languages,
      group: t('features.ai.group.edit'),
      keywords: 'translate übersetzen language sprache',
      run: () => {
        setView('translate')
        setQuery('')
        setActive(0)
      },
    }
    const gEdit = t('features.ai.group.edit')
    const gRead = t('features.ai.group.understand')
    const gWrite = t('features.ai.group.write')
    const gPage = t('features.ai.group.page')
    const gWs = t('features.ai.group.workspace')
    if (target.mode === 'selection')
      return [
        A('improve', t('features.ai.act.improve'), 'IMP', PenLine, gEdit, 'better rewrite verbessern'),
        A('fix', t('features.ai.act.fix'), 'FIX', SpellCheck, gEdit, 'spelling grammar rechtschreibung grammatik'),
        A('shorter', t('features.ai.act.shorter'), 'SHR', Minimize2, gEdit, 'short kürzer'),
        A('longer', t('features.ai.act.longer'), 'LNG', Maximize2, gEdit, 'long länger expand'),
        translate,
        A('explain', t('features.ai.act.explain'), 'EXP', MessageCircleQuestion, gRead, 'explain erklären'),
        A('summarize', t('features.ai.act.summarize'), 'SUM', AlignLeft, gRead, 'summary zusammenfassen tldr'),
        A('action_items', t('features.ai.act.actionItems'), 'ACT', ListChecks, gRead, 'todo tasks aufgaben'),
      ]
    return [
      A('continue', t('features.ai.act.continue'), 'CNT', ArrowRightToLine, gWrite, 'continue weiter'),
      prefill('outline', t('features.ai.act.outline'), 'OUT', ListTree, gWrite, t('features.ai.prefill.outline')),
      prefill('brainstorm', t('features.ai.act.brainstorm'), 'IDEA', Lightbulb, gWrite, t('features.ai.prefill.brainstorm')),
      A('summarize', t('features.ai.act.summarizePage'), 'SUM', AlignLeft, gPage, 'summary zusammenfassen tldr'),
      A('action_items', t('features.ai.act.actionItemsPage'), 'ACT', ListChecks, gPage, 'todo tasks aufgaben'),
      {
        id: 'workspace',
        label: t('features.ai.act.workspace'),
        code: 'WKS',
        icon: BookOpenText,
        group: gWs,
        keywords: 'ask question frage workspace search suchen',
        run: () => {
          setWsMode(true)
          setActive(0)
          requestAnimationFrame(() => inputRef.current?.focus())
        },
      },
    ]
  }, [t, target.mode, start])

  type Row = { id: string; label: ReactNode; code?: string; icon?: LucideIcon; group?: string; run: () => void; hint?: ReactNode; danger?: boolean }

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (setup) return []
    if (phase === 'streaming') return []
    if (phase === 'done' || phase === 'error') {
      if (q)
        return [
          {
            id: 'refine',
            label: (
              <>
                {t('features.ai.refine')} <span className="ai-quote">“{query.trim()}”</span>
              </>
            ),
            code: 'REF',
            icon: CornerDownLeft,
            run: () =>
              start({
                kind: 'action',
                action: 'custom',
                label: t('features.ai.refineLabel'),
                code: 'REF',
                instruction: query.trim(),
                input: output || target.selected,
                refine: true,
              }),
          },
        ]
      const out: Row[] = []
      if (phase === 'done') {
        const ws = run?.req.kind === 'workspace'
        if (target.mode === 'selection' && !ws) out.push({ id: 'replace', label: t('features.ai.res.replace'), icon: Check, run: () => void apply('replace'), hint: <Kbd>↵</Kbd> })
        out.push({
          id: 'insert',
          label: target.mode === 'selection' || ws || !targetBlockEmpty() ? t('features.ai.res.below') : t('features.ai.res.insert'),
          icon: ArrowDownToLine,
          run: () => void apply(target.mode === 'selection' || ws ? 'below' : 'insert'),
          hint: target.mode === 'selection' && !ws ? undefined : <Kbd>↵</Kbd>,
        })
        out.push({ id: 'copy', label: t('features.ai.res.copy'), icon: Copy, run: () => void copy() })
      }
      out.push({ id: 'retry', label: t('features.ai.res.retry'), icon: RotateCcw, run: retry })
      if (error && (error.code === 'invalid_key' || error.code === 'permission' || error.code === 'no_key'))
        out.push({ id: 'key', label: t('features.ai.res.changeKey'), icon: KeyRound, run: () => setSetup(true) })
      out.push({ id: 'discard', label: t('features.ai.res.discard'), icon: Trash2, run: dismiss, hint: <Kbd>esc</Kbd>, danger: true })
      return out
    }
    if (wsMode) {
      if (!q) return []
      return [
        {
          id: 'ask-ws',
          label: (
            <>
              {t('features.ai.askWs')} <span className="ai-quote">“{query.trim()}”</span>
            </>
          ),
          code: 'WKS',
          icon: BookOpenText,
          run: () => start({ kind: 'workspace', question: query.trim(), label: t('features.ai.act.workspace'), code: 'WKS' }),
        },
      ]
    }
    if (view === 'translate') {
      const langs = LANGS.filter((l) => !q || l.native.toLowerCase().includes(q) || l.english.toLowerCase().includes(q) || l.code.toLowerCase() === q)
      return langs.map((l) => ({
        id: `lang-${l.code}`,
        label: l.native,
        code: l.code,
        group: t('features.ai.translateTo'),
        run: () =>
          start({ kind: 'action', action: 'translate', label: `${t('features.ai.act.translate')} → ${l.native}`, code: 'TRN', instruction: l.english }),
      }))
    }
    const matched = q
      ? actions.filter((a) => a.label.toLowerCase().includes(q) || a.code.toLowerCase().startsWith(q) || a.keywords?.toLowerCase().includes(q))
      : actions
    const custom: Row | null = q
      ? {
          id: 'custom',
          label: (
            <>
              {t('features.ai.askClaude')} <span className="ai-quote">“{query.trim()}”</span>
            </>
          ),
          code: 'ASK',
          icon: CornerDownLeft,
          run: () => start({ kind: 'action', action: 'custom', label: t('features.ai.custom'), code: 'ASK', instruction: query.trim() }),
        }
      : null
    const list: Row[] = matched.map((a) => ({ ...a }))
    if (custom) {
      if (matched.length) list.push(custom)
      else list.unshift(custom)
    }
    return list
  }, [query, setup, phase, wsMode, view, actions, t, start, output, target, targetRev, run, error, dismiss, sources]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, rows.length - 1)))
  }, [rows.length])

  useEffect(() => {
    setActive(0)
  }, [query, view, wsMode])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // keep the live output scrolled to the newest line unless the reader scrolled up
  useLayoutEffect(() => {
    const el = outRef.current
    if (el && phase === 'streaming' && stickRef.current) el.scrollTop = el.scrollHeight
  }, [output, phase])

  /* ---------------- keyboard ---------------- */

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a + d + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (phase === 'streaming') return
      rows[active]?.run()
    } else if (e.key === 'Backspace' && !query) {
      if (view === 'translate') {
        e.preventDefault()
        setView('actions')
      } else if (wsMode && phase === 'idle') {
        e.preventDefault()
        setWsMode(false)
      }
    }
  }

  /* ---------------- render ---------------- */

  const cycleModel = () => {
    const i = AI_MODELS.findIndex((m) => m.id === model.id)
    updateSettings({ aiModel: AI_MODELS[(i + 1) % AI_MODELS.length].id })
    // keep the keyboard flow in the prompt: Enter must run the action, not cycle again
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  const placeholder =
    phase === 'done' || phase === 'error'
      ? t('features.ai.placeholder.refine')
      : wsMode
        ? t('features.ai.placeholder.workspace')
        : view === 'translate'
          ? t('features.ai.placeholder.language')
          : target.mode === 'selection'
            ? t('features.ai.placeholder.selection')
            : t('features.ai.placeholder.block')

  const busy = phase === 'streaming'
  const showOutput = phase !== 'idle' && !setup
  const words = output.trim() ? output.trim().split(/\s+/).length : 0

  let lastGroup: string | undefined
  return (
    <>
      {target.mode === 'selection' && <SelectionShade editor={editor} from={target.from} to={target.to} />}
      <Popover
        open
        anchor={anchor}
        onClose={onPopoverClose}
        placement="bottom-start"
        offset={8}
        bare
        className="ai-panel"
        closeOnOutside={phase === 'idle' || setup}
        role="dialog"
        aria-label={t('features.ai.title')}
      >
        {setup ? (
          <KeySetup
            reason={error?.code === 'invalid_key' ? 'invalid' : hasKey ? 'change' : 'missing'}
            onDone={() => {
              setSetup(false)
              setError(null)
              if (phase === 'error' && run) void start(run.req)
              else setPhase('idle')
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
            onCancel={hasKey ? () => setSetup(false) : dismiss}
          />
        ) : (
          <>
            <div className="ai-cmd" data-busy={busy || undefined}>
              <span className={`led ${busy ? 'led--on ai-led--live' : phase === 'error' ? 'ai-led--err' : 'led--on'}`} aria-hidden />
              {wsMode && phase === 'idle' && (
                <button className="ai-chip" onClick={() => setWsMode(false)} title={t('features.ai.leaveWs')}>
                  {t('features.ai.wsChip')} ×
                </button>
              )}
              {view === 'translate' && phase === 'idle' && (
                <button className="ai-chip" onClick={() => setView('actions')}>
                  <ArrowLeft size={11} strokeWidth={2} /> {t('features.ai.translateTo')}
                </button>
              )}
              <input
                ref={inputRef}
                className="ai-cmd__input"
                data-autofocus=""
                value={query}
                disabled={busy}
                placeholder={busy ? t('features.ai.placeholder.busy') : placeholder}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label={placeholder}
                aria-activedescendant={rows[active] ? `ai-row-${rows[active].id}` : undefined}
                spellCheck={false}
                autoComplete="off"
              />
              <button className="ai-model" onClick={cycleModel} disabled={busy} title={t('features.ai.switchModel')}>
                CLAUDE · {model.short}
              </button>
            </div>

            {showOutput && (
              <div className="ai-out" data-phase={phase}>
                <div className="ai-out__bar label">
                  <span className="ai-out__code">{run?.req.code}</span>
                  <span className="ai-out__title">{run?.req.label}</span>
                  <span className="ai-out__spacer" />
                  {run && <Elapsed start={run.started} end={run.ended} />}
                  <span className="ai-out__sep">·</span>
                  <span>{t('features.ai.words', { count: words })}</span>
                  {busy && (
                    <button className="ai-stop" onClick={stop}>
                      <Square size={9} fill="currentColor" strokeWidth={0} /> {t('features.ai.stop')}
                    </button>
                  )}
                </div>
                {(output || busy) && (
                  <div
                    className="ai-out__body"
                    ref={outRef}
                    onScroll={(e) => {
                      const el = e.currentTarget
                      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
                    }}
                  >
                    {output ? (
                      <MarkdownLite
                        source={output}
                        resolveCitation={
                          run?.req.kind === 'workspace'
                            ? (title) => {
                                const s = findSource(title, sources) ?? findPageByTitle(title)
                                return s ? { title: s.title, href: `#/p/${s.id}` } : undefined
                              }
                            : undefined
                        }
                      />
                    ) : (
                      <div className="ai-wait label">
                        {run?.req.kind === 'workspace' ? t('features.ai.searching', { count: sources.length }) : t('features.ai.thinking')}
                        <span className="ai-wait__dots" aria-hidden />
                      </div>
                    )}
                  </div>
                )}
                {run?.req.kind === 'workspace' && sources.length > 0 && (
                  <div className="ai-sources">
                    <span className="label">{t('features.ai.sources')}</span>
                    {sources.map((s) => (
                      <a
                        key={s.id}
                        className="ai-source"
                        href={`#/p/${s.id}`}
                        data-cited={new RegExp(`\\[\\[\\s*${escapeRe(s.title)}\\s*\\]\\]`, 'i').test(output) || undefined}
                      >
                        {s.title}
                      </a>
                    ))}
                  </div>
                )}
                {error && <ErrorNote error={error} model={model.name} />}
              </div>
            )}

            {rows.length > 0 && (
              <div className="ai-list" ref={listRef} role="listbox">
                {rows.map((r, i) => {
                  const header = r.group && r.group !== lastGroup ? r.group : null
                  lastGroup = r.group
                  const Icon = r.icon
                  return (
                    <div key={r.id}>
                      {header && <div className="ai-list__group label">{header}</div>}
                      <button
                        id={`ai-row-${r.id}`}
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        data-index={i}
                        data-active={i === active}
                        className={`ai-row${r.danger ? ' ai-row--danger' : ''}`}
                        onMouseMove={() => i !== active && setActive(i)}
                        onClick={() => r.run()}
                      >
                        <span className="ai-row__icon">{Icon ? <Icon size={15} strokeWidth={1.7} /> : null}</span>
                        <span className="ai-row__label">{r.label}</span>
                        {r.hint}
                        {r.code && <span className="ai-row__code">{r.code}</span>}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {phase === 'idle' && wsMode && !query.trim() && <div className="ai-hint">{t('features.ai.wsHint')}</div>}

            <div className="ai-foot">
              <span>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> {t('features.ai.kbd.nav')}
              </span>
              <span>
                <Kbd>↵</Kbd> {phase === 'done' && !query ? t('features.ai.kbd.apply') : t('features.ai.kbd.run')}
              </span>
              <span>
                <Kbd>esc</Kbd> {t('features.ai.kbd.close')}
              </span>
              <span className="ai-foot__spacer" />
              <button className="ai-foot__key" onClick={() => setSetup(true)} title={t('features.ai.res.changeKey')}>
                <Settings2 size={12} strokeWidth={1.7} /> BYOK
              </button>
            </div>
          </>
        )}
      </Popover>
    </>
  )
}

function findPageByTitle(title: string): WorkspaceSource | undefined {
  const t = title.trim().toLowerCase()
  const p = Object.values(useWorkspace.getState().pages).find((x) => !x.trashed && x.title.trim().toLowerCase() === t)
  return p ? { id: p.id, title: p.title.trim() } : undefined
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Elapsed({ start, end }: { start: number; end?: number }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (end) return
    const id = window.setInterval(() => setNow(performance.now()), 100)
    return () => window.clearInterval(id)
  }, [end])
  const ms = Math.max(0, (end ?? now) - start)
  const s = Math.floor(ms / 1000)
  return (
    <span className="ai-elapsed">
      {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}.{Math.floor((ms % 1000) / 100)}
    </span>
  )
}

function ErrorNote({ error, model }: { error: AIError; model: string }) {
  const t = useT()
  const detail = error.code === 'bad_request' || error.code === 'unknown' ? (error.detail ?? '') : ''
  return (
    <div className="ai-error" role="alert">
      <span className="ai-error__code label">ERR · {error.code.toUpperCase()}</span>
      <p>{t(`features.ai.err.${error.code}`, { model, detail })}</p>
    </div>
  )
}

/** Paints the (now unfocused) editor selection so it stays visible while the panel is open. */
function SelectionShade({ editor, from, to }: { editor: Editor; from: number; to: number }) {
  const [rects, setRects] = useState<DOMRect[]>([])
  useLayoutEffect(() => {
    let raf = 0
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (editor.isDestroyed) return setRects([])
        try {
          const view = editor.view
          const a = view.domAtPos(from)
          const b = view.domAtPos(to)
          const r = document.createRange()
          r.setStart(a.node, a.offset)
          r.setEnd(b.node, b.offset)
          const all = Array.from(r.getClientRects()).filter((x) => x.width > 1 && x.height > 1)
          // keep only the innermost boxes (line boxes), not the block boxes that contain them
          const inner = all.filter((x) => !all.some((y) => y !== x && y.left >= x.left - 0.5 && y.right <= x.right + 0.5 && y.top >= x.top - 0.5 && y.bottom <= x.bottom + 0.5 && (y.width < x.width - 1 || y.height < x.height - 1)))
          setRects(inner)
        } catch {
          setRects([])
        }
      })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [editor, from, to])
  return createPortal(
    <div className="ai-shade" aria-hidden>
      {rects.map((r, i) => (
        <div key={i} style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
      ))}
    </div>,
    document.body,
  )
}

/** First-run card: paste an Anthropic key (verified without spending tokens). */
function KeySetup({ reason, onDone, onCancel }: { reason: 'missing' | 'invalid' | 'change'; onDone: () => void; onCancel: () => void }) {
  const t = useT()
  const updateSettings = useWorkspace((s) => s.updateSettings)
  const [key, setKey] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'error'>(reason === 'invalid' ? 'error' : 'idle')
  const [msg, setMsg] = useState(reason === 'invalid' ? t('features.ai.setup.rejected') : '')
  const acRef = useRef<AbortController | null>(null)
  useEffect(() => () => acRef.current?.abort(), [])

  const submit = async () => {
    const k = key.trim()
    if (!k) return
    if (!/^sk-ant-/.test(k)) {
      setState('error')
      setMsg(t('features.ai.setup.format'))
      return
    }
    setState('checking')
    setMsg('')
    acRef.current?.abort()
    const ac = new AbortController()
    acRef.current = ac
    const res = await verifyKey(k, ac.signal)
    if (ac.signal.aborted) return
    if (res === 'invalid_key' || res === 'permission') {
      setState('error')
      setMsg(t('features.ai.setup.rejected'))
      return
    }
    updateSettings({ aiApiKey: k })
    if (res !== 'ok') useUI.getState().toast({ message: t('features.ai.setup.unverified'), kind: 'info' })
    else useUI.getState().toast({ message: t('features.ai.setup.connected'), kind: 'success' })
    onDone()
  }

  return (
    <div className="ai-setup">
      <div className="ai-setup__bar label">
        <span className={`led ${state === 'checking' ? 'led--on ai-led--live' : state === 'error' ? 'ai-led--err' : ''}`} aria-hidden />
        <span>{state === 'checking' ? t('features.ai.setup.checking') : t('features.ai.setup.status')}</span>
        <span className="ai-out__spacer" />
        <span>BYOK · LOCAL</span>
      </div>
      <div className="ai-setup__body">
        <h3 className="ai-setup__title">{reason === 'change' ? t('features.ai.setup.titleChange') : t('features.ai.setup.title')}</h3>
        <p className="ai-setup__lead">{t('features.ai.setup.lead')}</p>
        <form
          className="ai-setup__form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <input
            className="input ai-setup__input"
            type="password"
            data-autofocus=""
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-api03-…"
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              if (state === 'error') setState('idle')
            }}
            aria-label={t('features.ai.setup.label')}
            aria-invalid={state === 'error' || undefined}
          />
          <button className="btn btn--primary" type="submit" disabled={!key.trim() || state === 'checking'}>
            {state === 'checking' ? t('features.ai.setup.checkingShort') : t('features.ai.setup.connect')}
          </button>
        </form>
        {msg && (
          <p className="ai-setup__msg" role="alert">
            {msg}
          </p>
        )}
        <a className="ai-setup__link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          {t('features.ai.setup.getKey')} <span className="mono">console.anthropic.com ↗</span>
        </a>
      </div>
      <div className="ai-setup__note">
        <ShieldCheck size={14} strokeWidth={1.7} />
        <span>{t('features.ai.setup.privacy')}</span>
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
