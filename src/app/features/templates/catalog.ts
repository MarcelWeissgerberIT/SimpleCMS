/**
 * Template catalog. Each template builds real pages/databases through store actions,
 * localized EN/DE, using only the TipTap node names from the CLAUDE.md contract.
 */
import type { JSONContent } from '@tiptap/core'
import type { Lang } from '@/shared/i18n'
import { useWorkspace, defaultView } from '../../store/store'
import type { Database, FilterGroup, ID, PageCover, PageIcon, PropertyDef, PropertyValue, View } from '../../store/types'
import { newId } from '../../lib/ids'
import {
  b,
  barFormula,
  callout,
  code,
  codeBlock,
  columns,
  dateMention,
  day,
  dbBlock,
  doc,
  h2,
  h3,
  hr,
  i,
  li,
  mention,
  ol,
  opt,
  p,
  pageLink,
  quote,
  table,
  task,
  tasks,
  toc,
  toggle,
  ul,
  weekday,
} from './doc'

export type TemplateCategory = 'work' | 'product' | 'personal' | 'knowledge'
export type OutlineKind = 'page' | 'db' | 'views' | 'fields' | 'rows'
export interface OutlineLine {
  depth: number
  kind: OutlineKind
  label: string
}
type Tr = (en: string, de: string) => string

export interface TemplateDef {
  id: string
  code: string
  category: TemplateCategory
  icon: string
  title: (L: Tr) => string
  description: (L: Tr) => string
  outline: (L: Tr) => OutlineLine[]
  build: (parentId: ID | null, L: Tr) => ID
}

export const translator = (lang: Lang): Tr => (en, de) => (lang === 'de' ? de : en)

/* ------------------------------------------------------------------ */
/* store helpers                                                       */
/* ------------------------------------------------------------------ */

const S = () => useWorkspace.getState()
const emoji = (value: string): PageIcon => ({ type: 'emoji', value })
const asset = (value: string): PageIcon => ({ type: 'asset', value })
const cover = (name: string): PageCover => ({ type: 'image', value: `assets/covers/${name}.webp`, positionY: 50 })

function people(): ID[] {
  const s = S()
  if (s.people.length) return s.people.map((x) => x.id)
  return [s.addPerson(s.settings.userName || 'You')]
}

interface DbSpec {
  id?: ID
  parentId: ID | null
  title: string
  icon: PageIcon
  properties: PropertyDef[]
  views: (db: Pick<Database, 'properties'>) => View[]
  inline?: boolean
}

function makeDb(spec: DbSpec): ID {
  const db = { properties: spec.properties }
  return S().createDatabase({ id: spec.id, parentId: spec.parentId, title: spec.title, icon: spec.icon, properties: spec.properties, views: spec.views(db), inline: spec.inline })
}

function view(type: View['type'], db: Pick<Database, 'properties'>, name: string, patch: Partial<View> = {}): View {
  return { ...defaultView(type, db, name), ...patch }
}

function row(dbId: ID, title: string, properties: Record<ID, PropertyValue>, content?: JSONContent | null, icon?: PageIcon | null): ID {
  return S().createRow(dbId, { title, properties, content: content ?? null, icon: icon ?? null })
}

const range = (a: number, b: number) => ({ start: day(a), end: day(b) })
const on = (n: number) => ({ start: day(n) })

/* ------------------------------------------------------------------ */
/* 01 Meeting notes                                                    */
/* ------------------------------------------------------------------ */

const meetingNotes: TemplateDef = {
  id: 'meetings',
  code: 'T-01',
  category: 'work',
  icon: 'history',
  title: (L) => L('Meeting notes', 'Meeting-Notizen'),
  description: (L) =>
    L(
      'A meetings database with a ready agenda for every new entry: goal, agenda, notes, decisions and action items. Calendar view included.',
      'Eine Meeting-Datenbank mit fertiger Agenda für jeden neuen Eintrag: Ziel, Agenda, Notizen, Entscheidungen und Aufgaben. Inklusive Kalenderansicht.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'db', label: L('Meetings', 'Meetings') },
    { depth: 1, kind: 'views', label: L('All meetings · Calendar', 'Alle Meetings · Kalender') },
    { depth: 1, kind: 'fields', label: L('Date · Type · Attendees', 'Datum · Typ · Teilnehmende') },
    { depth: 1, kind: 'rows', label: L('3 meetings + "Meeting" row template', '3 Meetings + Zeilenvorlage „Meeting“') },
  ],
  build(parentId, L) {
    const P = { name: newId(), date: newId(), type: newId(), who: newId() }
    const types = [opt(L('Planning', 'Planung'), 'orange'), opt('Standup', 'blue'), opt('Retro', 'purple'), opt('1:1', 'green'), opt(L('Client', 'Kunde'), 'pink')]
    const properties: PropertyDef[] = [
      { id: P.name, name: L('Meeting', 'Meeting'), type: 'title' },
      { id: P.date, name: L('Date', 'Datum'), type: 'date' },
      { id: P.type, name: L('Type', 'Typ'), type: 'select', options: types },
      { id: P.who, name: L('Attendees', 'Teilnehmende'), type: 'person' },
    ]
    const dbId = makeDb({
      parentId,
      title: L('Meeting notes', 'Meeting-Notizen'),
      icon: asset('history'),
      properties,
      views: (db) => [view('table', db, L('All meetings', 'Alle Meetings'), { sorts: [{ propertyId: P.date, direction: 'desc' }] }), view('calendar', db, L('Calendar', 'Kalender'), { dateProperty: P.date })],
    })
    const agenda = (filled: boolean) =>
      doc(
        callout('🎯', 'orange', p(b(L('Goal: ', 'Ziel: ')), filled ? L('Agree on the Q4 launch scope and owners.', 'Q4-Launch-Umfang und Verantwortliche festlegen.') : L('What should be true after this meeting?', 'Was soll nach diesem Meeting klar sein?'))),
        h2(L('Agenda', 'Agenda')),
        filled ? ol(L('Status round — 2 min each', 'Statusrunde — je 2 Minuten'), L('Launch scope: must-haves vs. nice-to-haves', 'Launch-Umfang: Muss vs. Kann'), L('Risks & open questions', 'Risiken & offene Fragen')) : ol(L('Topic', 'Thema'), L('Topic', 'Thema')),
        h2(L('Notes', 'Notizen')),
        filled
          ? ul(
              li(L('Import from Notion is ', 'Notion-Import ist '), b(L('done', 'fertig')), L(' — 42 pages moved without broken links.', ' — 42 Seiten ohne kaputte Links umgezogen.')),
              li(L('Onboarding video slips one week; script needs another review.', 'Onboarding-Video rutscht eine Woche; Skript braucht noch ein Review.')),
            )
          : p(),
        h2(L('Decisions', 'Entscheidungen')),
        filled ? callout('✅', 'green', L('Ship the public beta on the 15th. Pricing page stays behind a flag.', 'Öffentliche Beta am 15. Die Preisseite bleibt hinter einem Flag.')) : ul(L('Decision', 'Entscheidung')),
        h2(L('Action items', 'Aufgaben')),
        filled
          ? tasks(task(true, L('Send recap to the team', 'Zusammenfassung ans Team schicken')), task(false, L('Finalize launch checklist', 'Launch-Checkliste finalisieren')), task(false, L('Book the review session', 'Review-Termin buchen')))
          : tasks(L('Action item', 'Aufgabe')),
      )
    const ppl = people()
    S().updateDatabase(dbId, { templates: [{ id: newId(), name: L('Meeting', 'Meeting'), icon: emoji('🗓️'), content: agenda(false), properties: { [P.date]: on(0) } }] })
    row(dbId, L('Weekly sync', 'Weekly Sync'), { [P.date]: on(0), [P.type]: types[0].id, [P.who]: ppl.slice(0, 3) }, agenda(true), emoji('🗓️'))
    row(
      dbId,
      L('Retro — last sprint', 'Retro — letzter Sprint'),
      { [P.date]: on(-7), [P.type]: types[2].id, [P.who]: ppl.slice(0, 4) },
      doc(
        columns(
          [h3(L('Went well', 'Lief gut')), ul(L('Pairing on the importer', 'Pairing am Importer'), L('Zero-downtime release', 'Release ohne Ausfall'))],
          [h3(L('To improve', 'Verbessern')), ul(L('Reviews took too long', 'Reviews dauerten zu lange'), L('Unclear ownership of docs', 'Unklare Zuständigkeit für Doku'))],
        ),
        h2(L('Experiments for next sprint', 'Experimente für den nächsten Sprint')),
        tasks(L('Review within 24 h — tracked on the board', 'Review innerhalb von 24 h — auf dem Board verfolgt')),
      ),
      emoji('🔁'),
    )
    row(dbId, L('Kickoff with client', 'Kickoff mit Kunde'), { [P.date]: on(3), [P.type]: types[4].id, [P.who]: ppl.slice(0, 2) }, agenda(false), emoji('🤝'))
    return dbId
  },
}

