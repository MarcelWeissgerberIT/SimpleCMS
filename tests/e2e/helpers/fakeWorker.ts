/**
 * A coding worker played by the test: a WebSocket server on 127.0.0.1 speaking the protocol of
 * features/coding/protocol.ts — nothing else runs (no git, no Claude Code). It says its welcome, asks for work like the
 * real worker (`next` on welcome, on a nudge and every 2 s, one at a time) and — when a test wants it — finishes a
 * handed-out stage with a given outcome (`finish`, or `auto` for every stage) and answers the tab's git keys (`onGit`).
 * worker 1.11.0: a running stage can wait for a permission (`askPermission` — named in `status` and sent as an event,
 * as the real worker does); the tab's answers are kept (`permAsked`) and settle it. A stop (`op: 'stop'`) is answered and the
 * running stage finishes as 'stopped' (`stopAsked`).
 * Used by coding-old-worker.spec (older workers), coding-ship-fake.spec (ship records), coding-permission.spec.
 */
import { WORKER_SUBPROTOCOL, type WorkerInfo } from '../../../src/app/features/coding/protocol.ts'

export type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Asked {
  /** what the worker said it runs (undefined: it sent no `can`) */
  can: string[] | undefined
  /** the tab's answer (undefined while it is open) */
  answer?: Json
}

export interface FakeWorker {
  onManage: ((action: string) => Json) | null
  /** null: an older worker (no `can`); a list: what a newer one names (with `docs: true`) */
  mcpAsked: Json[]
  onModelMcp: ((request: Json) => Json) | null
  textModels: Json[]
  textAsked: Json[]
  onText: ((request: Json) => Json) | null
  can: string[] | null
  /** `docs: true` without a `can`: the worker the Business analysis / QA pipelines came with */
  docs: boolean
  hellos: Json[]
  asked: Asked[]
  /** `next` requests the tab has not answered yet */
  open: () => number
  /** the tasks the tab handed out */
  handed: () => Json[]
  /** finish a handed-out task's stage with this outcome — the tab's answer */
  finish: (task: Json, outcome: Json) => Promise<Json>
  /** every handed-out stage is finished at once with what this returns (null: left running) */
  auto: ((task: Json) => Json | null) | null
  /** the tab's git requests (`op: 'git'`), in order */
  gitAsked: Json[]
  /** the answer to a git request: a result, or an Error to refuse it (default: refused) */
  onGit: ((req: Json) => Json | Error) | null
  /** the open permission request per task id (worker 1.11.0) */
  asks: Map<string, Json>
  /** the tab's permission answers (`op: 'permission'`), in order — exactly as sent */
  permAsked: Json[]
  /** the tab's stop requests (`op: 'stop'`), in order — answered, and the running stage finishes as 'stopped' */
  stopAsked: Json[]
  /** a running task waits for a permission: named in `status` (busy) and sent as an event */
  askPermission: (task: Json, ask: Json) => void
  /** send the tab a message of the protocol (an event) */
  send: (msg: Json) => void
  close: () => Promise<void>
}

