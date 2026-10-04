/**
 * AIMenu — the Claude panel the editor opens for a selection ("Ask AI") or at the cursor
 * block (space on an empty line / slash command). One input line on top (prompt or filter),
 * a keyboard-driven list below (actions → live output → result actions).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor, JSONContent } from '@tiptap/core'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { ResolvedPos } from '@tiptap/pm/model'
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
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SpellCheck,
  Square,
  Trash2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { Kbd } from '../../ui/controls'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { markdownToDoc } from '../../editor'
import { toMarkdown } from '../share/markdown'
import { AI_MODELS, AIError, aiErrorText, isAIDemo, onAIDemo, resolveModel, runAI, setAIDemo, stripFence, verifyKey, type AIAction } from './client'
import { readServers } from './mcp-servers/config'
import { callLabel, type McpCall } from './mcp-servers/activity'
import { askWorkspace, citationsToLinks, findSource, type WorkspaceSource } from './workspace'
import { MarkdownLite } from './MarkdownLite'
import { snapshotNow } from '../history/snapshots'
import { openAgent } from './agent/state'
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
  /** the cursor's own textblock (an empty one gets filled with the result) */
  blockFrom: number
  blockTo: number
  blockEmpty: boolean
  /** "Insert below": right after the target block, inside the callout / column / toggle it sits in */
  after: number
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
    const md = toMarkdown(doc).trim()
    if (md) return md
  } catch {
    /* fall through */
  }
  return state.doc.textBetween(from, to, '\n\n', ' ')
}

/**
 * Nodes whose children are free-standing blocks — where a result may land as its own block.
 * Mirrors where the editor offers "Space for AI"; lists, quotes and tables count as one block.
 */
const BLOCK_CONTAINERS = new Set(['doc', 'column', 'callout', 'detailsContent'])

/** The position right after the block holding `$pos`, inside the nearest block container. */
function afterBlock($pos: ResolvedPos): number {
  if (BLOCK_CONTAINERS.has($pos.parent.type.name)) return $pos.pos
  for (let d = $pos.depth; d >= 1; d--) if (BLOCK_CONTAINERS.has($pos.node(d - 1).type.name)) return $pos.after(d)
  return $pos.pos
}

function captureTarget(editor: Editor, wanted: 'selection' | 'block'): Target {
  const { state } = editor
  const { from, to, empty } = state.selection
  const mode = wanted === 'selection' && !empty ? 'selection' : 'block'
  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  // the textblock the cursor is in — possibly deep inside a callout, column or toggle
  const inText = $from.depth >= 1 && $from.parent.isTextblock
  return {
    mode,
    from,
    to,
    selected: mode === 'selection' ? sliceToMarkdown(state, from, to) : '',
    inlineOnly: $from.sameParent($to) && $from.parent.isTextblock,
    blockFrom: inText ? $from.before() : from,
    blockTo: inText ? $from.after() : from,
    blockEmpty: inText && $from.parent.content.size === 0,
    after: afterBlock(mode === 'selection' ? $to : $from),
    before: state.doc.textBetween(0, from, '\n\n', ' ').slice(-12000),
  }
}

