/**
 * Coding pipeline (features/coding) — re-exported by features/index.ts. One keeps the tasks, the pipeline,
 * approvals, logs and diffs; `one-worker` (mcp/src/worker → public/mcp/one-worker.mjs) runs git and Claude
 * Code on the person's machine. Docs: docs/CODING.md · protocol: ./protocol.ts.
 *  - startCoding(): background service (main.tsx); idle until Settings → Coding worker is switched on
 *  - CodingRoute (#/coding) · CodingTaskSlot { pageId } (the task panel on a task page; nothing elsewhere)
 *  - CodingWorkerTab: Settings → Coding worker · CodingStatusCell: status bar "WORKER" LED
 *  - openCodingSettings() / consumeCodingSettingsRequest(): open Settings on that tab
 *  - codingDbId(): the Coding database (Database.system 'coding') · useCoding: the worker link's state
 */
import { lazy } from 'react'
import { inTeam, pipelineDbIds } from './schema'
import { useCodingLocal } from './local'
import { defaultApprovals, type ApprovalsLevel } from './state'

export { startCoding } from './service'
export { CodingRoute, CodingTaskSlot, OrderSlot, OrderDbSlot, OrderNoteModal } from './slot'
export { WorkerTab as CodingWorkerTab } from './WorkerTab'
export { CodingStatusCell } from './WorkerStatus'
export { openCodingSettings, consumeCodingSettingsRequest } from './open'
/** a worker older than 1.9.0 on this Windows computer (Local link) — the #/coding plate and the Preflight lamp name it */
export { workerOldHere } from './service'
export { useCoding } from './state'
export { codingDbId } from './schema'
/** the worker link's state in words (Settings → Coding worker, the workspace page's Automation section) */
export { workerStateText as codingWorkerStateText } from './stateText'
/** why the link is down, as Preflight's worker card says it (a Local link that waits: is the worker running) — MCP · Connections */
export { workerDownText as codingWorkerDownText } from './stateText'
/** why the link is down, in words, now (Preflight's worker card) — '' while connected or switched off (coding/link.ts) */
export { codingConnText } from './link'
/** "Change repositories": the connected worker opens its setup page (renders only while it has one) — MCP · Connections */
export { ChangeReposButton as CodingChangeReposButton } from './SetupCard'
/** the AI terminal (features/ai/agent/coding.ts): reading the pipelines, planning + applying task changes the person reviewed */
export {
  taskPhase,
  landsOn,
  taskBriefs,
  useTaskBriefs,
  briefRank,
  pipelineOverview,
  taskDetail,
  planNewTask,
  applyNewTask,
  planTaskAction,
  applyTaskAction,
  startsNow,
  taskNeedsConfirm,
  mayNeedConfirm,
  isPipelineTask,
  textRefs,
  textRefsGained,
  taskWriteEndsConfirm,
  taskSig,
  newProjectNow,
  codingRoleOf,
  CodingPlanError,
  TASK_OPS,
  REPO_NAME,
  SHOWN_MAX,
  type TaskBrief,
  type TaskFilter,
  type TaskStatus,
  type TaskPhase,
  type TaskDetail,
  type PipelineOverview,
  type ProjectInfo,
  type NewTaskInput,
  type NewTaskPlan,
  type TaskOp,
  type TaskActionPlan,
  type ReadLimitFn,
  type SigSteps,
  type StagedPages,
} from './terminal'
export type { RefPage } from './refs'
export { stopTask as stopCodingTask, isRunning as isCodingTaskRunning } from './service'
export { PIPELINE_KINDS, FOLLOW_UPS, isPipelineKind, kindOfDb, type PipelineKind } from './schema'
/** is there any pipeline (a project of any kind)? */
export const hasPipelines = (): boolean => pipelineDbIds().length > 0
export { lineText as codingLogText } from './lines'
export { gitSummary as codingGitSummary } from './tasks'
export { useTaskLocal as useCodingTaskLocal } from './local'
/**
 * The Preflight lamps (Gate · Coding question · Task failed): the tasks that wait on the person, without a page-map walk
 * (waiting.ts) — waitingTasks() (sync) · onWaitingChanged(fn) · loadTasks(ids): many tasks' run states in one read
 */
