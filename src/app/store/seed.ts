/**
 * First-run demo workspace (EN/DE). Shows off what One can do on first open:
 * a guided welcome page (tabs, a button), a project database with many views
 * (form, sub-items, dependencies, a colour rule, AI autofill), a reading list gallery,
 * a content calendar, meeting notes (a comment, a button) and a small linked wiki (nice graph).
 * Uses ONLY the node names from the CLAUDE.md contract.
 */
import type { JSONContent } from '@tiptap/core'
import type { Lang } from '@/shared/i18n'
import { useWorkspace, defaultView } from './store'
import type { ColorName, ID, PropertyDef, SelectOption } from './types'
import { newId } from '../lib/ids'

/* ---------- tiny doc builders ---------- */
type Inline = JSONContent
const txt = (text: string, marks?: JSONContent['marks']): Inline => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const b = (text: string) => txt(text, [{ type: 'bold' }])
const i = (text: string) => txt(text, [{ type: 'italic' }])
const code = (text: string) => txt(text, [{ type: 'code' }])
const hl = (text: string, color: ColorName = 'orange') => txt(text, [{ type: 'highlight', attrs: { color } }])
const link = (text: string, href: string) => txt(text, [{ type: 'link', attrs: { href } }])
// ProseMirror forbids empty text nodes → drop empty strings
const inl = (...parts: Array<Inline | string>): Inline[] => parts.filter((x) => x !== '').map((x) => (typeof x === 'string' ? txt(x) : x))

const p = (...parts: Array<Inline | string>): JSONContent => {
  const content = inl(...parts)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}
const h1 = (t: string): JSONContent => ({ type: 'heading', attrs: { level: 1 }, content: [txt(t)] })
const h2 = (t: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [txt(t)] })
const h3 = (t: string): JSONContent => ({ type: 'heading', attrs: { level: 3 }, content: [txt(t)] })
const li = (...parts: Array<Inline | string>): JSONContent => ({ type: 'listItem', content: [p(...parts)] })
const ul = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items })
const ol = (...items: JSONContent[]): JSONContent => ({ type: 'orderedList', content: items })
const task = (checked: boolean, ...parts: Array<Inline | string>): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [p(...parts)] })
const tasks = (...items: JSONContent[]): JSONContent => ({ type: 'taskList', content: items })
const callout = (icon: string, color: ColorName, ...blocks: JSONContent[]): JSONContent => ({ type: 'callout', attrs: { icon, color }, content: blocks })
const quote = (...parts: Array<Inline | string>): JSONContent => ({ type: 'blockquote', content: [p(...parts)] })
const toggle = (summary: string, ...blocks: JSONContent[]): JSONContent => ({
  type: 'details',
  content: [
    { type: 'detailsSummary', content: [txt(summary)] },
    { type: 'detailsContent', content: blocks },
  ],
})
const toggleHeading = (level: 1 | 2 | 3, summary: string, ...blocks: JSONContent[]): JSONContent => ({ ...toggle(summary, ...blocks), attrs: { heading: level } })
const hr = (): JSONContent => ({ type: 'horizontalRule' })
const codeBlock = (language: string, source: string): JSONContent => ({ type: 'codeBlock', attrs: { language }, content: [txt(source)] })
const math = (latex: string): JSONContent => ({ type: 'blockMath', attrs: { latex } })
const imath = (latex: string): Inline => ({ type: 'inlineMath', attrs: { latex } })
const mermaid = (src: string): JSONContent => ({ type: 'mermaid', attrs: { code: src } })
const pageLink = (pageId: ID): JSONContent => ({ type: 'pageLink', attrs: { pageId } })
const mention = (id: ID, label: string): Inline => ({ type: 'mention', attrs: { id, label, kind: 'page' } })
const dateMention = (iso: string, label: string, reminder?: string): Inline => ({ type: 'mention', attrs: { id: iso, label, kind: 'date', ...(reminder ? { reminder } : {}) } })
const synced = (syncId: string, sourcePageId: ID | null, ...blocks: JSONContent[]): JSONContent => ({ type: 'syncedBlock', attrs: { syncId, sourcePageId }, content: blocks })
const dbBlock = (databaseId: ID, viewId: ID | null = null): JSONContent => ({ type: 'databaseBlock', attrs: { databaseId, viewId } })
const toc = (): JSONContent => ({ type: 'toc' })
const columns = (...cols: JSONContent[][]): JSONContent => ({ type: 'columns', content: cols.map((c) => ({ type: 'column', content: c })) })
const table = (rows: string[][]): JSONContent => ({
  type: 'table',
  content: rows.map((r, ri) => ({
    type: 'tableRow',
    content: r.map((cell) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', content: [p(cell)] })),
  })),
})
const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks })

/* ---------- helpers ---------- */
const opt = (name: string, color: ColorName, group?: SelectOption['group']): SelectOption => ({ id: newId(), name, color, ...(group ? { group } : {}) })
const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (offset: number) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return iso(d)
}

