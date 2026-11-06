/** Browser-owned, read-only model execution for document pipelines. No checkout or worker execution. */
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud/state'
import { currentLang } from '../../i18n'
import { newId } from '../../lib/ids'
import { withWriter, type Writer } from '../../store/writer'
import { runAgent, type RunHooks } from '../ai/agent/run'
import { TERMINAL_TOOLS, withToolScope, type StageApi } from '../ai/agent/tools'
import { newItemSession } from '../ai/agent/workItems'
import { AIError } from '../ai/core'
import { precheck } from '../ai/core/gate'
import { appliedOf } from '../ai/core/shape'
import { attachMcp, currentSetup } from '../ai/mcp-servers/config'
import { mcpActivityText } from '@/shared/mcp/activityDisplay'
import { appendLog, loadTask, patchTask, scope, taskLocal } from './local'
import { finishStage, isParkedStep, taskContext, type TaskContext } from './tasks'
import { nextStage, optionName } from './schema'
import { refPlan } from './refs'
import { isTrusted, keepTrust } from './trust'
import { PageReadBuffer } from '@/shared/ai/sourcePassages'
import { readableContent, readableBlocks, isContextLimited } from '../../editor'
import { contentKey } from '../history/snapshots'
import { CLAIM_STALE_MS } from './protocol'

export const canUseOneAnalysis = (ctx: TaskContext | null): boolean => !!ctx && ctx.kind !== 'coding'
  && !optionName(ctx.db, ctx.props.repo, ctx.row.properties[ctx.props.repo ?? ''])
  && ctx.pipeline.length > 0 && ctx.pipeline.every(s => ['queue', 'doc', 'gate', 'done'].includes(s.kind) && s.output !== 'stories')

type Claim = { worker?: string; claimed?: string; owner: string; writer: Writer }
interface Job { since: number; activity: string; controller: AbortController }
export const useOneAnalysis = create<{ jobs: Record<string, Job> }>(() => ({ jobs: {} }))
export const oneJobKey = (id: string) => `${scope()}|${id}`
export function stopOneAnalysis(id: string): Promise<void> {
  useOneAnalysis.getState().jobs[oneJobKey(id)]?.controller.abort()
  return Promise.resolve()
}
const say = (de: string, en: string) => currentLang() === 'de' ? de : en