/* ------------------------------------------------------------------ */
/* 02 Project tracker                                                  */
/* ------------------------------------------------------------------ */

const projectTracker: TemplateDef = {
  id: 'projects',
  code: 'T-02',
  category: 'work',
  icon: 'kanban',
  title: (L) => L('Project tracker', 'Projekt-Tracker'),
  description: (L) =>
    L(
      'Projects on a status board, a timeline and a table with average progress. Each project opens into a one-page brief.',
      'Projekte auf einem Status-Board, einer Timeline und einer Tabelle mit Durchschnittsfortschritt. Jedes Projekt öffnet sich als einseitiger Steckbrief.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'db', label: L('Projects', 'Projekte') },
    { depth: 1, kind: 'views', label: L('Board · Timeline · Table', 'Board · Timeline · Tabelle') },
    { depth: 1, kind: 'fields', label: L('Status · Priority · Owner · Dates · Progress · Tags', 'Status · Priorität · Verantwortlich · Zeitraum · Fortschritt · Tags') },
    { depth: 1, kind: 'rows', label: L('6 projects + "Project brief" template', '6 Projekte + Vorlage „Projektsteckbrief“') },
  ],
  build(parentId, L) {
    const P = { name: newId(), status: newId(), prio: newId(), owner: newId(), dates: newId(), progress: newId(), tags: newId() }
    const st = [opt('Backlog', 'gray', 'todo'), opt(L('Planning', 'Planung'), 'yellow', 'todo'), opt(L('In progress', 'In Arbeit'), 'blue', 'in_progress'), opt('Review', 'purple', 'in_progress'), opt(L('Done', 'Erledigt'), 'green', 'done')]
    const pr = [opt(L('High', 'Hoch'), 'red'), opt(L('Medium', 'Mittel'), 'yellow'), opt(L('Low', 'Niedrig'), 'gray')]
    const tg = [opt('Web', 'blue'), opt('Marketing', 'pink'), opt('Product', 'orange'), opt('Ops', 'brown')]
    const properties: PropertyDef[] = [
      { id: P.name, name: L('Project', 'Projekt'), type: 'title' },
      { id: P.status, name: 'Status', type: 'status', options: st },
      { id: P.prio, name: L('Priority', 'Priorität'), type: 'select', options: pr },
      { id: P.owner, name: L('Owner', 'Verantwortlich'), type: 'person' },
      { id: P.dates, name: L('Dates', 'Zeitraum'), type: 'date' },
      { id: P.progress, name: L('Progress', 'Fortschritt'), type: 'number', numberFormat: 'percent', numberDisplay: 'bar' },
      { id: P.tags, name: 'Tags', type: 'multi_select', options: tg },
    ]
    const dbId = makeDb({
      parentId,
      title: L('Project tracker', 'Projekt-Tracker'),
      icon: asset('kanban'),
      properties,
      views: (db) => [
        view('board', db, 'Board', { groupBy: P.status, visibleProperties: [P.prio, P.owner, P.dates, P.progress] }),
        view('timeline', db, 'Timeline', { dateProperty: P.dates, visibleProperties: [P.owner, P.status] }),
        view('table', db, L('Table', 'Tabelle'), { calculations: { [P.progress]: 'average' } }),
      ],
    })
    const brief = (goal: string) =>
      doc(
        callout('🎯', 'gray', p(b(L('Goal  ', 'Ziel  ')), goal)),
        h2(L('Scope', 'Umfang')),
        tasks(L('Define success metric', 'Erfolgskennzahl festlegen'), L('Draft plan & milestones', 'Plan & Meilensteine entwerfen'), L('Kick off with the team', 'Kickoff mit dem Team')),
        h2(L('Milestones', 'Meilensteine')),
        table([
          [L('Milestone', 'Meilenstein'), L('Owner', 'Verantwortlich'), L('Due', 'Fällig')],
          [L('Plan approved', 'Plan freigegeben'), '—', day(7)],
          [L('First release', 'Erstes Release'), '—', day(21)],
        ]),
        h2(L('Risks', 'Risiken')),
        ul(L('Name it, rate it, own it.', 'Benennen, bewerten, verantworten.')),
      )
    S().updateDatabase(dbId, { templates: [{ id: newId(), name: L('Project brief', 'Projektsteckbrief'), icon: emoji('📐'), content: brief(L('One sentence that defines done.', 'Ein Satz, der „fertig“ definiert.')), properties: { [P.status]: st[0].id } }] })
    const ppl = people()
    const rows: Array<[string, number, number, number, number, number, number[], string]> = [
      [L('Website relaunch', 'Website-Relaunch'), 2, 0, -12, 18, 0.55, [0, 1], '🌐'],
      [L('Customer portal', 'Kundenportal'), 1, 1, 6, 40, 0.1, [0, 2], '🔐'],
      [L('Q4 campaign', 'Q4-Kampagne'), 3, 1, -20, 4, 0.85, [1], '📣'],
      [L('Onboarding revamp', 'Onboarding-Überarbeitung'), 2, 0, -4, 22, 0.35, [2], '🧭'],
      [L('Office move', 'Büroumzug'), 0, 2, 30, 45, 0, [3], '📦'],
      [L('Analytics cleanup', 'Analytics-Aufräumen'), 4, 2, -40, -10, 1, [3, 2], '📊'],
    ]
    rows.forEach(([title, s, pri, a, z, prog, tags, ic], idx) =>
      row(
        dbId,
        title,
        { [P.status]: st[s].id, [P.prio]: pr[pri].id, [P.owner]: [ppl[idx % ppl.length]], [P.dates]: range(a, z), [P.progress]: prog, [P.tags]: tags.map((t) => tg[t].id) },
        idx === 0 ? brief(L('Launch the new site with a 30% faster first load.', 'Neue Website mit 30 % schnellerem Erstaufruf launchen.')) : null,
        emoji(ic),
      ),
    )
    return dbId
  },
}

/* ------------------------------------------------------------------ */
/* 03 Product roadmap                                                  */
/* ------------------------------------------------------------------ */

const roadmap: TemplateDef = {
  id: 'roadmap',
  code: 'T-03',
  category: 'product',
  icon: 'publish',
  title: (L) => L('Product roadmap', 'Produkt-Roadmap'),
  description: (L) =>
    L(
      'Features on a timeline by quarter, with stage, team, impact and votes. Switch to the stage board or the quarter table.',
      'Features auf einer Timeline nach Quartal, mit Phase, Team, Wirkung und Stimmen. Umschalten auf Phasen-Board oder Quartalstabelle.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'db', label: 'Roadmap' },
    { depth: 1, kind: 'views', label: L('Timeline · By stage · By quarter', 'Timeline · Nach Phase · Nach Quartal') },
    { depth: 1, kind: 'fields', label: L('Stage · Quarter · Team · Dates · Impact · Votes', 'Phase · Quartal · Team · Zeitraum · Wirkung · Stimmen') },
    { depth: 1, kind: 'rows', label: L('7 features', '7 Features') },
  ],
  build(parentId, L) {
    const P = { name: newId(), stage: newId(), q: newId(), team: newId(), dates: newId(), impact: newId(), votes: newId() }
    const st = [opt(L('Idea', 'Idee'), 'gray', 'todo'), opt(L('Planned', 'Geplant'), 'yellow', 'todo'), opt(L('Building', 'In Bau'), 'blue', 'in_progress'), opt('Beta', 'purple', 'in_progress'), opt(L('Shipped', 'Live'), 'green', 'done')]
    const qs = [opt('Q4 2026', 'orange'), opt('Q1 2027', 'blue'), opt('Q2 2027', 'green'), opt(L('Later', 'Später'), 'gray')]
    const teams = [opt('Core', 'blue'), opt('Growth', 'pink'), opt('Platform', 'brown'), opt('Design', 'purple')]
    const imp = [opt('XL', 'red'), opt('L', 'orange'), opt('M', 'yellow'), opt('S', 'gray')]
    const properties: PropertyDef[] = [
      { id: P.name, name: 'Feature', type: 'title' },
      { id: P.stage, name: L('Stage', 'Phase'), type: 'status', options: st },
      { id: P.q, name: L('Quarter', 'Quartal'), type: 'select', options: qs },
      { id: P.team, name: 'Team', type: 'select', options: teams },
      { id: P.dates, name: L('Dates', 'Zeitraum'), type: 'date' },
      { id: P.impact, name: L('Impact', 'Wirkung'), type: 'select', options: imp },
      { id: P.votes, name: L('Votes', 'Stimmen'), type: 'number' },
    ]
    const dbId = makeDb({
      parentId,
      title: L('Product roadmap', 'Produkt-Roadmap'),
      icon: asset('publish'),
      properties,
      views: (db) => [
        view('timeline', db, 'Timeline', { dateProperty: P.dates, visibleProperties: [P.stage, P.team] }),
        view('board', db, L('By stage', 'Nach Phase'), { groupBy: P.stage, visibleProperties: [P.q, P.team, P.impact, P.votes] }),
        view('table', db, L('By quarter', 'Nach Quartal'), { groupBy: P.q, sorts: [{ propertyId: P.votes, direction: 'desc' }], calculations: { [P.votes]: 'sum' } }),
      ],
    })
    const feats: Array<[string, number, number, number, number, number, number, number]> = [
      [L('Offline sync', 'Offline-Sync'), 4, 0, 2, -60, -14, 0, 182],
      [L('Real-time collaboration', 'Echtzeit-Zusammenarbeit'), 2, 0, 0, -20, 40, 0, 240],
      [L('Public API', 'Öffentliche API'), 3, 0, 2, -10, 25, 1, 131],
      [L('Mobile app', 'Mobile App'), 1, 1, 0, 45, 120, 0, 205],
      [L('Template marketplace', 'Vorlagen-Marktplatz'), 1, 1, 1, 60, 110, 2, 88],
      [L('Dark mode for print', 'Dunkelmodus für Druck'), 0, 3, 3, 150, 175, 3, 12],
      [L('SSO / SAML', 'SSO / SAML'), 0, 2, 2, 100, 150, 1, 64],
    ]
    feats.forEach(([title, s, q, team, a, z, im, votes]) =>
      row(
        dbId,
        title,
        { [P.stage]: st[s].id, [P.q]: qs[q].id, [P.team]: teams[team].id, [P.dates]: range(a, z), [P.impact]: imp[im].id, [P.votes]: votes },
        doc(h2(L('Problem', 'Problem')), p(L('Who hurts today, and how do we know?', 'Wer hat heute ein Problem — und woher wissen wir das?')), h2(L('Bet', 'Wette')), p(L('What we build and what we deliberately leave out.', 'Was wir bauen — und was bewusst nicht.'))),
      ),
    )
    return dbId
  },
}

