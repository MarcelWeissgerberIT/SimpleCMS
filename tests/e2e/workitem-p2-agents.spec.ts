/**
 * Task block P2 — custom agents write tasks: in apply mode a change that names a person, sets a reminder, changes an
 * assigned task, adds a blocker or removes tasks waits for review (and so does what depends on it); a server run's
 * proposals and an older proposal without staged ids create no task; links resolve only inside the agent's scope;
 * agents never say "me"; raw-HTML mentions are text. Claude is mocked (helpers/terminal.ts). Fictional data.
 */
import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, wsEval, createPage, flush, pageIdByTitle } from './fixtures'
import { call, mockAgent, openTerminal, resultText, say, setKey, type AnyState } from './helpers/terminal'

const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const item = (attrs: Record<string, unknown>, title: string): JSONContent => ({ type: 'workItem', attrs, content: [p(title)] })

function tasksIn(d: JSONContent | null | undefined): AnyState[] {
  const out: AnyState[] = []
  const text = (n: JSONContent): string => n.text ?? (n.content ?? []).map(text).join('')
  const walk = (n: JSONContent) => {
    if (n.type === 'workItem') out.push({ ...(n.attrs ?? {}), title: text(n.content?.[0] ?? {}) })
    for (const c of n.content ?? []) walk(c)
  }
  if (d) walk(d)
  return out
}
const typesIn = (d: JSONContent | null | undefined): string[] => {
  const out: string[] = []
  const walk = (n: JSONContent) => {
    if (n.type) out.push(n.type)
    for (const c of n.content ?? []) walk(c)
  }
  if (d) walk(d)
  return out
}
const pageContent = (page: Page, id: string) => wsEval(page, (s, id) => s.pages[id]?.content ?? null, id)
const people = (page: Page) => wsEval(page, (s) => Object.fromEntries((s.people as Array<{ id: string; name: string }>).map((x) => [x.name, x.id])))
const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function addAgent(page: Page, agent: AnyState): Promise<string> {
  const id = await wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Keep the plan tidy.', trigger: { type: 'manual' }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now, ...a })
      return a.id as string
    },
    agent,
  )
  await flush(page)
  return id
}

async function runsOf(page: Page, agentId: string): Promise<AnyState[]> {
  return page.evaluate(async (id) => (await (window as unknown as { __oneAgents: AnyState }).__oneAgents.loadRuns(id)) as AnyState[], agentId)
}

async function runNow(page: Page, agentId: string, count = 1): Promise<AnyState> {
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), agentId)
  await expect(page.locator('.agx-dhead')).toBeVisible()
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect.poll(async () => (await runsOf(page, agentId)).filter((r) => r.status !== 'running').length, { timeout: 30_000 }).toBe(count)
  return (await runsOf(page, agentId)).sort((a, b) => b.startedAt - a.startedAt)[0]
}