/** Only explicit task actions launch this path; opening a task never spends tokens. */
export async function runOneAnalysis(id: string, manual = false): Promise<void> {
  const workspace = scope(), epoch = useWorkspace.getState().epoch, key = oneJobKey(id)
  if (useOneAnalysis.getState().jobs[key]) return
  const controller = new AbortController()
  const job = { since: Date.now(), activity: say('Analyse vorbereiten', 'Preparing analysis'), controller }
  useOneAnalysis.setState(s => ({ jobs: { ...s.jobs, [key]: job } }))
  const same = () => scope() === workspace && useWorkspace.getState().epoch === epoch
  const log = (s: string, k: 'info' | 'tool' | 'error' = 'info') => {
    if (!same()) return
    appendLog(id, [{ t: Date.now(), k, s }])
    useOneAnalysis.setState(st => ({ jobs: { ...st.jobs, [key]: { ...job, activity: s } } }))
  }
  const check = () => {
    controller.signal.throwIfAborted()
    if (!same()) throw Error('Workspace changed; analysis stopped.')
    if (useCloud.getState().readOnly) throw Error('Read-only workspace.')
  }
  const unsubscribe = useWorkspace.subscribe(() => { if (!same()) controller.abort() })
  let acquired = false, heartbeat: ReturnType<typeof setInterval> | undefined
  let draft = '', claimed: Claim | null = null
  const execute = async () => {
    check()
    await loadTask(id)
    check()
    if (taskLocal(id).execution !== 'one') return
    const seen = new Set<string>()
    for (let hops = 0; hops < 100; hops++) {
      check()
      const ctx = taskContext(id)
      if (!canUseOneAnalysis(ctx) || !ctx?.stage) throw Error(say('Diese Pipeline benötigt einen Worker. One unterstützt reine Dokument-Stufen ohne lokales Repository.', 'This pipeline requires a worker. One supports document stages without a local repository.'))
      if (isParkedStep(id)) throw Error(say('Diese Aufgabe wartet auf den Start ihrer Auftragskette.', 'This task is waiting for its work-order chain.'))
      const { stage, row, db, props, pipeline } = ctx
      if (stage.kind === 'gate' || stage.kind === 'done') return
      if (seen.has(stage.id)) throw Error(say('Die Pipeline enthält eine Schleife. Bitte prüfe die nächste Stufe.', 'The pipeline contains a cycle. Check its next stage.'))
      seen.add(stage.id)
      const local = taskLocal(id)
      if (!stage.auto && !local.runNow && !manual) return
      if (!(await isTrusted(id))) throw Error(say('Bitte bestätige die geänderte Aufgabe vor dem Start.', 'Confirm the changed task before starting.'))
      check()
      if (taskContext(id)?.row !== row || taskContext(id)?.db !== db) throw Error('Task changed before start.')
      const owner = String(row.properties[props.worker ?? ''] ?? '')
      const date = row.properties[props.claimed ?? ''] as { start?: string } | undefined
      if (owner && Date.now() - new Date(date?.start ?? '').getTime() < CLAIM_STALE_MS) throw Error(say('Diese Aufgabe wird bereits ausgeführt.', 'This task is already running.'))
      if (stage.kind === 'queue') {
        const next = nextStage(pipeline, stage)
        if (!next || !props.stage) throw Error('Pipeline has no next stage.')
        await keepTrust([id], () => { check(); if (taskContext(id)?.row !== row) throw Error('Task changed.'); useWorkspace.getState().setRowProperty(id, props.stage!, next.id) }, { kind: 'coding', task: id, run: newId() })
        continue
      }
      const run = newId(), writer: Writer = { kind: 'coding', task: id, run }
      claimed = { worker: props.worker, claimed: props.claimed, owner: `One ${run}`, writer }
      await keepTrust([id], () => {
        check()
        if (taskContext(id)?.row !== row) throw Error('Task changed before claim.')
        if (props.worker) useWorkspace.getState().setRowProperty(id, props.worker, claimed!.owner)
        if (props.claimed) withWriter(writer, () => useWorkspace.getState().setRowProperty(id, props.claimed!, { start: new Date().toISOString() }))
      }, writer)
      check()
      await patchTask(id, { state: 'running', stageId: stage.id, run, runNow: false, error: null, analysisDraft: null })
      check()
      const refs = refPlan(id)
      const allowed = new Set([id, ...refs.pages.map(p => p.id)])
      if (refs.left.length) log(say(`${refs.left.length} weitere Verweise sind nicht im Lesebereich.`, `${refs.left.length} further references are outside the reading scope.`))
      const snapshot = () => JSON.stringify([taskContext(id)?.pipeline, [...allowed].map(p => {
        const page = useWorkspace.getState().pages[p]
        return page && [page.title, contentKey(page.content), page.trashed, page.databaseId, Object.fromEntries(Object.entries(page.properties).filter(([k]) => k !== props.worker && k !== props.claimed)), readableContent(p)]
      })])
      const before = snapshot()
      const valid = () => {
        check()
        if (!canUseOneAnalysis(taskContext(id)) || taskLocal(id).execution !== 'one' || taskLocal(id).run !== run || (props.worker && taskContext(id)?.row.properties[props.worker] !== claimed?.owner) || snapshot() !== before) throw Error(say('Aufgabe oder Quellen wurden verändert. Der Entwurf bleibt im Log; bitte erneut prüfen und starten.', 'Task or sources changed. The draft remains in the log; review and start again.'))
      }
      heartbeat = setInterval(() => {
        try { valid(); if (props.claimed) withWriter(writer, () => useWorkspace.getState().setRowProperty(id, props.claimed!, { start: new Date().toISOString() })) } catch { controller.abort() }
      }, 30_000)
      const sources = [...allowed].map(page => ({ page }))
      const instructions = `Read task page ${id} and its referenced pages with read_page before doing any analysis. Complete only the current document stage: ${stage.name}.\n${stage.instructions ?? ''}\nReturn the full stage document as Markdown. Include source references and distinguish observed facts, assumptions and open questions. The One task and its referenced pages are required sources for this document stage. An available Atlas connection alone does not require an external read. Read approved Atlas sources when the task requires fresh external verification or the One sources are insufficient. Clearly attribute carried-forward evidence to the One document; do not claim an Atlas read unless it actually occurred in this stage. Never execute code, change repository files, write external records, or claim tests ran. Host One saves your final document in this task and handles subsequent stages and approvals. If sources are unavailable, state this clearly. Use the language of the task. Referenced page ids: ${[...allowed].join(', ')}.`
      const pre = precheck({ purpose: 'agents.run', route: local.analysisRoute, sources, typed: instructions })
      const route = pre.route
      if (!route || ['codex', 'copilot', 'local'].includes(route.p)) throw Error(say('Wähle ein direkt verfügbares One-Modell ohne lokalen Worker.', 'Choose a directly available One model without a local worker.'))
      const mcp = pre.allows('mcp') ? await attachMcp(currentSetup(), 'free') : null
      valid()
      const read = new Map<string, PageReadBuffer>()
      const tools = TERMINAL_TOOLS.filter(t => ['read_page', 'search_pages', 'read_page_files', 'read_tables'].includes(t.name) && !t.write).map(tool => ({ ...tool, async run(input: Record<string, unknown>, api: StageApi) {
        valid()
        const result = await withToolScope(p => allowed.has(p), () => tool.run(input, api))
        valid()
        if (tool.name === 'read_page' && result.state === 'ok' && result.pageRead) {
          const buffer = read.get(result.pageRead.pageId) ?? new PageReadBuffer()
          buffer.add(result.pageRead, result.content); read.set(result.pageRead.pageId, buffer)
        }
        return result
      } }))
      const readonly = () => { throw Error('Analysis has no write tools.') }
      const api: StageApi = { list: () => [], add: readonly, update: readonly, resolve: id => id, items: newItemSession('agent') }
      let live = '', answer = '', cost = 0, turns = 0, held = ''
      const hooks: RunHooks = {
        contract: report => {
          if (!['ready', 'blocked'].includes(report.phase)) return
          const pages = (report.evidence.one_pages ?? []).map(p => useWorkspace.getState().pages[p]?.title || say('Seite ohne Titel', 'Untitled page'))
          log(say(`Quellen dieser Stufe: ${pages.length} One-Seiten, ${report.evidence.atlas_reads} Atlas-Abrufe.`, `Sources for this stage: ${pages.length} One pages, ${report.evidence.atlas_reads} Atlas reads.`) + (pages.length ? ` ${pages.join(' · ')}` : ''))
        },
        toolStart: (name, arg) => { log(`${name === 'read_page' ? say('Seite lesen', 'Read page') : name === 'search_pages' ? say('Seiten suchen', 'Find pages') : name} · ${arg}`); return newId() },
        toolEnd: (_id, out) => log(out.summary, out.state === 'err' ? 'error' : 'info'),
        note: text => log(text), text: text => { live += text; draft = live },
        textDone: kind => { if (kind === 'answer') answer = live; else if (live.trim()) log(live); live = '' },
        usage: (_usage, entry) => { cost += entry?.usd ?? 0; turns++ }, history: () => {},
        limit: () => { held = say('Anfragelimit erreicht.', 'Request limit reached.') },
        held: () => { held = say('Die Anfrage wurde angehalten. Prüfe Budget und Datenfreigaben.', 'The request was held. Check budget and data permissions.') },
        mcp: call => { const a = mcpActivityText(call.tool, call.display, call.arg, currentLang()); log([a.action, a.detail, call.state].filter(Boolean).join(' · '), call.state === 'err' ? 'error' : 'info') },
      }
      log(`${stage.name} · ${pre.label}`)
      const startedAt = Date.now()
      const result = await runAgent({ purpose: 'agents.run', targetPage: id, readOnly: true, sourcePolicy: 'document', maxRounds: stage.maxTurns ?? 40, route: pre.route, sources, typed: instructions,
        history: [], user: { role: 'user', content: instructions }, stage: api, signal: controller.signal, hooks, mcp, tools,
        system: 'You perform a read-only document analysis inside One. Read the task and sources with tools. Return a sourced Markdown document; host One saves it. Never perform external writes or execute code.',
        readLimit: p => {
          if (!isContextLimited(p)) return null
          const r = readableContent(p, { form: 'file' })
          return r.mode === 'marked' && r.blocks ? { mode: 'marked', markdown: r.markdown, plain: r.plain, blocks: r.blocks, ids: readableBlocks(p).flatMap(b => typeof b.attrs?.id === 'string' ? [b.attrs.id] : []) } : { mode: 'none', markdown: '', plain: '', blocks: 0, ids: [] }
        },
        applied: appliedOf(pre), run: { source: `analysis:${id}:${run}`, mode: 'manual' } })
      const finalDocument = answer || live
      draft = finalDocument || draft
      valid()
      if (result !== 'done' || !finalDocument.trim() || !read.get(id)?.complete()) throw Error(held || say('Analyse unvollständig: keine vollständige Antwort oder die Aufgabenseite wurde nicht gelesen. Die Stufe bleibt offen.', 'Analysis incomplete: missing final answer or task page was not read. The stage stays open.'))
      await finishStage(id, stage.id, { status: 'ok', plan: finalDocument, cost, runEvidence: { executor: 'host', requestedModel: `${route.p}/${route.m}`, startedAt, finishedAt: Date.now(), turns, costUsd: cost } }, valid)
      clearInterval(heartbeat); heartbeat = undefined
      claimed = null
      check()
      draft = ''
      manual = false
      log(say(`${stage.name} gespeichert.`, `${stage.name} saved.`))
    }
    throw Error('Pipeline stage limit reached.')
  }
  try {
    if (!navigator.locks) throw Error(say('Dieser Browser unterstützt keine sichere Aufgabensperre.', 'This browser does not support task locks.'))
    await navigator.locks.request(`one-analysis:${key}`, { ifAvailable: true }, async lock => {
      if (!lock) throw Error(say('Die Analyse läuft bereits in einem anderen Tab.', 'Analysis is already running in another tab.'))
      acquired = true
      await execute()
    })
  } catch (error) {
    if (same()) {
      const detail = error instanceof AIError ? error.detail ?? error.message : error instanceof Error ? error.message : String(error)
      const missingSources = detail.startsWith('Compiled result check blocked:') && detail.includes('task_sources_observed')
      const message = controller.signal.aborted ? say('Analyse gestoppt.', 'Analysis stopped.') : missingSources ? say('Quellenprüfung: In dieser Stufe wurde keine erforderliche Quelle erfolgreich gelesen. Bereits gespeicherte Dokumente bleiben erhalten; die Stufe wurde nicht abgeschlossen.', 'Source check: no required source was successfully read in this stage. Previously saved documents are retained; the stage was not completed.') : error instanceof Error ? error.message : String(error)
      log(message, 'error')
      if (draft.trim()) log(draft)
      if (acquired) await patchTask(id, { state: controller.signal.aborted ? 'stopped' : 'failed', error: message, analysisDraft: draft || null, runNow: false })
    }
  } finally {
    clearInterval(heartbeat)
    if (same() && claimed) {
      const c = claimed as Claim
      await keepTrust([id], () => {
        if (!same() || !c.worker || useWorkspace.getState().pages[id]?.properties[c.worker] !== c.owner) return
        useWorkspace.getState().setRowProperty(id, c.worker, null)
        if (c.claimed) useWorkspace.getState().setRowProperty(id, c.claimed, null)
      }, c.writer)
    }
    unsubscribe()
    useOneAnalysis.setState(s => { const jobs = { ...s.jobs }; delete jobs[key]; return { jobs } })
  }
}