/* ------------------------------------------------------------------ */
/* 04 Content calendar                                                 */
/* ------------------------------------------------------------------ */

const contentCalendar: TemplateDef = {
  id: 'content',
  code: 'T-04',
  category: 'work',
  icon: 'calendar',
  title: (L) => L('Content calendar', 'Content-Kalender'),
  description: (L) =>
    L(
      'Plan posts across channels on a calendar, move them through a pipeline board, and start each one from a post brief.',
      'Beiträge über Kanäle hinweg im Kalender planen, über ein Pipeline-Board schieben und jeden mit einem Briefing starten.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'db', label: L('Content calendar', 'Content-Kalender') },
    { depth: 1, kind: 'views', label: L('Calendar · Pipeline · Table', 'Kalender · Pipeline · Tabelle') },
    { depth: 1, kind: 'fields', label: L('Publish date · Channel · Status · Owner · Link', 'Veröffentlichung · Kanal · Status · Verantwortlich · Link') },
    { depth: 1, kind: 'rows', label: L('8 posts + "Post brief" template', '8 Beiträge + Vorlage „Briefing“') },
  ],
  build(parentId, L) {
    const P = { name: newId(), date: newId(), ch: newId(), status: newId(), owner: newId(), url: newId() }
    const chs = [opt('Blog', 'orange'), opt('Newsletter', 'blue'), opt('LinkedIn', 'purple'), opt('YouTube', 'red'), opt('Podcast', 'green')]
    const st = [opt(L('Idea', 'Idee'), 'gray', 'todo'), opt(L('Drafting', 'Entwurf'), 'yellow', 'in_progress'), opt(L('Editing', 'Lektorat'), 'blue', 'in_progress'), opt(L('Scheduled', 'Geplant'), 'purple', 'in_progress'), opt(L('Published', 'Veröffentlicht'), 'green', 'done')]
    const properties: PropertyDef[] = [
      { id: P.name, name: L('Title', 'Titel'), type: 'title' },
      { id: P.date, name: L('Publish date', 'Veröffentlichung'), type: 'date' },
      { id: P.ch, name: L('Channel', 'Kanal'), type: 'select', options: chs },
      { id: P.status, name: 'Status', type: 'status', options: st },
      { id: P.owner, name: L('Owner', 'Verantwortlich'), type: 'person' },
      { id: P.url, name: 'Link', type: 'url' },
    ]
    const dbId = makeDb({
      parentId,
      title: L('Content calendar', 'Content-Kalender'),
      icon: asset('calendar'),
      properties,
      views: (db) => [
        view('calendar', db, L('Calendar', 'Kalender'), { dateProperty: P.date, visibleProperties: [P.ch, P.status] }),
        view('board', db, 'Pipeline', { groupBy: P.status, visibleProperties: [P.ch, P.date, P.owner] }),
        view('table', db, L('Table', 'Tabelle'), { sorts: [{ propertyId: P.date, direction: 'asc' }] }),
      ],
    })
    const brief = doc(
      h2(L('Hook', 'Aufhänger')),
      p(L('One line that makes someone stop scrolling.', 'Eine Zeile, die zum Anhalten bringt.')),
      h2(L('Outline', 'Gliederung')),
      ol(L('Problem', 'Problem'), L('Insight', 'Erkenntnis'), L('How-to', 'Anleitung'), L('Call to action', 'Handlungsaufforderung')),
      h2(L('Distribution', 'Verteilung')),
      tasks('Newsletter', 'LinkedIn', L('Cross-post to the blog', 'Im Blog crossposten')),
    )
    S().updateDatabase(dbId, { templates: [{ id: newId(), name: L('Post brief', 'Briefing'), icon: emoji('✍️'), content: brief, properties: { [P.status]: st[0].id } }] })
    const ppl = people()
    const posts: Array<[string, number, number, number]> = [
      [L('Why local-first beats the cloud', 'Warum local-first die Cloud schlägt'), -9, 0, 4],
      [L('October product update', 'Produkt-Update Oktober'), -2, 1, 4],
      [L('5 automations for your workspace', '5 Automationen für deinen Workspace'), 1, 2, 3],
      [L('Behind the scenes: our design system', 'Hinter den Kulissen: unser Design-System'), 4, 3, 2],
      [L('Customer story: agency CRM', 'Kundengeschichte: Agentur-CRM'), 8, 0, 1],
      [L('Keyboard-first in 90 seconds', 'Tastatur zuerst in 90 Sekunden'), 11, 3, 1],
      [L('Interview: building in public', 'Interview: Building in Public'), 15, 4, 0],
      [L('Year-end reading list', 'Leseliste zum Jahresende'), 21, 1, 0],
    ]
    posts.forEach(([title, d, ch, s], idx) =>
      row(dbId, title, { [P.date]: on(d), [P.ch]: chs[ch].id, [P.status]: st[s].id, [P.owner]: [ppl[idx % ppl.length]], ...(s === 4 ? { [P.url]: 'https://example.com/blog' } : {}) }, idx === 2 ? brief : null),
    )
    return dbId
  },
}

/* ------------------------------------------------------------------ */
/* 05 Reading list                                                     */
/* ------------------------------------------------------------------ */

