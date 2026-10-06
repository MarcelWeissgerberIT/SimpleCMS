/**
 * Block catalog: everything the slash menu can insert, with markdown/keyboard
 * shortcuts shown as a teaching aid. Labels come from messages.ts:
 *   editor.block.<id>  and  editor.block.<id>.desc
 */
import type { Editor, Range } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import {
  AtSign,
  AudioLines,
  Bookmark,
  BookOpenText,
  CalendarDays,
  ChartColumn,
  ChartColumnIncreasing,
  ChartGantt,
  ChevronRight,
  ClipboardPen,
  Code,
  FileSpreadsheet,
  Columns2,
  Columns3,
  Columns4,
  FileSymlink,
  FileText,
  Film,
  Heading1,
  Heading2,
  Heading3,
  Image,
  LayoutGrid,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  ListTree,
  Minus,
  MonitorPlay,
  NotebookPen,
  Network,
  Newspaper,
  PanelTop,
  Paperclip,
  Pi,
  Quote,
  RefreshCw,
  Sheet,
  Shapes,
  Signpost,
  Sigma,
  Smile,
  SquareKanban,
  LayoutDashboard,
  SquareMousePointer,
  SquareCode,
  Lightbulb,
  Table,
  Calendar,
  Clapperboard,
  ImagePlus,
  Rows3,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { useWorkspace, defaultView, type NewDatabaseInput } from '../../store/store'
import { openPage } from '../../lib/router'
import { newId } from '../../lib/ids'
import type { PropertyDef, ViewType } from '../../store/types'
import type { Bridge } from './bridge'
import { insertBlock, moveIntoToggleBody, turnInto, type TurnTarget } from './blocks'
import { dateMentionAttrs } from './dates'
import { markFreshButton } from './buttonRun'
import { actionId } from '../schema/button'
import { caretIntoTabs, newTabsJson, tabsAround } from '../schema/tabs'
import { insertSynced } from '../synced/actions'
import { insertMeetingNotes } from '../schema/meetingNotes'
import { insertSpreadsheet } from '../schema/spreadsheet'
import { insertChart } from '../schema/chart'
import { Columns5, ToggleHeading1, ToggleHeading2, ToggleHeading3 } from './blockGlyphs'
import { toast } from '../../store/ui'
import { freeBoardSpec } from '../../database'
import { t } from '../../i18n'

export type BlockGroup = 'basic' | 'lists' | 'media' | 'database' | 'advanced' | 'ai' | 'inline'
export const GROUPS: BlockGroup[] = ['basic', 'lists', 'media', 'database', 'advanced', 'inline', 'ai']

export interface RunCtx {
  editor: Editor
  pageId: string
  range?: Range | null
  bridge: Bridge
  /** Open a picker for "linked database" (provided by the slash menu). */
  pickDatabase?: () => void
}

/** Items that open a picker in the slash menu instead of inserting right away. */
export type BlockPicker = 'database' | 'page'

export interface BlockItem {
  id: string
  group: BlockGroup
  icon: LucideIcon | 'AI'
  /** Markdown shortcut (typed at the start of a line) */
  md?: string
  /** Keyboard shortcut, "Mod+Alt+1" notation */
  keys?: string
  /** Extra search terms (EN + DE) */
  keywords: string
  turnInto?: TurnTarget
  /** The slash menu opens this picker (the item's `run` is not called). */
  picker?: BlockPicker
  run: (ctx: RunCtx) => void
}

const del = (ctx: RunCtx) => ctx.range && ctx.editor.chain().focus().deleteRange(ctx.range).run()

/** Emoji / icon picker at the caret (icons/InlinePickers.tsx); the caret stays where the command was. */
function openInlinePicker(ctx: RunCtx, kind: 'emoji' | 'icon') {
  del(ctx)
  ctx.bridge.setState({ inlinePicker: { kind, pos: ctx.editor.state.selection.from } })
}

const turn = (target: TurnTarget) => (ctx: RunCtx) => {
  del(ctx)
  // typed in a toggle title: the new block goes into the toggle body
  moveIntoToggleBody(ctx.editor)
  turnInto(ctx.editor, target)
}

/** After navigating to a freshly created page, put the caret into its (empty) title. */
function focusNewPageTitle(id: string, tries = 20) {
  const editorDom = document.querySelector(`.ProseMirror[data-page-id="${id}"]`)
  const title = editorDom?.closest('article')?.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"]')
  if (title && !title.value) {
    title.focus()
    return
  }
  if (tries > 0) window.setTimeout(() => focusNewPageTitle(id, tries - 1), 50)
}

function tableJson(rows: number, cols: number) {
  const cell = (type: string) => ({ type, content: [{ type: 'paragraph' }] })
  return {
    type: 'table',
    content: Array.from({ length: rows }, (_, r) => ({ type: 'tableRow', content: Array.from({ length: cols }, () => cell(r === 0 ? 'tableHeader' : 'tableCell')) })),
  }
}

/** An inline database on this page (its first view of `type`), or one with a ready schema + views. */
function createInlineDatabase(ctx: RunCtx, type: ViewType, input: Pick<NewDatabaseInput, 'title' | 'properties' | 'views'> = {}) {
  const ws = useWorkspace.getState()
  const id = ws.createDatabase({ parentId: ctx.pageId, inline: true, title: '', ...input })
  const db = useWorkspace.getState().databases[id]
  const first = db?.views[0]
  if (db && first && type !== 'table' && !input.views) {
    const { id: _ignore, ...rest } = defaultView(type, db)
    ws.updateView(id, first.id, rest)
  }
  insertBlock(ctx.editor, { type: 'databaseBlock', attrs: { databaseId: id, viewId: null } }, ctx.range)
}

/**
 * "/Form": an inline database whose first view is a form (database/form) with three starter
 * questions — Name (title, required), Email (required), Message — and a table of the responses.
 * Answers given on the page become rows; the form view's Share key makes a public link.
 */
function insertForm(ctx: RunCtx) {
  const ids = { name: newId(), email: newId(), message: newId() }
  const properties: PropertyDef[] = [
    { id: ids.name, name: t('editor.form.q.name'), type: 'title' },
    { id: ids.email, name: t('editor.form.q.email'), type: 'email' },
    { id: ids.message, name: t('editor.form.q.message'), type: 'text' },
  ]
  const form = {
    ...defaultView('form', { properties }, t('editor.form.view')),
    visibleProperties: [ids.email, ids.message],
    form: { questions: { [ids.name]: { required: true }, [ids.email]: { required: true, placeholder: 'name@example.com' } } },
  }
  const responses = defaultView('table', { properties }, t('editor.form.responses'))
  createInlineDatabase(ctx, 'form', { title: t('editor.form.title'), properties, views: [form, responses] })
}

const dbItem = (id: string, type: ViewType, icon: LucideIcon, keywords: string): BlockItem => ({
  id,
  group: 'database',
  icon,
  keywords,
  run: (ctx) => createInlineDatabase(ctx, type),
})

export const BLOCKS: BlockItem[] = [
  // ---------------- basic
  { id: 'text', group: 'basic', icon: Type, keys: 'Mod+Alt+0', keywords: 'text paragraph plain absatz text', turnInto: 'paragraph', run: turn('paragraph') },
  { id: 'heading1', group: 'basic', icon: Heading1, md: '#', keys: 'Mod+Alt+1', keywords: 'h1 heading title überschrift titel', turnInto: 'heading1', run: turn('heading1') },
  { id: 'heading2', group: 'basic', icon: Heading2, md: '##', keys: 'Mod+Alt+2', keywords: 'h2 heading subtitle überschrift', turnInto: 'heading2', run: turn('heading2') },
  { id: 'heading3', group: 'basic', icon: Heading3, md: '###', keys: 'Mod+Alt+3', keywords: 'h3 heading überschrift', turnInto: 'heading3', run: turn('heading3') },
  {
    id: 'page',
    group: 'basic',
    icon: FileText,
    keywords: 'page subpage document seite unterseite dokument',
    run: (ctx) => {
      const id = useWorkspace.getState().createPage({ parentId: ctx.pageId })
      insertBlock(ctx.editor, { type: 'pageLink', attrs: { pageId: id } }, ctx.range)
      window.setTimeout(() => {
        openPage(id)
        focusNewPageTitle(id)
      }, 30)
    },
  },
  {
    id: 'linkPage',
    group: 'basic',
    icon: FileSymlink,
    keywords: 'link to page existing page reference pagelink link zur seite verknüpfen bestehende seite verweis seitenlink',
    picker: 'page',
    run: () => {},
  },
  { id: 'callout', group: 'basic', icon: Lightbulb, md: '!>', keywords: 'callout note info box hinweis notiz kasten', turnInto: 'callout', run: turn('callout') },
  { id: 'quote', group: 'basic', icon: Quote, md: '>', keywords: 'quote blockquote citation zitat', turnInto: 'blockquote', run: turn('blockquote') },
  {
    id: 'divider',
    group: 'basic',
    icon: Minus,
    md: '---',
    keywords: 'divider separator line hr rule trenner linie trennlinie',
    run: (ctx) => insertBlock(ctx.editor, { type: 'horizontalRule' }, ctx.range),
  },
  {
    id: 'table',
    group: 'basic',
    icon: Table,
    keywords: 'table grid simple tabelle raster',
    run: (ctx) => insertBlock(ctx.editor, tableJson(3, 3), ctx.range),
  },
  {
    id: 'spreadsheet',
    group: 'basic',
    icon: FileSpreadsheet,
    keywords: 'spreadsheet sheet sheets excel calc calculation formula formulas sum vlookup tabellenkalkulation tabellenblatt rechnen formel formeln summe sverweis kalkulation',
    run: (ctx) => insertSpreadsheet(ctx.editor, ctx.range),
  },
  {
    id: 'chart',
    group: 'basic',
    icon: ChartColumnIncreasing,
    keywords: 'chart graph diagram diagramm grafik kpi bar balken line linie pie torte donut plot statistics statistik visualize visualisierung',
    run: (ctx) => insertChart(ctx.editor, ctx.range),
  },
  // ---------------- lists
  { id: 'bullet', group: 'lists', icon: List, md: '-', keys: 'Mod+Shift+8', keywords: 'bullet list unordered ul aufzählung liste punkte', turnInto: 'bulletList', run: turn('bulletList') },
  { id: 'numbered', group: 'lists', icon: ListOrdered, md: '1.', keys: 'Mod+Shift+7', keywords: 'numbered ordered list ol nummeriert liste', turnInto: 'orderedList', run: turn('orderedList') },
  { id: 'todo', group: 'lists', icon: ListTodo, md: '[]', keys: 'Mod+Shift+9', keywords: 'todo task checkbox check aufgabe checkliste', turnInto: 'taskList', run: turn('taskList') },
  { id: 'toggle', group: 'lists', icon: ChevronRight, md: '>>', keywords: 'toggle collapse details fold aufklappen umschalter', turnInto: 'toggle', run: turn('toggle') },
  { id: 'toggleHeading1', group: 'lists', icon: ToggleHeading1, md: '>#', keywords: 'toggle heading h1 collapsible section fold aufklapp überschrift einklappbar abschnitt', turnInto: 'toggleHeading1', run: turn('toggleHeading1') },
  { id: 'toggleHeading2', group: 'lists', icon: ToggleHeading2, md: '>##', keywords: 'toggle heading h2 collapsible section fold aufklapp überschrift einklappbar abschnitt', turnInto: 'toggleHeading2', run: turn('toggleHeading2') },
  { id: 'toggleHeading3', group: 'lists', icon: ToggleHeading3, md: '>###', keywords: 'toggle heading h3 collapsible section fold aufklapp überschrift einklappbar abschnitt', turnInto: 'toggleHeading3', run: turn('toggleHeading3') },
  // ---------------- media
  { id: 'image', group: 'media', icon: Image, keywords: 'image picture photo upload bild foto grafik', run: (ctx) => insertBlock(ctx.editor, { type: 'image', attrs: { src: null } }, ctx.range) },
  {
    id: 'video',
    group: 'media',
    icon: Film,
    keywords: 'video movie clip film mp4 webm mov screencast recording upload aufnahme filmclip',
    run: (ctx) => insertBlock(ctx.editor, { type: 'video', attrs: { src: null } }, ctx.range),
  },
  {
    id: 'audio',
    group: 'media',
    icon: AudioLines,
    keywords: 'audio sound music podcast voice memo mp3 recording upload ton musik sprachmemo aufnahme',
    run: (ctx) => insertBlock(ctx.editor, { type: 'audio', attrs: { src: null } }, ctx.range),
  },
  { id: 'bookmark', group: 'media', icon: Bookmark, keywords: 'bookmark link card web lesezeichen karte', run: (ctx) => insertBlock(ctx.editor, { type: 'bookmark', attrs: { url: '' } }, ctx.range) },
  {
    id: 'embed',
    group: 'media',
    icon: MonitorPlay,
    keywords: 'embed video youtube vimeo loom figma maps codepen iframe einbetten karte',
    run: (ctx) => insertBlock(ctx.editor, { type: 'embed', attrs: { url: '' } }, ctx.range),
  },
  { id: 'file', group: 'media', icon: Paperclip, keywords: 'file attachment upload pdf datei anhang', run: (ctx) => insertBlock(ctx.editor, { type: 'fileBlock', attrs: { src: '' } }, ctx.range) },
  {
    id: 'pdf',
    group: 'media',
    icon: BookOpenText,
    keywords: 'pdf viewer document reader paper read upload dokument betrachter lesen anzeigen',
    run: (ctx) => insertBlock(ctx.editor, { type: 'fileBlock', attrs: { src: '', display: 'viewer' } }, ctx.range),
  },
  // ---------------- database
  dbItem('dbTable', 'table', Sheet, 'table view database spreadsheet tabelle datenbank'),
  dbItem('dbBoard', 'board', SquareKanban, 'board kanban view database tafel'),
  // a FREE board: lanes + cards of any record type (database/model/recordTypes)
  { id: 'freeBoard', group: 'database', icon: LayoutDashboard, keywords: 'free board freies board record types datensatz typen lanes spalten kanban cards karten', run: (ctx) => createInlineDatabase(ctx, 'board', { title: t('editor.block.freeBoard.title'), ...freeBoardSpec() }) },
  dbItem('dbList', 'list', Rows3, 'list view database liste'),
  dbItem('dbGallery', 'gallery', LayoutGrid, 'gallery cards view database galerie karten'),
  dbItem('dbCalendar', 'calendar', Calendar, 'calendar view database kalender'),
  dbItem('dbTimeline', 'timeline', ChartGantt, 'timeline gantt view database zeitleiste'),
  dbItem('dbChart', 'chart', ChartColumn, 'chart graph view database diagramm'),
  dbItem('dbFeed', 'feed', Newspaper, 'feed posts stream announcements blog beiträge ankündigungen'),
  {
    id: 'form',
    group: 'database',
    icon: ClipboardPen,
    keywords: 'form survey questionnaire signup contact feedback poll quiz typeform formular umfrage fragebogen anmeldung kontakt rückmeldung abfrage',
    run: insertForm,
  },
  { id: 'dbLinked', group: 'database', icon: Link2, keywords: 'linked database existing verknüpfte datenbank', picker: 'database', run: (ctx) => ctx.pickDatabase?.() },
  // ---------------- advanced
  { id: 'code', group: 'advanced', icon: Code, md: '```', keys: 'Mod+Alt+C', keywords: 'code snippet programming quellcode', turnInto: 'codeBlock', run: turn('codeBlock') },
  {
    id: 'math',
    group: 'advanced',
    icon: Sigma,
    md: '$$',
    keywords: 'math equation latex katex formula formel gleichung',
    run: (ctx) => insertBlock(ctx.editor, { type: 'blockMath', attrs: { latex: '' } }, ctx.range),
  },
  {
    id: 'mermaid',
    group: 'advanced',
    icon: Network,
    keywords: 'mermaid diagram flowchart chart sequence diagramm ablauf',
    run: (ctx) => insertBlock(ctx.editor, { type: 'mermaid', attrs: { code: 'flowchart LR\n  Idea --> Draft --> Review --> Ship' } }, ctx.range),
  },
  {
    id: 'button',
    group: 'advanced',
    icon: SquareMousePointer,
    keywords: 'button action webhook n8n automation trigger click run schaltfläche knopf aktion automatisierung auslösen',
    run: (ctx) => {
      // a fresh button opens its configuration right away (see ButtonView)
      markFreshButton(ctx.editor)
      insertBlock(ctx.editor, { type: 'button', attrs: { label: t('editor.button.default'), variant: 'signal', actions: [] } }, ctx.range)
    },
  },
  {
    // a button bound to a saved One Script (features/script): its settings open on the script picker
    id: 'script',
    group: 'advanced',
    icon: SquareCode,
    keywords: 'script run code one script query automation skript ausführen code automatisierung',
    run: (ctx) => {
      const scripts = Object.values(useWorkspace.getState().scripts ?? {}).filter((x) => x.kind === 'script')
      // the only script there is: picked already
      const only = scripts.length === 1 ? scripts[0] : null
      markFreshButton(ctx.editor)
      insertBlock(ctx.editor, { type: 'button', attrs: { label: only?.name ?? t('editor.button.runScript'), variant: 'ink', actions: [{ id: actionId(), type: 'run_script', scriptId: only?.id ?? null }] } }, ctx.range)
    },
  },
  {
    id: 'tabs',
    group: 'advanced',
    icon: PanelTop,
    keywords: 'tabs tab register reiter registerkarten panels views ansichten',
    run: (ctx) => {
      const outer = tabsAround(ctx.editor.state.selection.$from)
      if (!outer) return void insertBlock(ctx.editor, newTabsJson(), ctx.range)
      // no tabs inside tabs: the new block goes right below the tabs block the caret is in
      const { editor } = ctx
      const tr = editor.state.tr
      if (ctx.range) tr.delete(ctx.range.from, ctx.range.to)
      const at = tr.mapping.map(outer.tabsPos + outer.node.nodeSize)
      tr.insert(at, editor.schema.nodeFromJSON(newTabsJson()))
      caretIntoTabs(tr, at)
      editor.view.dispatch(tr.scrollIntoView())
      editor.view.focus()
      toast({ message: t('editor.tabs.noNesting'), kind: 'info' })
    },
  },
  {
    id: 'synced',
    group: 'advanced',
    icon: RefreshCw,
    keywords: 'synced block sync copy mirror reuse same content several pages synchronisiert synchron spiegeln wiederverwenden mehrere seiten',
    run: (ctx) => insertSynced(ctx.editor, ctx.range),
  },
  { id: 'toc', group: 'advanced', icon: ListTree, keywords: 'toc table of contents outline inhaltsverzeichnis gliederung', run: (ctx) => insertBlock(ctx.editor, { type: 'toc' }, ctx.range) },
  {
    id: 'breadcrumb',
    group: 'advanced',
    icon: Signpost,
    keywords: 'breadcrumb breadcrumbs path location navigation parent brotkrumen brotkrümel pfad navigation übergeordnet',
    run: (ctx) => insertBlock(ctx.editor, { type: 'breadcrumb' }, ctx.range),
  },
  {
    id: 'columns2',
    group: 'advanced',
    icon: Columns2,
    keywords: 'columns layout two 2 spalten zwei',
    run: (ctx) => insertBlock(ctx.editor, columns(2), ctx.range),
  },
  {
    id: 'columns3',
    group: 'advanced',
    icon: Columns3,
    keywords: 'columns layout three 3 spalten drei',
    run: (ctx) => insertBlock(ctx.editor, columns(3), ctx.range),
  },
  {
    id: 'columns4',
    group: 'advanced',
    icon: Columns4,
    keywords: 'columns layout four 4 spalten vier',
    run: (ctx) => insertBlock(ctx.editor, columns(4), ctx.range),
  },
  {
    id: 'columns5',
    group: 'advanced',
    icon: Columns5,
    keywords: 'columns layout five 5 spalten fünf',
    run: (ctx) => insertBlock(ctx.editor, columns(5), ctx.range),
  },
  // ---------------- inline
  {
    id: 'mention',
    group: 'inline',
    icon: AtSign,
    md: '@',
    keywords: 'mention page link person erwähnen seite verlinken',
    run: (ctx) => {
      del(ctx)
      ctx.editor.chain().focus().insertContent(' @').run()
    },
  },
  {
    id: 'date',
    group: 'inline',
    icon: CalendarDays,
    md: '@today',
    keywords: 'date today reminder datum heute',
    run: (ctx) => {
      del(ctx)
      const lang = useWorkspace.getState().settings.language
      ctx.editor.chain().focus().insertContent([{ type: 'mention', attrs: dateMentionAttrs(new Date(), lang) }, { type: 'text', text: ' ' }]).run()
    },
  },
  {
    id: 'emoji',
    group: 'inline',
    icon: Smile,
    md: ':',
    keywords: 'emoji smiley emoticon face smiley gesicht',
    run: (ctx) => openInlinePicker(ctx, 'emoji'),
  },
  {
    id: 'icon',
    group: 'inline',
    icon: Shapes,
    keywords: 'icon symbol glyph object objekt zeichen piktogramm',
    run: (ctx) => openInlinePicker(ctx, 'icon'),
  },
  {
    id: 'inlineMath',
    group: 'inline',
    icon: Pi,
    md: '$$x$$',
    keywords: 'inline math equation latex formel gleichung',
    run: (ctx) => {
      del(ctx)
      const { editor } = ctx
      const pos = editor.state.selection.from
      editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex: '' } }).run()
      // select the new atom so its view opens the TeX editor
      try {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
      } catch {
        /* position shifted — leave the caret */
      }
    },
  },
  // ---------------- AI
  {
    id: 'ai',
    group: 'ai',
    icon: 'AI',
    md: '␣',
    keywords: 'ai ask claude write generate assistant ki schreiben',
    run: (ctx) => {
      del(ctx)
      ctx.bridge.setState({ ai: { mode: 'block' } })
    },
  },
  {
    // an image / a video from a connected MCP server (features/ai/media): the AI panel opens on the generate card
    id: 'generateImage',
    group: 'ai',
    icon: ImagePlus,
    keywords: 'generate image picture photo illustration render create mcp ai bild generieren erzeugen foto illustration grafik ki',
    run: (ctx) => {
      del(ctx)
      ctx.bridge.setState({ ai: { mode: 'block', generate: 'image' } })
    },
  },
  {
    id: 'generateVideo',
    group: 'ai',
    icon: Clapperboard,
    keywords: 'generate video clip movie animation render create mcp ai video generieren erzeugen film clip animation ki',
    run: (ctx) => {
      del(ctx)
      ctx.bridge.setState({ ai: { mode: 'block', generate: 'video' } })
    },
  },
  {
    id: 'meetingNotes',
    group: 'ai',
    icon: NotebookPen,
    keywords: 'meeting notes ai transcript transcription record recording minutes summary action items claude besprechung besprechungsnotizen protokoll mitschrift transkript aufnahme aufzeichnung ki',
    run: (ctx) => insertMeetingNotes(ctx.editor, ctx.range),
  },
]

function columns(n: number) {
  return {
    type: 'columns',
    content: Array.from({ length: n }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })),
  }
}

/** Items that make sense in "Turn into" menus, in display order. */
export const TURN_INTO_ITEMS = BLOCKS.filter((b) => b.turnInto)
