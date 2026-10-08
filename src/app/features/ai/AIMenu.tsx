/**
 * AIMenu — the Claude panel the editor opens for a selection ("Ask AI") or at the cursor
 * block (space on an empty line / slash command). One input line on top (prompt or filter),
 * a keyboard-driven list below (actions → live output → result actions).
 *
 * The request itself is a background run (runs.ts): closing the panel — Esc, a click elsewhere, another
 * page — leaves it running; only Stop and Discard end it. The page shows its runs (RunsHost) and reopens
 * the panel on one of them (`runId`).
 *
 * The reads line under the prompt says what goes to Claude from this page (the page's context marks:
 * whole page / only the marked blocks / nothing — plus the selection for selection actions); it opens
 * the choice, and "Mark blocks…" opens the picker on the page (the panel waits and comes back on Done).
 *
 * "Redo with instructions": the picker marks passages (purpose 'redo'), the panel takes the instructions
 * (presets, a rules page — redo/RedoSetup.tsx), the run rewrites them in the background, and the review
 * goes through them one by one (redo/RedoReview.tsx). Opened on passages from elsewhere: `redo`.
 *
 * "Transform into …" (transform/**): a submenu of forms (Auto, Board, Table, Timeline, Diagram, Chart, Columns,
 * Tabs, Toggles, Cards) on a selection of blocks; the run's preview and keys come from transform/panel.tsx.
 * Opened on a form from elsewhere (the grip menu of selected blocks): `transform`.
 *
 * Claude for files (file/**): a file block (node-selected, or the one file of a selection) lists its actions
 * (summarise, extract, tables, ask — or the local conversions: open as page, import as database, open as
 * spreadsheet); the run's body and keys come from file/FilePanel.tsx.
 *
 * The list for a first-time reader: the prompt first (a line under it says so), then a short top level — the
 * most used actions for what the panel is about (TOP_ACTIONS: text · several blocks · an image · a file · the
 * cursor) — with "Translate …", "Transform into …" and "More …" as submenus (→ opens, ← / Backspace goes
 * back). Typing searches every action, wherever it lives.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor, JSONContent } from '@tiptap/core'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { VirtualElement } from '@floating-ui/react'
import {
  AlignLeft,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRightToLine,
  BookMarked,
  BookOpenText,
  Check,
  Copy,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  EyeOff,
  FileText,
  History,
  KeyRound,
  Languages,
  Library,
  Lightbulb,
  ListChecks,
  ListTree,
  Maximize2,
  MessageCircleQuestion,
  MessageSquareText,
  Minimize2,
  MoreHorizontal,
  PenLine,
  Play,
  ReplaceAll,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SpellCheck,
  Square,
  SquareCheck,
  Shapes,
  SquareKanban,
  SquareDashed,
  Trash2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { Kbd } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { endUndoStep, openContextPicker, pageContextMarks, setContextMode, startUndoStep, topBlockKeys, useContextMarks, type ContextMode } from '../../editor'
import { closeHistory } from '@tiptap/pm/history'
import { toMarkdown } from '../share/markdown'
import { turnIntoPage } from '../../editor'
// own requests that are really structure actions or terminal tasks (intent.ts) · Sub-page per item (editor/split/items.ts)
import { FileStack, ListPlus } from 'lucide-react'
import { listItemsIn, openTurnIntoList } from '../kit'
import { itemCount, pagesPerItem } from '../../editor'
import { requestIntent } from './intent'
import { AI_MODELS, AIError, aiErrorText, isAIDemo, onAIDemo, resolveModel, setAIDemo, verifyKey } from './client'
import { readServers } from './mcp-servers/config'
import { callLabel, type McpCall } from './mcp-servers/activity'
import { CodewordChip, McpSkippedNote, skippedLabel } from './mcp-servers/Codeword'
import { citationsToLinks, findSource, type WorkspaceSource } from './workspace'
import { MarkdownLite } from './MarkdownLite'
import { snapshotNow } from '../history/snapshots'
import { webImagesOf } from '../agents/images'
import { claudeBlocks } from './claudeDoc'
import { openAgent } from './agent/state'
import { afterBlock, captureTarget, mapTarget, type RunTarget } from './runsTarget'
import { markSeen, removeRun, setTodbDraft, startRun, stopRun, useAIRuns, viewRun, type RunRequest } from './runs'
import { countWords, effectiveMode, readsFor, readsShort, readsText, type RunReads } from './reads'
import { RedoSetup, type RedoDraft } from './redo/RedoSetup'
import { RedoReview } from './redo/RedoReview'
import { capturePassages } from './redo/passages'
import { effectiveView, type BlockRange } from './todb/plan'
import { convertToDatabase, sameBlocks, TodbError, type TodbIssue } from './todb/run'
import { TodbPreview } from './todb/TodbPreview'
import { findImage, imageInSelection, imageTarget } from './image/locate'
import { imageRequest } from './image/actions'
import { imageActionRows, imageRunTarget, refineImage, useImagePanel } from './image/ImagePanel'
import type { ImageAction } from './image/request'
import { fileInSelection, findFile, fileTarget } from './file/locate'
import { fileRequest } from './file/actions'
import { FILE_ROOM, fileActionRows, fileAskLabel, fileRunTarget, refineFile, useFilePanel } from './file/FilePanel'
import { isLocalAction, isStructuredAction, type FileAction } from './file/kinds'
import { MemoryLine, useMemoryPreview } from './memory/MenuParts'
import { TRANSFORM_CODES, TRANSFORM_ICONS, TRANSFORM_KEYWORDS, transformChoices, transformRequest, typeLabel } from './transform/forms'
import { TRANSFORM_ROOM, useTransformPanel } from './transform/panel'
import type { TransformPick } from './transform/types'
import { MemoryBodyView, MemoryEdit } from './memory/MemoryCard'
import { isRememberRequest, stripRemember } from './memory/propose'
import { memoryHistory } from './memory/log'
import { confirmProposal, duplicateOf, openEntry, openMemoryDb, openMemoryLog } from './memory/open'
import { readMemories } from './memory/read'
import { memoryInUse } from './memory/settings'
import { examples } from './memory/example'
import type { MemoryProposal } from './memory/types'
// media from MCP servers (features/ai/media): cards under an answer, the generate card and its results
import { MediaCards } from './media/MediaCards'
import { mediaNode, pagePrivate } from './media/blocks'
import { GenerateSetup, draftOf, useGeneratePanel, type GenerateDraft } from './media/GeneratePanel'
import type { GenerateKind } from './media/generate'
import './ai.css'
import './runs.css'
import './reads.css'

export interface AIMenuProps {
  editor: Editor
  pageId: string
  /** 'selection' = act on selected text; 'block' = free prompt at cursor ("Ask AI" / space on empty line) */
  mode: 'selection' | 'block'
  onClose: () => void
  /** Open on a run that goes on (or finished) in the background — the page's run indicator does this. */
  runId?: string
  /** Open on passages to redo with instructions (block ids, marked in the picker — block menu, AI terminal). */
  redo?: string[]
  /** Open on a selection and transform it into this form at once (the grip menu of selected blocks). */
  transform?: TransformPick
  /**
   * Open on a submenu: 'todb' — "More …" with "Turn into database" highlighted (the grip menu's "Turn into
   * database…") · 'transform' — the forms of "Transform into …" (the tour, "What can One do?").
   */
  open?: 'todb' | 'transform'
  /** Open on the generate card (`/generate image` · `/generate video` · an empty image block's "Generate…"). */
  generate?: GenerateKind
}

/* ------------------------------------------------------------------ */
/* Target                                                              */
/* ------------------------------------------------------------------ */

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

/** Scrollable ancestor of an element (or the document scroller). */
function scrollParent(el: HTMLElement | null, short = false): HTMLElement {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    // `short`: the column that scrolls once it is taller (a page shorter than the screen, about to get a spacer)
    if (/(auto|scroll)/.test(oy) && (short || n.scrollHeight > n.clientHeight + 1)) return n
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
}