const readingList: TemplateDef = {
  id: 'reading',
  code: 'T-05',
  category: 'personal',
  icon: 'templates',
  title: (L) => L('Reading list', 'Leseliste'),
  description: (L) =>
    L(
      'A cover gallery of books, papers and podcasts with status, rating and notes. Board by status for what you are reading now.',
      'Eine Cover-Galerie für Bücher, Paper und Podcasts mit Status, Bewertung und Notizen. Board nach Status für das, was du gerade liest.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'db', label: L('Reading list', 'Leseliste') },
    { depth: 1, kind: 'views', label: L('Gallery · Board · Table', 'Galerie · Board · Tabelle') },
    { depth: 1, kind: 'fields', label: L('Author · Type · Status · Rating · Finished · Tags', 'Autor:in · Art · Status · Bewertung · Beendet · Tags') },
    { depth: 1, kind: 'rows', label: L('8 entries with covers', '8 Einträge mit Covern') },
  ],
  build(parentId, L) {
    const P = { name: newId(), author: newId(), type: newId(), status: newId(), rating: newId(), done: newId(), tags: newId(), link: newId() }
    const types = [opt(L('Book', 'Buch'), 'brown'), opt(L('Article', 'Artikel'), 'blue'), opt('Paper', 'purple'), opt('Podcast', 'green')]
    const st = [opt(L('To read', 'Zu lesen'), 'gray', 'todo'), opt(L('Reading', 'Am Lesen'), 'blue', 'in_progress'), opt(L('Finished', 'Gelesen'), 'green', 'done')]
    const tg = [opt('Design', 'orange'), opt('Software', 'blue'), opt(L('Systems', 'Systeme'), 'purple'), opt(L('Craft', 'Handwerk'), 'brown')]
    const properties: PropertyDef[] = [
      { id: P.name, name: L('Title', 'Titel'), type: 'title' },
      { id: P.author, name: L('Author', 'Autor:in'), type: 'text' },
      { id: P.type, name: L('Type', 'Art'), type: 'select', options: types },
      { id: P.status, name: 'Status', type: 'status', options: st },
      { id: P.rating, name: L('Rating', 'Bewertung'), type: 'rating', ratingMax: 5 },
      { id: P.done, name: L('Finished', 'Beendet'), type: 'date' },
      { id: P.tags, name: 'Tags', type: 'multi_select', options: tg },
      { id: P.link, name: 'Link', type: 'url' },
    ]
    const dbId = makeDb({
      parentId,
      title: L('Reading list', 'Leseliste'),
      icon: asset('templates'),
      properties,
      views: (db) => [
        view('gallery', db, L('Shelf', 'Regal'), { cardPreview: 'cover', cardSize: 'medium', visibleProperties: [P.author, P.status, P.rating] }),
        view('board', db, 'Board', { groupBy: P.status, cardPreview: 'cover', visibleProperties: [P.author, P.rating] }),
        view('table', db, L('Table', 'Tabelle')),
      ],
    })
    const books: Array<[string, string, number, number, number, number | null, number[], string]> = [
      ['Less but Better', 'Dieter Rams', 0, 2, 5, -30, [0, 3], 'aluminum'],
      ['Designing Design', 'Kenya Hara', 0, 1, 0, null, [0], 'paper-folds'],
      ['Thinking in Systems', 'Donella H. Meadows', 0, 2, 5, -90, [2], 'ink'],
      ['Local-first software', 'Ink & Switch', 2, 2, 4, -12, [1, 2], 'grain'],
      ['Shape Up', 'Ryan Singer', 0, 0, 0, null, [1, 3], 'concrete'],
      ['The Design of Everyday Things', 'Don Norman', 0, 2, 4, -200, [0], 'dunes'],
      ['The Mythical Man-Month', 'Fred Brooks', 0, 0, 0, null, [1], 'night'],
      [L('How to read a paper', 'How to read a paper'), 'S. Keshav', 2, 1, 0, null, [3], 'glass'],
    ]
    books.forEach(([title, author, ty, s, stars, fin, tags, cv]) => {
      const id = row(
        dbId,
        title,
        { [P.author]: author, [P.type]: types[ty].id, [P.status]: st[s].id, ...(stars ? { [P.rating]: stars } : {}), ...(fin !== null ? { [P.done]: on(fin) } : {}), [P.tags]: tags.map((x) => tg[x].id) },
        s === 2 ? doc(h3(L('Takeaways', 'Erkenntnisse')), ul(L('…', '…')), quote(i(L('Favourite quote goes here.', 'Lieblingszitat hier.')))) : null,
      )
      S().updatePage(id, { cover: cover(cv) })
    })
    return dbId
  },
}

/* ------------------------------------------------------------------ */
/* 06 Personal CRM                                                     */
/* ------------------------------------------------------------------ */

const crm: TemplateDef = {
  id: 'crm',
  code: 'T-06',
  category: 'personal',
  icon: 'sync',
  title: (L) => L('Personal CRM', 'Persönliches CRM'),
  description: (L) =>
    L(
      'Contacts linked to an interactions log. "Last contact" is a rollup, so you see at a glance who you have not talked to in a while.',
      'Kontakte, verknüpft mit einem Interaktions-Log. „Letzter Kontakt“ ist ein Rollup — so siehst du sofort, mit wem du länger nicht gesprochen hast.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'page', label: L('Personal CRM', 'Persönliches CRM') },
    { depth: 1, kind: 'db', label: L('Contacts', 'Kontakte') },
    { depth: 2, kind: 'fields', label: L('Company · Email · Stage · Interactions → · Last contact (rollup)', 'Firma · E-Mail · Phase · Interaktionen → · Letzter Kontakt (Rollup)') },
    { depth: 1, kind: 'db', label: L('Interactions', 'Interaktionen') },
    { depth: 2, kind: 'fields', label: L('Date · Type · Contact →', 'Datum · Art · Kontakt →') },
    { depth: 2, kind: 'rows', label: L('5 contacts · 7 interactions', '5 Kontakte · 7 Interaktionen') },
  ],
  build(parentId, L) {
    const root = S().createPage({ parentId, title: L('Personal CRM', 'Persönliches CRM'), icon: asset('sync') })
    const C = { name: newId(), company: newId(), email: newId(), phone: newId(), stage: newId(), tags: newId(), inter: newId(), last: newId(), next: newId() }
    const I = { name: newId(), date: newId(), type: newId(), contact: newId() }
    const interId = newId()
    const stages = [opt('Lead', 'yellow'), opt(L('Active', 'Aktiv'), 'blue'), opt('Partner', 'purple'), opt(L('Friend', 'Freund:in'), 'green')]
    const tg = [opt(L('Investor', 'Investor'), 'orange'), opt(L('Design', 'Design'), 'pink'), opt(L('Engineering', 'Engineering'), 'blue'), opt(L('Community', 'Community'), 'green')]
    const itypes = [opt(L('Call', 'Anruf'), 'blue'), opt('Email', 'gray'), opt('Meeting', 'purple'), opt(L('Coffee', 'Kaffee'), 'brown')]
    const contactsId = makeDb({
      parentId: root,
      title: L('Contacts', 'Kontakte'),
      icon: emoji('👥'),
      inline: true,
      properties: [
        { id: C.name, name: 'Name', type: 'title' },
        { id: C.company, name: L('Company', 'Firma'), type: 'text' },
        { id: C.email, name: 'Email', type: 'email' },
        { id: C.phone, name: L('Phone', 'Telefon'), type: 'phone' },
        { id: C.stage, name: L('Stage', 'Phase'), type: 'select', options: stages },
        { id: C.tags, name: 'Tags', type: 'multi_select', options: tg },
        { id: C.inter, name: L('Interactions', 'Interaktionen'), type: 'relation', relationDatabaseId: interId },
        { id: C.last, name: L('Last contact', 'Letzter Kontakt'), type: 'rollup', rollup: { relationPropertyId: C.inter, targetPropertyId: I.date, fn: 'latest_date' } },
        { id: C.next, name: L('Follow up', 'Nachfassen'), type: 'date' },
      ],
      views: (db) => [view('table', db, L('All contacts', 'Alle Kontakte'), { visibleProperties: [C.company, C.stage, C.last, C.next, C.tags] }), view('board', db, L('By stage', 'Nach Phase'), { groupBy: C.stage, visibleProperties: [C.company, C.last] })],
    })
    const realInterId = makeDb({
      id: interId,
      parentId: root,
      title: L('Interactions', 'Interaktionen'),
      icon: emoji('💬'),
      inline: true,
      properties: [
        { id: I.name, name: L('Summary', 'Zusammenfassung'), type: 'title' },
        { id: I.date, name: L('Date', 'Datum'), type: 'date' },
        { id: I.type, name: L('Type', 'Art'), type: 'select', options: itypes },
        { id: I.contact, name: L('Contact', 'Kontakt'), type: 'relation', relationDatabaseId: contactsId },
      ],
      views: (db) => [view('table', db, L('Log', 'Log'), { sorts: [{ propertyId: I.date, direction: 'desc' }] }), view('calendar', db, L('Calendar', 'Kalender'), { dateProperty: I.date })],
    })
    const contacts: Array<[string, string, string, number, number[], number | null]> = [
      ['Lena Hoffmann', 'Northwind Studio', 'lena@northwind.example', 2, [1], 10],
      ['Marcus Chen', 'Atlas Ventures', 'marcus@atlas.example', 0, [0], 3],
      ['Priya Raman', 'Kestrel Labs', 'priya@kestrel.example', 1, [2], null],
      ['Jonas Weber', L('Freelance', 'Freiberuflich'), 'jonas@weber.example', 3, [3, 2], 21],
      ['Sofia Alvarez', 'Lumen & Co', 'sofia@lumen.example', 1, [1, 3], 7],
    ]
    const cIds = contacts.map(([name, company, email, stage, tags, next]) =>
      row(contactsId, name, { [C.company]: company, [C.email]: email, [C.stage]: stages[stage].id, [C.tags]: tags.map((x) => tg[x].id), ...(next !== null ? { [C.next]: on(next) } : {}) }, doc(h3(L('Notes', 'Notizen')), ul(L('How we met, what they care about, kids’ names.', 'Wie wir uns kennen, was ihr wichtig ist, Namen der Kinder.')))),
    )
    const log: Array<[string, number, number, number]> = [
      [L('Intro call about the redesign', 'Kennenlern-Call zum Redesign'), -3, 0, 0],
      [L('Sent the pitch deck', 'Pitch-Deck geschickt'), -6, 1, 1],
      [L('Coffee at the conference', 'Kaffee auf der Konferenz'), -14, 3, 1],
      [L('Quarterly check-in', 'Quartals-Check-in'), -1, 2, 2],
      [L('Code review session', 'Code-Review-Session'), -40, 2, 3],
      [L('Birthday message', 'Geburtstagsnachricht'), -60, 1, 3],
      [L('Workshop planning', 'Workshop-Planung'), -2, 2, 4],
    ]
    const byContact = new Map<ID, ID[]>()
    for (const [title, d, ty, ci] of log) {
      const iid = row(realInterId, title, { [I.date]: on(d), [I.type]: itypes[ty].id, [I.contact]: [cIds[ci]] })
      byContact.set(cIds[ci], [...(byContact.get(cIds[ci]) ?? []), iid])
    }
    for (const [cid, list] of byContact) S().setRowProperty(cid, C.inter, list)
    S().setContent(
      root,
      doc(
        callout('💡', 'gray', p(L('Log every touchpoint in ', 'Jeden Kontakt in '), b(L('Interactions', 'Interaktionen')), L(' and link the person. ', ' eintragen und die Person verknüpfen. '), b(L('Last contact', 'Letzter Kontakt')), L(' updates itself.', ' aktualisiert sich selbst.'))),
        dbBlock(contactsId),
        dbBlock(realInterId),
      ),
      'template',
    )
    return root
  },
}

