/**
 * Work orders — what a press and the planner both read about a request (spec §1, §2.2 items 1–6): ONE reading, so the
 * press (press.ts — the plate's strip, the command, the trigger) and the planner's own re-check (planner.ts, the lazy
 * chunk) never disagree. Eager (it never loads the planner); reads the store and the worker link.
 *
 *  - The kinds a request may use: its own Pipelines (db.ts orderFields — "Felder der Zeile gehen vor"), else the
 *    settings' kinds (all three while the settings cannot be read — the planner refuses those itself: 'config').
 *  - Each kind's project: the one pinned in the settings (no longer a live project of that kind → 'gone', named), else
 *    the one #/coding shows on this device, else none yet — confirming the chain makes one from the kind's default
 *    template, so that template's stages are checked. Its problem: coding/chain.ts chainProjectProblem against what the
 *    connected worker runs.
 *  - The facts of items 1–6 for preconditions.ts checkPreconditions (the one rule set, in its order).
 */
import { useWorkspace } from '../../../store/store'
import type { ID, OrderKind } from '../../../store/types'
import { t } from '../../../i18n'
import { useCoding } from '../state'
import { codingReadOnly, currentProjectId, KIND_TEMPLATES, kindOfDb, readPipeline, templatePipeline, type ResolvedStage } from '../schema'
import { chainProjectProblem } from '../chain'
import { workerCan } from '../protocol'
import { codingConnText, workerCaps, workerOnline, workerVerdict } from '../link'
import { ORDER_KINDS, readOrderConfig } from './config'
import { orderFields } from './db'
import { hasChainProps } from './props'
import type { KindProblem, PlannerFacts } from './preconditions'

const ws = () => useWorkspace.getState()

/** A kind a request may use, with the project its steps would go to. */
export interface KindProject {
  kind: OrderKind
  /** the project (pipeline database) — null: none yet, one is made at confirm from the kind's default template */
  project: ID | null
  /** its title as the planner names it (the kind's name for a project still to be made) */
  title: string
  /** its stages (the default template's for a project still to be made) */
  pipeline: ResolvedStage[]
  /** why it cannot take chain steps (null: it can) */
  problem: KindProblem | null
}

/** The default template's stages of a kind (the project confirming a chain would make). */
const templateOf = (kind: OrderKind): ResolvedStage[] => templatePipeline(KIND_TEMPLATES[kind][0]!).map(({ option, stage }, index) => ({ ...stage, name: option.name, color: option.color, index }))

/** The kinds a request may use: its own Pipelines, else the settings' (see the head of this file). */
export function requestKinds(rowId: ID): OrderKind[] {
  const s = ws()
  const row = s.pages[rowId]
  const read = readOrderConfig(row?.databaseId ? s.databases[row.databaseId] : undefined)
  return orderFields(rowId).kinds ?? (read.kind === 'ok' ? read.config.kinds : [...ORDER_KINDS])
}

/** Each kind's project and its problem (see the head of this file). */
export function kindProjects(rowId: ID, kinds: readonly OrderKind[] = requestKinds(rowId)): KindProject[] {
  return kindProjectsOf(ws().pages[rowId]?.databaseId ?? null, kinds)
}

/** Each kind's project and its problem for a work-orders database (B11: the consent's sig reads every kind). */
export function kindProjectsOf(ordersDb: ID | null, kinds: readonly OrderKind[]): KindProject[] {
  const s = ws()
  const read = readOrderConfig(ordersDb ? s.databases[ordersDb] : undefined)
  const pinnedOf = read.kind === 'ok' ? read.config.projects : undefined
  const caps = workerCaps()
  const capSet = caps ? workerCan(caps) : null
  return kinds.map((kind): KindProject => {
    const pinned = pinnedOf?.[kind]
    if (pinned && kindOfDb(pinned) !== kind) return { kind, project: pinned, title: '', pipeline: [], problem: 'gone' }
    const id = pinned ?? currentProjectId(kind)
    const db = id ? s.databases[id] : undefined
    const pipeline = db ? readPipeline(db) : templateOf(kind)
    const title = (id ? s.pages[id]?.title.trim() : '') || t(`features.coding.pipe.${kind}`)
    const problem = chainProjectProblem({ kind, pipeline, locked: !!db?.locked, hasRoles: !!id && !!ordersDb && hasChainProps(id, ordersDb), repo: true, caps: capSet })
    return { kind, project: id ?? null, title, pipeline, problem }
  })
}

/** §2.2 items 1–6 as this tab sees them now (checkPreconditions decides), with each offered kind's project. */
export function requestFacts(rowId: ID, kinds?: readonly OrderKind[]): Omit<PlannerFacts, 'kinds'> & { kinds: KindProject[] } {
  const c = useCoding.getState()
  const caps = workerCaps(c)
  return {
    enabled: c.enabled,
    readOnly: codingReadOnly(),
    online: workerOnline(c),
    // a team member's cloud worker at another device (the relay refused this one, or says it is online there)
    elsewhere: c.refused === 'other-device' || (!!c.relay?.online && c.conn !== 'connected'),
    connText: codingConnText(),
    verdict: workerVerdict(c),
    repos: c.worker?.repos.length ?? 0,
    docs: !!caps && workerCan(caps).has('doc'),
    kinds: kindProjects(rowId, kinds),
  }
}
