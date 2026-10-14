/**
 * A coding worker played by the test: a WebSocket server on 127.0.0.1 speaking the protocol of
 * features/coding/protocol.ts — nothing else runs (no git, no Claude Code). It says its welcome, asks for work like the
 * real worker (`next` on welcome, on a nudge and every 2 s, one at a time) and — when a test wants it — finishes a
 * handed-out stage with a given outcome (`finish`, or `auto` for every stage) and answers the tab's git keys (`onGit`).
 * Used by coding-old-worker.spec (older workers) and coding-ship-fake.spec (ship records).
 */
import { WORKER_SUBPROTOCOL, type WorkerInfo } from '../../../src/app/features/coding/protocol'

export type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Asked {
  /** what the worker said it runs (undefined: it sent no `can`) */
  can: string[] | undefined
  /** the tab's answer (undefined while it is open) */
  answer?: Json
}

export interface FakeWorker {
  /** null: an older worker (no `can`); a list: what a newer one names (with `docs: true`) */
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
  /** handed-out stages finished since (task id + stage id) */
  const finished = new Set<string>()
  const keyOf = (task: Json) => `${task.id}|${task.stage?.id}`
  const running = () => fake.handed().filter((t) => !finished.has(keyOf(t)))
  const status = () => tab?.send(JSON.stringify({ type: 'status', busy: running().map((t) => ({ taskId: t.id, repo: t.repo, stageId: t.stage.id, since: Date.now() })), spentToday: 0 }))
  const fake: FakeWorker = {
    can: null,
    docs: false,
    hellos: [],
    asked: [],
    gitAsked: [],
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
        finished.add(keyOf(task))
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
      if (m.type === 'req' && m.op === 'git') {
        fake.gitAsked.push(m)
        const answer = fake.onGit ? fake.onGit(m) : new Error('git is not played by this fake')
        ws.send(JSON.stringify(answer instanceof Error ? { type: 'res', id: m.id, ok: false, error: answer.message } : { type: 'res', id: m.id, ok: true, result: answer }))
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