/* ------------------------------------------------------------------ */
/* 07 Bug tracker                                                      */
/* ------------------------------------------------------------------ */

const bugTracker: TemplateDef = {
  id: 'bugs',
  code: 'T-07',
  category: 'product',
  icon: 'hammer',
  title: (L) => L('Bug tracker', 'Bug-Tracker'),
  description: (L) =>
    L(
      'Auto-numbered bugs (BUG-1, BUG-2 …) with priority, status, component and environment. A "Critical" view filters P0 and P1.',
      'Automatisch nummerierte Bugs (BUG-1, BUG-2 …) mit Priorität, Status, Komponente und Umgebung. Die Ansicht „Kritisch“ filtert P0 und P1.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'db', label: L('Bugs', 'Bugs') },
    { depth: 1, kind: 'views', label: L('Board · Critical · All bugs', 'Board · Kritisch · Alle Bugs') },
    { depth: 1, kind: 'fields', label: L('ID (unique) · Priority · Status · Assignee · Component · Environment · Reported', 'ID (eindeutig) · Priorität · Status · Zuständig · Komponente · Umgebung · Gemeldet') },
    { depth: 1, kind: 'rows', label: L('6 bugs + "Bug report" template', '6 Bugs + Vorlage „Bug-Report“') },
  ],
  build(parentId, L) {
    const P = { name: newId(), uid: newId(), prio: newId(), status: newId(), who: newId(), comp: newId(), env: newId(), created: newId() }
    const pr = [opt('P0', 'red'), opt('P1', 'orange'), opt('P2', 'yellow'), opt('P3', 'gray')]
    const st = [opt(L('Reported', 'Gemeldet'), 'gray', 'todo'), opt(L('Triaged', 'Gesichtet'), 'yellow', 'todo'), opt(L('In progress', 'In Arbeit'), 'blue', 'in_progress'), opt(L('In review', 'Im Review'), 'purple', 'in_progress'), opt(L('Fixed', 'Behoben'), 'green', 'done'), opt(L("Won't fix", 'Wird nicht behoben'), 'brown', 'done')]
    const comps = [opt('Editor', 'blue'), opt('Sync', 'purple'), opt(L('Database', 'Datenbank'), 'orange'), opt('UI', 'pink'), opt('API', 'brown')]
    const envs = [opt('Chrome', 'yellow'), opt('Safari', 'blue'), opt('Firefox', 'orange'), opt('iOS', 'gray'), opt('Android', 'green')]
    const properties: PropertyDef[] = [
      { id: P.name, name: 'Bug', type: 'title' },
      { id: P.uid, name: 'ID', type: 'unique_id', idPrefix: 'BUG' },
      { id: P.prio, name: L('Priority', 'Priorität'), type: 'select', options: pr },
      { id: P.status, name: 'Status', type: 'status', options: st },
      { id: P.who, name: L('Assignee', 'Zuständig'), type: 'person' },
      { id: P.comp, name: L('Component', 'Komponente'), type: 'select', options: comps },
      { id: P.env, name: L('Environment', 'Umgebung'), type: 'multi_select', options: envs },
      { id: P.created, name: L('Reported', 'Gemeldet'), type: 'created_time' },
    ]
    const critical: FilterGroup = {
      id: newId(),
      op: 'or',
      items: [
        { id: newId(), propertyId: P.prio, operator: 'is', value: pr[0].id },
        { id: newId(), propertyId: P.prio, operator: 'is', value: pr[1].id },
      ],
    }
    const dbId = makeDb({
      parentId,
      title: L('Bug tracker', 'Bug-Tracker'),
      icon: asset('hammer'),
      properties,
      views: (db) => [
        view('board', db, 'Board', { groupBy: P.status, visibleProperties: [P.uid, P.prio, P.who, P.comp] }),
        view('table', db, L('Critical', 'Kritisch'), { filter: critical, sorts: [{ propertyId: P.prio, direction: 'asc' }], visibleProperties: [P.uid, P.prio, P.status, P.who, P.comp] }),
        view('table', db, L('All bugs', 'Alle Bugs'), { sorts: [{ propertyId: P.uid, direction: 'desc' }] }),
      ],
    })
    const report = (steps: string[], expected: string, actual: string, log?: string) =>
      doc(
        h2(L('Steps to reproduce', 'Schritte zum Reproduzieren')),
        ol(...steps),
        columns([callout('✅', 'green', p(b(L('Expected  ', 'Erwartet  ')), expected))], [callout('❌', 'red', p(b(L('Actual  ', 'Tatsächlich  ')), actual))]),
        ...(log ? [h2('Log'), codeBlock('bash', log)] : []),
      )
    S().updateDatabase(dbId, {
      templates: [
        {
          id: newId(),
          name: L('Bug report', 'Bug-Report'),
          icon: emoji('🐞'),
          content: report([L('Open …', 'Öffne …'), L('Click …', 'Klicke …')], L('What should happen', 'Was passieren sollte'), L('What happens instead', 'Was stattdessen passiert')),
          properties: { [P.status]: st[0].id, [P.prio]: pr[2].id },
        },
      ],
    })
    const ppl = people()
    const bugs: Array<[string, number, number, number, number[], string[], string, string, string?]> = [
      [L('Pasting a table from Excel loses the header row', 'Tabelle aus Excel einfügen verliert die Kopfzeile'), 1, 2, 0, [0, 2], [L('Copy 3×3 cells in Excel', '3×3 Zellen in Excel kopieren'), L('Paste into an empty page', 'In leere Seite einfügen')], L('A table with a header row', 'Eine Tabelle mit Kopfzeile'), L('First row becomes a normal row', 'Erste Zeile wird normale Zeile')],
      [L('Sync stalls after waking from sleep', 'Sync hängt nach dem Aufwachen aus dem Ruhezustand'), 0, 3, 1, [1, 3], [L('Open two tabs', 'Zwei Tabs öffnen'), L('Sleep the laptop for 10 min', 'Laptop 10 min schlafen legen'), L('Edit in tab A', 'In Tab A bearbeiten')], L('Tab B updates', 'Tab B aktualisiert sich'), L('Tab B shows stale content', 'Tab B zeigt alten Stand'), 'BroadcastChannel: message dropped (tab suspended)\nretrying in 2000ms…'],
      [L('Board column overflows on 390px screens', 'Board-Spalte läuft auf 390px über'), 2, 1, 3, [3, 4], [L('Open a board on a phone', 'Board auf dem Handy öffnen')], L('Columns scroll horizontally', 'Spalten scrollen horizontal'), L('Cards are cut off', 'Karten werden abgeschnitten')],
      [L('Formula error on empty date', 'Formelfehler bei leerem Datum'), 2, 4, 2, [0], [L('Create a row without a date', 'Zeile ohne Datum anlegen')], L('Formula shows nothing', 'Formel zeigt nichts'), '#ERROR'],
      [L('API returns 500 for unicode titles', 'API liefert 500 bei Unicode-Titeln'), 0, 2, 4, [0, 1, 2], [L('POST a page titled "Ünïcödé 🚀"', 'Seite mit Titel „Ünïcödé 🚀“ senden')], '201 Created', '500 Internal Server Error', 'TypeError: Cannot read properties of undefined (reading "normalize")\n    at slugify (api/pages.ts:41:18)'],
      [L('Tooltip flickers over keycaps', 'Tooltip flackert über Tastenkappen'), 3, 5, 3, [1], [L('Hover a shortcut keycap', 'Über eine Tastenkappe fahren')], L('Steady tooltip', 'Ruhiger Tooltip'), L('Flickers at 2 Hz', 'Flackert mit 2 Hz')],
    ]
    bugs.forEach(([title, pri, s, comp, env, steps, exp, act, log], idx) =>
      row(dbId, title, { [P.prio]: pr[pri].id, [P.status]: st[s].id, [P.who]: [ppl[idx % ppl.length]], [P.comp]: comps[comp].id, [P.env]: env.map((x) => envs[x].id) }, report(steps, exp, act, log)),
    )
    return dbId
  },
}

