/**
 * The flight recorder's fictional morning (tests/e2e/fixtures/recorder-story.json, written by
 * scripts/recorder-story.mjs) played into an open app — plain JS: the recorder specs (through helpers/recorder.ts),
 * scripts/changelog-shots.mjs and scripts/recorder-shots.mjs import the same code. Everything goes through the app's
 * own test seams (window.__one, __oneRecorder) — never a real host; every name is made up ("Nordlicht Handoff",
 * "Nordlicht-Spiegel", "Tessera", "Tagesplan").
 *
 * The page's clock must be installed at the story's setup time before the app opens (`page.clock.install`).
 */

/** A story time ('07:31:04') on the story's day, as epoch ms. */
export const storyTime = (story, hms) => new Date(`${story.day}T${hms}${story.tz}`).getTime()

/** `$NL-1408` → that row's id (any string argument, at any depth). */
export function resolveRefs(v, ids) {
  if (typeof v === 'string') return v.startsWith('$') && ids[v.slice(1)] ? ids[v.slice(1)] : v
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, ids))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, ids)]))
  return v
}

/** The setup at the story's setup time (as the person, through the test hook): the database, its rows, the pages, the agent and the script. Row ids by ref. */
export async function setupStory(page, story) {
  await page.clock.setFixedTime(storyTime(story, story.setupAt))
  return page.evaluate((story) => {
    const g = () => window.__one.workspace.getState()
    const d = story.database
    g().createDatabase({ id: d.id, title: d.title })
    for (const p of d.properties) g().addProperty(d.id, p)
    g().addView(d.id, { id: d.board.id, type: 'board', name: d.board.name, groupBy: d.board.groupBy })
    const ids = {}
    for (const r of d.rows) ids[r.ref] = g().createRow(d.id, { title: r.title, properties: r.properties, content: r.content })
    for (const p of story.pages) g().createPage({ id: p.id, title: p.title, parentId: p.parentId ?? null, content: p.content })
    const now = Date.now()
    g().upsertAgent({ id: story.agent.id, name: story.agent.name, instructions: 'Spiegelt den Nordlicht-Abgleich.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [d.id] }, write: 'apply', output: { pageId: 'story-report', mode: 'replace' }, mcpServers: [], runner: 'browser', maxRunUsd: 1, enabled: false, createdBy: null, updatedBy: null, createdAt: now, updatedAt: now })
    g().upsertScript({ id: story.script.id, name: story.script.name, code: "page.create({ title: 'Tagesplan' })", kind: 'script', createdBy: null, updatedBy: null, createdAt: now, updatedAt: now })
    return ids
  }, story)
}

/** Every step's real store actions under its writer, at its time on the page clock. */
export async function playSteps(page, story, ids) {
  for (const s of story.steps) {
    await page.clock.setFixedTime(storyTime(story, s.at))
    await page.evaluate((st) => window.__oneRecorder.step(st), { writer: s.writer, calls: resolveRefs(s.calls, ids), ...(s.note ? { note: s.note } : {}), ...(s.end ? { end: true } : {}) })
  }
}

/**
 * The AgentRun review keeps for run 212 (through the agents' seam `__oneAgents.putRun`): status ok, browser runner,
 * every staged change but c34 applied, page ids resolved (the three rows it created by title, with their staged ids in
 * `rowIds`). Never touches the store or the tape.
 */
export async function putStoryRun(page, story, ids) {
  await page.waitForFunction(() => !!window.__oneAgents && typeof window.__oneAgents.putRun === 'function')
  const at = (hms) => storyTime(story, hms)
  return page.evaluate(
    ({ story, ids, startedAt, endedAt }) => {
      const s = window.__one.workspace.getState()
      const byTitle = (t) => Object.values(s.pages).find((p) => p.title === t && p.databaseId === story.database.id)?.id
      const resolve = (ref) => (ref.startsWith('$') ? ids[ref.slice(1)] ?? byTitle(ref.slice(1)) : ref)
      const rowIds = {}
      const staged = Object.entries(story.agentRun.changes).map(([id, c], i) => {
        const real = resolve(c.page)
        const created = c.kind === 'create_row'
        const pageId = created ? `staged-${id}` : real
        if (created) rowIds[pageId] = real
        const isRow = c.page.startsWith('$')
        return { id, n: i + 1, kind: c.kind, status: 'applied', pageId, ...(isRow ? { databaseId: story.database.id } : {}), ...(created ? { title: c.page.slice(1) } : {}) }
      })
      return window.__oneAgents.putRun({ id: story.agentRun.id, agentId: story.agent.id, runner: 'browser', seq: story.agentRun.seq, trigger: { type: 'manual' }, startedAt, endedAt, status: 'ok', summary: '', steps: [], applied: staged.length, staged, rowIds })
    },
    { story, ids, startedAt: at('07:31:00'), endedAt: at('07:34:45') },
  )
}

/**
 * Play the story: the setup (as the person at setup time), then every step under its writer at its time, then the
 * clock at `now` and the tape settled; the AgentRun of run 212 is written as review keeps it (`opts.agentRun: false`
 * leaves it out). `opts.wipeSetup`: the setup's writes leave the tape (the changelog shots). Returns the row ids by ref
 * ('NL-1408').
 */
export async function playStoryPage(page, story, opts = {}) {
  await page.waitForFunction(() => !!window.__oneRecorder && !!window.__one)
  const ids = await setupStory(page, story)
  if (opts.wipeSetup) {
    await page.evaluate(() => window.__oneRecorder.settle())
    await page.evaluate(() => window.__oneRecorder.wipe())
  }
  await playSteps(page, story, ids)
  await page.clock.setFixedTime(storyTime(story, story.now))
  await page.evaluate(() => window.__oneRecorder.settle())
  if (opts.agentRun !== false) await putStoryRun(page, story, ids)
  return ids
}

/**
 * The privacy run (08:06, after the story): the person adds a text property "Notiz"; run 213 of the agent writes
 * known strings into a new page's content and title, a number and a text cell of NL-1398, then adds an option and a
 * view (their names may only reach the tape inside schema deltas). Returns the property and page ids.
 */
export async function seedPrivacyRun(page, story) {
  await page.clock.setFixedTime(storyTime(story, '08:06:00'))
  const db = story.database.id
  const agent = { kind: 'agent', id: story.agent.id, run: 'r213' }
  const { note, row } = await page.evaluate((db) => {
    const s = window.__one.workspace.getState()
    const note = s.addProperty(db, { name: 'Notiz', type: 'text' })
    const row = Object.values(s.pages).find((p) => p.databaseId === db && p.title === 'NL-1398')?.id
    return { note, row }
  }, db)
  const step = (st) => page.evaluate((st) => window.__oneRecorder.step(st), st)
  const [page2] = await step({ writer: { kind: 'you', via: 'ui' }, calls: [['createPage', { title: 'Platzhalter' }]] })
  await step({
    writer: agent,
    calls: [
      ['setContent', page2, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nordlicht-Geheimwert-7' }] }] }, 'ai'],
      ['updatePage', page2, { title: 'Tessera Quartalsplan' }],
      ['setRowProperty', row, 'story-est', 98765.4321],
      ['setRowProperty', row, note, 'Lindenweg 12'],
    ],
    note: { seq: 213 },
  })
  const stage = await page.evaluate((db) => JSON.parse(JSON.stringify(window.__one.workspace.getState().databases[db].properties.find((p) => p.id === 'story-stage'))), db)
  await step({
    writer: agent,
    calls: [
      ['updateProperty', db, 'story-stage', { options: [...stage.options, { id: 'o-tessera', name: 'Tessera-Option', color: 'red' }] }],
      ['addView', db, { type: 'table', name: 'Tessera-Ansicht' }],
    ],
    end: true,
  })
  await page.evaluate(() => window.__oneRecorder.settle())
  return { note, page: page2, row, run: `agent:${story.agent.id}:r213` }
}
