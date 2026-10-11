/**
 * Preflight's fictional morning (plain JS: the Preflight specs, scripts/preflight-shots.mjs and later
 * scripts/changelog-shots.mjs import the same code). Everything goes through the app's own test seams
 * (window.__one, __onePreflight, __oneOutbox, __oneInbox) — never a real host; every name is made up.
 *
 *  Workspace "Nordlicht Werk" · mirror database "Nordlicht Übergabe" (key "Schlüssel", NL-201 …) · mirror agent
 *  "Nordlicht-Spiegel" (browser, mirrorOf) · report agent "Wochenbericht Nordlicht" · integration profile "Tessera"
 *  for the MCP server "relay" (relay.tessera.example) with a reply route · people Mara Lind, Ivo Brandt, Oda Wendt ·
 *  pipeline "Werkzeug" with "Exportfilter: Sonderzeichen" and "Zertifikat-Warnung" at the plan gate and "Protokollstufe
 *  senken" in the backlog.
 *
 * The lamp part of the P2 story (seedMorning): Proposals 10 = mirror 7 (3 of them from runs 8–11 days old) + report 1 +
 * terminal 1 + memory 1 · Gate 2 · Token 1 (relay refused) · Outbox 1 (a slip on the reply route) · Sync · folder
 * grey (no folder permission in this tab).
 */

export const STORY = {
  workspace: 'Nordlicht Werk',
  db: 'Nordlicht Übergabe',
  mirrorAgent: 'Nordlicht-Spiegel',
  reportAgent: 'Wochenbericht Nordlicht',
  profile: 'Tessera',
  server: 'relay',
  host: 'relay.tessera.example',
  people: ['Mara Lind', 'Ivo Brandt', 'Oda Wendt'],
  pipeline: 'Werkzeug',
  tasks: ['Exportfilter: Sonderzeichen', 'Zertifikat-Warnung', 'Protokollstufe senken'],
}

export const RELAY_SERVER = { id: 'm-relay', name: 'relay', url: 'https://relay.tessera.example/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'add_comment', 'list_comments'], checkedAt: 1 }

export const REPLY_ROUTE = {
  id: 'reply',
  role: 'reply',
  label: { en: 'Reply in the ticket', de: 'Im Ticket antworten' },
  tool: 'add_comment',
  args: { ref: '{key}', body: '{draft}' },
  params: [{ name: 'draft', type: 'text', max: 4000 }],
  confirm: { tool: 'list_comments', args: { ref: '{key}' }, find: 'items', match: [{ path: 'body', equals: '{draft}' }] },
}

export const TESSERA_PROFILE = {
  schema: 'one.integration/1',
  id: 'tessera',
  name: 'Tessera',
  match: { name: 'relay' },
  unlocks: ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify', 'sends'],
  recipes: [{ kind: 'mirror' }],
  reads: ['list_items', 'get_item', 'search_items', 'list_comments'],
  sends: [REPLY_ROUTE],
}

const DAY = 86_400_000

/** Run a function in the page with the seams: (w, arg) → value. */
export async function inPage(page, fn, arg) {
  return page.evaluate(
    async ({ src, arg }) => {
      const w = window
      return new Function('w', 'arg', `return (${src})(w, arg)`)(w, arg)
    },
    { src: fn.toString(), arg: arg ?? null },
  )
}

/** Wait for the app and Preflight's seam. */
export async function waitPreflight(page) {
  await page.waitForFunction(() => !!window.__one && !!window.__onePreflight && !document.getElementById('boot'), null, { timeout: 60_000 })
}

/** Read the lamps now (no idle wait). */
export async function flushLamps(page) {
  await page.evaluate(() => window.__onePreflight.flush())
}

/** The mirror database, its rows and the mirror + report agents (no runs). */
export async function seedMirror(page, { rows = 12 } = {}) {
  return inPage(
    page,
    (w, a) => {
      const s = w.__one.workspace.getState()
      const id = () => Math.random().toString(36).slice(2, 12)
      const opt = (name, color = 'gray') => ({ id: id(), name, color })
      const status = [opt('Offen'), opt('In Arbeit', 'yellow'), opt('Erledigt', 'green')]
      const src = [opt('Neu'), opt('In Prüfung', 'blue'), opt('Freigegeben', 'green')]
      const props = {
        title: { id: id(), name: 'Name', type: 'title' },
        key: { id: id(), name: 'Schlüssel', type: 'text', key: true },
        link: { id: id(), name: 'Link', type: 'url' },
        srcStatus: { id: id(), name: 'Quellstatus', type: 'select', options: src },
        owner: { id: id(), name: 'Bearbeitung', type: 'text' },
        comments: { id: id(), name: 'Kommentare', type: 'number', numberFormat: 'number' },
        waiting: { id: id(), name: 'Wartet auf mich', type: 'checkbox' },
        newComment: { id: id(), name: 'Neuer Kommentar', type: 'checkbox' },
        myStatus: { id: id(), name: 'Mein Status', type: 'select', options: status, agentReadOnly: true },
        due: { id: id(), name: 'Fällig', type: 'date' },
      }
      const dbId = s.createDatabase({ title: a.db, properties: Object.values(props) })
      const titles = ['Exportfilter verliert Sonderzeichen', 'Zertifikat Halle Nord läuft ab', 'Prüfplan P3 oder P4', 'Rollout-Plan Halle Nord', 'Protokollstufe in Produktion', 'Schnittstelle v3: Abnahme', 'Lieferliste prüfen', 'Messreihe Linie 2', 'Taktzeit Station 4', 'Wartungsfenster Oktober', 'Prüfplan Gehäuse', 'Etiketten neu drucken']
      const people = a.people
      const out = {}
      for (let i = 0; i < a.rows; i++) {
        const key = `NL-${201 + i}`
        const p = {}
        p[props.key.id] = key
        p[props.link.id] = `https://relay.tessera.example/item/${key}`
        p[props.srcStatus.id] = src[i % 3].id
        p[props.owner.id] = people[i % people.length]
        p[props.comments.id] = (i * 3) % 7
        p[props.waiting.id] = i % 4 === 0
        p[props.newComment.id] = i % 3 === 0
        p[props.myStatus.id] = status[0].id
        out[key] = s.createRow(dbId, { title: titles[i % titles.length], properties: p })
      }
      const now = Date.now()
      const agent = (x) => ({ icon: null, instructions: 'Halte die Liste aktuell.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [dbId] }, write: 'stage', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now - 30 * 86_400_000, updatedAt: now - 30 * 86_400_000, ...x })
      s.upsertAgent(agent({ id: 'ag-spiegel', name: a.mirrorAgent, mcpServers: ['relay'], mirrorOf: dbId }))
      s.upsertAgent(agent({ id: 'ag-bericht', name: a.reportAgent }))
      return { dbId, rows: out, props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.id])), mirrorId: 'ag-spiegel', reportId: 'ag-bericht' }
    },
    { rows, db: STORY.db, mirrorAgent: STORY.mirrorAgent, reportAgent: STORY.reportAgent, people: STORY.people },
  )
}