/** Scrollable ancestor of an element (or the document scroller). */
function scrollParent(el: HTMLElement | null): HTMLElement {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if (/(auto|scroll)/.test(oy) && n.scrollHeight > n.clientHeight + 1) return n
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
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
  // no key, demo switched on: canned answers, clearly labelled
  const demo = useSyncExternalStore(onAIDemo, isAIDemo) && !hasKey

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
      target.after = m.map(target.after, -1)
      setTargetRev((r) => r + 1)
    }
    editor.on('transaction', onTx)
    return () => {
      editor.off('transaction', onTx)
    }
  }, [editor, target])

  // Selection mode: the range is painted by <SelectionShade>, so the editor keeps only a caret.
  // A blurred editor holding a range would write it back when it is clicked again, and the next
  // keystroke would overwrite the selected text instead of typing where the user clicked.
  useEffect(() => {
    if (target.mode !== 'selection' || editor.isDestroyed) return
    const { state } = editor
    if (state.selection.empty) return
    try {
      const pos = Math.max(0, Math.min(target.to, state.doc.content.size))
      editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos), -1)).setMeta('addToHistory', false))
    } catch {
      /* keep the selection */
    }
  }, [editor, target])

  const narrow = useNarrow()
  const [setup, setSetup] = useState(!hasKey && !isAIDemo())
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'actions' | 'translate'>('actions')
  const [wsMode, setWsMode] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<AIError | null>(null)
  const [sources, setSources] = useState<WorkspaceSource[]>([])
  /** tool calls of external MCP servers in the running / last request */
  const [mcpCalls, setMcpCalls] = useState<McpCall[]>([])
  /** the MCP servers a free-form request would use ("ATLAS · GITHUB", '' = none) */
  const mcpNames = useWorkspace((s) =>
    readServers(s.settings)
      .filter((x) => x.enabled)
      .map((x) => x.name.toUpperCase())
      .join(' · '),
  )
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

  /**
   * Put the keyboard back into the prompt — but only if it is not somewhere else already.
   * Someone who clicked into the page while Claude was writing keeps typing there.
   */
  const refocusPrompt = useCallback(() => {
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      const active = document.activeElement
      if (!active || active === document.body || input.closest('.ai-panel')?.contains(active)) input.focus({ preventScroll: true })
    })
  }, [])

  /** Temporary spacer under the editor (see makeRoom), removed when the panel closes. */
  const roomRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => () => roomRef.current?.remove(), [])

  /**
   * Room for the answer. Phones: lift the target block towards the top as soon as the panel opens
   * (the keyboard takes the lower half anyway). Larger screens: when a run starts with little space
   * below the target, scroll it up to ~120px from the top, so the panel opens downwards at full height
   * instead of being squeezed (or flipped over the text it is writing about).
   */
  const makeRoom = useCallback(
    (running = false) => {
      if (editor.isDestroyed) return
      const phone = !!window.matchMedia?.('(max-width: 640px)').matches
      if (!phone && !running) return
      const r = anchor.getBoundingClientRect()
      const scroller = scrollParent(editor.view.dom as HTMLElement)
      const isDoc = scroller === document.scrollingElement || scroller === document.documentElement
      const box = isDoc ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect()
      const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      if (phone) {
        const delta = r.top - (box.top + 64)
        if (delta > 48) scroller.scrollBy({ top: delta, behavior })
        return
      }
      const below = Math.min(window.innerHeight, box.bottom) - r.bottom
      if (below >= 360) return
      const delta = r.top - (box.top + 120)
      if (delta <= 24) return
      // the last lines of a page cannot scroll that far: a temporary spacer below the editor makes room
      const max = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
      const host = (editor.view.dom as HTMLElement).parentElement
      if (delta > max && host) {
        const spacer = roomRef.current ?? document.createElement('div')
        spacer.className = 'ai-room'
        spacer.setAttribute('aria-hidden', 'true')
        spacer.style.height = `${Math.ceil(delta - max) + (roomRef.current?.offsetHeight ?? 0)}px`
        if (!spacer.isConnected) host.append(spacer)
        roomRef.current = spacer
      }
      scroller.scrollBy({ top: delta, behavior })
    },
    [editor, anchor],
  )

  // phones: give the panel room from the start
  useEffect(() => {
    const id = requestAnimationFrame(() => makeRoom())
    return () => cancelAnimationFrame(id)
  }, [makeRoom])

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
      setMcpCalls([])
      setQuery('')
      setActive(0)
      makeRoom(true)
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
            onMcp: (calls) => {
              if (!ac.signal.aborted) setMcpCalls(calls)
            },
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
      refocusPrompt()
    },
    [pageId, pageContext, target, makeRoom, refocusPrompt],
  )

  const stop = () => {
    abortRef.current?.abort()
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    const partial = bufRef.current
    setOutput(stripFence(partial))
    setPhase(partial.trim() ? 'done' : 'idle')
    setRun((r) => (r ? { ...r, ended: performance.now() } : r))
    refocusPrompt()
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

  /** Where "Insert below" lands now: after the target block, in the container it sits in. */
  const insertionPoint = () => {
    const { doc } = editor.state
    const $pos = doc.resolve(Math.max(0, Math.min(target.after, doc.content.size)))
    // the boundary can end up inside text when blocks were joined meanwhile
    return $pos.parent.isTextblock ? afterBlock($pos) : $pos.pos
  }

  /**
   * replace: the selection · fill: the empty cursor line (else below it) · below: after the block.
   */
  const apply = async (how: 'replace' | 'fill' | 'below') => {
    if (editor.isDestroyed || !output.trim()) return
    const blocks = resultBlocks()
    if (!blocks.length) return
    await snapshotNow(pageId, 'ai')
    if (editor.isDestroyed) return
    const size = editor.state.doc.content.size
    const clamp = (n: number) => Math.max(0, Math.min(n, size))
    const chain = editor.chain().focus()
    if (how === 'replace' && target.mode === 'selection' && target.to > target.from) {
      const range = { from: clamp(target.from), to: clamp(target.to) }
      const single = blocks.length === 1 && blocks[0].type === 'paragraph'
      chain.insertContentAt(range, single && target.inlineOnly ? (blocks[0].content ?? []) : blocks).run()
    } else if (how === 'fill' && targetBlockEmpty()) {
      chain.insertContentAt({ from: clamp(target.blockFrom), to: clamp(target.blockTo) }, blocks).run()
    } else {
      chain.insertContentAt(insertionPoint(), blocks).run()
    }
    onClose()
  }

  /** Close and hand the caret (or the original selection) back to the editor, so typing continues. */
  const dismiss = useCallback(() => {
    // focus already moved on (the user clicked into the page and typed): leave the caret there
    const active = document.activeElement
    const fromPanel = !active || active === document.body || !!inputRef.current?.closest('.ai-panel')?.contains(active)
    if (!editor.isDestroyed && fromPanel) {
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

  /** Close the menu and open the workspace agent (with the typed request as its task, run right away). */
  const handToAgent = useCallback(
    (task: string) => {
      onClose()
      openAgent(task.trim() ? { task, run: true } : {})
    },
    [onClose],
  )

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
    const agent: ActionDef = {
      id: 'agent',
      label: t('features.agent.menu'),
      code: 'AGT',
      icon: Workflow,
      group: gWs,
      keywords: 'agent automate bulk rows pages database automatisieren datenbank zeilen',
      run: () => handToAgent(''),
    }
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
        agent,
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
      agent,
    ]
  }, [t, target.mode, start, handToAgent])

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
        const sel = target.mode === 'selection'
        out.push({
          id: 'insert',
          label: sel || !targetBlockEmpty() ? t('features.ai.res.below') : t('features.ai.res.insert'),
          icon: ArrowDownToLine,
          run: () => void apply(sel ? 'below' : 'fill'),
          hint: sel && !ws ? undefined : <Kbd>↵</Kbd>,
        })
        out.push({ id: 'copy', label: t('features.ai.res.copy'), icon: Copy, run: () => void copy() })
      }
      out.push({ id: 'retry', label: t('features.ai.res.retry'), icon: RotateCcw, run: retry })
      if (error && (error.code === 'invalid_key' || error.code === 'permission' || error.code === 'no_key'))
        out.push({ id: 'key', label: t('features.ai.res.changeKey'), icon: KeyRound, run: () => setSetup(true) })
      if (error?.code === 'mcp' || error?.code === 'mcp_auth')
        out.push({
          id: 'mcp',
          label: t('features.ai.mcp.openSettings'),
          icon: Settings2,
          run: () => {
            onClose()
            useUI.getState().openModal({ type: 'settings', tab: 'ai' })
          },
        })
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
          hint: mcpNames ? (
            <span className="ai-row__mcp" title={t('features.ai.mcp.uses', { names: mcpNames })}>
              + {mcpNames}
            </span>
          ) : undefined,
        }
      : null
    const list: Row[] = matched.map((a) => ({ ...a }))
    if (custom) {
      if (matched.length) list.push(custom)
      else list.unshift(custom)
      list.push({
        id: 'agent-task',
        label: (
          <>
            {t('features.agent.menuTask')} <span className="ai-quote">“{query.trim()}”</span>
          </>
        ),
        code: 'AGT',
        icon: Workflow,
        run: () => handToAgent(query.trim()),
      })
    }
    return list
  }, [query, setup, phase, wsMode, view, actions, t, start, output, target, targetRev, run, error, dismiss, sources, handToAgent, mcpNames, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const phKey =
    phase === 'done' || phase === 'error' ? 'refine' : wsMode ? 'workspace' : view === 'translate' ? 'language' : target.mode === 'selection' ? 'selection' : 'block'
  const placeholder = t(`features.ai.placeholder.${phKey}${narrow ? 'Short' : ''}`)

  /** Back from the key card to the panel (re-running a request that failed for lack of a key). */
  function leaveSetup() {
    setSetup(false)
    setError(null)
    if (phase === 'error' && run) void start(run.req)
    else setPhase('idle')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

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
            onDone={leaveSetup}
            onDemo={
              demo
                ? undefined
                : () => {
                    setAIDemo(true)
                    leaveSetup()
                  }
            }
            onCancel={hasKey || demo ? () => setSetup(false) : dismiss}
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
              {demo ? (
                <span className="ai-model ai-model--demo" title={t('features.ai.demo.title')}>
                  <span className="ai-model__brand">CLAUDE · </span>
                  {t('features.ai.demo.tag').toUpperCase()}
                </span>
              ) : (
                <button className="ai-model" onClick={cycleModel} disabled={busy} title={t('features.ai.switchModel')}>
                  <span className="ai-model__brand">CLAUDE · </span>
                  {model.short}
                </button>
              )}
            </div>

            {demo && (
              <div className="ai-demo" role="note" data-ai-demo="">
                <span className="ai-demo__tag label">{t('features.ai.demo.tag')}</span>
                <span className="ai-demo__text label">{t('features.ai.demo.label')}</span>
                <button type="button" className="ai-demo__key label" onClick={() => setSetup(true)}>
                  <KeyRound size={11} strokeWidth={1.8} aria-hidden /> {t('features.ai.demo.addKey')}
                </button>
              </div>
            )}

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
                {mcpCalls.length > 0 && <McpChips calls={mcpCalls} />}
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
              <div className="ai-list" ref={listRef} role="listbox" data-keys={phase === 'done' || phase === 'error' ? '' : undefined}>
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

/** Phone-width layout (short placeholders, function-key result row). */
function useNarrow(): boolean {
  const query = '(max-width: 520px)'
  const [narrow, setNarrow] = useState(() => !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
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

/** Tool calls of external MCP servers: "ATLAS · search_records" chips with an LED; failures said politely. */
function McpChips({ calls }: { calls: McpCall[] }) {
  const t = useT()
  const failed = calls.filter((c) => c.state === 'err')
  return (
    <div className="ai-mcp">
      <ul className="ai-mcp__list" aria-label={t('features.ai.mcp.calls')}>
        {calls.map((c) => (
          <li key={c.id} className="ai-mcp__chip" data-state={c.state} title={c.arg ? `${callLabel(c)} — ${c.arg}` : callLabel(c)}>
            <span className={`led${c.state === 'run' ? ' led--on ai-led--live' : c.state === 'err' ? ' ai-led--err' : ' led--ok'}`} aria-hidden />
            {callLabel(c)}
          </li>
        ))}
      </ul>
      {failed.map((c) => (
        <p key={c.id} className="ai-mcp__err">
          {c.error ? t('features.ai.mcp.callErr', { server: c.server.toUpperCase(), tool: c.tool, error: c.error }) : t('features.ai.mcp.callErrBare', { server: c.server.toUpperCase(), tool: c.tool })}{' '}
          {t('features.ai.mcp.callErrNote')}
        </p>
      ))}
    </div>
  )
}

function ErrorNote({ error, model }: { error: AIError; model: string }) {
  const t = useT()
  const detail = error.code === 'bad_request' || error.code === 'unknown' || error.code === 'mcp' ? (error.detail ?? '') : ''
  return (
    <div className="ai-error" role="alert">
      <span className="ai-error__code label">ERR · {error.code.toUpperCase()}</span>
      <p>{aiErrorText(error.code, { model, detail, server: error.server })}</p>
      {error.code === 'outdated' && (
        <button type="button" className="btn btn--sm" onClick={() => window.location.reload()}>
          {t('features.ai.reload')}
        </button>
      )}
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
function KeySetup({ reason, onDone, onDemo, onCancel }: { reason: 'missing' | 'invalid' | 'change'; onDone: () => void; onDemo?: () => void; onCancel: () => void }) {
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
    setAIDemo(false)
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
        {onDemo && reason === 'missing' && (
          <div className="ai-setup__demo">
            <button type="button" className="btn btn--sm" onClick={onDemo} data-ai-try-demo="">
              <Play size={12} strokeWidth={1.8} aria-hidden /> {t('features.ai.demo.try')}
            </button>
            <span className="label">{t('features.ai.demo.tryNote')}</span>
          </div>
        )}
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