/* ------------------------------------------------------------------ */
/* 08 OKRs                                                             */
/* ------------------------------------------------------------------ */

const okrs: TemplateDef = {
  id: 'okrs',
  code: 'T-08',
  category: 'work',
  icon: 'focus',
  title: (L) => L('OKRs', 'OKRs'),
  description: (L) =>
    L(
      'Objectives with measurable key results. Progress is a formula (current ÷ target) and rolls up into each objective as a bar.',
      'Ziele mit messbaren Schlüsselergebnissen. Fortschritt ist eine Formel (Ist ÷ Soll) und rollt als Balken in jedes Ziel hoch.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'page', label: 'OKRs' },
    { depth: 1, kind: 'db', label: L('Objectives', 'Ziele') },
    { depth: 2, kind: 'fields', label: L('Quarter · Owner · Status · Key results → · Progress (formula)', 'Quartal · Verantwortlich · Status · Schlüsselergebnisse → · Fortschritt (Formel)') },
    { depth: 1, kind: 'db', label: L('Key results', 'Schlüsselergebnisse') },
    { depth: 2, kind: 'fields', label: L('Current · Target · Progress (formula) · Confidence', 'Ist · Soll · Fortschritt (Formel) · Zuversicht') },
    { depth: 2, kind: 'rows', label: L('3 objectives · 7 key results', '3 Ziele · 7 Schlüsselergebnisse') },
  ],
  build(parentId, L) {
    const root = S().createPage({ parentId, title: 'OKRs', icon: asset('focus') })
    const O = { name: newId(), q: newId(), owner: newId(), status: newId(), krs: newId(), score: newId(), progress: newId() }
    const K = { name: newId(), obj: newId(), cur: newId(), target: newId(), score: newId(), progress: newId(), conf: newId() }
    const qs = [opt('Q4 2026', 'orange'), opt('Q1 2027', 'blue')]
    const st = [opt(L('Not started', 'Nicht begonnen'), 'gray', 'todo'), opt(L('On track', 'Im Plan'), 'green', 'in_progress'), opt(L('At risk', 'Gefährdet'), 'yellow', 'in_progress'), opt(L('Off track', 'Verfehlt'), 'red', 'in_progress'), opt(L('Achieved', 'Erreicht'), 'blue', 'done')]
    const conf = [opt(L('High', 'Hoch'), 'green'), opt(L('Medium', 'Mittel'), 'yellow'), opt(L('Low', 'Niedrig'), 'red')]
    const krName = L('Key results', 'Schlüsselergebnisse')
    // formulas reference the localized column names
    const curName = L('Current', 'Ist')
    const targetName = L('Target', 'Soll')
    const ratio = `prop("${curName}") / prop("${targetName}")`
    const hasTarget = `prop("${targetName}") > 0`
    const krDbId = newId()
    const objId = makeDb({
      parentId: root,
      title: L('Objectives', 'Ziele'),
      icon: emoji('🎯'),
      inline: true,
      properties: [
        { id: O.name, name: L('Objective', 'Ziel'), type: 'title' },
        { id: O.q, name: L('Quarter', 'Quartal'), type: 'select', options: qs },
        { id: O.owner, name: L('Owner', 'Verantwortlich'), type: 'person' },
        { id: O.status, name: 'Status', type: 'status', options: st },
        { id: O.krs, name: krName, type: 'relation', relationDatabaseId: krDbId },
        { id: O.score, name: 'Score', type: 'rollup', rollup: { relationPropertyId: O.krs, targetPropertyId: K.score, fn: 'average' } },
        { id: O.progress, name: L('Progress', 'Fortschritt'), type: 'formula', formula: barFormula('toNumber(prop("Score"))') },
      ],
      views: (db) => [view('table', db, L('Objectives', 'Ziele'), { visibleProperties: [O.progress, O.status, O.q, O.owner, O.krs] }), view('board', db, L('By status', 'Nach Status'), { groupBy: O.status, visibleProperties: [O.progress, O.owner] })],
    })
    const krId = makeDb({
      id: krDbId,
      parentId: root,
      title: krName,
      icon: emoji('📏'),
      inline: true,
      properties: [
        { id: K.name, name: L('Key result', 'Schlüsselergebnis'), type: 'title' },
        { id: K.obj, name: L('Objective', 'Ziel'), type: 'relation', relationDatabaseId: objId },
        { id: K.cur, name: curName, type: 'number' },
        { id: K.target, name: targetName, type: 'number' },
        { id: K.score, name: 'Score', type: 'formula', formula: `if(${hasTarget}, min(1, ${ratio}), 0)` },
        { id: K.progress, name: L('Progress', 'Fortschritt'), type: 'formula', formula: barFormula(`if(${hasTarget}, ${ratio}, 0)`) },
        { id: K.conf, name: L('Confidence', 'Zuversicht'), type: 'select', options: conf },
      ],
      views: (db) => [view('table', db, krName, { groupBy: K.obj, visibleProperties: [K.progress, K.cur, K.target, K.conf, K.obj] })],
    })
    const ppl = people()
    const objectives: Array<[string, number, number, Array<[string, number, number, number]>]> = [
      [
        L('Make onboarding effortless', 'Onboarding mühelos machen'),
        0,
        1,
        [
          [L('Activation rate from 38% to 55%', 'Aktivierungsrate von 38 % auf 55 %'), 49, 55, 0],
          [L('Time to first page under 60 s', 'Zeit bis zur ersten Seite unter 60 s'), 70, 100, 1],
          [L('Support tickets about setup −50%', 'Support-Tickets zum Setup −50 %'), 30, 50, 1],
        ],
      ],
      [
        L('Become the go-to Notion alternative', 'Die erste Notion-Alternative werden'),
        0,
        2,
        [
          [L('2,000 Notion imports', '2.000 Notion-Importe'), 640, 2000, 2],
          [L('Publish 12 comparison guides', '12 Vergleichsratgeber veröffentlichen'), 5, 12, 1],
        ],
      ],
      [
        L('Ship a rock-solid sync engine', 'Eine grundsolide Sync-Engine liefern'),
        1,
        0,
        [
          [L('Zero data-loss incidents', 'Null Datenverlust-Vorfälle'), 1, 1, 0],
          [L('p95 sync latency < 300 ms', 'p95-Sync-Latenz < 300 ms'), 0, 1, 2],
        ],
      ],
    ]
    objectives.forEach(([title, q, s, krs], idx) => {
      const oid = row(objId, title, { [O.q]: qs[q].id, [O.owner]: [ppl[idx % ppl.length]], [O.status]: st[s].id })
      const kids = krs.map(([kr, cur, target, c]) => row(krId, kr, { [K.obj]: [oid], [K.cur]: cur, [K.target]: target, [K.conf]: conf[c].id }))
      S().setRowProperty(oid, O.krs, kids)
    })
    S().setContent(
      root,
      doc(
        callout('🧭', 'gray', p(b(L('Objectives', 'Ziele')), L(' are qualitative and inspiring. ', ' sind qualitativ und motivierend. '), b(L('Key results', 'Schlüsselergebnisse')), L(' are numbers. Update “Current” weekly — progress bars follow.', ' sind Zahlen. „Ist“ wöchentlich aktualisieren — die Balken folgen.'))),
        dbBlock(objId),
        dbBlock(krId),
        toggle(L('How progress is calculated', 'Wie der Fortschritt berechnet wird'), p(code(`Score = min(1, ${curName} / ${targetName})`), L(' per key result; each objective averages its key results.', ' je Schlüsselergebnis; jedes Ziel mittelt seine Schlüsselergebnisse.'))),
      ),
      'template',
    )
    return root
  },
}

/* ------------------------------------------------------------------ */
/* 09 Weekly planner                                                   */
/* ------------------------------------------------------------------ */