/** Agent runs with open proposals: the mirror's newest run (4) + 3 runs 8–11 days old (1 each), the report's run (1). */
export async function seedRuns(page, m, now = Date.now()) {
  const keys = Object.keys(m.rows)
  const change = (n, key, prop, after, title) => ({ id: `c${n}`, n, kind: 'update_row', status: 'pending', pageId: m.rows[key], databaseId: m.dbId, title, props: [{ propId: m.props[prop], name: prop === 'comments' ? 'Kommentare' : 'Quellstatus', type: prop === 'comments' ? 'number' : 'text', before: 0, after, intent: { kind: 'value', value: after } }] })
  const run = (id, agentId, startedAt, staged) => ({ id, agentId, runner: 'browser', trigger: { type: 'schedule', detail: 'schedule 07:30' }, startedAt, endedAt: startedAt + 60_000, status: 'staged', summary: '', steps: [], staged })
  const runs = [
    run('r-now', m.mirrorId, now - 30 * 60_000, [change(1, keys[0], 'comments', 4, 'NL-201'), change(2, keys[1], 'comments', 2, 'NL-202'), change(3, keys[2], 'comments', 7, 'NL-203'), change(4, keys[3], 'comments', 5, 'NL-204')]),
    run('r-d8', m.mirrorId, now - 8 * DAY, [change(1, keys[4], 'comments', 1, 'NL-205')]),
    run('r-d10', m.mirrorId, now - 10 * DAY, [change(1, keys[5], 'comments', 3, 'NL-206')]),
    run('r-d11', m.mirrorId, now - 11 * DAY, [change(1, keys[6], 'comments', 2, 'NL-207')]),
    run('r-rep', m.reportId, now - 20 * 60_000, [{ id: 'c1', n: 1, kind: 'append', status: 'pending', pageId: m.dbId, title: 'KW 41', markdown: 'Kurzbericht der Woche.' }]),
  ]
  await page.evaluate((runs) => window.__onePreflight.seedRuns(runs), runs)
}