export { waitingTasks, onWaitingChanged, type WaitingTask } from './waiting'
export { loadTasks } from './local'
/**
 * Preflight's coding cards (P2): taskVersionView(id) — a task version exactly as it is hashed (title, page, fields,
 * stages, linked pages) with its hash · confirmTaskVersion(id, hash) → 'ok' | 'changed' | 'gone' — trusts exactly the
 * version shown · actionTook(plan) — did an applied task action move the task (the actions return silently on their
 * guards). Every other key goes through planTaskAction → applyTaskAction (never confirms a version).
 */
export { taskVersionView, actionTook, type TaskVersionView } from './terminal'
export { confirmTaskVersion } from './tasks'
/**
 * worker 1.11.0 — Preflight's "Claude möchte" lamp and the step-limit card: the permission requests running stages wait
 * for on this device are `useCoding.asks` (task id → PermissionAsk; only on the worker's own tab) ·
 * answerPermission(taskId, askId, verb) — only the request's id and a fixed verb go to the worker ('gone': answered
 * elsewhere, timed out, the stage ended) · askOf(taskId) · AskWhat (the request as the task panel shows it) ·
 * canContinue() (no connected worker that lacks 'continue')
 */
export { answerPermission, askOf } from './service'
export { canContinue } from './tasks'
export { AskWhat } from './PermissionCard'
export type { PermissionAsk, PermissionVerb } from './protocol'
/** bumped whenever this device trusts another task version (Confirm …, also in another tab): a trust readout re-checks with it */
export const useCodingTrustRev = (): number => useCodingLocal((s) => s.trustRev)
/** admins: every member's cloud worker with Revoke (the workspace page's Automation section; renders nothing otherwise) */
export { CloudWorkers as CodingCloudWorkers } from './CloudWorkers'
/**
 * The Patchbay's reads (features/patchbay — §1.3 gates, §1.4 the GIT exit, §1.7 live; the rules stay this area's own):
 *  - pipelineDbIdsOf(kind) (every live project of a kind, oldest first; team: private ones) · readPipeline(db) (the
 *    stages in Stage-option order, each with its git action, gate, hold) · gitStageWarnings(action, repos)
 *  - onShipRecord(fn) / lastShip(dbId): ship records as they arrive in this tab (pipeline → GIT, live)
 *  - approvalsDefault(): this device's Approvals for new tasks ('all' · 'review' · 'none')
 *  - taskConfirmRule(): who waits for a confirmed version — 'always' (team) · 'agent' (local: tasks an agent created or
 *    changed last, trust.ts needsConfirm)
 *  - worker state: workerOnline(s) · workerCaps(s) (what the connected worker runs; null: not known) ·
 *    workerVerdict(s) ('ok' | 'outdated' | 'unsafe' | null offline) · workerUnsafe(version) · workerOutdated(can)
 */
export { pipelineDbIdsOf, readPipeline, currentProjectId, type ResolvedStage } from './schema'
export { gitStageWarnings, onShipRecord, lastShip, type ShipNote } from './ship'
export { workerUnsafe, workerOutdated } from './protocol'
/** The outdated-worker notice in the person's language (what the newer one adds; before 1.11.0 the stage-end fix first). */
export { outdatedNotice as codingOutdatedNotice } from './outdated'
export type { ApprovalsLevel } from './state'
/**
 * Work orders (Prüfaufträge, orders/** — the contract, B1): the config of a `system: 'workorders'` database as every
 * reader keeps it (readOrderConfig: 'none' · 'unreadable' (a later build's: acts on nothing) · 'ok' + missing Status
 * options), the planner's typed plan, this device's record of a request, the limits; the chain roles on a project are
 * codingProps(db).order / .step (display only, never part of a task version).
 */
export { readOrderConfig, newOrderConfig, orderCheckpoint, orderConfigUsable, ORDER_KINDS, ORDER_STATUS_KEYS, BUDGET_RANGE, type OrderConfigRead } from './orders/config'
/**
 * B2 hardening: a work order's Status field (by the config's option ids; never by its name) and the Draft a row an
 * agent made lands in; the fields only One's own flows write (FREE_ROLES = title + priority — the rest of a pipeline
 * task's roles never by an agent, the MCP bridge or the folder / GitHub pick-up; `pickupKeeps` adds the Status); the
 * other live tasks holding a task's branch (no discard / clean-up from One while one does).
 */