const weeklyPlanner: TemplateDef = {
  id: 'week',
  code: 'T-09',
  category: 'personal',
  icon: 'split',
  title: (L) => L('Weekly planner', 'Wochenplaner'),
  description: (L) =>
    L(
      'One page per week: focus, top three, a day-by-day board of tasks and a place for wins. Duplicate it every Monday.',
      'Eine Seite pro Woche: Fokus, Top 3, ein Tages-Board mit Aufgaben und Platz für Erfolge. Jeden Montag duplizieren.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'page', label: L('Week of …', 'Woche vom …') },
    { depth: 1, kind: 'page', label: L('Focus · Top 3 · Wins · Notes', 'Fokus · Top 3 · Erfolge · Notizen') },
    { depth: 1, kind: 'db', label: L('This week', 'Diese Woche') },
    { depth: 2, kind: 'views', label: L('Board by day · Table', 'Board nach Tag · Tabelle') },
    { depth: 2, kind: 'rows', label: L('9 tasks across the week', '9 Aufgaben über die Woche') },
  ],
  build(parentId, L) {
    const monday = weekday(0)
    const label = new Intl.DateTimeFormat(L('en-GB', 'de-DE'), { day: 'numeric', month: 'long' }).format(new Date(`${monday}T12:00`))
    const root = S().createPage({ parentId, title: L(`Week of ${label}`, `Woche vom ${label}`), icon: asset('split') })
    const P = { name: newId(), day: newId(), done: newId(), prio: newId(), est: newId() }
    const names = L('Mon,Tue,Wed,Thu,Fri,Sat,Sun', 'Mo,Di,Mi,Do,Fr,Sa,So').split(',')
    const days = [...names.map((n, k) => opt(n, k < 5 ? 'blue' : 'green')), opt(L('Someday', 'Irgendwann'), 'gray')]
    const prio = [opt(L('Must', 'Muss'), 'red'), opt(L('Should', 'Sollte'), 'yellow'), opt(L('Could', 'Könnte'), 'gray')]
    const dbId = makeDb({
      parentId: root,
      title: L('This week', 'Diese Woche'),
      icon: emoji('🗂️'),
      inline: true,
      properties: [
        { id: P.name, name: L('Task', 'Aufgabe'), type: 'title' },
        { id: P.day, name: L('Day', 'Tag'), type: 'select', options: days },
        { id: P.done, name: L('Done', 'Erledigt'), type: 'checkbox' },
        { id: P.prio, name: L('Priority', 'Priorität'), type: 'select', options: prio },
        { id: P.est, name: L('Hours', 'Stunden'), type: 'number' },
      ],
      views: (db) => [view('board', db, L('By day', 'Nach Tag'), { groupBy: P.day, visibleProperties: [P.done, P.prio, P.est] }), view('table', db, L('Table', 'Tabelle'), { groupBy: P.day, calculations: { [P.est]: 'sum', [P.done]: 'percent_checked' } })],
    })
    const items: Array<[string, number, boolean, number, number]> = [
      [L('Write the launch post', 'Launch-Post schreiben'), 0, true, 0, 3],
      [L('1:1 with Sam', '1:1 mit Sam'), 0, true, 1, 1],
      [L('Review roadmap draft', 'Roadmap-Entwurf prüfen'), 1, false, 0, 2],
      [L('Gym', 'Sport'), 1, false, 1, 1],
      [L('Customer interviews ×3', 'Kundeninterviews ×3'), 2, false, 0, 3],
      [L('Invoice & expenses', 'Rechnungen & Spesen'), 3, false, 1, 1],
      [L('Ship onboarding fix', 'Onboarding-Fix ausliefern'), 4, false, 0, 2],
      [L('Hike', 'Wandern'), 5, false, 2, 4],
      [L('Learn Rust basics', 'Rust-Grundlagen lernen'), 7, false, 2, 5],
    ]
    items.forEach(([title, d, done, pr, est]) => row(dbId, title, { [P.day]: days[d].id, [P.done]: done, [P.prio]: prio[pr].id, [P.est]: est }))
    S().setContent(
      root,
      doc(
        callout('🎯', 'orange', p(b(L('Focus  ', 'Fokus  ')), L('Ship the launch, protect two deep-work mornings.', 'Launch liefern, zwei Vormittage für Deep Work schützen.'))),
        columns(
          [h3(L('Top 3', 'Top 3')), tasks(task(true, L('Launch post', 'Launch-Post')), task(false, L('Roadmap review', 'Roadmap-Review')), task(false, L('Onboarding fix', 'Onboarding-Fix')))],
          [h3(L('Wins', 'Erfolge')), ul(L('First 100 signups', 'Erste 100 Anmeldungen'))],
          [h3(L('Notes', 'Notizen')), p(i(L('Anything to carry over?', 'Etwas zum Mitnehmen?')))],
        ),
        dbBlock(dbId),
        hr(),
        p(L('Week starts ', 'Woche beginnt '), dateMention(monday, label), L('. Duplicate this page every Monday (⋯ → Duplicate).', '. Jeden Montag diese Seite duplizieren (⋯ → Duplizieren).')),
      ),
      'template',
    )
    return root
  },
}

/* ------------------------------------------------------------------ */
/* 10 Team wiki                                                        */
/* ------------------------------------------------------------------ */