/** The AI terminal of this tab: one staged change and one memory proposal. */
export async function seedTerminal(page) {
  await page.evaluate(() =>
    window.__onePreflight.terminal({
      changes: [{ id: 'c1', n: 1, kind: 'coding', status: 'pending', pageId: 'staged-task-1', title: 'Aufgabe anlegen und starten', coding: { op: 'create', kind: 'coding', projectId: null, project: 'Werkzeug', starts: true } }],
      memCards: [{ id: 'mc1', after: 0, origin: 'task', state: 'ready', items: [{ id: 'mi1', status: 'pending', dup: null, p: { type: 'fact', text: 'Prüfplan P3 gilt bis zur Abnahme am 14.10.', topics: ['werk'], body: '', source: 'AI terminal · Schichtnotizen' } }] }],
    }),
  )
}

/** The pipeline "Werkzeug" (#/coding → Set up), two tasks at the plan gate and one in the backlog. */
export async function seedPipeline(page) {
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.locator('[data-testid="coding-setup"]').click()
  await page.waitForFunction(() => Object.values(window.__one.workspace.getState().databases).some((d) => d.system === 'coding'))
  return inPage(
    page,
    (w, a) => {
      const s = w.__one.workspace.getState()
      const db = Object.values(s.databases).find((d) => d.system === 'coding')
      s.updatePage(db.id, { title: a.pipeline })
      const gate = db.pipeline.find((x) => x.kind === 'gate')
      const backlog = db.pipeline[0]
      const stage = db.properties.find((p) => p.type === 'select' && (p.options ?? []).some((o) => o.id === gate.id))
      const make = (title, stageId) => s.createRow(db.id, { title, properties: { [stage.id]: stageId }, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${title} — siehe Übergabe.` }] }] } })
      return { dbId: db.id, gateId: gate.id, tasks: [make(a.tasks[0], gate.id), make(a.tasks[1], gate.id), make(a.tasks[2], backlog.id)] }
    },
    { pipeline: STORY.pipeline, tasks: STORY.tasks },
  )
}

/** Settings: the refused "relay" server and the Tessera profile with its reply route. */
export async function seedRelay(page, { refused = true } = {}) {
  await inPage(
    page,
    (w, a) => {
      const s = w.__one.workspace.getState()
      s.updateSettings({ mcpServers: [{ ...a.server, checkedAt: Date.now(), ...(a.refused ? { checkAuth: true, checkError: 'Der Server hat die Anfrage abgelehnt.' } : {}) }] })
      s.upsertIntegration(a.profile)
    },
    { server: RELAY_SERVER, profile: TESSERA_PROFILE, refused },
  )
}

/** One slip on the reply route (never sent). */
export async function seedSlip(page, m) {
  await page.waitForFunction(() => window.__oneOutbox?.useOutbox.getState().loaded === true)
  return page.evaluate(
    async (a) => {
      const res = await window.__oneOutbox.stageSlip({ route: { profileId: 'tessera', routeId: 'reply' }, rowId: a.row, draft: 'Danke, der Filter ist korrigiert.', origin: { kind: 'api' }, sources: [] })
      return res.slip ? res.slip.id : res
    },
    { row: m.rows['NL-201'] },
  )
}

/** Sync · folder grey: the folder is set up, its permission is not granted in this tab. */
export async function seedSyncGrey(page) {
  await page.evaluate(() => window.__onePreflight.stores.sync.setState((s) => ({ folder: { ...s.folder, state: 'permission', name: 'Nordlicht' } })))
}

/**
 * The lamp part of the morning. Leaves the page on "#/" with the lamps counted. `opts.parts` picks parts
 * ('mirror', 'runs', 'terminal', 'pipeline', 'relay', 'slip', 'sync'); default: all.
 */
export async function seedMorning(page, opts = {}) {
  const parts = new Set(opts.parts ?? ['mirror', 'runs', 'terminal', 'pipeline', 'relay', 'slip', 'sync'])
  await waitPreflight(page)
  await inPage(page, (w, a) => w.__one.workspace.getState().updateSettings({ workspaceName: a.name }), { name: STORY.workspace }).catch(() => {})
  const out = {}
  if (parts.has('relay')) await seedRelay(page)
  if (parts.has('mirror') || parts.has('runs') || parts.has('slip')) out.mirror = await seedMirror(page)
  if (parts.has('runs')) await seedRuns(page, out.mirror)
  if (parts.has('terminal')) await seedTerminal(page)
  if (parts.has('pipeline')) out.pipeline = await seedPipeline(page)
  if (parts.has('slip')) out.slip = await seedSlip(page, out.mirror)
  if (parts.has('sync')) await seedSyncGrey(page)
  await page.evaluate(() => (window.location.hash = '#/'))
  await flushLamps(page)
  return out
}