export { orderStatusProps, isOrderStatusProp, orderDraftOf, isOrdersDb } from './orders/status'
export { FREE_ROLES, lockedPipelineRole, pickupKeeps, branchHolders, type BranchHolder } from './guards'
/**
 * B3 the chain core (pure — coding/chain.ts): nextMove(world, press?) → halt · card · advance · done · wait over a
 * ChainWorld (this device's record + the facts the sink reads), done evidence (doneEvidence / givesEvidence), the
 * parked-start guard (parksNewTasks, chainProjectProblem; tasks.ts setParkedGuard keeps the worker off a parked step),
 * the record transitions (withDone · withAdvance · withHalt · withResume · withSkip · withLine, mayResume, canSkip),
 * strayRows; the Grundlage (orders/basis.ts: a copy in one callout replacing the slot), the record reader, keys in a
 * plan (planKeyHits / scrubPlanKeys), the chain roles on a project (ensureChainProps), the chain's words; a new task's
 * checks shared with the terminal (draft.ts checkTaskDraft over terminal.ts draftWorld()) and its pipeline line.
 */
export { nextMove, doneEvidence, givesEvidence, parksNewTasks, chainProjectProblem, chainSteps, strayRows, chainSpent, withDone, withAdvance, withHalt, withResume, withSkip, withLine, mayResume, canSkip, CARD_ORDER, type ChainWorld, type ChainTaskFacts, type ChainRefFacts, type ChainMove, type ChainPress, type ChainCardWhy, type ChainPassable, type ChainWaitWhy, type ChainProjectProblem } from './chain'
export { basisBlock, skippedBlock, slotBlock, placeBasis, basisText, type BasisInput, type Basis } from './orders/basis'
export { readOrderRecord, readOrderChain } from './orders/record'
export { planKeyHits, scrubPlanKeys, type PlanKeyHit, type PlanKeyField } from './orders/keys'
export { ensureChainProps, hasChainProps, type ChainPropsResult } from './orders/props'
export { chainWords, stepNo, type ChainWords } from './orders/words'
export { checkTaskDraft, BRANCH_NAME, DRAFT_LIMITS, type DraftWorld, type DraftIssue, type DraftIssueCode, type TaskDraft } from './draft'
export { draftWorld, pipelineLine } from './terminal'
export { startStageOf, runsFrom, type StageApprovals } from './stages'
export { setParkedGuard, isParkedStep } from './tasks'
export { ORDER_HALT_WHYS } from './orders/types'
/**
 * B5 the planner: planOrder(row, { mode: 'manual' | 'trigger', prov?, run?, replace? }) → PlanOutcome (lazy — orders/plan.ts
 * seam; the entry points reach it only through press.ts callPlanner, with the press's run + provenance) · what a press
 * and the planner both read (orders/facts.ts: requestKinds, kindProjects, requestFacts — one reading of §2.2 items 1–6) ·
 * readPlan (the strict reader, pure) · this device's records (loadOrderRecord,
 * patchOrderRecord, useOrderRecord; IndexedDB one-coding `<scope>|order|<row>`, channel one-coding-orders) · the planner's
 * runs in this tab (usePlannerRun, plannerRun, stopPlanning — ⌘.) · answerQuestions (lazy, through planner.ts) · the
 * pure parts the plate words: preconditions, the picked server's tools, the call list, the open points (the prompt itself
 * stays inside the planner's lazy chunk).
 */
export { planOrder, readPlan, readStoredPlan, unlinkText, planOpenPoints, orderPlanHash, type PlanRead, type PlanReadCtx, type ResolvedStep } from './orders/plan'
export { loadOrderRecord, orderRecordNow, patchOrderRecord, useOrderRecord, readDraft, ORDERS_CHANNEL } from './orders/records'
export { usePlannerRun, plannerRun, stopPlanning, type PlannerRun, type PlannerPhase } from './orders/runs'
export { checkPreconditions, wordChars, type PlannerBlock, type PlannerFacts, type KindProblem } from './orders/preconditions'
export { requestKinds, kindProjects, requestFacts, type KindProject } from './orders/facts'
export { pickedTools, serverSkip, type ServerSkip } from './orders/tools'
export { foldCalls, callArgs, serverReturnedNothing } from './orders/calls'
export const answerQuestions = (rowId: string, answers: ReadonlyArray<{ q: string; a: string }>) => import('./orders/planner').then((m) => m.answerQuestions(rowId, answers))
export type { PlanOutcome, PlanOpts } from './orders/planner'
import './orders/seam'
export { PLAN_LIMITS, ORDER_LIMITS, type OrderPlanV1, type OrderStepPlan, type OrderRecord, type OrderDraft, type OrderChain, type OrderChainStep, type OrderDoneBy, type OrderHaltWhy, type OrderState, type OrderProv, type OrderCall, type OrderToolLeft, type OrderServerSkip, type PlanNote, type OrderConfig, type OrderKind, type OrderStatusKey } from './orders/types'