export function seedWorkspace(lang: Lang): void {
  const de = lang === 'de'
  const L = (en: string, deText: string) => (de ? deText : en)
  const s = useWorkspace.getState()

  /* people */
  const me = s.addPerson(L('You', 'Du'))
  const alex = s.addPerson('Alex')
  const sam = s.addPerson('Sam')
  const mira = s.addPerson('Mira')

  /* ---------- top-level pages (created first so links work) ---------- */
  const welcome = s.createPage({ title: L('Welcome to One', 'Willkommen bei One'), icon: { type: 'emoji', value: '👋' }, cover: { type: 'image', value: 'assets/covers/paper-folds.webp', positionY: 50 } })
  const projects = newId()
  const reading = newId()
  const calendar = newId()
  const wiki = s.createPage({ title: L('Team wiki', 'Team-Wiki'), icon: { type: 'emoji', value: '📖' } })
  const meeting = s.createPage({ title: L('Weekly sync — notes', 'Weekly Sync — Notizen'), icon: { type: 'emoji', value: '🗓️' } })

  /* ---------- Projects database ---------- */
  const statusOpts = [
    opt(L('Backlog', 'Backlog'), 'gray', 'todo'),
    opt(L('In progress', 'In Arbeit'), 'blue', 'in_progress'),
    opt(L('Review', 'Review'), 'purple', 'in_progress'),
    opt(L('Done', 'Erledigt'), 'green', 'done'),
  ]
  const prioOpts = [opt(L('High', 'Hoch'), 'red'), opt(L('Medium', 'Mittel'), 'yellow'), opt(L('Low', 'Niedrig'), 'gray')]
  const tagOpts = [opt('Web', 'blue'), opt('Marketing', 'pink'), opt(L('Product', 'Produkt'), 'orange'), opt('Ops', 'brown'), opt(L('AI', 'KI'), 'purple')]
  const P = {
    name: newId(),
    status: newId(),
    prio: newId(),
    owner: newId(),
    due: newId(),
    progress: newId(),
    tags: newId(),
    budget: newId(),
    id: newId(),
    daysLeft: newId(),
  }
  const projectProps: PropertyDef[] = [
    { id: P.name, name: L('Project', 'Projekt'), type: 'title' },
    { id: P.status, name: 'Status', type: 'status', options: statusOpts },
    { id: P.prio, name: L('Priority', 'Priorität'), type: 'select', options: prioOpts, autofill: { preset: 'categorize' } },
    { id: P.owner, name: L('Owner', 'Verantwortlich'), type: 'person' },
    { id: P.due, name: L('Timeline', 'Zeitraum'), type: 'date' },
    { id: P.progress, name: L('Progress', 'Fortschritt'), type: 'number', numberFormat: 'percent', numberDisplay: 'bar' },
    { id: P.tags, name: 'Tags', type: 'multi_select', options: tagOpts },
    { id: P.budget, name: 'Budget', type: 'number', numberFormat: 'euro' },
    { id: P.id, name: 'ID', type: 'unique_id', idPrefix: 'PRJ' },
    { id: P.daysLeft, name: L('Days left', 'Tage übrig'), type: 'formula', formula: `if(empty(prop("${L('Timeline', 'Zeitraum')}")), "", dateBetween(dateEnd(prop("${L('Timeline', 'Zeitraum')}")), now(), "days"))` },
  ]
  s.createDatabase({ id: projects, title: L('Projects', 'Projekte'), icon: { type: 'emoji', value: '🗂️' }, properties: projectProps, views: [] })
  {
    const db = { properties: projectProps }
    const board = { ...defaultView('board', db, L('Board', 'Board')), groupBy: P.status, visibleProperties: [P.prio, P.owner, P.due, P.progress] }
    const tableView = { ...defaultView('table', db, L('All projects', 'Alle Projekte')), calculations: { [P.budget]: 'sum' as const, [P.progress]: 'average' as const } }
    const timeline = { ...defaultView('timeline', db, L('Timeline', 'Zeitleiste')), dateProperty: P.due, visibleProperties: [P.owner, P.status] }
    const cal = { ...defaultView('calendar', db, L('Calendar', 'Kalender')), dateProperty: P.due }
    // budget per status: varied bars (7,500 / 20,500 / 13,000 / 12,000) instead of four equal counts
    const chart = { ...defaultView('chart', db, L('Chart', 'Diagramm')), chart: { kind: 'bar' as const, xPropertyId: P.status, aggregate: 'sum' as const, yPropertyId: P.budget } }
    const form = {
      ...defaultView('form', db, L('Intake form', 'Eingangsformular')),
      visibleProperties: [P.status, P.prio, P.owner, P.due, P.tags, P.budget],
      form: {
        title: L('Project intake', 'Projekt-Einreichung'),
        description: L('Pitch a project for next quarter. We read every submission on Mondays.', 'Schlag ein Projekt fürs nächste Quartal vor. Wir lesen jede Einreichung montags.'),
        submitLabel: L('Send pitch', 'Pitch senden'),
        questions: {
          [P.name]: { required: true, help: L('A short, specific name.', 'Ein kurzer, konkreter Name.') },
          [P.status]: { required: true },
          [P.due]: { help: L('When should it start?', 'Wann soll es losgehen?') },
        },
      },
    }
    s.updateDatabase(projects, {
      views: [board, tableView, timeline, cal, chart, form],
      nextUniqueId: 1,
      // one armed automation, so the feature is visible from the start (same shape as the notify_done recipe)
      automations: [
        {
          id: newId(),
          name: L('Notify when Status → Done', 'Benachrichtigen bei Status → Erledigt'),
          enabled: true,
          trigger: { type: 'property_changed', propertyId: P.status, toValue: statusOpts[3].id },
          actions: [{ type: 'notify', message: L('{title} → Done', '{title} → Erledigt') }],
          lastRunAt: null,
          lastStatus: null,
          lastMessage: null,
        },
      ],
    })
  }
  const projectRows: Array<[string, number, number, ID, number, number, number, number, string[], number]> = [
    // title, status idx, prio idx, owner, start offset, length, progress, budget, tags idx, rating unused
    [L('Website relaunch', 'Website-Relaunch'), 1, 0, alex, -10, 24, 0.6, 18000, ['0', '1'], 0],
    [L('Import our Notion workspace', 'Notion-Workspace importieren'), 3, 1, me, -14, 3, 1, 0, ['3'], 0],
    [L('n8n lead-routing automation', 'n8n Lead-Routing-Automation'), 1, 0, sam, -3, 10, 0.35, 2500, ['4', '3'], 0],
    [L('Q4 content calendar', 'Content-Kalender Q4'), 2, 1, mira, -1, 30, 0.8, 4000, ['1'], 0],
    [L('Customer onboarding video', 'Onboarding-Video'), 0, 2, mira, 9, 12, 0, 6000, ['1', '2'], 0],
    [L('Pricing page experiment', 'Pricing-Page-Experiment'), 0, 1, alex, 14, 8, 0, 1500, ['0', '2'], 0],
    [L('AI support assistant', 'KI-Support-Assistent'), 2, 0, sam, -6, 18, 0.7, 9000, ['4', '2'], 0],
    [L('Brand refresh', 'Brand-Refresh'), 3, 2, me, -40, 21, 1, 12000, ['1'], 0],
  ]
  const rowIds: ID[] = []
  for (const [title, st, pr, owner, start, len, progress, budget, tags] of projectRows) {
    const rowId = s.createRow(projects, {
      title,
      properties: {
        [P.status]: statusOpts[st].id,
        [P.prio]: prioOpts[pr].id,
        [P.owner]: [owner],
        [P.due]: { start: day(start), end: day(start + len) },
        [P.progress]: progress,
        [P.tags]: tags.map((t) => tagOpts[Number(t)].id),
        [P.budget]: budget,
      },
      content: doc(
        callout('🎯', 'orange', p(b(L('Goal: ', 'Ziel: ')), L('ship something people actually use.', 'etwas ausliefern, das Menschen wirklich nutzen.'))),
        h3(L('Next steps', 'Nächste Schritte')),
        tasks(task(true, L('Kick-off & scope', 'Kick-off & Scope')), task(progress > 0.5, L('First draft', 'Erster Entwurf')), task(progress >= 1, L('Launch', 'Launch'))),
      ),
    })
    rowIds.push(rowId)
  }

  /* ---------- Projects: sub-items, dependencies, a colour rule ---------- */
  {
    const SUB = newId()
    const DEP = newId()
    const rel = (id: ID, name: string) => s.addProperty(projects, { id, type: 'relation', name, relationDatabaseId: projects })
    rel(SUB, L('Parent item', 'Übergeordnet'))
    rel(`${SUB}.2way`, L('Sub-items', 'Unterelemente'))
    rel(DEP, L('Blocked by', 'Blockiert durch'))
    rel(`${DEP}.2way`, L('Blocking', 'Blockiert'))
    const managed = [SUB, `${SUB}.2way`, DEP, `${DEP}.2way`]
    for (const v of useWorkspace.getState().databases[projects].views) s.updateView(projects, v.id, { visibleProperties: v.visibleProperties.filter((x) => !managed.includes(x)) })
    s.updateDatabase(projects, {
      subItems: { enabled: true, parentPropertyId: SUB, childPropertyId: `${SUB}.2way` },
      dependencies: { enabled: true, blockedByPropertyId: DEP, blockingPropertyId: `${DEP}.2way`, onConflict: 'shift' },
    })
    // both sides of each pair, the way writeValue keeps them
    const link = (propId: ID, from: ID, to: ID) => {
      const get = (row: ID, prop: ID) => (useWorkspace.getState().pages[row]?.properties[prop] as ID[] | undefined) ?? []
      s.setRowProperty(from, propId, [...get(from, propId), to])
      s.setRowProperty(to, `${propId}.2way`, [...get(to, `${propId}.2way`), from])
    }
    link(SUB, rowIds[5], rowIds[0]) // Pricing page experiment ⊂ Website relaunch
    link(SUB, rowIds[4], rowIds[3]) // Customer onboarding video ⊂ Q4 content calendar
    link(DEP, rowIds[0], rowIds[1]) // Website relaunch waits for the Notion import (ink arrow)
    link(DEP, rowIds[4], rowIds[6]) // onboarding video waits for the AI assistant — overlap: orange arrow
    const tableView = useWorkspace.getState().databases[projects].views.find((v) => v.type === 'table')
    if (tableView)
      s.updateView(projects, tableView.id, {
        colorRules: [{ id: newId(), color: 'green', target: 'background', filter: { id: newId(), op: 'and', items: [{ id: newId(), propertyId: P.status, operator: 'is', value: statusOpts[3].id }] } }],
      })
  }

  /* ---------- Reading list (gallery) ---------- */
  const R = { title: newId(), author: newId(), type: newId(), rating: newId(), status: newId() }
  const typeOpts = [opt(L('Book', 'Buch'), 'brown'), opt(L('Article', 'Artikel'), 'blue'), opt('Podcast', 'purple')]
  const readStatus = [opt(L('To read', 'Zu lesen'), 'gray', 'todo'), opt(L('Reading', 'Am Lesen'), 'yellow', 'in_progress'), opt(L('Finished', 'Gelesen'), 'green', 'done')]
  const readingProps: PropertyDef[] = [
    { id: R.title, name: L('Title', 'Titel'), type: 'title' },
    { id: R.author, name: L('Author', 'Autor:in'), type: 'text' },
    { id: R.type, name: L('Type', 'Typ'), type: 'select', options: typeOpts },
    { id: R.rating, name: L('Rating', 'Bewertung'), type: 'rating', ratingMax: 5 },
    { id: R.status, name: 'Status', type: 'status', options: readStatus },
  ]
  s.createDatabase({ id: reading, title: L('Reading list', 'Leseliste'), icon: { type: 'emoji', value: '📚' }, properties: readingProps, views: [] })
  {
    const db = { properties: readingProps }
    s.updateDatabase(reading, {
      views: [
        { ...defaultView('gallery', db, L('Shelf', 'Regal')), cardPreview: 'cover', cardSize: 'medium', visibleProperties: [R.author, R.rating] },
        { ...defaultView('table', db, L('Table', 'Tabelle')) },
        { ...defaultView('board', db, L('By status', 'Nach Status')), groupBy: R.status },
      ],
    })
  }
  const books: Array<[string, string, number, number, number, string]> = [
    ['Less, but better', 'Dieter Rams', 0, 5, 2, 'concrete'],
    ['The Design of Everyday Things', 'Don Norman', 0, 5, 2, 'paper-folds'],
    ['Shape Up', 'Ryan Singer', 0, 4, 1, 'aluminum'],
    [L('Local-first software', 'Local-first Software'), 'Ink & Switch', 1, 5, 2, 'glass'],
    ['Working in Public', 'Nadia Eghbal', 0, 4, 0, 'dunes'],
    ['Lex Fridman Podcast #367', 'Sam Altman', 2, 3, 0, 'night'],
  ]
  for (const [title, author, type, rating, st, cover] of books) {
    s.createRow(reading, {
      title,
      properties: { [R.author]: author, [R.type]: typeOpts[type].id, [R.rating]: rating, [R.status]: readStatus[st].id },
    })
  }
  // covers for gallery cards
  {
    const rows = Object.values(useWorkspace.getState().pages).filter((pg) => pg.databaseId === reading)
    rows.forEach((row) => {
      const c = books.find((bk) => bk[0] === row.title)?.[5]
      if (c) s.updatePage(row.id, { cover: { type: 'image', value: `assets/covers/${c}.webp`, positionY: 50 } })
    })
  }

  /* ---------- Content calendar ---------- */
  const C = { title: newId(), date: newId(), channel: newId(), status: newId() }
  const channelOpts = [opt('Newsletter', 'orange'), opt('LinkedIn', 'blue'), opt('YouTube', 'red'), opt('Blog', 'green')]
  const cStatus = [opt(L('Idea', 'Idee'), 'gray', 'todo'), opt(L('Writing', 'Schreiben'), 'yellow', 'in_progress'), opt(L('Published', 'Veröffentlicht'), 'green', 'done')]
  const calProps: PropertyDef[] = [
    { id: C.title, name: L('Post', 'Beitrag'), type: 'title' },
    { id: C.date, name: L('Publish date', 'Veröffentlichung'), type: 'date' },
    { id: C.channel, name: L('Channel', 'Kanal'), type: 'select', options: channelOpts },
    { id: C.status, name: 'Status', type: 'status', options: cStatus },
  ]
  s.createDatabase({ id: calendar, title: L('Content calendar', 'Content-Kalender'), icon: { type: 'emoji', value: '📣' }, properties: calProps, views: [] })
  {
    const db = { properties: calProps }
    s.updateDatabase(calendar, {
      views: [
        { ...defaultView('calendar', db, L('Month', 'Monat')), dateProperty: C.date, visibleProperties: [C.channel] },
        { ...defaultView('board', db, L('Pipeline', 'Pipeline')), groupBy: C.status },
        { ...defaultView('table', db, L('Table', 'Tabelle')) },
      ],
    })
  }
  const posts: Array<[string, number, number, number]> = [
    [L('Why we left Notion (and saved €2,880)', 'Warum wir Notion verlassen haben (und 2.880 € sparen)'), 2, 3, 2],
    [L('5 n8n automations for your workspace', '5 n8n-Automationen für deinen Workspace'), 5, 2, 1],
    [L('Local-first explained in 90 seconds', 'Local-first in 90 Sekunden erklärt'), 8, 1, 1],
    [L('October product update', 'Produkt-Update Oktober'), 12, 0, 0],
    [L('Keyboard-first: 12 shortcuts', 'Keyboard-first: 12 Shortcuts'), 16, 1, 0],
    [L('Case study: agency CRM', 'Case Study: Agentur-CRM'), 21, 3, 0],
  ]
  for (const [title, off, ch, st] of posts) {
    s.createRow(calendar, { title, properties: { [C.date]: { start: day(off) }, [C.channel]: channelOpts[ch].id, [C.status]: cStatus[st].id } })
  }

  /* ---------- Wiki subpages (linked → nice graph) ---------- */
  const brand = s.createPage({ parentId: wiki, title: L('Brand voice', 'Markenstimme'), icon: { type: 'emoji', value: '🎙️' } })
  const onboarding = s.createPage({ parentId: wiki, title: L('Onboarding', 'Onboarding'), icon: { type: 'emoji', value: '🧭' } })
  const tooling = s.createPage({ parentId: wiki, title: L('Tooling & automations', 'Tools & Automationen'), icon: { type: 'emoji', value: '🛠️' } })
  const glossary = s.createPage({ parentId: wiki, title: L('Glossary', 'Glossar'), icon: { type: 'emoji', value: '🔤' } })

  s.setContent(
    wiki,
    doc(
      p(L('Everything the team needs, in one place. Start with ', 'Alles, was das Team braucht, an einem Ort. Starte mit '), mention(onboarding, L('Onboarding', 'Onboarding')), '.'),
      toc(),
      h2(L('Sections', 'Bereiche')),
      pageLink(brand),
      pageLink(onboarding),
      pageLink(tooling),
      pageLink(glossary),
    ),
    'seed',
  )
  const principlesSync = newId()
  const principles = () =>
    ol(li(b(L('Concrete over clever. ', 'Konkret statt clever. ')), L('Numbers, names, examples.', 'Zahlen, Namen, Beispiele.')), li(b(L('No hype words. ', 'Keine Hype-Wörter. ')), L('Nobody wants to be "supercharged".', 'Niemand will "supercharged" werden.')), li(b(L('Respect the reader’s time.', 'Respektiere die Zeit der Lesenden.'))))
  s.setContent(
    brand,
    doc(
      quote(L('Say less. Mean it. Ship it.', 'Weniger sagen. Ernst meinen. Ausliefern.')),
      h2(L('Principles', 'Prinzipien')),
      // the same principles live in the meeting notes as a synced block
      synced(principlesSync, null, principles()),
      p(L('See also ', 'Siehe auch '), mention(glossary, L('Glossary', 'Glossar')), '.'),
    ),
    'seed',
  )
  s.setContent(
    onboarding,
    doc(
      callout('🧭', 'blue', p(L('Your first week, step by step.', 'Deine erste Woche, Schritt für Schritt.'))),
      tasks(
        task(true, L('Read the ', 'Lies die '), mention(brand, L('Brand voice', 'Markenstimme'))),
        task(false, L('Set up ', 'Richte '), mention(tooling, L('Tooling & automations', 'Tools & Automationen')), L('', ' ein')),
        task(false, L('Pick a project in ', 'Such dir ein Projekt in '), mention(projects, L('Projects', 'Projekte')), L('', ' aus')),
        task(false, L('Add a book to the ', 'Leg ein Buch auf die '), mention(reading, L('Reading list', 'Leseliste'))),
      ),
    ),
    'seed',
  )
  s.setContent(
    tooling,
    doc(
      p(L('Every database in One can fire webhooks. We send new projects to n8n:', 'Jede Datenbank in One kann Webhooks auslösen. Neue Projekte schicken wir an n8n:')),
      codeBlock(
        'json',
        `{\n  "event": "row_created",\n  "database": { "id": "…", "title": "${L('Projects', 'Projekte')}" },\n  "row": {\n    "title": "${L('Website relaunch', 'Website-Relaunch')}",\n    "properties": { "Status": "${L('In progress', 'In Arbeit')}", "Owner": "Alex" }\n  },\n  "source": "simplecms-one"\n}`,
      ),
      mermaid(`flowchart LR\n  A[One database] -- webhook --> B(n8n)\n  B --> C[Slack]\n  B --> D[CRM]\n  B --> E[Claude summary]`),
      p(L('Related: ', 'Verwandt: '), mention(projects, L('Projects', 'Projekte'))),
    ),
    'seed',
  )
  s.setContent(
    glossary,
    doc(
      table([
        [L('Term', 'Begriff'), L('Meaning', 'Bedeutung')],
        ['Local-first', L('Your data lives on your device first.', 'Deine Daten liegen zuerst auf deinem Gerät.')],
        ['BYOK', L('Bring your own key — you pay the AI provider directly.', 'Bring your own key — du zahlst den KI-Anbieter direkt.')],
        ['Webhook', L('An HTTP call fired when something changes.', 'Ein HTTP-Aufruf, wenn sich etwas ändert.')],
      ]),
    ),
    'seed',
  )

  /* ---------- Meetings database: a template that repeats every Monday ---------- */
  const meetings = newId()
  {
    const M = { name: newId(), date: newId(), type: newId(), people: newId() }
    const typeOpts = [opt('Sync', 'blue'), opt('Retro', 'purple')]
    const props: PropertyDef[] = [
      { id: M.name, name: L('Meeting', 'Meeting'), type: 'title' },
      { id: M.date, name: L('Date', 'Datum'), type: 'date' },
      { id: M.type, name: L('Type', 'Typ'), type: 'select', options: typeOpts },
      { id: M.people, name: L('Attendees', 'Teilnehmende'), type: 'person' },
    ]
    s.createDatabase({ id: meetings, title: L('Meetings', 'Meetings'), icon: { type: 'emoji', value: '🗒️' }, properties: props, views: [] })
    const db = { properties: props }
    const notes = (decision: string) =>
      doc(
        h2(L('Agenda', 'Agenda')),
        ul(li(L('Wins of the week', 'Erfolge der Woche')), li(L('Blockers', 'Blocker')), li(L('Next steps', 'Nächste Schritte'))),
        h2(L('Decisions', 'Entscheidungen')),
        callout('✅', 'green', p(decision)),
        h2(L('Action items', 'Aufgaben')),
        tasks(task(false, '')),
      )
    // the most recent Mondays (today counts if it is one)
    const dow = new Date().getDay()
    const lastMonday = -((dow + 6) % 7)
    s.updateDatabase(meetings, {
      views: [
        { ...defaultView('table', db, L('All meetings', 'Alle Meetings')), sorts: [{ propertyId: M.date, direction: 'desc' as const }] },
        { ...defaultView('calendar', db, L('Calendar', 'Kalender')), dateProperty: M.date },
      ],
      templates: [
        {
          id: newId(),
          name: 'Weekly sync',
          icon: { type: 'emoji', value: '🗓️' },
          content: notes(L('…', '…')),
          properties: { [M.type]: typeOpts[0].id, [M.people]: [alex, sam, mira] },
          // every Monday at 09:00, counted from now on (no backfill on first open)
          repeat: { freq: 'weekly', days: [1], time: '09:00', start: day(0), title: '{{name}} — {{date}}', dateProperty: M.date, lastRunAt: Date.now() },
        },
      ],
    })
    const past: Array<[number, string]> = [
      [lastMonday - 7, L('Ship the relaunch in two steps.', 'Relaunch in zwei Schritten ausliefern.')],
      [lastMonday, L('Webhook to n8n goes live this week.', 'Webhook an n8n geht diese Woche live.')],
    ]
    for (const [off, decision] of past) {
      const when = new Date(`${day(off)}T12:00`).toLocaleDateString(de ? 'de-DE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      s.createRow(meetings, { title: `Weekly sync — ${when}`, properties: { [M.date]: { start: day(off) }, [M.type]: typeOpts[0].id, [M.people]: [alex, sam, mira] }, content: notes(decision) })
    }
  }

  /* ---------- Meeting notes ---------- */
  s.setContent(
    meeting,
    doc(
      p(dateMention(day(0), L('Today', 'Heute')), ' · ', b(L('Attendees: ', 'Teilnehmende: ')), 'Alex, Sam, Mira'),
      h2(L('Agenda', 'Agenda')),
      ul(li(mention(rowIds[0], L('Website relaunch', 'Website-Relaunch')), L(' — launch date', ' — Launch-Termin')), li(mention(rowIds[2], L('n8n lead-routing automation', 'n8n Lead-Routing-Automation'))), li(L('Budget check', 'Budget-Check'))),
      h2(L('Decisions', 'Entscheidungen')),
      callout('✅', 'green', p(txt(L('Relaunch goes live on ', 'Relaunch geht live am '), [{ type: 'comment', attrs: { id: 'seed-c1' } }]), dateMention(day(14), day(14), '-1d'), '.')),
      h2(L('Action items', 'Aufgaben')),
      tasks(task(false, b('Alex'), L(' — final QA on staging', ' — finale QA auf Staging')), task(false, b('Sam'), L(' — connect webhook to n8n', ' — Webhook mit n8n verbinden')), task(true, b('Mira'), L(' — draft the newsletter', ' — Newsletter-Entwurf'))),
      p(L('Before it goes out, check the newsletter against our brand voice.', 'Vor dem Versand den Newsletter mit unserer Markenstimme abgleichen.')),
      synced(principlesSync, brand, principles()),
      p(L('Every Monday at 09:00 a fresh entry appears in ', 'Jeden Montag um 09:00 erscheint ein neuer Eintrag in '), mention(meetings, L('Meetings', 'Meetings')), L(' — a repeating template.', ' — eine wiederkehrende Vorlage.')),
      h2(L('Next sync', 'Nächstes Sync')),
      {
        type: 'button',
        attrs: {
          label: L('New meeting entry', 'Neuer Meeting-Eintrag'),
          variant: 'signal',
          actions: [
            {
              id: 'seed-btn-1a',
              type: 'insert_blocks',
              content: [h3('Sync {{date}}'), tasks(task(false, L('Decisions', 'Entscheidungen')))],
            },
            { id: 'seed-btn-1b', type: 'message', text: L('Logged at {{time}} — have a good sync, {{user}}', 'Erfasst um {{time}} — gutes Meeting, {{user}}') },
          ],
        },
      },
    ),
    'seed',
  )

  /* ---------- Welcome page ---------- */
  s.setContent(
    welcome,
    doc(
      p(
        L('One is a workspace that does what Notion does — pages, blocks, databases — and then some. ', 'One ist ein Workspace, der kann, was Notion kann — Seiten, Blöcke, Datenbanken — und noch mehr. '),
        b(L('No account, no server, no subscription.', 'Kein Konto, kein Server, kein Abo.')),
      ),
      callout(
        '🔒',
        'orange',
        p(b(L('Everything you see lives in this browser. ', 'Alles hier lebt in diesem Browser. ')), L('Nothing is uploaded. Export or share whenever you want.', 'Nichts wird hochgeladen. Exportieren oder teilen, wann immer du willst.')),
      ),
      h2(L('Quick tour — tick them off', 'Kurze Tour — zum Abhaken')),
      tasks(
        task(false, L('Type ', 'Tippe '), code('/'), L(' on an empty line to insert any block', ' in einer leeren Zeile, um einen Block einzufügen')),
        task(false, L('Press ', 'Drücke '), code('⌘K'), L(' / ', ' / '), code('Ctrl+K'), L(' to search everything', ', um alles zu durchsuchen')),
        task(false, L('Drag a block by its ', 'Zieh einen Block an seinem '), code('⋮⋮'), L(' handle', '-Griff')),
        task(false, L('Open ', 'Öffne '), mention(projects, L('Projects', 'Projekte')), L(' and switch between Board, Timeline and Chart', ' und wechsle zwischen Board, Zeitleiste und Diagramm')),
        task(false, L('Drag a card on the ', 'Zieh auf dem '), mention(projects, L('Projects', 'Projekte')), L(' board to Done', '-Board eine Karte nach Erledigt')),
        task(false, L('Alt-click ', 'Alt-Klick auf '), mention(wiki, L('Team wiki', 'Team-Wiki')), L(' to open it in a side-by-side pane', ', um es nebeneinander zu öffnen')),
        task(false, L('Add your Claude key in Settings → Claude AI, then press Space on an empty line', 'Hinterlege deinen Claude-Key unter Einstellungen → Claude KI und drücke dann Leertaste in einer leeren Zeile')),
        task(false, L('Move in from Notion, Obsidian, Evernote or Trello with ', 'Zieh mit '), b(L('Import', 'Importieren')), L(' in the sidebar', ' in der Seitenleiste aus Notion, Obsidian, Evernote oder Trello um')),
        task(false, L('Publish any page as a website: ', 'Veröffentliche jede Seite als Website: '), b(L('Export → Website', 'Exportieren → Website'))),
      ),
      h2(L('Three ways to work', 'Drei Arten zu arbeiten')),
      {
        type: 'tabs',
        content: [
          { type: 'tab', attrs: { title: L('Write', 'Schreiben') }, content: [p(L('Type / for blocks, select text for the toolbar, press Space on an empty line to ask AI.', 'Tippe / für Blöcke, markiere Text für die Werkzeugleiste, drücke Leertaste in einer leeren Zeile für die KI.'))] },
          { type: 'tab', attrs: { title: L('Organise', 'Ordnen') }, content: [p(L('Drag blocks by their handle, nest pages in the sidebar, plan everything dated in the Agenda.', 'Zieh Blöcke am Griff, verschachtle Seiten in der Seitenleiste, plane alles mit Datum in der Agenda.'))] },
          {
            type: 'tab',
            attrs: { title: L('Share', 'Teilen') },
            content: [
              p(L('Share links carry the page itself — no server, optional password. Or publish a whole section as a website.', 'Teilen-Links tragen die Seite selbst — kein Server, optional mit Passwort. Oder veröffentliche einen ganzen Bereich als Website.')),
            ],
          },
        ],
      },
      h2(L('Why One', 'Warum One')),
      columns(
        [
          h3(L('Owned', 'Deins')),
          ul(li(L('Local-first, works offline', 'Local-first, funktioniert offline')), li(L('Share links that contain the page itself', 'Teilen-Links, die die Seite selbst enthalten')), li(L('Markdown, HTML and JSON export', 'Export als Markdown, HTML und JSON'))),
        ],
        [
          h3(L('Fast', 'Schnell')),
          ul(li(L('Keyboard-first, ⌘K for everything', 'Keyboard-first, ⌘K für alles')), li(L('Stacked panes & focus mode', 'Gestapelte Panes & Fokus-Modus')), li(L('Version history with a tape scrubber', 'Versionsverlauf mit Band-Regler'))),
        ],
        [
          h3(L('Wired', 'Vernetzt')),
          ul(li(L('Claude AI with your own key', 'Claude-KI mit eigenem Key')), li(L('Webhooks to n8n, Make, Zapier', 'Webhooks an n8n, Make, Zapier')), li(L('Graph view of everything', 'Graph-Ansicht über alles'))),
        ],
      ),
      h2(L('Your projects, live', 'Deine Projekte, live')),
      p(L('Databases can live inside pages. This one is the same data as ', 'Datenbanken können in Seiten leben. Diese hier zeigt dieselben Daten wie '), mention(projects, L('Projects', 'Projekte')), '.'),
      dbBlock(projects),
      {
        type: 'button',
        attrs: {
          label: L('Add a project', 'Projekt anlegen'),
          variant: 'ink',
          actions: [{ id: 'seed-btn-2a', type: 'add_page', databaseId: projects, title: L('New project {{date}}', 'Neues Projekt {{date}}'), values: [{ propertyId: P.status, value: statusOpts[0].id }, { propertyId: P.due, value: '@today' }], open: true }],
        },
      },
      h2(L('Blocks for nerds', 'Blöcke für Nerds')),
      p(L('Inline math like ', 'Inline-Mathe wie '), imath('e^{i\\pi} + 1 = 0'), L(', block equations, code with highlighting and diagrams:', ', Formeln, Code mit Highlighting und Diagramme:')),
      math('\\text{saved}_{year} = \\text{seats} \\times \\text{price} \\times 12'),
      mermaid(`flowchart LR\n  You([${L('You', 'Du')}]) --> One[SimpleCMS One]\n  One --> IDB[(IndexedDB)]\n  One -. ${L('your key', 'dein Key')} .-> Claude[Claude API]\n  One -. webhook .-> n8n`),
      toggle(L('Keyboard shortcuts', 'Tastenkürzel'), table([
        [L('Action', 'Aktion'), L('Shortcut', 'Kürzel')],
        [L('Search & commands', 'Suche & Befehle'), '⌘K / Ctrl+K'],
        [L('New page', 'Neue Seite'), '⌘⌥N / Ctrl+Alt+N'],
        [L('Toggle sidebar', 'Seitenleiste'), '⌘\\ / Ctrl+\\'],
        [L('Focus mode', 'Fokus-Modus'), '⌘⇧F / Ctrl+Shift+F'],
        [L('Duplicate block', 'Block duplizieren'), '⌘D / Ctrl+D'],
      ])),
      // a toggle heading (details.heading 1–3)
      toggleHeading(3, L('Where is my data?', 'Wo sind meine Daten?'), p(L('In your browser’s IndexedDB. Use Export for backups or to move to another device.', 'In der IndexedDB deines Browsers. Nutze den Export für Backups oder den Umzug auf ein anderes Gerät.'))),
      hr(),
      p(i(L('Explore: ', 'Entdecken: ')), mention(wiki, L('Team wiki', 'Team-Wiki')), ' · ', mention(meeting, L('Weekly sync — notes', 'Weekly Sync — Notizen')), ' · ', mention(reading, L('Reading list', 'Leseliste')), ' · ', mention(calendar, L('Content calendar', 'Content-Kalender')), ' · ', hl(L('have fun', 'viel Spaß'))),
      p(L('Built for the ', 'Gebaut für die '), link('Ninja Armory', 'https://www.skool.com'), '.'),
    ),
    'seed',
  )

  s.addComment(meeting, {
    id: 'seed-c1',
    quote: L('Relaunch goes live on ', 'Relaunch geht live am '),
    body: L('Only after Alex signs off QA on staging. (Margin notes: select text, press Comment or ⌘⌥M / Ctrl+Alt+M — they stay on this device.)', 'Erst nach Alex’ QA-Freigabe auf Staging. (Randnotizen: Text markieren, Kommentieren oder ⌘⌥M / Strg+Alt+M — sie bleiben auf diesem Gerät.)'),
  })

  // order in sidebar: Welcome, Projects, Reading list, Content calendar, Wiki, Meeting
  const order: ID[] = [welcome, projects, reading, calendar, wiki, meeting, meetings]
  order.forEach((id, idx) => s.updatePage(id, { order: idx + 1 }))
  s.toggleFavorite(welcome)
  s.toggleFavorite(projects)
  s.updateSettings({ startPageId: welcome, userName: '' })
  void me
}
