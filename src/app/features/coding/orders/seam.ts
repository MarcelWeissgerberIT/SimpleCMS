/**
 * Work orders — the planner's e2e seam (DEV / `?e2e` only; coding/index.ts imports this module for its side effect):
 * `window.__oneOrders` = { plan(row, opts), answer(row, answers), record(row), run(row), stop(row) } and B6's confirming
 * (start, hashNow, undo, undoable, startNow, runChain, finishCreates, finishRest, discardMade, fault, world, parked, countFor) and
 * B7's chain (move, advance, confirmAndGo, halt, haltAll, stopNow, resume, skip, replanFrom, successor, agentAppend,
 * agentStage, approvePlan; seenNow = what a card would render now, as the fingerprints a press passes). The planner
 * and confirm.ts load on the first call (lazy chunks); results are plain JSON (an AIError as { code, detail, fixes }).
 */
import type { ID } from '../../../store/types'

type AnyErr = { code?: unknown; detail?: unknown; fixes?: unknown }
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (x instanceof Error ? { code: (x as AnyErr).code ?? 'error', detail: (x as AnyErr).detail ?? null, fixes: (x as AnyErr).fixes ?? [] } : x))) as unknown

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneOrders?: unknown }).__oneOrders = {
    plan: (rowId: ID, o: { mode: 'manual' | 'trigger'; replace?: boolean }) => import('./planner').then((m) => m.planOrder(rowId, o)).then(plain),
    answer: (rowId: ID, answers: Array<{ q: string; a: string }>) => import('./planner').then((m) => m.answerQuestions(rowId, answers)).then(plain),
    record: (rowId: ID) => import('./records').then((m) => m.loadOrderRecord(rowId, { fresh: true })).then(plain),
    run: (rowId: ID) => import('./runs').then((m) => plain(m.plannerRun(rowId) ?? null)),
    stop: (rowId: ID) => import('./runs').then((m) => m.stopPlanning(rowId)),
    // B6 — confirming: ↵ Kette starten (the shown hash), Z, ↵ jetzt, a creation left half done, the e2e fault
    start: (rowId: ID, hash?: string) =>
      Promise.all([import('./confirm'), import('./records')]).then(async ([m, r]) => {
        const rec = await r.loadOrderRecord(rowId, { fresh: true })
        const draft = rec && rec !== 'unreadable' ? rec.draft : undefined
        const shown = hash ?? (draft ? await m.planHashNow(rowId, draft) : null) ?? ''
        return plain(await m.startChain(rowId, shown))
      }),
    hashNow: (rowId: ID) =>
      Promise.all([import('./confirm'), import('./records')]).then(async ([m, r]) => {
        const rec = await r.loadOrderRecord(rowId, { fresh: true })
        return rec && rec !== 'unreadable' && rec.draft ? m.planHashNow(rowId, rec.draft) : null
      }),
    undo: (rowId: ID) => import('./confirm').then((m) => m.undoChain(rowId)).then(plain),
    undoable: (rowId: ID) => import('./confirm').then((m) => m.undoable(rowId)),
    startNow: (rowId: ID) => import('./chainRun').then((m) => m.startNow(rowId)).then(plain),
    runChain: (rowId: ID) => import('./chainRun').then((m) => m.runChain(rowId)).then(plain),
    finishCreates: (rows: ID[]) => import('./confirm').then((m) => m.finishCreates(rows)),
    finishRest: (rowId: ID) => import('./confirm').then((m) => m.finishRest(rowId)).then(plain),
    discardMade: (rowId: ID) => import('./confirm').then((m) => m.discardMade(rowId)).then(plain),
    fault: (f: { at: number; mode: 'throw' | 'hold' } | null) => import('./confirm').then((m) => m.setCreateFault(f)),
    world: (rowId: ID) =>
      Promise.all([import('./chainRun'), import('./records'), import('../chain')]).then(async ([c, r, core]) => {
        const rec = await r.loadOrderRecord(rowId, { fresh: true })
        if (!rec || rec === 'unreadable') return null
        const world = await c.chainWorld(rowId, rec)
        return plain({ world, move: core.nextMove(world) })
      }),
    parked: (taskId: ID) => import('../tasks').then((m) => m.isParkedStep(taskId)),
    // the count before step 01 set to `ms` from now (screenshots of the Laufleiste while it counts)
    countFor: (rowId: ID, ms: number) =>
      Promise.all([import('./records'), import('./chainRun')]).then(async ([r, c]) => {
        const out = await r.patchOrderRecord(rowId, (rec) => (rec?.state === 'running' && rec.chain ? { ...rec, chain: { ...rec.chain, startAt: Date.now() + ms } } : rec))
        c.followRecord(rowId, out.rec)
        return out.ok
      }),
    // B7 — the chain on its own: the newest move here, the person's keys, the next step an approval releases
    move: (rowId: ID) => import('./chainRun').then((m) => plain(m.useChainMoves.getState().moves[rowId]?.move ?? null)),
    // `seen`: what a card rendered of the changed pages and the Grundlage (fingerprints — seenNow gives them as a card
    // would render them now)
    advance: (rowId: ID, step: number, passes: string[], seen?: { refs?: Record<ID, string>; basis?: string }) => import('./chainKeys').then((m) => m.advanceChain(rowId, step, passes as never, seen ?? {})).then(plain),
    confirmAndGo: (rowId: ID, step: number, hash: string, passes: string[] = [], seen?: { refs?: Record<ID, string>; basis?: string }) => import('./chainKeys').then((m) => m.confirmAndGo(rowId, step, hash, passes as never, seen ?? {})).then(plain),
    seenNow: (rowId: ID, step: number) =>
      Promise.all([import('./records'), import('./chainRun')]).then(async ([r, c]) => {
        const rec = await r.loadOrderRecord(rowId, { fresh: true })
        return rec && rec !== 'unreadable' && rec.chain ? plain(await c.shownNow(rec.chain, step)) : null
      }),
    halt: (rowId: ID) => import('./chainKeys').then((m) => m.haltChain(rowId)).then(plain),
    haltAll: () => import('./chainKeys').then((m) => m.haltAll()),
    stopNow: (rowId: ID) => import('./chainKeys').then((m) => m.stopNow(rowId)).then(plain),
    resume: (rowId: ID) => import('./chainKeys').then((m) => m.resumeChain(rowId)).then(plain),
    skip: (rowId: ID, n: number) => import('./chainKeys').then((m) => m.skipStep(rowId, n)).then(plain),
    replanFrom: (rowId: ID, n: number) => import('./chainKeys').then((m) => m.replanFrom(rowId, n)).then(plain),
    budget: (rowId: ID, usd: number | null) => import('./chainKeys').then((m) => m.setChainBudget(rowId, usd)).then(plain),
    successor: (taskId: ID) => import('./records').then((m) => plain(m.chainSuccessorNow(taskId))),
    // a custom agent's write, as an agent run applies it (asAgent + this device's stamp): text appended / the Stage set
    agentAppend: (taskId: ID, text: string, agentId = 'agentE2e01') =>
      Promise.all([import('../../agents/attribution'), import('../../../store/store'), import('../../../store/writer')]).then(async ([a, st, w]) => {
        const ws = st.useWorkspace.getState()
        const page = ws.pages[taskId]
        if (!page) return false
        await a.asAgent(agentId, () => w.withWriter({ kind: 'agent', id: agentId, run: 'e2e' }, () => ws.setContent(taskId, { type: 'doc', content: [...(page.content?.content ?? []), { type: 'paragraph', content: [{ type: 'text', text }] }] }, 'ai')))
        a.stampLocal(agentId, [taskId])
        return true
      }),
    agentStage: (taskId: ID, stageName: string, agentId = 'agentE2e01') =>
      Promise.all([import('../../agents/attribution'), import('../../../store/store'), import('../../../store/writer'), import('../schema')]).then(async ([a, st, w, sc]) => {
        const ws = st.useWorkspace.getState()
        const page = ws.pages[taskId]
        const db = page?.databaseId ? ws.databases[page.databaseId] : undefined
        const stage = db ? sc.readPipeline(db).find((x) => x.name === stageName) : undefined
        const prop = db ? sc.codingProps(db).stage : undefined
        if (!page || !stage || !prop) return false
        await a.asAgent(agentId, () => w.withWriter({ kind: 'agent', id: agentId, run: 'e2e' }, () => ws.setRowProperty(taskId, prop, stage.id)))
        a.stampLocal(agentId, [taskId])
        return true
      }),
    // the Preflight / terminal decision for an approval: its plan, whether it starts the worker now, its VON HAND reasons
    approvePlan: (taskId: ID) =>
      import('../terminal').then(async (m) => {
        try {
          const plan = await m.planTaskAction(taskId, 'approve')
          return plain({ plan, startsNow: m.startsNow({ op: 'approve', starts: plan.starts, action: plan }) })
        } catch (e) {
          return plain({ error: e instanceof Error ? e.message : String(e) })
        }
      }),
    // what the brake note's E does on the plate (governor BrakeFor): an allowance for exactly this retry, then plan again
    retryWith: (rowId: ID, allowance: string) =>
      Promise.all([import('../../ai/core/gate'), import('./planner')]).then(([g, m]) => {
        g.armRetry('coding.plan', { allowance })
        return m.planOrder(rowId, { mode: 'manual' }).then(plain)
      }),
  }
}