/** This device's Approvals for new tasks (localStorage one.coding.approvals). */
export const approvalsDefault = (): ApprovalsLevel => defaultApprovals()

/** Who waits for a confirmed task version before the worker runs it: every task in a team, local tasks an agent wrote. */
export const taskConfirmRule = (): 'always' | 'agent' => (inTeam() ? 'always' : 'agent')

/** the worker link: up (workerOnline) · what it runs (workerCaps) · its verdict 'ok' | 'outdated' | 'unsafe' (workerVerdict) — coding/link.ts */
export { workerOnline, workerCaps, workerVerdict } from './link'
/**
 * Work orders B4 — the database and its entry points (orders/db.ts · send.ts · press.ts · trigger.ts):
 *  - orderDbId() / ensureOrderDb(writer) (Status options by id in Database.orders.status; team: private) ·
 *    saveOrderConfig(dbId, fn) (the only writer of Database.orders) · orderStatusKey(row) · orderFields(row) ·
 *    orderCode(row) ("PA-12") · openOrderCount()
 *  - "Prüfen lassen": sendToOrders(pageId, { note? }) · sendToOrdersWithNote(pageId) ("Prüfen lassen …") ·
 *    canSendToOrders(pageId, { menu }) (menus: only while Coding is on here; never for viewers, pipeline tasks,
 *    databases or templates)
 *  - the press (pressPlan — the allow-list's one way to the planner: callPlanner → orders/plan.ts planOrder → planner.ts) and the
 *    database command Planen (planRows); the trigger subscriber + kept presses start with startCoding (startOrders)
 *  - OrderSlot { pageId } (the plate on a request's page) · OrderDbSlot { dbId } (the database's head) · OrderNoteModal
 */
export { ensureOrderDb, orderDbId, orderDbIds, saveOrderConfig, orderStatusKey, orderFields, orderCode, openOrderCount, orderProps, isOrderRow, writeOrderStatus } from './orders/db'
export { sendToOrders, sendToOrdersWithNote, canSendToOrders, openRequestFor, newOrderRequest } from './orders/send'
export { pressPlan, pressProv, orderPreNow, type PressResult } from './orders/press'
/**
 * B8 — the plate's pieces other areas show: NextStepFold (a gate card whose approval ends a chain step: "Freigeben startet
 * den nächsten Schritt …" + the step as it will run; `onSeen(true)` once read whole — pass it as the approval's
 * `sawNext`) · ChainLine (the task panel's "Teil von Prüfauftrag …") · registerCardChip is installed by startOrders.
 */
export { NextStepFold, ChainLine, type ChainNext } from './orders/ChainLine'
export { orderPre, WANT_WHYS, type OrderPreFacts, type OrderPreResult, type OrderPreWhy, type OrderPreKind } from './orders/pre'
export { planRows, OrderCommandError } from './orders/command'
export type { OrderPress, OrderPressHow } from './orders/types'
/**
 * Work orders B6 — confirming (orders/confirm.ts, lazy; chainRun.ts, stepPage.ts): startChain(row, hash) (↵ Kette starten,
 * VON HAND — two phases: checks + projects + chain roles, then every step created PARKED under `order:<row>:<run>#c<n>`,
 * a throw rolls back; 'running' + Status Läuft, step 01 after the 10 s count) · planHashNow(row, draft) (the hash the
 * plate shows and ↵ confirms) · undoChain(row) (Z, `you~undo`, all or nothing) · finishRest / discardMade (an
 * interrupted creation's VON HAND keys) · runChain(row) / startNow(row) (the engine's step-01 start and halts, B7 adds
 * the rest) · chainWorld(row, record) · stepPage(input) (the slot, the request quote, the context callout, the pages)
 */