/** Start the fake on `port` with this welcome. */
export async function startFakeWorker(port: number, info: WorkerInfo): Promise<FakeWorker> {
  const { WebSocketServer } = (await import('../../../mcp/node_modules/ws/wrapper.mjs')) as typeof import('../../../mcp/node_modules/@types/ws/index.d.ts')
  const wss = new WebSocketServer({ host: '127.0.0.1', port, handleProtocols: (p: Set<string>) => (p.has(WORKER_SUBPROTOCOL) ? WORKER_SUBPROTOCOL : false) })
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve())
    wss.once('error', reject)
  })
  let tab: { send: (data: string) => void; readyState: number } | null = null
  let seq = 0
  let again = false
  const pending = new Map<string, Asked>()
  const finishing = new Map<string, (m: Json) => void>()
  /**
   * hand-outs finished since — each hand-out on its own (a stage handed out again after it finished, a Continue or a
   * Start over, runs until it finishes too: the real worker names it busy meanwhile)
   */
  const finished = new Set<Json>()
  const keyOf = (task: Json) => `${task.id}|${task.stage?.id}`
  const running = () => fake.handed().filter((t) => !finished.has(t))
  const status = () => tab?.send(JSON.stringify({ type: 'status', busy: running().map((t) => ({ taskId: t.id, repo: t.repo, stageId: t.stage.id, since: Date.now(), ...(fake.asks.get(t.id) ? { ask: fake.asks.get(t.id) } : {}) })), spentToday: 0 }))
  const fake: FakeWorker = {
    onManage: null,
    mcpAsked: [], onModelMcp: null, textModels: [], textAsked: [], onText: null,
    can: null,
    docs: false,
    hellos: [],
    asked: [],
    gitAsked: [],
    asks: new Map(),
    permAsked: [],
    stopAsked: [],
    askPermission: (task, ask) => {
      fake.asks.set(task.id, ask)
      tab?.send(JSON.stringify({ type: 'event', taskId: task.id, kind: 'permission', ask }))
      status()
    },
    auto: null,
    onGit: null,
    open: () => pending.size,
    handed: () => fake.asked.flatMap((a) => (a.answer?.result?.task ? [a.answer.result.task as Json] : [])),
    finish: (task, outcome) =>
      new Promise<Json>((resolve, reject) => {
        if (!tab || tab.readyState !== 1) return reject(new Error('no tab'))
        const id = `f${++seq}`
        finishing.set(id, resolve)
        tab.send(JSON.stringify({ type: 'req', id, op: 'finish', taskId: task.id, stageId: task.stage.id, outcome, finishId: `fin-${id}` }))
      }).then((m) => {
        // like the real worker: the stage stays busy until One confirmed its outcome — then it is free again and asks
        for (const t of running()) if (keyOf(t) === keyOf(task)) finished.add(t)
        status()
        setTimeout(ask, 50)
        return m
      }),
    send: (msg) => tab?.send(JSON.stringify(msg)),
    close: () => {
      clearInterval(poll)
      for (const c of wss.clients) c.terminate()
      return new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
  // one `next` at a time (again right after, when asked meanwhile) — like the real worker
  const ask = () => {
    // busy with as many stages as it runs in parallel: it asks for nothing more
    if (!tab || tab.readyState !== 1 || running().length >= info.parallel) return
    if (pending.size) {
      again = true
      return
    }
    again = false
    const id = `n${++seq}`
    const can = fake.can ? [...fake.can] : undefined
    const entry: Asked = { can }
    pending.set(id, entry)
    fake.asked.push(entry)
    tab.send(JSON.stringify({ type: 'req', id, op: 'next', repos: info.repos.map((r) => r.name), worker: info.name, ...(can || fake.docs ? { docs: true } : {}), ...(can ? { can } : {}) }))
  }
  const poll = setInterval(ask, 2000)
  wss.on('connection', (ws) => {
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as Json
      if (m.type === 'hello') {
        fake.hellos.push(m)
        tab = ws
        ws.send(JSON.stringify({ type: 'welcome', ...info }))
        return ask()
      }
      if (m.type === 'nudge') return ask()
      if (m.type === 'req' && m.op === 'worker-manage') { ws.send(JSON.stringify({type:'res',id:m.id,ok:true,result:fake.onManage?.(m.action) ?? {installed:true,version:info.worker,previous:null,phase:'running'}})); return }
      if (m.type === 'req' && m.op === 'text-models') { ws.send(JSON.stringify({ type: 'res', id: m.id, ok: true, result: fake.textModels })); return }
      if (m.type === 'req' && m.op === 'model-mcp') {
        fake.mcpAsked.push(m.request)
        const result = fake.onModelMcp?.(m.request) ?? { tools: [] }
        ws.send(JSON.stringify(result instanceof Error ? { type: 'res', id: m.id, ok: false, error: result.message } : { type: 'res', id: m.id, ok: true, result })); return
      }
      if (m.type === 'req' && m.op === 'text-request') {
        fake.textAsked.push(m.request)
        const result = fake.onText?.(m.request) ?? { model: m.request.model, text: 'Worker text answer.', inputTokens: 200, outputTokens: 50, usd: null }
        ws.send(JSON.stringify({ type: 'res', id: m.id, ok: true, result })); return
      }
      if (m.type === 'req' && m.op === 'text-stop') { ws.send(JSON.stringify({ type: 'res', id: m.id, ok: true, result: { stopped: true } })); return }
      if (m.type === 'req' && m.op === 'git') {
        fake.gitAsked.push(m)
        const answer = fake.onGit ? fake.onGit(m) : new Error('git is not played by this fake')
        ws.send(JSON.stringify(answer instanceof Error ? { type: 'res', id: m.id, ok: false, error: answer.message } : { type: 'res', id: m.id, ok: true, result: answer }))
        return
      }
      if (m.type === 'req' && m.op === 'stop') {
        // like the real worker: Claude Code's process tree ends, the stage reports 'stopped'
        fake.stopAsked.push(m)
        ws.send(JSON.stringify({ type: 'res', id: m.id, ok: true, result: { ok: true } }))
        const task = running().find((t) => t.id === m.taskId)
        if (task) setTimeout(() => void fake.finish(task, { status: 'stopped', error: 'Stopped' }).catch(() => {}), 50)
        return
      }
      if (m.type === 'req' && m.op === 'permission') {
        fake.permAsked.push(m)
        const open = fake.asks.get(String(m.taskId))
        if (!open || open.id !== m.ask) return ws.send(JSON.stringify({ type: 'res', id: m.id, ok: true, result: { ok: false, gone: true } }))
        fake.asks.delete(String(m.taskId))
        ws.send(JSON.stringify({ type: 'event', taskId: m.taskId, kind: 'permission', ask: null, settled: { id: open.id, how: m.verb } }))
        status()
        ws.send(JSON.stringify({ type: 'res', id: m.id, ok: true, result: { ok: true } }))
        return
      }
      if (m.type === 'res') {
        const done = finishing.get(String(m.id))
        if (done) {
          finishing.delete(String(m.id))
          return done(m)
        }
        const entry = pending.get(String(m.id))
        if (!entry) return
        pending.delete(String(m.id))
        entry.answer = m
        // a task: it runs here now (what One shows as "Running")
        const task = m.result?.task as Json | null | undefined
        if (task) {
          status()
          const outcome = fake.auto?.(task)
          if (outcome) setTimeout(() => void fake.finish(task, outcome).catch(() => {}), 150)
        }
        if (again) ask()
      }
    })
  })
  return fake
}