/** Anchor at the target as it is now (`get` reads the latest one). */
function makeAnchor(editor: Editor, get: () => RunTarget): VirtualElement {
  return {
    contextElement: editor.view.dom,
    getBoundingClientRect() {
      const view = editor.view
      if (editor.isDestroyed) return new DOMRect(0, 0, 0, 0)
      const dom = view.dom.getBoundingClientRect()
      const target = get()
      try {
        if (target.lost) {
          // not found again: below the last block, where "Insert below" puts it
          const end = view.coordsAtPos(view.state.doc.content.size)
          return new DOMRect(dom.left, end.top, 1, end.bottom - end.top)
        }
        // an image (Claude for images): below the picture — a tall one only down to the middle of the screen
        const pic = target.mode === 'selection' ? view.state.doc.nodeAt(target.from) : null
        const picEl = (pic?.type.name === 'image' || pic?.type.name === 'fileBlock') && target.to === target.from + pic.nodeSize ? (view.nodeDOM(target.from) as HTMLElement | null) : null
        if (picEl?.getBoundingClientRect) {
          const r = picEl.getBoundingClientRect()
          const bottom = Math.min(r.bottom, Math.max(r.top + 40, window.innerHeight * 0.5))
          return new DOMRect(Math.max(dom.left, r.left), r.top, 1, bottom - r.top)
        }
        if (target.mode === 'selection') {
          const a = view.coordsAtPos(target.from, 1)
          const b = view.coordsAtPos(target.to, -1)
          const left = a.top === b.top ? a.left : dom.left
          // a selection taller than the screen allows (a whole report): the panel goes under its first line
          if (b.bottom - a.top > window.innerHeight * 0.4) return new DOMRect(dom.left, a.top, 1, a.bottom - a.top)
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
  /** only listed when the query matches */
  hidden?: boolean
  /** opens a submenu (Translate, Transform into, More) */
  sub?: boolean
}

/** What the panel is opened on — its top level offers the most used actions for that. */
type MenuKind = 'block' | 'text' | 'blocks' | 'image' | 'file'

/**
 * The top level per selection type (ids of ActionDef; image / file: their own actions first). Everything else
 * sits under "More …"; typing finds every action.
 */
const TOP_ACTIONS: Record<MenuKind, readonly string[]> = {
  block: ['continue', 'outline', 'brainstorm', 'summarize', 'action_items', 'workspace'],
  text: ['improve', 'fix', 'shorter', 'translate', 'explain'],
  blocks: ['improve', 'fix', 'translate', 'transform', 'summarize'],
  image: ['improve'],
  file: ['improve'],
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

type Phase = 'idle' | 'streaming' | 'done' | 'error'

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AIMenu({ editor, pageId, mode, onClose, runId: openRun, redo, transform: transformPick, open: openOn, generate }: AIMenuProps) {
  const t = useT()
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const model = resolveModel(useWorkspace((s) => s.settings.aiModel))
  const updateSettings = useWorkspace((s) => s.updateSettings)
  // no key, demo switched on: canned answers, clearly labelled
  const demo = useSyncExternalStore(onAIDemo, isAIDemo) && !hasKey

  // The panel's own target: captured once and mapped through every later edit while no run holds it.
  // Once a request runs, the run's target (runs.ts, mapped by the run store) is the one that counts.
  const [own] = useState(() => ({ t: captureTarget(editor, mode, (from, to) => sliceToMarkdown(editor.state, from, to)) }))
  /** the image the panel was opened on (node-selected, or the one image of the selection): Claude for images */
  const [img] = useState(() => (openRun ? null : imageInSelection(editor.state)))
  /** the file block the panel was opened on (node-selected, or the one file of the selection): Claude for files */
  const [file] = useState(() => (openRun ? null : fileInSelection(editor.state)))
  const [, setOwnRev] = useState(0)
  useEffect(() => {
    const onTx = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return
      own.t = mapTarget(own.t, transaction.mapping)
      setOwnRev((r) => r + 1)
    }
    editor.on('transaction', onTx)
    return () => {
      editor.off('transaction', onTx)
    }
  }, [editor, own])

  const [runId, setRunId] = useState<string | null>(openRun ?? null)
  const run = useAIRuns((s) => (runId ? (s.runs[runId] ?? null) : null))
  // an image run: its image found again (the picture is the target, not text)
  const target: RunTarget =
    run?.req.kind === 'image' && !editor.isDestroyed
      ? imageRunTarget(editor, run, run.target)
      : run?.req.kind === 'file' && !editor.isDestroyed
        ? fileRunTarget(editor, run, run.target)
        : (run?.target ?? own.t)
  const targetRef = useRef(target)
  targetRef.current = target
  const anchor = useMemo(() => makeAnchor(editor, () => targetRef.current), [editor])

  // the page's plate leaves out the run this panel shows
  useEffect(() => (runId ? viewRun(runId) : undefined), [runId])

  // the run went away elsewhere (discarded from another panel, accepted): back to the actions
  useEffect(() => {
    if (!runId || run) return
    if (openRun) onClose()
    else setRunId(null)
  }, [runId, run, openRun, onClose])

  // Selection mode: the range is painted by <SelectionShade>, so the editor keeps only a caret.
  // A blurred editor holding a range would write it back when it is clicked again, and the next
  // keystroke would overwrite the selected text instead of typing where the user clicked.
  useEffect(() => {
    if (openRun || own.t.mode !== 'selection' || editor.isDestroyed) return
    const { state } = editor
    if (state.selection.empty) return
    try {
      const pos = Math.max(0, Math.min(own.t.to, state.doc.content.size))
      editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos), -1)).setMeta('addToHistory', false))
    } catch {
      /* keep the selection */
    }
  }, [editor, own, openRun])

  const narrow = useNarrow()
  const [setup, setSetup] = useState(!hasKey && !isAIDemo() && !openRun)
  const [query, setQuery] = useState('')
  const lang = useLang()
  const [view, setView] = useState<'actions' | 'translate' | 'reads' | 'memory' | 'memhist' | 'transform' | 'more'>('actions')
  /** One memory: switched off for the next own request (the list's toggle) · the entry whose history shows */
  const [memOff, setMemOff] = useState(false)
  const [histOf, setHistOf] = useState<string | null>(null)
  /** a memory run's proposal as edited here (null: as Claude proposed it) · the edit form is open */
  const [memDraft, setMemDraft] = useState<MemoryProposal | null>(null)
  const [memEdit, setMemEdit] = useState(false)
  /** the context picker is open on the page: the panel steps aside until Done / Esc */
  const [picking, setPicking] = useState(false)
  /** a page-level request that needs page text while Claude may read nothing of it: asked first */
  const [ask, setAsk] = useState<{ req: RunRequest; label: string } | null>(null)
  const marks = useContextMarks(pageId)
  /** "Redo with instructions": the marked passages (block ids) — the panel shows the instructions card */
  const [redoIds, setRedoIds] = useState<string[] | null>(redo?.length ? redo : null)
  /** the instructions card's text + rules page (kept while the picker or the reads choice is open) */
  const [redoDraft, setRedoDraft] = useState<RedoDraft>({ text: '', rules: null })
  /** the review's "Change instructions": the card again, a new run replaces this one */
  const [redoEdit, setRedoEdit] = useState(false)
  const [wsMode, setWsMode] = useState(false)
  /** "Generate image / video": the card's values (null: not generating) · the card again over a finished run ("Change prompt") */
  const [genDraft, setGenDraft] = useState<GenerateDraft | null>(() => (generate && !openRun ? draftOf(generate) : null))
  const [genEdit, setGenEdit] = useState(false)
  /** a conversion that failed ("Turn into database") */
  const [convertIssue, setConvertIssue] = useState<TodbIssue | null>(null)
  const convertingRef = useRef(false)

  const phase: Phase = !run ? 'idle' : run.status === 'running' ? 'streaming' : run.status === 'done' ? 'done' : 'error'
  const output = run?.output ?? ''
  const sources: WorkspaceSource[] = run?.sources ?? []
  const mcpCalls: McpCall[] = run?.mcpCalls ?? []
  const runError = run?.error ?? null
  const error = useMemo(() => (runError ? new AIError(runError.code, runError.detail, runError.server) : null), [runError])
  const table = phase === 'done' ? (run?.table ?? null) : null
  const issue = convertIssue ?? run?.issue ?? null
  const interrupted = run?.status === 'interrupted'
  /** a file's local conversion is shown: text typed now is a question about the file (its kind) */
  const fileLocal = run?.req.kind === 'file' && isLocalAction(run.req.action) ? run.req.fileKind : null

  /** the MCP servers a free-form request would use ("KB · TRACKER", '' = none) */
  const mcpNames = useWorkspace((s) =>
    readServers(s.settings)
      .filter((x) => x.enabled)
      .map((x) => x.name.toUpperCase())
      .join(' · '),
  )
  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const outRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

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

  // a finished run: the prompt gets the keyboard back, the result counts as seen, a missing key opens the key card
  const prevPhase = useRef(phase)
  useEffect(() => {
    const was = prevPhase.current
    prevPhase.current = phase
    if (!run || phase === 'streaming') return
    markSeen(run.id)
    if (was === 'streaming') {
      // a redo result: the review takes the keyboard
      if (run.req.kind !== 'redo' || phase === 'error') refocusPrompt()
      if (run.error?.code === 'no_key') setSetup(true)
    }
  }, [phase, run, refocusPrompt])

  /** Temporary spacer under the editor (see makeRoom), removed when the panel closes. */
  const roomRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => () => roomRef.current?.remove(), [])

  /**
   * Room for the answer. Phones: lift the target block towards the top as soon as the panel opens
   * (the keyboard takes the lower half anyway). Larger screens: when a run starts with little space
   * below the target, scroll it up to ~120px from the top, so the panel opens downwards at full height
   * instead of being squeezed (or flipped over the text it is writing about). `running` as a number: the
   * room a preview needs below the target ("Transform into": the drawn result, its options and keys).
   */
  const makeRoom = useCallback(
    (running: boolean | number = false) => {
      if (editor.isDestroyed) return
      const phone = !!window.matchMedia?.('(max-width: 640px)').matches
      if (!phone && !running) return
      const r = anchor.getBoundingClientRect()
      const scroller = scrollParent(editor.view.dom as HTMLElement, typeof running === 'number')
      const isDoc = scroller === document.scrollingElement || scroller === document.documentElement
      const box = isDoc ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect()
      const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      if (phone) {
        const delta = r.top - (box.top + 64)
        if (delta > 48) scroller.scrollBy({ top: delta, behavior })
        return
      }
      const below = Math.min(window.innerHeight, box.bottom) - r.bottom
      const need = typeof running === 'number' ? running : 360
      if (below >= need) return
      // a preview: as far as its room needs, the target's first line kept in view
      const delta = typeof running === 'number' ? Math.min(need - below, r.top - (box.top + 24)) : r.top - (box.top + 120)
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
        // a page shorter than the screen (its min-height swallows the first pixels): measured with a spacer as
        // tall as the screen — past any min-height, where every pixel counts — then set to what the room needs
        const range = () => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
        if (!isDoc && range() < delta) {
          const probe = spacer.offsetHeight + scroller.clientHeight
          spacer.style.height = `${probe}px`
          spacer.style.height = `${Math.max(0, Math.ceil(probe + delta - range()))}px`
        }
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

  // opened on an image run (the image toolbar, the block menu) / a transform run ("AI result ready"): room below the target, like a request started here
  useEffect(() => {
    const kind = openRun ? useAIRuns.getState().runs[openRun]?.req.kind : null
    if (kind !== 'image' && kind !== 'transform' && kind !== 'file') return
    const r = openRun ? useAIRuns.getState().runs[openRun]?.req : null
    const id = requestAnimationFrame(() => makeRoom(kind === 'transform' ? TRANSFORM_ROOM : r?.kind === 'file' && isStructuredAction(r.action) ? FILE_ROOM : true))
    return () => cancelAnimationFrame(id)
  }, [openRun, makeRoom])

  /* ---------------- running ---------------- */

  /** A request becomes a background run (it replaces the panel's current run: Retry, Revise). */
  const start = useCallback(
    (req: RunRequest, tg?: RunTarget) => {
      stickRef.current = true
      setConvertIssue(null)
      convertingRef.current = false
      const id = startRun({ editor, pageId, req, target: tg ?? targetRef.current, replaces: runId })
      setRunId(id)
      setQuery('')
      setActive(0)
      setMemOff(false)
      setMemDraft(null)
      setMemEdit(false)
      if (view === 'memory' || view === 'memhist' || view === 'transform' || view === 'more') setView('actions')
      makeRoom(req.kind === 'transform' ? TRANSFORM_ROOM : req.kind === 'file' && isStructuredAction(req.action) ? FILE_ROOM : true)
    },
    [editor, pageId, runId, makeRoom, view],
  )

  /** Stop: the request ends; text that arrived stays as the result. */
  const stop = () => {
    if (runId && !stopRun(runId)) setRunId(null)
    refocusPrompt()
  }

  /** A redo request again, with its passages read anew (and the instructions extended by a revision). */
  const redoAgain = (extra = '') => {
    if (run?.req.kind !== 'redo') return
    const req = run.req
    start({ ...req, instructions: [req.instructions, extra.trim()].filter(Boolean).join('\n'), passages: capturePassages(editor, req.passages.map((p) => p.key)) })
  }

  const retry = () => run && (run.req.kind === 'redo' ? redoAgain() : run.req.kind === 'transform' ? transformPanel.again() : start(run.req))

  /* ---------------- what Claude reads ---------------- */

  /** The picker on the page; the panel comes back (with the request kept) on Done or Esc. */
  const pickBlocks = useCallback(() => {
    const ok = openContextPicker(editor, {
      onEnd: () => {
        setPicking(false)
        setView('actions')
        setActive(0)
      },
    })
    if (ok) setPicking(true)
  }, [editor])

  const chooseMode = useCallback(
    (mode: ContextMode) => {
      if (mode === 'marked' && !pageContextMarks(pageId).marked) return pickBlocks()
      setContextMode(editor, mode)
      setView('actions')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    },
    [editor, pageId, pickBlocks],
  )

  /**
   * "Redo with instructions": the picker marks the passages (pre-marked: `ids`); Done with passages
   * shows the instructions card, Esc goes back to where the panel was.
   */
  const pickRedo = useCallback(
    (ids: string[]) => {
      const ok = openContextPicker(editor, {
        purpose: 'redo',
        ids,
        onEnd: (done, marked) => {
          setPicking(false)
          setView('actions')
          setActive(0)
          if (done && marked.length) setRedoIds(marked)
        },
      })
      if (ok) setPicking(true)
    },
    [editor],
  )

  /** The review's "Change instructions": the card with the run's instructions; Redo replaces the run. */
  const editRedo = () => {
    if (run?.req.kind !== 'redo') return
    setRedoDraft({ text: run.req.instructions, rules: run.req.rulesPageId })
    setRedoIds(run.req.passages.map((p) => p.key))
    setRedoEdit(true)
  }

  /** Continue / summarize / action items of the page need its text: with nothing to read, ask first. */
  const startPageLevel = useCallback(
    (req: RunRequest, label: string) => {
      if (effectiveMode(pageContextMarks(pageId)) === 'none') {
        setAsk({ req, label })
        setActive(0)
        return
      }
      start(req)
    },
    [pageId, start],
  )

  /* ---------------- applying ---------------- */

  const resultMarkdown = () => (run?.req.kind === 'workspace' ? citationsToLinks(output, sources) : output)

  const resultBlocks = (): JSONContent[] => {
    // the answer may follow text nobody vouches for (a mail, a file, an MCP result): a web image in it
    // becomes a link — only the images this page shows already stay images
    return claudeBlocks(resultMarkdown(), webImagesOf(useWorkspace.getState().pages[pageId]?.content))
  }

  /** The cursor block may have been typed into meanwhile: it is only filled while still empty. */
  const targetBlockEmpty = (tg: RunTarget = target) => {
    if (!tg.blockEmpty || tg.lost || editor.isDestroyed) return false
    const { doc } = editor.state
    const block = tg.blockFrom <= doc.content.size ? doc.nodeAt(tg.blockFrom) : null
    return !!block && block.isTextblock && block.content.size === 0 && tg.blockTo - tg.blockFrom === block.nodeSize
  }

  /** Where "Insert below" lands now: after the target block, in the container it sits in (lost: the end of the page). */
  const insertionPoint = (tg: RunTarget) => {
    const { doc } = editor.state
    if (tg.lost) return doc.content.size
    const $pos = doc.resolve(Math.max(0, Math.min(tg.after, doc.content.size)))
    // the boundary can end up inside text when blocks were joined meanwhile
    return $pos.parent.isTextblock ? afterBlock($pos) : $pos.pos
  }

  /**
   * replace: the selection · fill: the empty cursor line (else below it) · below: after the block.
   * The run is done with once its result is in the page.
   */
  const apply = async (how: 'replace' | 'fill' | 'below') => {
    if (editor.isDestroyed || !run || !output.trim()) return
    const blocks = resultBlocks()
    if (!blocks.length) return
    await snapshotNow(pageId, 'ai')
    if (editor.isDestroyed) return
    const tg = useAIRuns.getState().runs[run.id]?.target ?? targetRef.current
    const size = editor.state.doc.content.size
    const clamp = (n: number) => Math.max(0, Math.min(n, size))
    // Claude's result is its own undo step (also in a shared page, where Y undo merges by time)
    startUndoStep(editor.view)
    const chain = editor
      .chain()
      .focus()
      .command(({ tr }) => (closeHistory(tr), true))
    if (how === 'replace' && tg.mode === 'selection' && !tg.lost && tg.to > tg.from) {
      const range = { from: clamp(tg.from), to: clamp(tg.to) }
      const single = blocks.length === 1 && blocks[0].type === 'paragraph'
      chain.insertContentAt(range, single && tg.inlineOnly ? (blocks[0].content ?? []) : blocks).run()
    } else if (how === 'fill' && targetBlockEmpty(tg)) {
      chain.insertContentAt({ from: clamp(tg.blockFrom), to: clamp(tg.blockTo) }, blocks).run()
    } else {
      chain.insertContentAt(insertionPoint(tg), blocks).run()
    }
    endUndoStep(editor.view)
    removeRun(run.id)
    onClose()
  }

  /**
   * Media saved from a run (an MCP result's cards, generated results): one undo step at the target — 'fill': an
   * empty image block or empty line there takes them, else below it · 'below': after the target block.
   */
  const insertMedia = async (nodes: JSONContent[], how: 'fill' | 'below') => {
    if (editor.isDestroyed || !nodes.length) return
    await snapshotNow(pageId, 'ai')
    if (editor.isDestroyed) return
    const tg = (runId ? useAIRuns.getState().runs[runId]?.target : null) ?? targetRef.current
    const { doc } = editor.state
    const at = !tg.lost && tg.from <= doc.content.size ? doc.nodeAt(tg.from) : null
    startUndoStep(editor.view)
    const chain = editor
      .chain()
      .focus()
      .command(({ tr }) => (closeHistory(tr), true))
    if (how === 'fill' && at?.type.name === 'image' && !at.attrs.src) chain.insertContentAt({ from: tg.from, to: tg.from + at.nodeSize }, nodes).run()
    else if (how === 'fill' && targetBlockEmpty(tg)) chain.insertContentAt({ from: tg.blockFrom, to: tg.blockTo }, nodes).run()
    else chain.insertContentAt(insertionPoint(tg), nodes).run()
    endUndoStep(editor.view)
  }

  /** "Turn into database": in place of the blocks Claude read (one undo step) — or at the end when they changed. */
  const todbInPlace = !!table && !target.lost && !!target.todb && !editor.isDestroyed && !!sameBlocks(editor.state.doc, target.todb, table.blocks)
  const convert = async () => {
    if (!run?.table || convertingRef.current || editor.isDestroyed) return
    const tg = useAIRuns.getState().runs[run.id]?.target ?? targetRef.current
    const range: BlockRange | null = !tg.lost && tg.todb && sameBlocks(editor.state.doc, tg.todb, run.table.blocks) ? tg.todb : null
    convertingRef.current = true
    try {
      await convertToDatabase(editor, pageId, range, run.table, run.table.draft)
      removeRun(run.id)
      onClose()
    } catch (e) {
      convertingRef.current = false
      setConvertIssue(e instanceof TodbError ? e.issue : 'bad')
      refocusPrompt()
    }
  }

  /** Close and hand the caret (or the original selection) back to the editor, so typing continues. */
  const dismiss = useCallback(() => {
    const panel = inputRef.current?.closest('.ai-panel') ?? null
    const handBack = () => {
      // focus already moved on (the user clicked into the page and typed) or ⌘K opened the palette: leave it there
      const active = document.activeElement
      const fromPanel = !active || active === document.body || !!panel?.contains(active)
      if (editor.isDestroyed || !fromPanel || useUI.getState().paletteOpen) return
      try {
        const tg = targetRef.current
        const size = editor.state.doc.content.size
        if (!tg.lost) {
          const from = Math.max(0, Math.min(tg.from, size))
          const to = Math.max(from, Math.min(tg.mode === 'selection' ? tg.to : tg.from, size))
          const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to))
          editor.view.dispatch(tr.setMeta('addToHistory', false))
        }
      } catch {
        /* keep whatever selection the editor has */
      }
      editor.view.focus()
    }
    if (document.activeElement === document.body) {
      // closed in the middle of a focus move (focus left the panel and has not landed yet): decide once it has
      onClose()
      requestAnimationFrame(handBack)
      return
    }
    handBack()
    onClose()
  }, [editor, onClose])

  /** Discard: the run ends (aborted when it still runs) and is gone. */
  const discard = useCallback(() => {
    if (runId) removeRun(runId)
    dismiss()
  }, [runId, dismiss])

  // Esc closes with focus back in the editor; a click elsewhere closes and leaves focus where it went.
  // Either way a run goes on in the background — the page shows it.
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

  /** "This needs the AI terminal — run it there": the request runs there, the selection goes along as a reference. */
  const handToTerminal = useCallback(
    (task: string) => {
      const at = own.t.mode === 'selection' ? { from: own.t.from, to: own.t.to } : null
      onClose()
      void import('./agent/refs').then((m) => m.runInTerminal(task, editor, at))
    },
    [onClose, own, editor],
  )

  /* ---------------- Claude for images ---------------- */

  /** An image action on the image the panel is about (found again — the page may have changed meanwhile). */
  const startImage = (action: ImageAction, question?: string) => {
    if (!img || editor.isDestroyed) return
    const hit = findImage(editor.state.doc, { src: String(img.hit.node.attrs.src), blockId: (img.hit.node.attrs.id as string | null) ?? null }, img.hit.pos)
    if (hit) start(imageRequest(action, hit, { question }), imageTarget(editor.state.doc, hit.pos))
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      useUI.getState().toast({ message: t('common.copied'), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t('features.ai.copyFailed'), kind: 'error' })
    }
  }

  /* ---------------- Claude for files ---------------- */

  /** A file action on the file the panel is about (found again — the page may have changed meanwhile). */
  const startFile = (action: FileAction, question?: string) => {
    if (!file || editor.isDestroyed) return
    const hit = findFile(editor.state.doc, { src: String(file.hit.node.attrs.src), blockId: (file.hit.node.attrs.id as string | null) ?? null }, file.hit.pos)
    if (hit) start(fileRequest(action, hit, { question }), fileTarget(editor.state.doc, hit.pos))
  }

  /** a file run: its result body and keys (a page preview, the tables / sheets, a database, Upload a copy …) */
  const filePanel = useFilePanel({
    editor,
    pageId,
    run: run?.req.kind === 'file' ? run : null,
    phase,
    start,
    finish: () => {
      if (run) removeRun(run.id)
      onClose()
    },
    discard,
    copy: (text) => void copyText(text),
  })

  /** an image run: its result body and keys (alt text + caption, tables, Upload a copy …) */
  const imagePanel = useImagePanel({
    editor,
    pageId,
    run: run?.req.kind === 'image' ? run : null,
    phase,
    start,
    finish: () => {
      if (run) removeRun(run.id)
      onClose()
    },
    discard,
    copy: (text) => void copyText(text),
  })

  /* ---------------- Transform into … ---------------- */

  /** a transform run: its preview (forms, options, the result, what stays) and its Transform key */
  const transformPanel = useTransformPanel({
    editor,
    pageId,
    run: run?.req.kind === 'transform' ? run : null,
    phase,
    target,
    start,
    finish: () => {
      if (run) removeRun(run.id)
      onClose()
    },
    onIssue: (i) => {
      setConvertIssue(i)
      refocusPrompt()
    },
  })

  /* ---------------- Generate image / video ---------------- */

  /** a generation run: its results as cards to pick, its keys (Insert selected, Try again, Change prompt) */
  const generatePanel = useGeneratePanel({
    pageId,
    run: run?.req.kind === 'generate' ? run : null,
    phase,
    start,
    insert: (nodes) => insertMedia(nodes, 'fill'),
    finish: () => {
      if (run) removeRun(run.id)
      onClose()
    },
    close: onClose,
    edit: (req) => {
      setGenDraft(draftOf(req.media, req))
      setGenEdit(true)
    },
    discard,
  })

  /** the forms the selection may become (Auto first; [] when it is no whole blocks) */
  const transformPicks = useMemo(
    () => (own.t.mode === 'selection' && !img?.only && !file?.only && !editor.isDestroyed ? transformChoices(editor.state.doc, own.t.range) : []),
    [own.t.mode, own.t.range, img, file, editor],
  )
  const transformRun = useCallback((pick: TransformPick) => start(transformRequest(pick)), [start])

  // opened on a form (the grip menu of selected blocks): it runs at once — or the list of forms when it can't go there
  const transformOpened = useRef(false)
  useEffect(() => {
    if (!transformPick || openRun || transformOpened.current) return
    transformOpened.current = true
    if (!setup && transformPicks.includes(transformPick)) {
      // the keyboard into the panel first (the prompt is off while the run works; the result's keys need it after)
      inputRef.current?.focus({ preventScroll: true })
      transformRun(transformPick)
    } else if (transformPicks.length) setView('transform')
  }, [transformPick, openRun, setup, transformPicks, transformRun])

  /* ---------------- lists ---------------- */

  const actions: ActionDef[] = useMemo(() => {
    const pageLevel = own.t.mode !== 'selection'
    const A = (id: Extract<RunRequest, { kind: 'action' }>['action'], label: string, code: string, icon: LucideIcon, group: string, keywords = ''): ActionDef => ({
      id,
      label,
      code,
      icon,
      group,
      keywords,
      run: () =>
        pageLevel && (id === 'continue' || id === 'summarize' || id === 'action_items')
          ? startPageLevel({ kind: 'action', action: id, label, code }, label)
          : start({ kind: 'action', action: id, label, code }),
    })
    // only when typed for ("context", "liest" …): the choice of what Claude reads
    const reads: ActionDef = {
      id: 'reads',
      label: t('features.ai.reads.action'),
      code: 'CTX',
      icon: SquareCheck,
      group: t('features.ai.reads.title'),
      keywords: 'context kontext reads liest lesen read marked markiert markieren blocks blöcke',
      hidden: true,
      run: () => {
        setView('reads')
        setQuery('')
        setActive(0)
      },
    }
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
      sub: true,
      run: () => {
        setView('translate')
        setQuery('')
        setActive(0)
        requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
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
    // the passages to redo: pre-marked by the selection's blocks / the cursor block (not an empty line)
    const redoAction: ActionDef = {
      id: 'redo',
      label: t('features.ai.redo.action'),
      code: 'REDO',
      icon: ReplaceAll,
      group: own.t.mode === 'selection' ? gEdit : gPage,
      keywords: 'redo rewrite instructions neu machen umschreiben überarbeiten vorgaben passagen stellen',
      run: () => {
        const tg = own.t
        if (tg.mode === 'selection') return pickRedo(topBlockKeys(editor, tg.from, tg.to))
        pickRedo(tg.blockEmpty || tg.lost ? [] : topBlockKeys(editor, tg.blockFrom, tg.blockTo))
      },
    }
    // an image in the selection: Claude looks at it ("Ask about the image…" puts the keyboard into the prompt)
    const imageGroup: ActionDef[] = img
      ? imageActionRows(
          t,
          (a) => startImage(a),
          () => {
            setQuery('')
            requestAnimationFrame(() => inputRef.current?.focus())
          },
        )
      : []
    // a file block in the selection: its Claude actions and local conversions ("Ask about the file…" focuses the prompt)
    const fileGroup: ActionDef[] = file
      ? fileActionRows(
          t,
          file.hit.kind,
          (a) => startFile(a),
          () => {
            setQuery('')
            requestAnimationFrame(() => inputRef.current?.focus())
          },
        )
      : []
    if (img?.only) return [...imageGroup, agent, reads]
    if (file?.only) return [...fileGroup, agent, reads]
    // spans blocks (or holds a list / table) where a database block may go
    const todb: ActionDef[] = own.t.todb
      ? [
          {
            id: 'todb',
            label: t('features.ai.todb.action'),
            code: 'DB',
            icon: SquareKanban,
            group: t('features.ai.group.structure'),
            keywords: 'board kanban table database tabelle datenbank umwandeln liste list convert',
            run: () => start({ kind: 'todb', label: t('features.ai.todb.action'), code: 'DB' }),
          },
        ]
      : []
    // "Transform into …": the list of forms — or, typed for ("chart", "flowchart" …), a form directly
    const gStructure = t('features.ai.group.structure')
    const transform: ActionDef[] = transformPicks.length
      ? [
          {
            id: 'transform',
            label: t('features.ai.transform.action'),
            code: 'TRF',
            icon: Shapes,
            group: gStructure,
            keywords: 'transform convert visualize diagram chart columns tabs toggles cards timeline verwandeln umwandeln visualisieren schaubild diagramm spalten karten zeitleiste',
            sub: true,
            run: () => {
              setView('transform')
              setQuery('')
              setActive(0)
              requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
            },
          },
          // "Turn into free board": record types, lanes and cards from mixed text (features/ai/freeboard)
          ...(transformPicks.includes('freeboard')
            ? [
                {
                  id: 'freeboard',
                  label: t('features.ai.freeboard.action'),
                  code: TRANSFORM_CODES.freeboard,
                  icon: TRANSFORM_ICONS.freeboard,
                  group: gStructure,
                  keywords: TRANSFORM_KEYWORDS.freeboard,
                  run: () => transformRun('freeboard'),
                } satisfies ActionDef,
              ]
            : []),
          ...transformPicks.map(
            (p): ActionDef => ({
              id: `transform-${p}`,
              label: t('features.ai.transform.direct', { type: typeLabel(p) }),
              code: TRANSFORM_CODES[p],
              icon: TRANSFORM_ICONS[p],
              group: gStructure,
              keywords: TRANSFORM_KEYWORDS[p],
              hidden: true,
              run: () => transformRun(p),
            }),
          ),
        ]
      : []
    if (own.t.mode === 'selection')
      return [
        ...imageGroup,
        ...fileGroup,
        A('improve', t('features.ai.act.improve'), 'IMP', PenLine, gEdit, 'better rewrite verbessern'),
        A('fix', t('features.ai.act.fix'), 'FIX', SpellCheck, gEdit, 'spelling grammar rechtschreibung grammatik'),
        A('shorter', t('features.ai.act.shorter'), 'SHR', Minimize2, gEdit, 'short kürzer'),
        A('longer', t('features.ai.act.longer'), 'LNG', Maximize2, gEdit, 'long länger expand'),
        translate,
        redoAction,
        ...todb,
        ...transform,
        // "Turn into page" (editor/split): no Claude — the selected blocks move into a new sub-page at once
        {
          id: 'topage',
          label: t('editor.split.toPage'),
          code: 'PG',
          icon: FileText,
          group: t('features.ai.group.structure'),
          keywords: 'page subpage new page extract seite unterseite neue seite auslagern',
          run: () => {
            onClose()
            turnIntoPage(editor, { pageId, range: { from: own.t.from, to: own.t.to } })
          },
        },
        // "Sub-page per item" (editor/split/items.ts): no Claude — each item a sub-page, one table of links in their place
        {
          id: 'pagesPerItem',
          label: t('editor.split.items.action'),
          code: 'PGS',
          icon: FileStack,
          group: t('features.ai.group.structure'),
          keywords: 'sub-page per item pages each item ticket table unterseite pro eintrag seiten jeder tabelle',
          hidden: itemCount(editor.state.doc, { from: own.t.from, to: own.t.to }) < 2,
          run: () => {
            onClose()
            pagesPerItem(editor, { pageId, range: { from: own.t.from, to: own.t.to } })
          },
        },
        // "Turn into list" (features/kit): no Claude — one item per line / list item becomes a shared list (previewed first)
        {
          id: 'tolist',
          label: t('features.kit.toList.action'),
          code: 'LST',
          icon: ListPlus,
          group: t('features.ai.group.structure'),
          keywords: 'list shared list options items select building blocks liste gemeinsame einträge auswahl bausteine',
          run: () => {
            const items = listItemsIn(editor.state.doc, own.t.from, own.t.to)
            onClose()
            if (items.length) openTurnIntoList(items)
            else useUI.getState().toast(t('features.kit.toList.none'))
          },
        },
        A('explain', t('features.ai.act.explain'), 'EXP', MessageCircleQuestion, gRead, 'explain erklären'),
        A('summarize', t('features.ai.act.summarize'), 'SUM', AlignLeft, gRead, 'summary zusammenfassen tldr'),
        A('action_items', t('features.ai.act.actionItems'), 'ACT', ListChecks, gRead, 'todo tasks aufgaben'),
        // One memory: Claude condenses the selection into one proposal (saved only on OK)
        {
          id: 'remember',
          label: t('features.memory.menu.rememberThis'),
          code: 'MEM',
          icon: BookMarked,
          group: gWs,
          keywords: 'remember memory keep merken gedächtnis erinnern',
          run: () => start({ kind: 'memory', label: t('features.memory.menu.rememberThis'), code: 'MEM', text: own.t.selected, from: 'selection' }),
        },
        // … or the selected blocks as an EXAMPLE ("take #tag as the template"): the dialog asks for the tag
        {
          id: 'remember-example',
          label: t('features.memory.example.menuSelection'),
          code: 'EX',
          icon: BookMarked,
          group: gWs,
          keywords: 'example template pattern beispiel vorlage muster',
          run: () => {
            const blocks = editor.state.doc.slice(own.t.from, own.t.to).content.toJSON() as JSONContent[] | null
            onClose()
            useUI.getState().openModal({ type: 'memoryExample', pageId, blocks: blocks ?? [] })
          },
        },
        agent,
        reads,
      ]
    return [
      A('continue', t('features.ai.act.continue'), 'CNT', ArrowRightToLine, gWrite, 'continue weiter'),
      prefill('outline', t('features.ai.act.outline'), 'OUT', ListTree, gWrite, t('features.ai.prefill.outline')),
      prefill('brainstorm', t('features.ai.act.brainstorm'), 'IDEA', Lightbulb, gWrite, t('features.ai.prefill.brainstorm')),
      A('summarize', t('features.ai.act.summarizePage'), 'SUM', AlignLeft, gPage, 'summary zusammenfassen tldr'),
      A('action_items', t('features.ai.act.actionItemsPage'), 'ACT', ListChecks, gPage, 'todo tasks aufgaben'),
      redoAction,
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
      reads,
    ]
  }, [t, own.t.mode, own.t.todb, start, startPageLevel, handToAgent, pickRedo, editor, own, pageId, onClose, transformPicks, transformRun])

  /** text · several blocks (two or more, or a list / table) · an image · a file · the cursor (no selection) */
  const menuKind: MenuKind =
    own.t.mode !== 'selection' ? 'block' : img ? 'image' : file ? 'file' : transformPicks.length && !editor.isDestroyed && severalBlocks(editor, own.t.range) ? 'blocks' : 'text'
  const isTop = useCallback(
    (a: ActionDef) => TOP_ACTIONS[menuKind].includes(a.id) || (menuKind === 'image' && a.id.startsWith('img-')) || (menuKind === 'file' && a.id.startsWith('file-')),
    [menuKind],
  )
  /** "More …": everything off the top level, in its groups ("What Claude reads…" included — elsewhere typed for only) */
  const moreActions = useMemo(() => actions.filter((a) => !isTop(a) && (!a.hidden || a.id === 'reads')), [actions, isTop])

  type Row = { id: string; label: ReactNode; code?: string; icon?: LucideIcon; group?: string; run: () => void; hint?: ReactNode; danger?: boolean; disabled?: boolean; current?: boolean; sub?: boolean }

  /* ---------------- One memory ---------------- */

  const memInUse = useWorkspace(() => memoryInUse())
  const remembering = !!query.trim() && isRememberRequest(query) && !img?.only && !file?.only
  /** the typed text would go to Claude as an own request (or a revision): its memory preview shows */
  const previewing = memInUse && !!query.trim() && !remembering && !wsMode && !img?.only && !file?.only && !redoIds && (view === 'actions' || view === 'memory' || view === 'memhist') && phase !== 'streaming' && run?.req.kind !== 'todb' && run?.req.kind !== 'memory' && run?.req.kind !== 'transform' && run?.req.kind !== 'file'
  const preview = useMemoryPreview(query.trim(), previewing, memOff)
  /** the line under the reads line: the preview while typing, else what the shown run took along */
  const lineUse = previewing ? preview : !query.trim() && run?.req.kind === 'action' ? (run.memory ?? null) : null

  /** a memory run: its proposal (as edited here) and a near-identical memory it would repeat */
  const memProposal: MemoryProposal | null = run?.req.kind === 'memory' && phase === 'done' ? (memDraft ?? run.proposals?.[0] ?? null) : null
  const memDup = useMemo(() => (memProposal ? duplicateOf(memProposal) : null), [memProposal])
  const memDupText = useMemo(() => (memDup ? (readMemories().find((m) => m.id === memDup)?.text ?? null) : null), [memDup])
  const saveMem = (asNew: boolean) => {
    if (!run || !memProposal) return
    if (!confirmProposal(memProposal, asNew ? null : memDup)) return
    removeRun(run.id)
    onClose()
  }

  const isRedo = run?.req.kind === 'redo'
  /** the instructions card shows: passages marked, nothing running yet (or "Change instructions") */
  const redoCard = !!redoIds && (phase === 'idle' || redoEdit)
  /** the generate card shows: opened to generate, nothing running yet (or "Change prompt") */
  const genCard = !!genDraft && !redoCard && (phase === 'idle' || genEdit)

  /** "#wo" being typed at the end of the prompt (an example's tag to complete), null: none */
  const tagQuery = memInUse && phase !== 'streaming' && view === 'actions' ? (/(^|\s)#([a-z0-9-]{0,32})$/i.exec(query)?.[2]?.toLowerCase() ?? null) : null
  const completeTag = (tag: string) => {
    setQuery(query.replace(/#([a-z0-9-]{0,32})$/i, `#${tag} `))
    setActive(0)
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  /** "MEMORY · 3" opened: the memories (→ the entry), history, the per-request switch, the databases */
  const memoryRows = (): Row[] => {
    const out: Row[] = []
    const use = lineUse
    const group = previewing ? t('features.memory.list.forRequest') : t('features.memory.list.usedBy')
    if (use?.off) out.push({ id: 'mem-none', label: t('features.memory.list.off'), group, run: () => {}, disabled: true })
    else if (!use?.items.length) out.push({ id: 'mem-none', label: t('features.memory.list.none'), group, run: () => {}, disabled: true })
    for (const it of use && !use.off ? use.items : [])
      out.push({
        id: `mem-${it.id}`,
        label: it.text,
        code: it.label,
        icon: BookMarked,
        group,
        run: () => openEntry(it.id),
        hint: <span className="ai-row__mem">{it.forced ? t('features.memory.example.forced', { tag: it.forced }) : t(`features.memory.type.${it.type}`)}</span>,
      })
    const g2 = t('features.memory.list.title')
    if (previewing) out.push({ id: 'mem-toggle', label: t('features.memory.list.useOn'), icon: SquareCheck, group: g2, current: !memOff, run: () => setMemOff((v) => !v), code: memOff ? 'OFF' : 'ON' })
    if (use?.items.length && !use.off)
      out.push({
        id: 'mem-history',
        label: t('features.memory.list.history'),
        icon: History,
        group: g2,
        run: () => {
          setHistOf(null)
          setView('memhist')
          setActive(0)
        },
      })
    out.push({ id: 'mem-open', label: t('features.memory.list.open'), icon: Library, group: g2, run: openMemoryDb })
    out.push({ id: 'mem-log', label: t('features.memory.list.log'), icon: History, group: g2, run: openMemoryLog })
    return out
  }

  /** "History": every use of the listed memories (the memory log, newest first) → the log row */
  const historyRows = (): Row[] => {
    const items = lineUse && !lineUse.off ? lineUse.items.filter((x) => !histOf || x.id === histOf) : []
    const out: Row[] = [
      {
        id: 'memh-back',
        label: t('features.memory.history.back'),
        icon: ArrowLeft,
        run: () => {
          setView('memory')
          setActive(0)
        },
      },
    ]
    const fmt = (ms: number) => new Date(ms).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    for (const it of items) {
      const group = t('features.memory.list.historyOf', { label: `${it.label} · ${it.text}` })
      const uses = memoryHistory(it.id, 8)
      if (!uses.length) out.push({ id: `memh-none-${it.id}`, label: t('features.memory.history.none'), group, run: () => {}, disabled: true })
      for (const u of uses)
        out.push({
          id: `memh-${it.id}-${u.id}`,
          label: u.task || u.where,
          code: fmt(u.at),
          icon: u.cited ? BookMarked : History,
          group,
          run: () => openEntry(u.id),
          hint: <span className="ai-row__mem">{u.cited ? `${u.where} · ${t('features.memory.list.cited')}` : u.where}</span>,
        })
    }
    return out
  }

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (setup) return []
    if (phase === 'streaming') return []
    if (view === 'reads') {
      const m = marks ? effectiveMode(marks) : 'page'
      const group = t('features.ai.reads.title')
      const blocks = marks?.marked ?? 0
      const n = (x: number) => x.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
      return [
        { id: 'reads-page', label: t('features.ai.reads.opt.page'), icon: FileText, group, current: m === 'page', run: () => chooseMode('page'), code: 'ALL' },
        {
          id: 'reads-marked',
          label: blocks ? t('features.ai.reads.opt.marked') : t('features.ai.reads.opt.markedFirst'),
          icon: SquareCheck,
          group,
          current: m === 'marked',
          run: () => chooseMode('marked'),
          code: blocks ? t(`features.ai.reads.blocks.${blocks === 1 ? 'one' : 'other'}`, { count: n(blocks) }).toUpperCase() : 'MRK',
        },
        { id: 'reads-pick', label: t('features.ai.reads.opt.mark'), icon: SquareDashed, group, run: pickBlocks, code: 'PICK' },
        { id: 'reads-none', label: t('features.ai.reads.opt.none'), icon: EyeOff, group, current: m === 'none', run: () => chooseMode('none'), code: 'NONE' },
      ]
    }
    if (view === 'memory') return memoryRows()
    if (view === 'memhist') return historyRows()
    // "Redo with instructions": the instructions card has its own keys
    if (redoCard) return []
    // "Generate image / video": the card has its own keys
    if (genCard) return []
    // a memory proposal (One memory): save · update the near-identical one · edit · discard
    if (phase === 'done' && run?.req.kind === 'memory') {
      const req = run.req
      if (memEdit) return []
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
            run: () => start({ ...req, text: `${req.text}\n\n${query.trim()}` }),
          },
        ]
      const out: Row[] = memDup
        ? [
            { id: 'mem-update', label: t('features.memory.menu.update'), icon: Check, run: () => saveMem(false), hint: <Kbd>↵</Kbd> },
            { id: 'mem-new', label: t('features.memory.menu.saveNew'), icon: BookMarked, run: () => saveMem(true) },
          ]
        : [{ id: 'mem-save', label: t('features.memory.menu.save'), icon: Check, run: () => saveMem(false), hint: <Kbd>↵</Kbd> }]
      out.push({ id: 'mem-edit', label: t('features.memory.menu.edit'), icon: PenLine, run: () => setMemEdit(true) })
      out.push({ id: 'discard', label: t('features.memory.menu.discard'), icon: Trash2, run: discard, hint: <Kbd>esc</Kbd>, danger: true })
      return out
    }
    if (phase === 'done' || phase === 'error') {
      if (q)
        return [
          {
            id: 'refine',
            label: (
              <>
                {/* after a local conversion of a file the text is a question about it */}
                {fileLocal ? fileAskLabel(t, fileLocal) : t('features.ai.refine')} <span className="ai-quote">“{query.trim()}”</span>
              </>
            ),
            code: fileLocal ? 'ASK' : 'REF',
            icon: CornerDownLeft,
            run: () =>
              run?.req.kind === 'generate'
                ? start({ ...run.req, prompt: [run.req.prompt, query.trim()].join('\n') })
                : run?.req.kind === 'image'
                ? start(refineImage(run.req, query))
                : run?.req.kind === 'file'
                ? start(refineFile(t, run.req, query))
                : run?.req.kind === 'transform'
                ? transformPanel.again(query)
                : run?.req.kind === 'todb'
                ? start({ kind: 'todb', label: run.req.label, code: 'DB', instruction: query.trim() })
                : run?.req.kind === 'redo'
                  ? redoAgain(query)
                  : start({
                      kind: 'action',
                      action: 'custom',
                      label: t('features.ai.refineLabel'),
                      code: 'REF',
                      instruction: query.trim(),
                      input: output || target.selected,
                      refine: true,
                      ...(memOff ? { memoryOff: true } : {}),
                    }),
          },
        ]
      // a generation: Insert selected / Try again / Change prompt / Discard
      if (generatePanel.rows) return generatePanel.rows
      // an image result: its own keys (Apply / Insert below / as table · spreadsheet · database / Upload a copy)
      if (imagePanel.rows) return imagePanel.rows
      // a file result: its own keys (Create the page / Insert below / as spreadsheet · table · database / Upload a copy)
      if (filePanel.rows) return filePanel.rows
      const out: Row[] = []
      const todb = run?.req.kind === 'todb'
      const transform = run?.req.kind === 'transform'
      // a redo result: the review decides passage by passage; here only "other instructions" and discard
      if (phase === 'done' && isRedo)
        return [
          { id: 'redo-edit', label: t('features.ai.redo.edit'), icon: PenLine, run: editRedo },
          { id: 'discard', label: t('features.ai.res.discard'), icon: Trash2, run: discard, hint: <Kbd>esc</Kbd>, danger: true },
        ]
      if (phase === 'done' && todb) {
        if (table)
          out.push({
            id: 'convert',
            label: todbInPlace ? t('features.ai.todb.convert') : t('features.ai.todb.convertEnd'),
            code: t(`features.ai.todb.view.${effectiveView(table.plan, table.draft)}`).toUpperCase(),
            icon: SquareKanban,
            run: () => void convert(),
            hint: <Kbd>↵</Kbd>,
          })
      } else if (transform) {
        // "Transform into": Transform (Enter) — the forms and options are in the preview above
        if (transformPanel.apply) out.push(transformPanel.apply)
      } else if (phase === 'done') {
        const ws = run?.req.kind === 'workspace'
        const sel = target.mode === 'selection'
        const replace: Row | null =
          sel && !ws ? { id: 'replace', label: t('features.ai.res.replace'), icon: Check, run: () => void apply('replace'), hint: target.lost ? undefined : <Kbd>↵</Kbd>, disabled: !!target.lost } : null
        const insert: Row = {
          id: 'insert',
          label: sel || !targetBlockEmpty() ? t('features.ai.res.below') : t('features.ai.res.insert'),
          icon: ArrowDownToLine,
          run: () => void apply(sel ? 'below' : 'fill'),
          hint: (sel && !ws && !target.lost) ? undefined : <Kbd>↵</Kbd>,
        }
        // the selected text is gone: Insert goes first (to the end of the page), Replace stays visible but off
        if (replace && !target.lost) out.push(replace, insert)
        else if (replace) out.push(insert, replace)
        else out.push(insert)
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
      out.push({ id: 'discard', label: todb ? t('common.cancel') : t('features.ai.res.discard'), icon: Trash2, run: discard, hint: <Kbd>esc</Kbd>, danger: true })
      return out
    }
    if (ask) {
      return [
        { id: 'ask-whole', label: t('features.ai.reads.runWhole'), code: 'ALL', icon: FileText, run: () => {
          setContextMode(editor, 'page')
          const req = ask.req
          setAsk(null)
          start(req)
        }, hint: <Kbd>↵</Kbd> },
        { id: 'ask-pick', label: t('features.ai.reads.opt.mark'), icon: SquareCheck, run: () => {
          setAsk(null)
          pickBlocks()
        } },
        { id: 'ask-back', label: t('features.ai.reads.back'), icon: ArrowLeft, run: () => {
          setAsk(null)
          requestAnimationFrame(() => inputRef.current?.focus())
        } },
      ]
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
    if (view === 'transform') {
      const group = t('features.ai.transform.title')
      const picks: Row[] = transformPicks
        .filter((p) => !q || typeLabel(p).toLowerCase().includes(q) || TRANSFORM_CODES[p].toLowerCase().startsWith(q) || TRANSFORM_KEYWORDS[p].includes(q))
        .map((p) => ({
          id: `trf-${p}`,
          label: typeLabel(p),
          code: TRANSFORM_CODES[p],
          icon: TRANSFORM_ICONS[p],
          group,
          hint: <span className="trf-hint">{t(`features.ai.transform.hint.${p}`)}</span>,
          run: () => transformRun(p),
        }))
      // "Pages + table": Sub-page per item, no Claude (editor/split/items.ts)
      const pages = actions.find((a) => a.id === 'pagesPerItem' && !a.hidden)
      const label = t('editor.split.items.transform')
      if (!pages || (q && !label.toLowerCase().includes(q) && !pages.keywords?.includes(q))) return picks
      return [...picks, { id: 'trf-pages', label, code: pages.code, icon: pages.icon, group, hint: <span className="trf-hint">{t('editor.split.items.hint')}</span>, run: pages.run }]
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
    // "#wo…": the examples of the One memory — Enter / Tab completes the tag
    if (tagQuery !== null) {
      const hits = examples()
        .filter((m) => m.tag.startsWith(tagQuery))
        .slice(0, 6)
      if (hits.length)
        return hits.map((m) => ({
          id: `tag-${m.id}`,
          label: `#${m.tag}`,
          code: 'TAG',
          icon: BookMarked,
          group: t('features.memory.example.complete'),
          hint: <span className="ai-row__mem">{m.text}</span>,
          run: () => completeTag(m.tag),
        }))
    }
    // "More …": the rest, in their groups (typing searches everything again, as on the top level)
    if (view === 'more' && !q) return moreActions.map(({ hidden: _hidden, keywords: _keywords, ...a }) => ({ ...a }))
    const matched = q
      ? actions.filter((a) => a.label.toLowerCase().includes(q) || a.code.toLowerCase().startsWith(q) || a.keywords?.toLowerCase().includes(q))
      : actions.filter((a) => !a.hidden && isTop(a))
    // the image alone is selected: a typed request is a question about it
    const imageAsk: Row | null =
      q && img
        ? {
            id: 'ask-image',
            label: (
              <>
                {t('features.ai.image.act.ask')} <span className="ai-quote">“{query.trim()}”</span>
              </>
            ),
            code: 'ASK',
            icon: MessageSquareText,
            run: () => startImage('ask', query.trim()),
          }
        : null
    // the file alone is selected: a typed request is a question about it
    const fileAsk: Row | null =
      q && file
        ? {
            id: 'ask-file',
            label: (
              <>
                {fileAskLabel(t, file.hit.kind)} <span className="ai-quote">“{query.trim()}”</span>
              </>
            ),
            code: 'ASK',
            icon: MessageSquareText,
            run: () => startFile('ask', query.trim()),
          }
        : null
    const custom: Row | null = q && !img?.only && !file?.only
      ? {
          id: 'custom',
          label: (
            <>
              {t('features.ai.askClaude')} <span className="ai-quote">“{query.trim()}”</span>
            </>
          ),
          code: 'ASK',
          icon: CornerDownLeft,
          run: () => start({ kind: 'action', action: 'custom', label: t('features.ai.custom'), code: 'ASK', instruction: query.trim(), ...(memOff ? { memoryOff: true } : {}) }),
          hint: mcpNames ? (
            <span className="ai-row__mcp" title={t('features.ai.mcp.uses', { names: mcpNames })}>
              + {mcpNames}
            </span>
          ) : undefined,
        }
      : null
    const list: Row[] = matched.map(({ hidden: _hidden, keywords: _keywords, ...a }) => ({ ...a }))
    if (!q && moreActions.length)
      list.push({
        id: 'more',
        label: t('features.ai.menu.more'),
        code: `+${moreActions.length}`,
        icon: MoreHorizontal,
        sub: true,
        run: () => {
          setView('more')
          setQuery('')
          setActive(0)
          requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
        },
      })
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
    // an own request that is really a structure action, or work for the AI terminal (intent.ts): that key first, Enter runs it
    const intent = q && !img?.only && !file?.only && !remembering ? requestIntent(query, { selection: own.t.mode === 'selection', servers: mcpNames ? mcpNames.split(' · ') : [] }) : null
    const routed = intent && intent !== 'terminal' ? actions.find((a) => a.id === (intent === 'todb' ? 'todb' : intent)) : null
    if (routed || intent === 'terminal') {
      const at = list.findIndex((r) => r.id === routed?.id)
      if (at >= 0) list.splice(at, 1)
      const quote = <span className="ai-quote">“{query.trim()}”</span>
      list.unshift(
        routed
          ? { id: `intent-${routed.id}`, label: <>{routed.label} {quote}</>, code: routed.code, icon: routed.icon, run: routed.id === 'todb' ? () => start({ kind: 'todb', label: routed.label, code: 'DB', instruction: query.trim() }) : routed.run }
          : { id: 'intent-terminal', label: <>{t('features.agent.intent.terminal')} {quote}</>, code: 'AGT', icon: Workflow, run: () => handToTerminal(query.trim()) },
      )
    }
    if (imageAsk) list.unshift(imageAsk)
    if (fileAsk) list.unshift(fileAsk)
    // "remember …" / "merk dir …": a memory proposal, not an answer
    if (remembering)
      list.unshift({
        id: 'remember-req',
        label: (
          <>
            {t('features.memory.menu.remember')} <span className="ai-quote">“{stripRemember(query)}”</span>
          </>
        ),
        code: 'MEM',
        icon: BookMarked,
        run: () => start({ kind: 'memory', label: t('features.memory.menu.label'), code: 'MEM', text: query.trim(), from: 'request' }),
      })
    return list
  }, [query, setup, phase, wsMode, view, actions, t, start, output, target, run, error, discard, sources, handToAgent, handToTerminal, mcpNames, onClose, table, todbInPlace, ask, marks, lang, chooseMode, pickBlocks, redoCard, genCard, generatePanel.rows, isRedo, imagePanel.rows, img, filePanel.rows, file, lineUse, memOff, previewing, histOf, memEdit, memDup, remembering, tagQuery, transformPicks, transformRun, transformPanel.apply, isTop, moreActions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, rows.length - 1)))
  }, [rows.length])

  // opened on a submenu (the grip menu's "Turn into database…", the tour): there, the asked row highlighted
  const openedOn = useRef(false)
  useEffect(() => {
    if (!openOn || openRun || setup || openedOn.current) return
    openedOn.current = true
    if (openOn === 'transform' && transformPicks.length) return setView('transform')
    if (openOn === 'todb' && moreActions.some((a) => a.id === 'todb')) {
      setView('more')
      requestAnimationFrame(() => setActive(Math.max(0, moreActions.findIndex((a) => a.id === 'todb'))))
    }
  }, [openOn, openRun, setup, transformPicks, moreActions])

  useEffect(() => {
    setActive(0)
  }, [query, view, wsMode])

  // an image result switched its keys (the tables → "As database…" and back): the first key again
  useEffect(() => {
    if (imagePanel.mode) setActive(0)
  }, [imagePanel.mode])

  // a file result switched its keys (the data → "As database…" and back): the first key again
  useEffect(() => {
    if (filePanel.mode) setActive(0)
  }, [filePanel.mode])

  // a transform run shows another form / finished: Transform is the key again
  useEffect(() => {
    if (transformPanel.mode) setActive(0)
  }, [transformPanel.mode])

  // the current choice is highlighted when the reads view opens
  useEffect(() => {
    if (view !== 'reads') return
    const m = marks ? effectiveMode(marks) : 'page'
    setActive(m === 'page' ? 0 : m === 'marked' ? 1 : 3)
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

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
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !query && run?.req.kind === 'transform') {
      // "Transform into": ←/→ in the empty prompt = the previous / next form
      if (transformPanel.step(e.key === 'ArrowLeft' ? -1 : 1)) e.preventDefault()
    } else if (e.key === 'ArrowRight' && !query && phase === 'idle' && rows[active]?.sub) {
      // a submenu row (Translate, Transform into, More): → opens it
      e.preventDefault()
      rows[active].run()
    } else if (e.key === 'ArrowLeft' && !query && phase === 'idle' && (view === 'more' || view === 'translate' || view === 'transform')) {
      e.preventDefault()
      setView('actions')
    } else if (e.key === 'Tab' && !e.shiftKey && rows[active]?.id.startsWith('tag-')) {
      e.preventDefault()
      rows[active].run()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (phase === 'streaming') return
      const row = rows[active]
      if (row && !row.disabled) row.run()
    } else if (e.key === 'Backspace' && !query) {
      if (ask) {
        e.preventDefault()
        setAsk(null)
      } else if (view === 'translate' || view === 'reads' || view === 'memory' || view === 'transform' || view === 'more') {
        e.preventDefault()
        setView('actions')
      } else if (view === 'memhist') {
        e.preventDefault()
        setView('memory')
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
    phase === 'done' || phase === 'error' ? (fileLocal ? 'file' : 'refine') : wsMode ? 'workspace' : view === 'translate' ? 'language' : view === 'transform' ? 'transform' : img && view === 'actions' ? 'image' : file && view === 'actions' ? 'file' : target.mode === 'selection' ? 'selection' : 'block'
  const placeholder = t(`features.ai.placeholder.${phKey}${narrow ? 'Short' : ''}`)

  /** Back from the key card to the panel (re-running a request that failed for lack of a key). */
  function leaveSetup() {
    setSetup(false)
    if (phase === 'error' && run) start(run.req)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const busy = phase === 'streaming'
  const showOutput = phase !== 'idle' && !setup && !redoCard && !genCard
  /** the line under the prompt on the top level: ask in your own words, or pick */
  const leadShown = phase === 'idle' && view === 'actions' && !query && !wsMode && !ask && !redoCard && !genCard && !openRun && rows.length > 0
  const isTodb = run?.req.kind === 'todb'
  const isMemory = run?.req.kind === 'memory'
  const isTransform = run?.req.kind === 'transform'
  const isGen = run?.req.kind === 'generate'
  const todbBlocks = isTodb && target.todb && !editor.isDestroyed ? countBlocks(editor, target.todb) : 0
  const words = output.trim() ? output.trim().split(/\s+/).length : 0
  /** the passages the instructions card would send (they recount as the page changes) */
  const redoSent = useMemo(() => (redoCard && redoIds && !editor.isDestroyed ? capturePassages(editor, redoIds).filter((p) => !p.skip) : []), [redoCard, redoIds, editor, marks])
  /** what the next request reads (the line under the prompt); "Transform into" reads the selected blocks only */
  const readsNow: RunReads = redoCard
    ? redoReads(readsFor(marks, null), redoSent.length, redoSent.reduce((n, p) => n + countWords(p.anchor), 0))
    : wsMode && phase === 'idle'
      ? { ...readsFor(marks, null), workspace: true }
      : (isTransform || view === 'transform') && target.mode === 'selection'
        ? { mode: 'none', selection: true, blocks: 0, words: countWords(target.selected) }
        : readsFor(marks, target.mode === 'selection' && !img?.only && !file?.only ? target.selected : null)
  /** a redo result is under review: the review has the keyboard (no prompt, no reads line) */
  const reviewing = isRedo && phase === 'done' && !redoEdit
  /** the prompt gives way to a title while the instructions card or the review shows */
  const redoHead = (redoCard || reviewing || genCard) && view !== 'reads'

  let lastGroup: string | undefined
  return (
    <>
      {target.mode === 'selection' && !target.lost && !picking && !redoIds && !isRedo && !img?.only && !file?.only && run?.req.kind !== 'image' && run?.req.kind !== 'file' && <SelectionShade editor={editor} from={target.from} to={target.to} />}
      <Popover open={!picking} anchor={anchor} onClose={onPopoverClose} placement="bottom-start" offset={8} bare className="ai-panel" resizable="ai-menu" role="dialog" aria-label={t('features.ai.title')}>
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
              {view === 'transform' && phase === 'idle' && (
                <button className="ai-chip" onClick={() => setView('actions')}>
                  <ArrowLeft size={11} strokeWidth={2} /> {t('features.ai.transform.title')}
                </button>
              )}
              {view === 'more' && phase === 'idle' && (
                <button className="ai-chip" onClick={() => setView('actions')}>
                  <ArrowLeft size={11} strokeWidth={2} /> {t('features.ai.menu.moreTitle')}
                </button>
              )}
              {view === 'reads' && (
                <button className="ai-chip" onClick={() => setView('actions')}>
                  <ArrowLeft size={11} strokeWidth={2} /> {t('features.ai.reads.title')}
                </button>
              )}
              {(view === 'memory' || view === 'memhist') && (
                <button className="ai-chip" onClick={() => setView(view === 'memhist' ? 'memory' : 'actions')}>
                  <ArrowLeft size={11} strokeWidth={2} /> {t('features.memory.list.title')}
                </button>
              )}
              {redoHead ? (
                genCard ? (
                  <span className="ai-cmd__title label" data-testid="ai-gen-title">
                    {t('features.ai.gen.title')}
                  </span>
                ) : // the review quotes what was asked
                reviewing && run?.req.kind === 'redo' && run.req.instructions ? (
                  <span className="ai-cmd__title ai-cmd__title--quote" data-testid="ai-redo-title" title={run.req.instructions}>
                    “{run.req.instructions.replace(/\s+/g, ' ')}”
                  </span>
                ) : (
                  <span className="ai-cmd__title label" data-testid="ai-redo-title">
                    {t('features.ai.redo.label')}
                  </span>
                )
              ) : (
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
                  aria-describedby={leadShown ? 'ai-lead' : undefined}
                  aria-activedescendant={rows[active] ? `ai-row-${rows[active].id}` : undefined}
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
              {/* "kb: …" — the query goes to Claude as an own request / a revision: the addressed server shows */}
              {!busy && !wsMode && !redoHead && view === 'actions' && run?.req.kind !== 'todb' && run?.req.kind !== 'transform' && <CodewordChip text={query} />}
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

            {!reviewing && !genCard && !isGen && (
              <button
                type="button"
                className="ai-reads"
                data-mode={readsNow.workspace ? 'workspace' : readsNow.mode}
                data-open={view === 'reads' || undefined}
                data-testid="ai-reads"
                disabled={busy}
                aria-expanded={view === 'reads'}
                title={t('features.ai.reads.change')}
                onClick={() => {
                  setAsk(null)
                  setView((v) => (v === 'reads' ? 'actions' : 'reads'))
                  requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
                }}
              >
                <span className={`led${readsNow.mode === 'none' && !readsNow.selection && !readsNow.workspace ? '' : ' led--on'}`} aria-hidden />
                <span className="ai-reads__k">{t('features.ai.reads.label')}</span>
                <span className="ai-reads__sep" aria-hidden>
                  ·
                </span>
                {(img || run?.req.kind === 'image') && <span className="ai-reads__img">{t('features.ai.image.readsImage')}</span>}
                {(run ? run.req.kind === 'file' && !isLocalAction(run.req.action) : !!file) && <span className="ai-reads__file">{t('features.ai.file.readsFile')}</span>}
                <span className="ai-reads__v">{readsText(t, lang, readsNow, marks ?? undefined)}</span>
                <ChevronDown className="ai-reads__chev" size={12} strokeWidth={1.8} aria-hidden />
              </button>
            )}

            {lineUse && !reviewing && view !== 'reads' && (
              <MemoryLine
                use={lineUse}
                open={view === 'memory' || view === 'memhist'}
                disabled={busy}
                onToggle={() => {
                  setAsk(null)
                  setView((v) => (v === 'memory' || v === 'memhist' ? 'actions' : 'memory'))
                  setActive(0)
                  requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
                }}
              />
            )}

            {previewing && !!preview?.unknownTags?.length && (
              <p className="ai-lost ai-ask" role="note" data-testid="ai-memory-unknown">
                {preview.unknownTags.map((tag) => t('features.memory.example.unknown', { tag })).join(' ')}
              </p>
            )}

            {ask && (
              <p className="ai-lost ai-ask" role="note" data-testid="ai-reads-ask">
                {t('features.ai.reads.needs', { action: ask.label })}
              </p>
            )}

            {redoCard && redoIds && view !== 'reads' && (
              <RedoSetup
                editor={editor}
                ids={redoIds}
                draft={redoDraft}
                onDraft={setRedoDraft}
                onRun={(req) => {
                  setRedoEdit(false)
                  start(req)
                }}
                onRepick={() => pickRedo(redoIds)}
                onCancel={() => {
                  if (redoEdit) return setRedoEdit(false)
                  if (redo?.length) return dismiss()
                  setRedoIds(null)
                  requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
                }}
              />
            )}

            {genCard && genDraft && view !== 'reads' && (
              <GenerateSetup
                draft={genDraft}
                onDraft={setGenDraft}
                hasKey={hasKey}
                onRun={(req) => {
                  setGenEdit(false)
                  start(req)
                }}
                onCancel={() => {
                  if (genEdit) return setGenEdit(false)
                  dismiss()
                }}
              />
            )}

            {showOutput && (
              <div className="ai-out" data-phase={phase}>
                <div className="ai-out__bar label">
                  <span className="ai-out__code">{run?.req.code}</span>
                  <span className="ai-out__title">{run?.req.label}</span>
                  <span className="ai-out__spacer" />
                  {run?.reads && (
                    <>
                      <span className="ai-out__reads" title={t('features.ai.reads.spec', { what: readsText(t, lang, run.reads) })} data-testid="ai-run-reads">
                        {run.req.kind === 'image' ? `${t('features.ai.image.readsImage')} ` : run.req.kind === 'file' ? `${t('features.ai.file.readsFile')} ` : ''}
                        {readsShort(t, lang, run.reads)}
                      </span>
                      <span className="ai-out__sep">·</span>
                    </>
                  )}
                  {run && <Elapsed start={run.startedAt} end={run.finishedAt ?? undefined} />}
                  {!isTodb && !isRedo && !isMemory && !isTransform && !isGen && !imagePanel.structured && !filePanel.structured && (
                    <>
                      <span className="ai-out__sep">·</span>
                      <span>{t('features.ai.words', { count: words })}</span>
                    </>
                  )}
                  {busy && (
                    <button className="ai-stop" onClick={stop}>
                      <Square size={9} fill="currentColor" strokeWidth={0} /> {t('features.ai.stop')}
                    </button>
                  )}
                </div>
                {mcpCalls.length > 0 && <McpChips calls={mcpCalls} />}
                {generatePanel.body}
                {imagePanel.body}
                {filePanel.body}
                {transformPanel.body}
                {isTodb && busy && (
                  <div className="ai-out__body">
                    <div className="ai-wait label">
                      {todbBlocks === 1 ? t('features.ai.todb.readingOne') : t('features.ai.todb.reading', { n: todbBlocks })}
                      <span className="ai-wait__dots" aria-hidden />
                    </div>
                  </div>
                )}
                {isTodb && table && run && (
                  <TodbPreview plan={table.plan} draft={table.draft} onDraft={(draft) => setTodbDraft(run.id, draft)} gists={table.gists} onConvert={() => void convert()} />
                )}
                {isRedo && busy && run?.req.kind === 'redo' && (
                  <div className="ai-out__body">
                    <div className="ai-wait label" data-testid="ai-redo-wait">
                      {t(`features.ai.redo.working.${run.req.passages.filter((p) => !p.skip).length === 1 ? 'one' : 'other'}`, { count: run.req.passages.filter((p) => !p.skip).length })}
                      <span className="ai-wait__dots" aria-hidden />
                    </div>
                  </div>
                )}
                {reviewing && run?.redo && <RedoReview run={run} editor={editor} pageId={pageId} onDone={onClose} />}
                {isMemory && busy && (
                  <div className="ai-out__body">
                    <div className="ai-wait label">
                      {t('features.memory.menu.working')}
                      <span className="ai-wait__dots" aria-hidden />
                    </div>
                  </div>
                )}
                {memProposal && (
                  <div className="ai-out__body ai-out__body--mem" data-testid="ai-memory-card">
                    {memEdit ? (
                      <MemoryEdit
                        p={memProposal}
                        onSave={(next) => {
                          setMemDraft(next)
                          setMemEdit(false)
                          requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
                        }}
                        onCancel={() => {
                          setMemEdit(false)
                          requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
                        }}
                        saveLabel={t('features.memory.edit.save')}
                      />
                    ) : (
                      <MemoryBodyView p={memProposal} dup={memDupText ? { text: memDupText } : null} />
                    )}
                  </div>
                )}
                {!isTodb && !isRedo && !isMemory && !isTransform && !isGen && !imagePanel.structured && !filePanel.structured && !run?.imageIssue && !run?.fileIssue && (output || busy) && (
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
                {/* media an MCP server returned with an own request: cards, saved below the target on a click */}
                {run?.req.kind === 'action' && !!run.media?.length && (
                  <MediaCards items={run.media} onSaved={(saved) => insertMedia(saved.map(mediaNode), 'below')} privateTarget={pagePrivate(pageId)} where={t('features.ai.media.whereMenu')} />
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
                {phase === 'done' && target.lost && !isRedo && !isTransform && (
                  <p className="ai-lost" role="note" data-testid="ai-lost">
                    {isTodb ? t('features.ai.bg.lostTodb') : t('features.ai.bg.lost')}
                  </p>
                )}
                {phase === 'done' && isTodb && !target.lost && table && !todbInPlace && (
                  <p className="ai-lost" role="note" data-testid="ai-lost">
                    {t('features.ai.bg.lostTodb')}
                  </p>
                )}
                {error && <ErrorNote error={error} model={model.name} />}
                {interrupted && (
                  <div className="ai-error" role="alert">
                    <span className="ai-error__code label">ERR · INTERRUPTED</span>
                    <p>{t('features.ai.bg.interrupted')}</p>
                  </div>
                )}
                {issue && (
                  <div className="ai-error" role="alert">
                    <span className="ai-error__code label">ERR · {ISSUE_CODES[issue]}</span>
                    <p>{t(`features.ai.todb.err.${issue}`)}</p>
                  </div>
                )}
              </div>
            )}

            {leadShown && (
              <p className="ai-lead" id="ai-lead">
                {t('features.ai.menu.leadA')} <Kbd>↵</Kbd> {t('features.ai.menu.leadB')}
              </p>
            )}

            {rows.length > 0 && (
              <div className="ai-list" ref={listRef} role="listbox" data-keys={phase === 'done' || phase === 'error' ? '' : undefined} data-quiet={reviewing || undefined}>
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
                        aria-disabled={r.disabled || undefined}
                        aria-current={r.current || undefined}
                        data-index={i}
                        data-active={i === active}
                        className={`ai-row${r.danger ? ' ai-row--danger' : ''}${r.id === 'more' ? ' ai-row--more' : ''}`}
                        onMouseMove={() => i !== active && setActive(i)}
                        onClick={() => !r.disabled && r.run()}
                      >
                        <span className="ai-row__icon">{Icon ? <Icon size={15} strokeWidth={1.7} /> : null}</span>
                        <span className="ai-row__label">{r.label}</span>
                        {r.current && <span className="led led--on ai-row__cur" aria-hidden />}
                        {r.hint}
                        {r.code && <span className="ai-row__code">{r.code}</span>}
                        {r.sub && <ChevronRight className="ai-row__sub" size={13} strokeWidth={1.8} aria-hidden />}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {phase === 'idle' && wsMode && !query.trim() && <div className="ai-hint">{t('features.ai.wsHint')}</div>}

            {!redoHead && (
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
            )}
          </>
        )}
      </Popover>
    </>
  )
}

/** What a redo request reads: the passages + this page as its context marks allow (marked words come on top). */
function redoReads(base: RunReads, passages: number, words: number): RunReads {
  return { ...base, passages, words: base.words + (base.mode === 'page' ? 0 : words) }
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

const ISSUE_CODES: Record<TodbIssue, string> = { none: 'NO_ENTRIES', bad: 'BAD_ANSWER', changed: 'CHANGED', gone: 'GONE' }

/** A selection that is "several blocks" for the menu: two or more whole blocks, or a whole list / table. */
function severalBlocks(editor: Editor, range: BlockRange | null | undefined): boolean {
  if (!range) return false
  try {
    const $a = editor.state.doc.resolve(range.from)
    const $b = editor.state.doc.resolve(range.to)
    if (!$a.sameParent($b)) return true
    const n = $b.index() - $a.index()
    if (n >= 2) return true
    const only = n === 1 ? $a.parent.child($a.index()) : null
    return !!only && /^(bulletList|orderedList|taskList|table)$/.test(only.type.name)
  } catch {
    return false
  }
}

/** Blocks in a "Turn into database" range (the wait line counts them). */
function countBlocks(editor: Editor, range: BlockRange): number {
  try {
    const $a = editor.state.doc.resolve(range.from)
    const $b = editor.state.doc.resolve(range.to)
    return $a.sameParent($b) ? Math.max(0, $b.index() - $a.index()) : 0
  } catch {
    return 0
  }
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

/** mm:ss.t since `start` (epoch ms), frozen at `end`. */
function Elapsed({ start, end }: { start: number; end?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (end) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
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

/** Tool calls of external MCP servers: "KB · search_records" chips with an LED; failures said politely. */
function McpChips({ calls }: { calls: McpCall[] }) {
  const t = useT()
  const failed = calls.filter((c) => c.state === 'err' && !c.skipped)
  return (
    <div className="ai-mcp">
      <ul className="ai-mcp__list" aria-label={t('features.ai.mcp.calls')}>
        {calls.map((c) =>
          c.skipped ? (
            // a server the codeword addressed that stayed out (switched off, no token here)
            <li key={c.id} className="ai-mcp__chip" data-state="skipped">
              <span className="led" aria-hidden />
              {skippedLabel(t, c)}
            </li>
          ) : (
            <li key={c.id} className="ai-mcp__chip" data-state={c.state} title={c.arg ? `${callLabel(c)} — ${c.arg}` : callLabel(c)}>
              <span className={`led${c.state === 'run' ? ' led--on ai-led--live' : c.state === 'err' ? ' ai-led--err' : ' led--ok'}`} aria-hidden />
              {callLabel(c)}
            </li>
          ),
        )}
      </ul>
      <McpSkippedNote calls={calls} />
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