export const startChain = (rowId: string, hash: string) => import('./orders/confirm').then((m) => m.startChain(rowId, hash))
export const planHashNow = (rowId: string, draft: import('./orders/types').OrderDraft) => import('./orders/confirm').then((m) => m.planHashNow(rowId, draft))
export const undoChain = (rowId: string) => import('./orders/confirm').then((m) => m.undoChain(rowId))
export const finishRest = (rowId: string) => import('./orders/confirm').then((m) => m.finishRest(rowId))
export const discardMade = (rowId: string) => import('./orders/confirm').then((m) => m.discardMade(rowId))
export type { StartOutcome, StartRefusal, UndoOutcome, FinishOutcome } from './orders/confirm'
export { runChain, startNow, chainWorld, taskFacts, parkedOf } from './orders/chainRun'
export { stepPage, stepBlockIds, requestPlain, type StepPage, type StepPageInput, type StepPageWords } from './orders/stepPage'
export { stepWords } from './orders/words'
/**
 * Work orders B7 — the chain on its own (orders/chainRun.ts eager, chainKeys.ts lazy): the done evidence (a store
 * subscriber reads who moved a step to done, in this tab, at the move), the catch-up (start, the worker's return, the
 * hooks beside spawnFollowUps, a debounced watch), the move (Grundlage copy into the slot, QA's shared branch, Stage —
 * `order:<row>:<run>#a<n>` under keepTrust, never past a Confirm wait), cards (useChainMoves), the end. The person's
 * keys (VON HAND where they start the worker): advanceChain (↵ Weiter on a card) · confirmAndGo (the Confirm card) ·
 * haltChain (H, every device) · haltAll · stopNow (⌘., the worker device) · resumeChain (↵ Fortsetzen; refused at the
 * budget) · skipStep (S) · setChainBudget · replanFrom (R after an analysis). chainSuccessorNow(task) — the parked step
 * an approval of `task` releases (TaskActionPlan.chain); chainStepOf(task).
 */
export const advanceChain = (rowId: string, step: number, passes: readonly import('./chain').ChainPassable[], seen: import('./orders/chainKeys').ChainSeen = {}) => import('./orders/chainKeys').then((m) => m.advanceChain(rowId, step, passes, seen))
export const confirmAndGo = (rowId: string, step: number, hash: string, passes: readonly import('./chain').ChainPassable[] = [], seen: import('./orders/chainKeys').ChainSeen = {}) => import('./orders/chainKeys').then((m) => m.confirmAndGo(rowId, step, hash, passes, seen))
export const haltChain = (rowId: string) => import('./orders/chainKeys').then((m) => m.haltChain(rowId))
export const haltAllChains = () => import('./orders/chainKeys').then((m) => m.haltAll())
export const stopChainNow = (rowId: string) => import('./orders/chainKeys').then((m) => m.stopNow(rowId))
export const resumeChain = (rowId: string) => import('./orders/chainKeys').then((m) => m.resumeChain(rowId))
export const skipChainStep = (rowId: string, n: number) => import('./orders/chainKeys').then((m) => m.skipStep(rowId, n))
export const replanFrom = (rowId: string, n: number) => import('./orders/chainKeys').then((m) => m.replanFrom(rowId, n))
export type { ChainKeyOutcome, ChainKeyRefusal } from './orders/chainKeys'
export { useChainMoves, basisPreview, type ChainView } from './orders/chainRun'
export { chainSuccessorNow, chainStepOf, chainLegOf } from './orders/records'
/**
 * Orders B10 — this device's consent "Ohne Bestätigung starten" (orders/auto.ts, localStorage
 * `one.orders.auto:<scope>:<db>`, local only — B11 switches it on): readOrderAuto(db) · dropOrderAuto(db) (the
 * Patchbay's key 1) · restoreOrderAuto(db, v) (its Undo) · onOrderAuto(fn); runningOrderCount() (the planner's window).
 */
