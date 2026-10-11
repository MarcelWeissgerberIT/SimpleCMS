/**
 * Flight recorder in team workspaces (R1a): the tape is the signed-in member's (scope cloud:<id>:u:<account> —
 * another account in the same browser starts its own); removing a team workspace's copy from this browser takes its
 * tapes and before-images with it and keeps the local workspace's; the binding's own upkeep (follow-up
 * stamps, repairs, look put-backs) is never anyone's Vorgang; a collab refresh that carries this tab's typing and a
 * colleague's at once is flagged BATCH; a colleague's change that arrives through the binding is on lane team (R1–R4).
 * Fictional people and pages (Mara Lind, Nordlicht, Tessera).
 */
import type { Page } from '@playwright/test'
import { test, expect, email, signIn, newPerson, openApp, waitForApp, waitOnline, wsEval, cloudEval, cloudStatus, gotoPage, editorOf, createWorkspace, join } from './fixtures'
import { F, markRec, rec, recorderOps, startRecorder, step } from '../e2e/helpers/recorder'

type AnyRec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const agent = (run: string) => ({ kind: 'agent', id: 'nordlicht-spiegel', run })

/** The open workspace's tape is written; its ops / pins of a scope. */
const opsOf = (page: Page, scope: string) => rec<AnyRec[]>(page, 'ops', { scope })
const pinsOf = (page: Page, scope: string) => rec<{ metas: AnyRec[]; bodies: AnyRec[] }>(page, 'pins', scope)