const teamWiki: TemplateDef = {
  id: 'wiki',
  code: 'T-10',
  category: 'knowledge',
  icon: 'blocks',
  title: (L) => L('Team wiki', 'Team-Wiki'),
  description: (L) =>
    L(
      'A nested handbook: getting started, how we work (meetings, code review), tools and a glossary — each with its own table of contents.',
      'Ein verschachteltes Handbuch: Einstieg, wie wir arbeiten (Meetings, Code-Review), Tools und ein Glossar — jeweils mit eigenem Inhaltsverzeichnis.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'page', label: L('Team wiki', 'Team-Wiki') },
    { depth: 1, kind: 'page', label: L('Getting started', 'Erste Schritte') },
    { depth: 1, kind: 'page', label: L('How we work', 'Wie wir arbeiten') },
    { depth: 2, kind: 'page', label: L('Meetings', 'Meetings') },
    { depth: 2, kind: 'page', label: L('Code review', 'Code-Review') },
    { depth: 1, kind: 'page', label: L('Tools & access', 'Tools & Zugänge') },
    { depth: 1, kind: 'page', label: L('Glossary', 'Glossar') },
  ],
  build(parentId, L) {
    const root = S().createPage({ parentId, title: L('Team wiki', 'Team-Wiki'), icon: asset('blocks') })
    const sub = (parent: ID, title: string, icon: string) => S().createPage({ parentId: parent, title, icon: emoji(icon) })
    const start = sub(root, L('Getting started', 'Erste Schritte'), '🚀')
    const how = sub(root, L('How we work', 'Wie wir arbeiten'), '🧭')
    const meetings = sub(how, L('Meetings', 'Meetings'), '🗓️')
    const review = sub(how, L('Code review', 'Code-Review'), '🔍')
    const tools = sub(root, L('Tools & access', 'Tools & Zugänge'), '🛠️')
    const glossary = sub(root, L('Glossary', 'Glossar'), '📚')
    const set = (id: ID, ...blocks: JSONContent[]) => S().setContent(id, doc(...blocks), 'template')

    set(
      root,
      callout('👋', 'gray', p(L('Welcome! This wiki is the single source of truth for how we work. If something is wrong or missing, ', 'Willkommen! Dieses Wiki ist die eine Quelle der Wahrheit dafür, wie wir arbeiten. Falls etwas fehlt oder falsch ist, '), b(L('fix it right here', 'direkt hier korrigieren')), '.')),
      toc(),
      h2(L('Start here', 'Hier starten')),
      pageLink(start),
      pageLink(how),
      pageLink(tools),
      pageLink(glossary),
      h2(L('Principles', 'Prinzipien')),
      ol(L('Write it down — async beats meetings.', 'Aufschreiben — asynchron schlägt Meetings.'), L('Small, reversible steps.', 'Kleine, umkehrbare Schritte.'), L('Default to open.', 'Standardmäßig offen.')),
      h2(L('Ownership', 'Zuständigkeit')),
      table([
        [L('Area', 'Bereich'), L('Owner', 'Verantwortlich'), L('Backup', 'Vertretung')],
        ['Product', 'Alex', 'Mira'],
        ['Engineering', 'Sam', 'Alex'],
        ['Design', 'Mira', 'Sam'],
      ]),
    )
    set(
      start,
      toc(),
      h2(L('Your first week', 'Deine erste Woche')),
      tasks(L('Get access to all tools', 'Zugang zu allen Tools bekommen'), L('Read “How we work”', '„Wie wir arbeiten“ lesen'), L('Pair with a teammate on a small fix', 'Mit jemandem ein kleines Problem lösen'), L('Ship something on day five', 'Am fünften Tag etwas ausliefern')),
      h2(L('Who to ask', 'Wen fragen')),
      table([
        [L('Topic', 'Thema'), L('Person', 'Person'), L('Channel', 'Kanal')],
        [L('Access & accounts', 'Zugänge & Konten'), 'Sam', '#it'],
        [L('Product questions', 'Produktfragen'), 'Alex', '#product'],
        [L('Everything else', 'Alles andere'), L('Your buddy', 'Dein Buddy'), L('DM', 'DM')],
      ]),
      h2(L('Rituals', 'Rituale')),
      ul(L('Monday: planning (30 min)', 'Montag: Planung (30 Min.)'), L('Daily: async standup in the channel', 'Täglich: asynchrones Standup im Kanal'), L('Friday: demo & retro', 'Freitag: Demo & Retro')),
    )
    set(
      how,
      toc(),
      h2(L('Communication', 'Kommunikation')),
      table([
        [L('Need', 'Bedarf'), L('Use', 'Nutze'), L('Expected reply', 'Antwort erwartet')],
        [L('Decision with context', 'Entscheidung mit Kontext'), L('A wiki page', 'Eine Wiki-Seite'), L('2 days', '2 Tage')],
        [L('Quick question', 'Kurze Frage'), 'Chat', L('Same day', 'Am selben Tag')],
        [L('Something is on fire', 'Es brennt'), L('Call', 'Anruf'), L('Now', 'Sofort')],
      ]),
      h2(L('Deep dives', 'Vertiefung')),
      pageLink(meetings),
      pageLink(review),
    )
    set(
      meetings,
      callout('⏱️', 'yellow', p(L('No agenda, no meeting. Every meeting ends with decisions and owners.', 'Keine Agenda, kein Meeting. Jedes Meeting endet mit Entscheidungen und Verantwortlichen.'))),
      h2(L('Formats', 'Formate')),
      ul(li(b('Planning'), L(' — Monday, 30 min, the board is the agenda.', ' — Montag, 30 Min., das Board ist die Agenda.')), li(b('Demo'), L(' — Friday, show don’t tell.', ' — Freitag, zeigen statt erzählen.')), li(b('1:1'), L(' — biweekly, the report owns the agenda.', ' — alle zwei Wochen, die Agenda gehört der Person.'))),
    )
    set(
      review,
      h2(L('Checklist', 'Checkliste')),
      tasks(L('Does it do what the ticket says?', 'Tut es, was das Ticket sagt?'), L('Is it tested?', 'Ist es getestet?'), L('Would a newcomer understand it?', 'Würde eine neue Person es verstehen?')),
      h2(L('Tone', 'Ton')),
      quote(L('Review the code, not the person. Ask, don’t command.', 'Den Code reviewen, nicht die Person. Fragen statt anordnen.')),
      codeBlock('bash', 'git switch -c fix/onboarding-copy\ngit commit -m "fix: clearer onboarding copy"\ngit push -u origin HEAD'),
    )
    set(
      tools,
      table([
        [L('Tool', 'Tool'), L('What for', 'Wofür'), L('Access', 'Zugang')],
        ['SimpleCMS One', L('Docs, wiki, projects', 'Doku, Wiki, Projekte'), L('Everyone', 'Alle')],
        ['GitHub', 'Code', 'Engineering'],
        ['n8n', L('Automations', 'Automationen'), 'Ops'],
        ['Figma', 'Design', 'Design, Product'],
      ]),
      callout('🔒', 'red', p(b(L('Security  ', 'Sicherheit  ')), L('Use a password manager and 2FA everywhere. Never paste secrets into pages.', 'Überall Passwortmanager und 2FA nutzen. Niemals Geheimnisse in Seiten einfügen.'))),
    )
    set(
      glossary,
      table([
        [L('Term', 'Begriff'), L('Meaning', 'Bedeutung')],
        ['Local-first', L('Your data lives on your device first; sync is optional.', 'Deine Daten liegen zuerst auf deinem Gerät; Sync ist optional.')],
        ['OKR', L('Objectives & key results — goals with numbers.', 'Objectives & Key Results — Ziele mit Zahlen.')],
        ['Rollup', L('A value summarised from related rows.', 'Ein aus verknüpften Zeilen zusammengefasster Wert.')],
        ['Webhook', L('An HTTP call that tells another tool something happened.', 'Ein HTTP-Aufruf, der einem anderen Tool sagt, dass etwas passiert ist.')],
      ]),
      p(L('Missing a term? Add a row — and link it from where you needed it: ', 'Fehlt ein Begriff? Zeile ergänzen — und von dort verlinken, wo er gefehlt hat: '), mention(how, L('How we work', 'Wie wir arbeiten'))),
    )
    return root
  },
}

/* ------------------------------------------------------------------ */
/* 11 Habit tracker                                                    */
/* ------------------------------------------------------------------ */

const habits: TemplateDef = {
  id: 'habits',
  code: 'T-11',
  category: 'personal',
  icon: 'automation',
  title: (L) => L('Habit tracker', 'Gewohnheiten-Tracker'),
  description: (L) =>
    L(
      'One row per day, one checkbox per habit. A formula turns the ticks into a daily score bar; column totals show your hit rate.',
      'Eine Zeile pro Tag, eine Checkbox pro Gewohnheit. Eine Formel macht aus den Häkchen einen Tages-Score; Spaltensummen zeigen die Trefferquote.',
    ),
  outline: (L) => [
    { depth: 0, kind: 'db', label: L('Habits', 'Gewohnheiten') },
    { depth: 1, kind: 'views', label: L('Log · Calendar', 'Log · Kalender') },
    { depth: 1, kind: 'fields', label: L('Date · 5 habit checkboxes · Score (formula) · Note', 'Datum · 5 Gewohnheits-Checkboxen · Score (Formel) · Notiz') },
    { depth: 1, kind: 'rows', label: L('Last 10 days', 'Letzte 10 Tage') },
  ],
  build(parentId, L) {
    const H = [L('Exercise', 'Sport'), L('Read', 'Lesen'), L('Meditate', 'Meditieren'), L('Water 2l', 'Wasser 2l'), L('Sleep 8h', 'Schlaf 8h')]
    const P = { name: newId(), date: newId(), habits: H.map(() => newId()), score: newId(), note: newId() }
    const sum = H.map((h) => `toNumber(prop("${h}"))`).join(' + ')
    const properties: PropertyDef[] = [
      { id: P.name, name: L('Day', 'Tag'), type: 'title' },
      { id: P.date, name: L('Date', 'Datum'), type: 'date' },
      ...H.map((name, k) => ({ id: P.habits[k], name, type: 'checkbox' as const })),
      { id: P.score, name: 'Score', type: 'formula', formula: barFormula(`(${sum}) / ${H.length}`) },
      { id: P.note, name: L('Note', 'Notiz'), type: 'text' },
    ]
    const dbId = makeDb({
      parentId,
      title: L('Habit tracker', 'Gewohnheiten-Tracker'),
      icon: asset('automation'),
      properties,
      views: (db) => [
        view('table', db, 'Log', { sorts: [{ propertyId: P.date, direction: 'desc' }], visibleProperties: [P.score, ...P.habits, P.note], calculations: Object.fromEntries(P.habits.map((h) => [h, 'percent_checked' as const])) }),
        view('calendar', db, L('Calendar', 'Kalender'), { dateProperty: P.date, visibleProperties: [P.score] }),
      ],
    })
    const fmt = new Intl.DateTimeFormat(L('en-GB', 'de-DE'), { weekday: 'short', day: 'numeric', month: 'short' })
    const pattern = ['11011', '10111', '01110', '11111', '10010', '11101', '01111', '11011', '00110', '11111']
    for (let k = 9; k >= 0; k--) {
      const iso = day(-k)
      const ticks = pattern[k]
      row(dbId, fmt.format(new Date(`${iso}T12:00`)), {
        [P.date]: { start: iso },
        ...Object.fromEntries(P.habits.map((h, n) => [h, ticks[n] === '1'])),
        ...(k === 3 ? { [P.note]: L('Perfect day', 'Perfekter Tag') } : {}),
      })
    }
    return dbId
  },
}

export const TEMPLATES: TemplateDef[] = [meetingNotes, projectTracker, roadmap, contentCalendar, readingList, crm, bugTracker, okrs, weeklyPlanner, teamWiki, habits]

/** Shared helpers for preview counts. */
export function outlineStats(lines: OutlineLine[]) {
  return {
    pages: lines.filter((l) => l.kind === 'page').length,
    dbs: lines.filter((l) => l.kind === 'db').length,
    views: lines.filter((l) => l.kind === 'views').reduce((n, l) => n + l.label.split('·').length, 0),
  }
}