const newPageId = (body: AnyState, toolId: string) => /New page id: (\S+?)[ .(]/.exec(resultText(body, toolId))![1]

test.describe('1440 light', () => {
  test('apply mode: plain tasks and an unassigned status change apply; reminders, owners, blockers, an assigned task’s due date, removals — and what needs them — wait', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const ppl = await people(page)
    const U = 'wi_agu0000001'
    const AS = 'wi_aga0000002'
    const EX = 'wi_age0000003'
    const R = 'wi_agr0000004'
    const space = await createPage(page, {
      title: 'Nordlicht space',
      content: doc(item({ itemId: U, status: 'todo' }, 'Unassigned errand'), item({ itemId: AS, status: 'todo', due: day(2), people: [ppl.Alex] }, 'Assigned errand'), item({ itemId: EX, status: 'todo' }, 'Existing target'), item({ itemId: R, status: 'todo' }, 'Remove me')),
    })
    let read = ''
    const m = await mockAgent(context, [
      call('c1', 'create_page', { title: 'Plain', parent_id: space, markdown: '> [!TODO] Book the bus' }),
      call('c2', 'create_page', { title: 'Reminder', parent_id: space, markdown: `> [!TODO] Call the caterer\n> Due: ${day(3)} · Reminder: -1d` }),
      call('c3', 'create_page', { title: 'Owned', parent_id: space, markdown: '> [!TODO] Order shirts\n> Owner: Alex' }),
      (body) => call('c4', 'create_page', { title: 'Under owned', parent_id: newPageId(body, 'c3'), markdown: 'Sizes per person.' })(),
      call('c5', 'update_work_item', { updates: [{ item: EX, blocked_by: { add: [U] } }] }),
      call('c6', 'update_work_item', { updates: [{ item: U, status: 'done' }] }),
      call('c7', 'update_work_item', { updates: [{ item: AS, due: day(5) }] }),
      call('r1', 'read_page', { id: space, refs: true }),
      (body) => {
        read = resultText(body, 'r1')
        const ref = /⟦(b\d+)⟧\n> \[!TODO\] Remove me/.exec(read)![1]
        return call('c8', 'edit_page', { id: space, edits: [{ op: 'replace', from: ref, markdown: 'No longer needed.' }] })()
      },
      say('Planned the trip.'),
    ])
    const agent = await addAgent(page, { id: 'ag-apply-items', name: 'Planner', write: 'apply', scope: { everything: false, pages: [space], databases: [] } })
    const run = await runNow(page, agent)
    expect(run.status).toBe('staged')
    const status = Object.fromEntries((run.staged as AnyState[]).map((c) => [c.n, c.status]))
    expect(status).toEqual({ 1: 'applied', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending', 6: 'applied', 7: 'pending', 8: 'pending' })
    const held = Object.fromEntries((run.staged as AnyState[]).map((c) => [c.n, c.items?.holds ?? c.workItem?.holds ?? []]))
    expect(held[2]).toEqual(['reminder'])
    expect(held[3]).toEqual(['names'])
    expect(held[5]).toEqual(['blocker'])
    expect(held[7]).toEqual(['assigned'])
    expect(held[8]).toEqual(['removes'])
    const notes = (run.steps as AnyState[]).map((s) => s.label as string)
    expect(notes.some((l) => l.startsWith('5 changes wait for your review'))).toBe(true)
    expect(notes.some((l) => /could not be applied|failed/i.test(l))).toBe(false)
    // what applied: the plain task (stamped as the agent), the status of the unassigned task
    const plain = (run.staged as AnyState[]).find((c) => c.n === 1)!
    expect(tasksIn(await pageContent(page, plain.pageId))).toMatchObject([{ itemId: plain.items.ids[0], title: 'Book the bus' }])
    expect(await wsEval(page, (s, id) => s.pages[id].updatedBy, plain.pageId)).toBe(`agent:${agent}`)
    const space1 = tasksIn(await pageContent(page, space))
    expect(space1.find((t) => t.itemId === U)!.status).toBe('done')
    expect(space1.find((t) => t.itemId === AS)!.due).toBe(day(2))
    expect(space1.find((t) => t.itemId === EX)!.blockedBy ?? []).toEqual([])
    // the review applies the held reminder task — WITH its reminder
    const c2 = (run.staged as AnyState[]).find((c) => c.n === 2)!
    await page.evaluate(async ({ agent, runId, id }) => {
      const a = (window as unknown as { __oneAgents: AnyState }).__oneAgents
      const run = (await a.loadRuns(agent)).find((r: AnyState) => r.id === runId)
      await a.applyRun(run, [id], { row: true })
    }, { agent, runId: run.id, id: c2.id })
    await expect.poll(async () => tasksIn(await pageContent(page, c2.pageId))).toMatchObject([{ itemId: c2.items.ids[0], due: day(3), reminder: '-1d' }])
    void m
  })

  test('server runs and proposals stored before P2 create no task; a server run’s task change is refused', async ({ page }) => {
    await openApp(page)
    const ppl = await people(page)
    const before = await wsEval(page, (s) => s.people.length as number)
    const T = 'wi_srvtask001'
    const host = await createPage(page, { title: 'Tessera ops', content: doc(item({ itemId: T, status: 'todo' }, 'Rotate keys')) })
    // the apply step lives in the terminal's chunk: open it once to load the seam
    await openTerminal(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !!(window as unknown as { __oneTerm?: unknown }).__oneTerm)
    const res = await page.evaluate(
      async ({ host, T }) => {
        const term = (window as unknown as { __oneTerm: AnyState }).__oneTerm
        const c1 = { id: 'c1', n: 1, kind: 'create_page', status: 'pending', pageId: 'srv-page-001', parentId: null, title: 'Server page', markdown: '> [!TODO] Pay invoice\n> Owner: Alex', items: { ids: ['wi_srvnew0001'], handles: {}, facts: [], warnings: [], holds: ['names'] } }
        const c2 = { id: 'c2', n: 2, kind: 'workItem', status: 'pending', pageId: host, title: 'Rotate keys', workItem: { itemId: T, patch: { status: 'done' }, before: null, facts: { itemId: T, handle: null, tag: 'changed', title: 'Rotate keys', status: 'done', due: null, reminder: null, people: [], blockedBy: [], related: [] }, holds: [] } }
        const out = await term.applyChanges([c1, c2], [c1, c2], (id: string) => id, { writer: { kind: 'agent', id: 'ag-srv', run: 'r-srv', remote: true }, items: { creates: false } })
        return { applied: out.applied, failed: out.failed }
      },
      { host, T },
    )
    expect(res.applied).toEqual(['c1'])
    expect(res.failed).toEqual([{ id: 'c2', error: 'Task changes of a server run are not applied in this browser.' }])
    const made = await pageContent(page, 'srv-page-001')
    expect(typesIn(made)).toContain('blockquote')
    expect(typesIn(made)).not.toContain('workItem')
    expect(tasksIn(await pageContent(page, host))[0].status).toBe('todo')
    // a browser run stored before P2: its create_page has no staged ids
    const agent = await addAgent(page, { id: 'ag-old', name: 'Old planner', write: 'stage' })
    const run = { id: 'r-old', agentId: agent, runner: 'browser', seq: 1, trigger: { type: 'manual' }, startedAt: Date.now() - 60_000, endedAt: Date.now() - 50_000, status: 'staged', summary: 'Old.', steps: [], staged: [{ id: 'c1', n: 1, kind: 'create_page', status: 'pending', pageId: 'old-page-001', parentId: null, title: 'Old proposal', markdown: '> [!TODO] Renew the lease\n> Owner: Alex' }] }
    await page.evaluate(async (run) => {
      const a = (window as unknown as { __oneAgents: AnyState }).__oneAgents
      await a.putRun(run)
      await a.applyRun(run, undefined, { row: true })
    }, run)
    await expect.poll(async () => typesIn(await pageContent(page, 'old-page-001'))).toContain('blockquote')
    expect(typesIn(await pageContent(page, 'old-page-001'))).not.toContain('workItem')
    expect(await wsEval(page, (s) => s.people.length as number)).toBe(before)
    void ppl
  })

  test('scope: a title link resolves inside the scope only (the outside page never named); "me" is refused; a page_id outside is refused', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const IN = 'wi_scopein001'
    const OUT = 'wi_scopeout01'
    const inside = await createPage(page, { title: 'Inside notes', content: doc(item({ itemId: IN, status: 'todo' }, 'Shared title')) })
    const outside = await createPage(page, { title: 'Hidden Tessera page', content: doc(item({ itemId: OUT, status: 'todo' }, 'Shared title')) })
    const m = await mockAgent(context, [
      call('a1', 'append_to_page', { id: inside, markdown: '> [!TODO] New thing\n> Blocked by: Shared title' }),
      call('a2', 'append_to_page', { id: inside, markdown: '> [!TODO] Mine\n> Owner: me' }),
      call('l1', 'list_work_items', { page_id: outside }),
      say('Done.'),
    ])
    const agent = await addAgent(page, { id: 'ag-scope-items', name: 'Scoped', write: 'stage', scope: { everything: false, pages: [inside], databases: [] } })
    const run = await runNow(page, agent)
    const first = resultText(m.bodies[1], 'a1')
    expect(first).toMatch(/New tasks: "New thing" → wi_/)
    // nothing Claude got back about the link names the page outside the scope
    expect(JSON.stringify(m.bodies[1].messages)).not.toContain('Hidden Tessera page')
    expect(JSON.stringify(m.bodies[2].messages)).not.toContain('Hidden Tessera page')
    expect(resultText(m.bodies[2], 'a2')).toContain('"me" means nobody for an agent')
    expect(resultText(m.bodies[3], 'l1')).toContain("outside this agent's scope")
    const staged = (run.staged as AnyState[])[0]
    expect(staged.items.facts[0].blockedBy.map((r: AnyState) => r.itemId)).toEqual([IN])
  })

  test('triggers: a person’s new row starts the row agent; the agent’s own row (with a task in its body) does not', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const projects = await pageIdByTitle(page, 'Projects')
    await mockAgent(context, [call('r1', 'create_row', { database_id: projects, title: 'Follow-up from the agent', markdown: '> [!TODO] Call back the vendor' }), say('Added a follow-up.')])
    const agent = await addAgent(page, { id: 'ag-rows-items', name: 'Intake', write: 'apply', trigger: { type: 'row_created', databaseId: projects }, scope: { everything: false, pages: [], databases: [projects] } })
    await wsEval(page, (s, db) => s.createRow(db, { title: 'Nordlicht intake' }), projects)
    await expect.poll(async () => (await runsOf(page, agent)).filter((r) => r.status !== 'running').length, { timeout: 30_000 }).toBe(1)
    const row = await wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === db && p.title === 'Follow-up from the agent')?.id ?? null, projects)
    expect(row).not.toBeNull()
    expect(tasksIn(await pageContent(page, row!))).toMatchObject([{ title: 'Call back the vendor' }])
    await page.waitForTimeout(4000)
    expect(await runsOf(page, agent)).toHaveLength(1)
  })

  test('raw-HTML person and date mentions in an auto-applied page are text: no mention node, no reminder', async ({ page, context }) => {
    await openApp(page)
    await setKey(page)
    const ppl = await people(page)
    const space = await createPage(page, { title: 'Nordlicht inbox', content: doc(p('Start.')) })
    const html = `Ping <span data-type="mention" data-kind="person" data-id="${ppl.Mira}" data-label="Mira">@Mira</span> on <span data-type="mention" data-kind="date" data-id="2026-10-20" data-reminder="at" data-label="Tue 20 Oct">@Tue 20 Oct</span>.`
    await mockAgent(context, [call('a1', 'append_to_page', { id: space, markdown: html }), say('Noted.')])
    const agent = await addAgent(page, { id: 'ag-html', name: 'Notes', write: 'apply', scope: { everything: false, pages: [space], databases: [] } })
    const run = await runNow(page, agent)
    expect(run.status).toBe('ok')
    const content = await pageContent(page, space)
    expect(typesIn(content)).not.toContain('mention')
    expect(JSON.stringify(content)).toContain('@Mira')
  })
})