export { readOrderAuto, dropOrderAuto, restoreOrderAuto, onOrderAuto, type OrderAuto } from './orders/auto'
/**
 * Orders B11 — "Ohne Bestätigung starten" switched on in the work orders' settings (orders/autoStart.ts, lazy:
 * switchAutoOn — a budget, the sig, the Patchbay asked — and the auto create after a press); dropOrderAutoAll() = every
 * consent of this scope (a restored backup never keeps one — features/io/backup.ts); AUTO_KEY_PREFIX (the local reset).
 */
export { dropOrderAutoAll, AUTO_KEY_PREFIX as ORDER_AUTO_KEY_PREFIX } from './orders/auto'
export { runningOrderCount, startedOrderCount } from './orders/db'
export { chainSuccessor, withPassed, withSeenNext, withRefs } from './chain'
/**
 * Work orders B9 — Preflight's cards (orders/lamp.ts · cardPrep.ts eager; the body lazy). orderCards() — what waits on
 * the person on this device: 'ready' (Kette bereit) · 'next' (the engine's card: Weiter mit Schritt n?) · 'halted' ·
 * 'interrupted' · 'chainConfirm' (a Läuft request whose chain this device holds no record of — the worker moved, a
 * restore) · 'request' (a team: Planen asked on another device); onOrderCardsChanged / onOrderSeen; prepareOrderCard /
 * orderPrep / dropOrderPrep (what a card shows, read when it becomes current — what its ↵ passes) · readyBlock (why ↵
 * Kette starten cannot act: the plate's own order and seen book) · chainKeyBlock (the guard of every start-like key) ·
 * chainChipOf (a coding card's "PA-12 · 2/3"). The keys — each VON HAND where it lets the worker start something — are
 * the orders' own entry points, called only from Preflight's queue/calls.ts: startChain · discardPlan · advanceChain /
 * confirmAndGo · haltChain · resumeChain · skipChainStep · replanFrom · finishRest · discardMade · confirmChainVersions ·
 * planHere · undoChain (the start's Undo).
 */
export { orderCards, onOrderCardsChanged, onOrderSeen, parseOrderCard, chainChipOf, chainKeyBlock, type OrderCard, type OrderCardKind } from './orders/lamp'
export { prepareOrderCard, orderPrep, dropOrderPrep, readyBlock, type OrderPrep } from './orders/cardPrep'
export { refusalText as orderStartRefusalText, preWhyText as orderPreWhyText } from './orders/text'
export { discardPlan } from './orders/trigger'
export const OrderCardBody = lazy(() => import('./orders/OrderCard'))
export const confirmChainVersions = (rowId: string, shown: ReadonlyArray<{ id: string; hash: string }>) => import('./orders/confirm').then((m) => m.confirmChainVersions(rowId, shown))
export type { ConfirmChainOutcome } from './orders/confirm'
/** ↵ Hier planen on Preflight's card for a request asked for on another device (a team): this device's press (VON HAND). */
export const planHere = (rowId: string) => import('./orders/press').then((m) => m.pressPlan(rowId, 'card'))
/**
 * Orders B13 — the flight recorder's eject (orders/eject.ts, lazy; called only from features/recorder/eject/sources.ts):
 * the chain's eject units `order:<row>:<run>#c<n>` (creation) · `#a<n>` (advance) · `#s` (Status). settleEjectedOrder
 * marks the steps it took back in this device's record and halts a running chain ('ejected' / 'ejectedStatus' — S
 * decides); unsettleEjectedOrder (its Undo) drops that eject's marks, the halt stays (an eject never advances a chain);
 * orderEjectBusy — a chain of the window being created right now; orderEjectFacts — the dialog's line.
 */
export const settleEjectedOrder = (runKey: string, ids: readonly string[], ejectId: string) => import('./orders/eject').then((m) => m.settleEjectedOrder(runKey, ids, ejectId))
export const unsettleEjectedOrder = (runKey: string, ids: readonly string[], ejectId: string) => import('./orders/eject').then((m) => m.unsettleEjectedOrder(runKey, ids, ejectId))
export const orderEjectBusy = (runKeys: readonly string[]) => import('./orders/eject').then((m) => m.orderEjectBusy(runKeys))
export const orderEjectFacts = (units: readonly string[]) => import('./orders/eject').then((m) => m.orderEjectFacts(units))
export { withEjected, withoutEjected } from './chain'