test.describe('flight recorder — team workspaces', () => {
  test('removing a team copy wipes its tape and pins; the local tape stays', async ({ page: a }) => {
    await signIn(a, email('mara'))
    // the local workspace: a machine write → a Vorgang and a pin of scope local:local
    await openApp(a)
    await startRecorder(a)
    const local = await wsEval(a, (s) => s.createPage({ title: 'Nordlicht lokal' }) as string)
    await step(a, agent('l1'), [['updatePage', local, { title: 'Nordlicht lokal 2' }]], { note: { seq: 1 }, end: true })
    await rec(a, 'settle')
    const localOps = (await opsOf(a, 'local:local')).length
    const localPins = (await pinsOf(a, 'local:local')).metas.length
    expect(localOps).toBeGreaterThan(0)
    expect(localPins).toBeGreaterThan(0)
    await a.evaluate(() => (window as unknown as { __one: { flushSave: () => Promise<void> } }).__one.flushSave())

    // the team workspace: the same, in the member's scope cloud:<id>:u:<account>
    const wsId = await createWorkspace(a, 'Tessera Team')
    await openApp(a, wsId)
    await waitOnline(a)
    await startRecorder(a)
    const uid = await cloudEval(a, (c) => c.user.id as string)
    const scope = `cloud:${wsId}:u:${uid}`
    expect(await rec(a, 'scope')).toBe(scope)
    const team = await wsEval(a, (s) => s.createPage({ title: 'Tessera Plan' }) as string)
    await step(a, agent('t1'), [['updatePage', team, { title: 'Tessera Plan 2' }]], { note: { seq: 2 }, end: true })
    await rec(a, 'settle')
    expect((await opsOf(a, scope)).length).toBeGreaterThan(0)
    expect((await pinsOf(a, scope)).metas.length).toBeGreaterThan(0)
    expect(await rec(a, 'unknowns')).toEqual([])
    await expect.poll(() => a.evaluate(() => (window as any).__one.cloud.useCloudSync.getState().unsynced), { timeout: 15_000 }).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any

    // Settings → Data → Remove copy: the tab goes back to the local workspace, the copy is removed at that boot
    await a.keyboard.press('Control+,')
    const settings = a.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: /Data/ }).click()
    await settings.getByTestId('remove-copy').getByRole('button', { name: 'Remove copy' }).click()
    const confirm = a.getByRole('dialog').filter({ hasText: 'Remove the copy of' })
    await Promise.all([a.waitForEvent('load'), confirm.getByRole('button', { name: 'Remove copy' }).click()])
    await waitForApp(a)
    await startRecorder(a)
    expect(await cloudStatus(a)).toBe('local')
    await expect.poll(async () => (await opsOf(a, scope)).length).toBe(0)
    expect((await pinsOf(a, scope)).metas).toEqual([])
    expect((await pinsOf(a, scope)).bodies).toEqual([])
    // its digest key went with it
    expect(await rec(a, 'kv', scope)).toEqual([])
    // the local tape and its pins are untouched
    expect((await opsOf(a, 'local:local')).length).toBe(localOps)
    expect((await pinsOf(a, 'local:local')).metas.length).toBe(localPins)
  })

  test('another account signed in in this browser has a tape of its own: none of the first one’s records or pins', async ({ page: a, context }) => {
    await signIn(a, email('mara'))
    const wsId = await createWorkspace(a, 'Tessera Geteilt')
    await openApp(a, wsId)
    await waitOnline(a)
    await startRecorder(a)
    const first = (await rec<string>(a, 'scope')) as string
    expect(first).toMatch(new RegExp(`^cloud:${wsId}:u:[A-Za-z0-9_-]+$`))
    const page = await wsEval(a, (s) => s.createPage({ title: 'Tessera Entwurf (Mara)' }) as string)
    await step(a, agent('m1'), [['updatePage', page, { title: 'Tessera Entwurf (Mara) 2' }]], { note: { seq: 1 }, end: true })
    await rec(a, 'settle')
    expect((await opsOf(a, first)).length).toBeGreaterThan(0)
    expect((await pinsOf(a, first)).metas.length).toBeGreaterThan(0)
    await expect.poll(() => a.evaluate(() => (window as any).__one.cloud.useCloudSync.getState().unsynced), { timeout: 15_000 }).toBe(false) // eslint-disable-line @typescript-eslint/no-explicit-any

    // Lind joins, then signs in in Mara's browser (the copy stays): Lind's tape starts empty
    const lindMail = email('lind')
    const lind = await newPerson(context)
    await signIn(lind, lindMail)
    await join(a, lind, wsId, 'member')
    await signIn(a, lindMail)
    await openApp(a, wsId)
    await waitOnline(a)
    await startRecorder(a)
    const second = (await rec<string>(a, 'scope')) as string
    expect(second).toMatch(new RegExp(`^cloud:${wsId}:u:[A-Za-z0-9_-]+$`))
    expect(second).not.toBe(first)
    expect(await opsOf(a, second)).toEqual([])
    expect((await pinsOf(a, second)).metas).toEqual([])
    // Mara's tape is still hers (kept like her private documents), never read as Lind's
    expect((await opsOf(a, first)).length).toBeGreaterThan(0)
  })

  test('follow-up stamps, repairs and look put-backs are nobody’s Vorgang', async ({ page: owner, context }) => {
    await signIn(owner, email('nordlicht-owner'))
    const wsId = await createWorkspace(owner, 'Nordlicht Team')
    const mara = await newPerson(context)
    await signIn(mara, email('mara'))
    await join(owner, mara, wsId, 'member')
    await openApp(mara, wsId)
    await waitOnline(mara)
    await startRecorder(mara)

    // the person writes twice; after each write the binding stamps created_by / last_edited_by (system: stamp)
    const id = await wsEval(mara, (s) => s.createPage({ title: 'Tessera Ablauf' }) as string)
    await expect.poll(() => wsEval(mara, (s, id) => s.pages[id]?.updatedBy ?? null, id)).not.toBeNull()
    const mark = await markRec(mara)
    await wsEval(mara, (s, id) => s.updatePage(id, { title: 'Tessera Ablauf 2' }), id)
    await mara.waitForTimeout(300)
    await wsEval(mara, (s, id) => s.updatePage(id, { icon: { type: 'emoji', value: '🧭' } }), id)
    await mara.waitForTimeout(300)
    // a structural repair: a page whose parent is not there goes to the top (system: repair, run 1.5 s after a
    // database change)
    const orphan = await wsEval(mara, (s) => s.createPage({ title: 'Tessera Waise', parentId: 'gone-parent-0001' }) as string)
    await wsEval(mara, (s) => s.createDatabase({ title: 'Tessera Liste' }))
    await expect.poll(() => wsEval(mara, (s, id) => s.pages[id]?.parentId ?? null, orphan), { timeout: 10_000 }).toBeNull()
    // a look a member may not set: the team's look comes back (system: refused)
    await mara.evaluate(() => {
      const ws = (window as unknown as { __one: { workspace: { setState: (p: unknown) => void } } }).__one.workspace
      ws.setState({ look: { preset: 'blueprint', colors: { paper: '#f4f1ea', ink: '#1d1d1b', signal: '#2457ff' }, fonts: { ui: 'Archivo', text: 'Archivo', headings: 'Archivo' }, corners: 'sharp', updatedAt: Date.now(), updatedBy: null } })
    })
    await expect.poll(() => wsEval(mara, (s) => s.look?.preset ?? null)).toBeNull()
    await mara.waitForTimeout(500)

    const ops = await recorderOps(mara, mark)
    // only the person's four writes (title, icon, the orphan, the database): no system op, nothing on the unknown lane
    expect(ops.map((o) => o.w)).toEqual(['you~ui:e2e', 'you~ui:e2e', 'you~ui:e2e', 'you~ui:e2e'])
    expect(ops.every((o) => o.l === 'you')).toBe(true)
    // the stamps moved the identity chain (ignored fields only): one segment of the person on the page, no gap
    await rec(mara, 'settle')
    const segs = ((await rec<AnyRec[]>(mara, 'segments')) as AnyRec[]).filter((s) => s.p === `p:${id}` && s.from >= Math.min(...ops.map((o) => o.at)))
    expect(segs).toHaveLength(1)
    expect(segs[0].f & F.GAP).toBe(0)
    expect(await rec(mara, 'unknowns')).toEqual([])
  })

  test('a collab refresh that carries this tab’s typing and a colleague’s is flagged BATCH', async ({ page: a, context }) => {
    await signIn(a, email('mara'))
    const wsId = await createWorkspace(a, 'Tessera Schreibstube')
    const b = await newPerson(context)
    await signIn(b, email('lind'))
    await join(a, b, wsId, 'member')
    await openApp(a, wsId)
    await waitOnline(a)
    await startRecorder(a)
    const id = await wsEval(a, (s) => s.createPage({ title: 'Nordlicht Protokoll' }) as string)
    await gotoPage(a, id)
    await openApp(b, wsId)
    await waitOnline(b)
    await gotoPage(b, id)
    await editorOf(a, id).click()
    await a.keyboard.type('Nordlicht')
    await expect(editorOf(b, id)).toContainText('Nordlicht')
    await a.waitForTimeout(1500)
    const mark = await markRec(a)
    // both type within the refresh delay (900 ms after this tab's last key): one refresh carries both
    await a.keyboard.type(' eins')
    await editorOf(b, id).click()
    await b.keyboard.press('End')
    await b.keyboard.type(' zwei')
    await expect.poll(() => wsEval(a, (s, id) => s.pages[id].plain as string, id), { timeout: 10_000 }).toMatch(/eins[\s\S]*zwei|zwei[\s\S]*eins/)
    await a.waitForTimeout(1200)
    const ops = await recorderOps(a, mark)
    const mixed = ops.filter((o) => o.w === 'editor:collab+m')
    expect(mixed.length, JSON.stringify(ops.map((o) => [o.w, o.l, o.f ?? 0]))).toBeGreaterThan(0)
    for (const o of mixed) {
      expect(o.l).toBe('you')
      expect(o.f & F.BATCH).toBe(F.BATCH)
    }

    // a colleague's change that reaches this tab through the binding: lane team (until R5 names the member)
    const before = await markRec(a)
    await wsEval(b, (s, id) => s.updatePage(id, { title: 'Nordlicht Protokoll (Lind)' }), id)
    await expect.poll(() => wsEval(a, (s, id) => s.pages[id].title as string, id), { timeout: 10_000 }).toBe('Nordlicht Protokoll (Lind)')
    await expect.poll(async () => (await recorderOps(a, before)).filter((o) => o.l === 'team' && o.w === 'team').length, { timeout: 10_000 }).toBeGreaterThan(0)
    expect(await rec(a, 'unknowns')).toEqual([])

    // a colleague's change that sets off this tab's automation: its cause is the team's — never "unknown" (a
    // derived writer reads its cause where no frame is open: store/writer.ts causeKey)
    const n = await wsEval(a, (s) => {
      const db = s.createDatabase({ title: 'Tessera Übergabe' }) as string
      const stage = s.addProperty(db, { name: 'Stage', type: 'select', options: [{ id: 'o-offen', name: 'Offen', color: 'gray' }, { id: 'o-fertig', name: 'Fertig', color: 'green' }] }) as string
      const note = s.addProperty(db, { name: 'Notiz', type: 'text' }) as string
      const row = s.createRow(db, { title: 'NL-1402', properties: { [stage]: 'o-offen' } }) as string
      s.updateDatabase(db, { automations: [{ id: 'au-tessera', name: 'Fertig notieren', enabled: true, trigger: { type: 'property_changed', propertyId: stage, toValue: 'o-fertig' }, actions: [{ type: 'set_property', propertyId: note, value: 'automatisch' }] }] })
      return { db, stage, note, row }
    })
    await expect.poll(() => wsEval(b, (s, n) => !!s.pages[n.row] && !!s.databases[n.db]?.automations?.length, n), { timeout: 10_000 }).toBe(true)
    const caused = await markRec(a)
    await wsEval(b, (s, n) => s.setRowProperty(n.row, n.stage, 'o-fertig'), n)
    await expect.poll(() => wsEval(a, (s, n) => s.pages[n.row].properties[n.note] ?? null, n), { timeout: 10_000 }).toBe('automatisch')
    await a.waitForTimeout(800)
    const after = await recorderOps(a, caused)
    expect(after.filter((o) => /<unknown/.test(o.w)).map((o) => o.w), 'causes that fell back to unknown').toEqual([])
    for (const o of after.filter((o) => o.w.startsWith('automation:'))) expect(o.w).toMatch(/<team$/)
    expect(await rec(a, 'unknowns')).toEqual([])
  })
})
