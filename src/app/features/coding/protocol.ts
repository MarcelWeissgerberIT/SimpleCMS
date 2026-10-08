/**
 * Coding pipeline — the shared contract of `one-worker` (mcp/src/worker, bundled to public/mcp/one-worker.mjs)
 * and the app (features/coding). Pure data, no imports: the worker bundles this file as it is, so the
 * tab ⇄ worker protocol is defined exactly once.
 *
 * One (the browser tab) keeps the tasks, the pipeline, approvals, logs and diffs. The worker runs on the
 * person's machine: it owns the repositories (paths and commands never leave the machine), runs git and
 * Claude Code there, and talks to the tab either over ws://127.0.0.1:<port> (Local — origin allow-list, host
 * check and workspace binding exactly like the MCP bridge, docs/MCP.md § Security model) or, in a team
 * workspace, through the team server's relay (Cloud — the worker dials out; every protocol frame travels
 * end-to-end encrypted with a key derived from the download's pairing secret: the server passes boxes it
 * can neither read nor forge, docs/CODING.md § Cloud worker).
 *
 * The worker asks (`req`), the tab answers (`res`) — and the other way round for the person's actions
 * (Stop, the fixed git verbs). One never sends a command line, a path or a free git argument.
 */

/** Default port of the worker's WebSocket (ONE_WORKER_PORT / "port" in worker.json; Settings → Coding worker). */
export const WORKER_DEFAULT_PORT = 47322
/** WebSocket subprotocol of the tab ⇄ worker protocol. */
export const WORKER_SUBPROTOCOL = 'one-worker.v1'
/** Close code: a newer tab of the same workspace took over. */
export const WORKER_CLOSE_REPLACED = 4001
/** Close code: the worker serves another workspace (or none yet). */
export const WORKER_CLOSE_REFUSED = 4003
/** A claim whose heartbeat is older than this may be taken over by another worker. */
export const CLAIM_STALE_MS = 10 * 60_000
/** How often the worker confirms the tasks it works on. */
export const HEARTBEAT_MS = 60_000
/** Log lines kept per task on this device. */
export const LOG_MAX = 2000
/** Tasks one worker runs at once (across repos; one per repo). */
export const PARALLEL_MAX = 2

/**
 * 'doc' = a document stage (business analysis, test design …): Claude Code only reads — the repository (if the task
 * has one), the task, the person's knowledge-base MCP servers — and its last message is the document One writes into
 * the page. It needs no worktree, and a task without a repository runs it in the worker's own scratch folder.
 * 'import' = the task's code arrives here (an "Import" stage, e.g. legacy code): in the task panel the person hands
 * the worker a ZIP or a clone address, the worker makes it a new repository (intake.ts) and the task takes it as its
 * Repo, then moves on. The worker never takes a task standing there.
 * 'analyze' = static analysis: the repo's analyzeCommand (worker.json / setup page; a linter, a compiler, a vet …) runs in
 * the task's worktree (or the main checkout when the task has none — it creates no branch); its output becomes a section
 * of the page, so the stages after it read the findings. A non-zero exit is a finding, not a failure.
 */
export const STAGE_KINDS = ['queue', 'import', 'analyze', 'plan', 'doc', 'gate', 'implement', 'test', 'git', 'done'] as const
export type StageKind = (typeof STAGE_KINDS)[number]
/** Claude Code permission modes a stage may ask for — never one that skips permissions. */
export const PERMISSION_MODES = ['plan', 'acceptEdits', 'default'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]
/**
 * What a git stage does: commit · commit + push · commit + push + pull request · merge the base in · post the newest
 * review document to the branch's merge / pull request · merge that request on the host (gh / glab).
 */
export const GIT_ACTIONS = ['commit', 'push', 'pr', 'update-base', 'comment', 'merge'] as const
export type GitAction = (typeof GIT_ACTIONS)[number]
/**
 * What a worker runs beyond the first protocol, sent with every `next`: 'analyze' (the Static analysis stage), the
 * git actions 'git:comment' / 'git:merge', 'doc' (document stages), 'model' (it passes the stage's model to Claude
 * Code) and 'mcp-list' (it names each repo's own Claude Code MCP servers, so the task panel can show them). One hands a stage that needs one of them only to a worker that says so — an older worker would run an unknown
 * stage kind as a git stage, drop the task as unreadable (and get it again on every round), or quietly run Claude
 * Code with another model than the one picked.
 */
export const WORKER_CAN = ['analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list'] as const
/**
 * What a worker runs, read from its `next`. Document stages came before `can`, together with `docs: true`: a worker
 * that sends either knows them, so a `can` without 'doc' (1.3.x) or `docs` without a `can` (1.3.1 before `can`)
 * counts as knowing them too. Only a worker with neither (older than document stages) gets none.
 */
export function workerCan(can: readonly string[], docs = false): Set<string> {
  const set = new Set(can)
  if (set.size || docs) set.add('doc')
  return set
}
/** A worker that does not name everything this One hands out: older than the download on the site. */
export function workerOutdated(can: readonly string[] | null): boolean {
  if (!can) return false
  const has = workerCan(can)
  return WORKER_CAN.some((c) => !has.has(c))
}
/**
 * The capabilities a stage needs ([]: every worker runs it). `model` = the model the stage runs with (the task's own
 * pick on this device, else the stage's): a worker that does not name 'model' would ignore it.
 */
export function stageNeeds(stage: { kind: string; gitAction?: string | null; model?: string | null }): string[] {
  const needs: string[] = []
  if (stage.kind === 'analyze') needs.push('analyze')
  if (stage.kind === 'doc') needs.push('doc')
  if (stage.kind === 'git' && (stage.gitAction === 'comment' || stage.gitAction === 'merge')) needs.push(`git:${stage.gitAction}`)
  if (stage.model && claudeRuns(stage.kind)) needs.push('model')
  return needs
}

/** Stage kinds that run Claude Code — the only ones a model applies to. */
export const CLAUDE_KINDS = ['plan', 'implement', 'doc'] as const
export function claudeRuns(kind: string): boolean {
  return (CLAUDE_KINDS as readonly string[]).includes(kind)
}

/**
 * A model name for Claude Code's `--model`: an alias it accepts ('opus' · 'sonnet' · 'haiku'), a full model id or an
 * own name — letters, digits and . _ : - [ ], 1–100 characters, starting with a letter or digit (a leading "-" would
 * read as a flag of its own). The one rule for a stage's model from One and `claude.model` in worker.json. It reaches
 * Claude Code as one entry of an argument list, never through a shell.
 */
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/
/** The name trimmed when it passes MODEL_NAME, else null. */
export function cleanModel(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim()
  return MODEL_NAME.test(m) ? m : null
}
/**
 * The person's git actions in One — fixed verbs the worker maps to its own commands. "reveal" only prints
 * the worktree's path in the worker's terminal (it never comes to One); "discard", "force-push" and "merge-pr"
 * are confirmed in One; "discard" / "cleanup" touch only branches and worktrees the worker created; "comment-pr"
 * posts `message` (the review) to the branch's merge / pull request, "merge-pr" merges it — both with the person's
 * own glab / gh.
 */
export const GIT_VERBS = ['refresh', 'commit', 'push', 'force-push', 'pr', 'update-base', 'discard', 'cleanup', 'reveal', 'comment-pr', 'merge-pr'] as const
export type GitVerb = (typeof GIT_VERBS)[number]

/** A repo name as worker.json may name it (One shows and stores only names). */
export const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** A workspace id ('local:…' / 'team:…', the same ids as the MCP bridge). */
export const WORKSPACE_ID = /^(local|team):[A-Za-z0-9_-]{1,64}$/

/**
 * A worker downloaded from One comes ready-paired: One writes this line right after the shebang of
 * one-worker.mjs (`globalThis.ONE_WORKER_PRESET = {…}`). With it the worker needs no config for the
 * connection — workspace, the page origin it accepts and the port come from here — and it takes only a
 * tab that says hello with `pair` (created per download, kept per device in One; a new download
 * replaces it). Without a preset the worker reads worker.json as before.
 */
export const PRESET_GLOBAL = 'ONE_WORKER_PRESET'
/** The pairing secret: 32 random bytes, base64url. */
export const PAIR_SECRET = /^[A-Za-z0-9_-]{43}$/

export interface WorkerPreset {
  workspace: string
  /** the One site the download came from (the only page origin the worker accepts) */
  origin: string
  port: number
  pair: string
  /** the workspace's name (the setup page's heading) */
  name: string
  /** One runs on a loopback origin (development): any http://localhost / 127.0.0.1 port is accepted too */
  dev?: boolean
  /**
   * A cloud worker (team workspaces): it dials `origin`'s relay with this worker token instead of waiting for a
   * tab on 127.0.0.1 — the local port then serves only its task tools and setup page. `pair` keys the
   * end-to-end encryption between this file and the browser that downloaded it (it never travels).
   */
  cloud?: { token: string }
}

export interface WorkspaceRef {
  id: string
  name: string
  kind: 'local' | 'team'
  readOnly: boolean
}

/** The stage a task is run in, resolved by the tab from Database.pipeline. */
export interface TaskStage {
  /** = the Stage option id */
  id: string
  name: string
  kind: StageKind
  /** the stage's own instructions ('' = the worker's defaults for its kind) */
  instructions: string
  permissionMode: PermissionMode
  /** 1–200; the worker's config may lower it */
  maxTurns: number
  gitAction: GitAction | null
  /**
   * Claude Code's `--model` for this stage (MODEL_NAME): the task's own pick on the device that hands it out, else the
   * stage's. null = the worker's default (the repo's `claude.model` in worker.json, else Claude Code's own). Only
   * stages that run Claude Code carry one, and only a worker whose `can` names 'model' gets one.
   */
  model: string | null
}

/** What the worker gets for one stage of one task. Everything but ids and names is task DATA, never instructions. */
export interface TaskPayload {
  id: string
  title: string
  /** '' = no repository (document stages only: the worker's scratch folder) */
  repo: string
  stage: TaskStage
  /** the task page as Markdown (goal, acceptance criteria, the plan, notes) — what Claude may read of it */
  text: string
  /** the newest rework note for this stage (the person's, or the failing tests' output) */
  rework: string | null
  /** questions Claude asked in this stage and the person's answers */
  answers: Array<{ q: string; a: string }>
  /** the Branch field: a branch to reuse (or the one the worker created) */
  branch: string | null
  /** Cost so far ($) */
  spent: number
  /** the newest summary of an implement stage (the commit message's body) */
  summary: string | null
  /** the newest review document (a doc stage with output 'review') — what a git 'comment' stage posts; older tabs send none */
  review?: string | null
  /** team workspaces: written / confirmed on this device (local workspaces: always) */
  trusted: boolean
}

export type LogKind = 'info' | 'claude' | 'tool' | 'warn' | 'error' | 'git' | 'test' | 'note'
export interface LogLine {
  /** ms since epoch */
  t: number
  k: LogKind
  s: string
  /** the worker's own lines: a message code + its values — One shows them in the person's language (`s` = English) */
  c?: string
  v?: Record<string, string | number>
  /** a tool call that changed a file (Edit / MultiEdit / Write): what changed — the log shows it as a diff */
  e?: ToolEdit
}

/** What an Edit / MultiEdit / Write of Claude Code changed: the file (scrubbed) and old → new per change, clipped. */
export interface ToolEdit {
  path: string
  /** '' old: new text (Write: the whole file) */
  hunks: Array<{ old: string; new: string }>
  /** changes or text were left out (too many / too long) */
  clipped?: boolean
}

/** per edit: at most this many changes, this many characters per side */
export const EDIT_HUNKS = 6
export const EDIT_CHARS = 4000

/** Claude Code's progress in a running stage (sent after every turn). */
export interface TaskProgress {
  turns: number
  maxTurns: number
  /** an estimate from the token counts ($; Claude Code reports the exact cost at the end) — null: unknown model */
  cost: number | null
  model: string | null
}

export interface GitCommit {
  sha: string
  subject: string
  author: string
  at: number
}

export interface GitFile {
  path: string
  /** A added · M modified · D deleted · R renamed · ? untracked · U conflict */
  status: 'A' | 'M' | 'D' | 'R' | '?' | 'U'
  add: number
  del: number
  binary: boolean
  /** unified diff of this file (null: binary, or left out to keep the message small) */
  diff: string | null
  truncated: boolean
}

export interface GitInfo {
  branch: string
  /** "<remote>/<base>" */
  base: string
  /** commits on the branch that the base does not have / the other way round */
  ahead: number
  behind: number
  /** the branch exists on the remote */
  pushed: boolean
  /** local commits not on the remote branch yet */
  unpushed: number
  /** changed files in the worktree (not committed) */
  dirty: number
  commits: GitCommit[]
  files: GitFile[]
  conflicts: string[]
  /** the worker created this branch (cleanup / discard allowed) */
  created: boolean
  /** the branch is merged into the base */
  merged: boolean
  at: number
}

export interface TestResult {
  ok: boolean
  /** the output's tail (paths of this machine replaced) */
  output: string
  ms: number
  code: number | null
  /** no testCommand in worker.json */
  skipped?: boolean
}

export type OutcomeStatus = 'ok' | 'failed' | 'question' | 'stopped' | 'limit' | 'refused'

export interface StageOutcome {
  status: OutcomeStatus
  /** Claude's closing summary / what the git stage did */
  summary?: string
  /** plan stages: the plan (Markdown) */
  plan?: string
  error?: string
  /** $ this stage cost (Claude Code's total_cost_usd) */
  cost?: number
  turns?: number
  /** the question Claude asked (status 'question') */
  question?: string
  /** the branch the task works on */
  branch?: string
  /** pull request or compare URL */
  url?: string
  test?: TestResult
  git?: GitInfo
}

export interface BusyTask {
  taskId: string
  repo: string
  stageId: string
  since: number
}

export interface WorkerRepo {
  name: string
  baseBranch: string
  /** local branch names, newest first (≤ 100; older workers send none) — the task's Branch picker */
  branches?: string[]
  /** the person's own Claude Code MCP servers this repo's stages may use — names only (older workers send none) */
  mcp?: string[]
}

export interface WorkerInfo {
  /** worker version */
  worker: string
  /** how One shows this worker (worker.json "name", default the computer's name) */
  name: string
  repos: WorkerRepo[]
  parallel: number
  busy: BusyTask[]
  /** $ spent today on this machine */
  spentToday: number
  /** the strictest day limit of its repos (null = none) */
  dayLimit: number | null
  claude: { found: boolean; version: string | null }
  /** it has a local setup page (One shows "Change repositories", which sends `open-setup`) */
  setup?: boolean
  /** it came ready-paired from a download in One */
  paired?: boolean
  /** how it reaches One: 127.0.0.1 (local) or the team server's relay (cloud); older workers send none */
  via?: 'local' | 'cloud'
  /** own Claude Code MCP servers of document stages of tasks without a repository — names only (older workers send none) */
  mcp?: string[]
}
/** An MCP server name as Claude Code lists it ("claude mcp list") and worker.json takes it. */
export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/

/** The answer to `open-setup`: the worker opened its setup page on its own screen (One never learns its address). */
export interface OpenSetupResult {
  opened: boolean
  /** off: the worker runs without its setup page (--no-browser) · no-browser: no browser could be opened (the address is in its terminal) */
  reason?: 'off' | 'no-browser'
}

/** An import (task panel → worker): receiving / unpacking / cloning, then the new repository's name — or why not. */
export interface IntakeState {
  state: 'running' | 'done' | 'failed'
  source: 'zip' | 'clone'
  /** the ZIP's file name or the clone address */
  label: string
  line: string
  percent: number | null
  /** done: the repository's name in the worker's config */
  repo?: string
  /** a ZIP: the project name its code suggests */
  suggest?: string
  error?: string
}

/** tab → worker */
export type TabMessage =
  /** `pair`: this device's pairing secret for the workspace (a downloaded worker requires it) */
  | { type: 'hello'; app: 'one'; version: string; workspace: WorkspaceRef; pair?: string }
  | { type: 'status'; workspace: WorkspaceRef }
  /** tasks changed: ask for work now */
  | { type: 'nudge' }
  | { type: 'res'; id: string; ok: true; result: unknown }
  | { type: 'res'; id: string; ok: false; error: string }
  | { type: 'req'; id: string; op: 'stop'; taskId: string }
  | { type: 'req'; id: string; op: 'git'; taskId: string; verb: GitVerb; repo: string; branch: string | null; title: string; message?: string }
  /** "Change repositories": the worker opens its setup page locally (a fixed verb — One can never tick or add a repo) */
  | { type: 'req'; id: string; op: 'open-setup' }
  /**
   * Import stage: the code a task starts from — a ZIP the person picked in the task panel (begin → chunk … → end,
   * base64 pieces of ≤ `chunk` bytes) or a clone address they typed. The worker makes it a NEW repository in its
   * clone folder and adds it to its config; One never names a path.
   */
  | { type: 'req'; id: string; op: 'intake-begin'; taskId: string; name: string; size: number }
  | { type: 'req'; id: string; op: 'intake-chunk'; uploadId: string; data: string }
  | { type: 'req'; id: string; op: 'intake-end'; uploadId: string }
  | { type: 'req'; id: string; op: 'intake-clone'; taskId: string; url: string }

/** Why a worker refused a tab: another workspace · not bound to one · a paired worker got no / another pairing secret. */
export type RefusedReason = 'workspace' | 'unbound' | 'pair'

/* ------------------------------------------------------------------ cloud: the team server's relay */

/**
 * Cloud mode (docs/CODING.md § Cloud worker): the worker dials RELAY_WORKER_PATH with its worker token, the
 * member's tab opens RELAY_TAB_PATH with its session; the server pairs them per (workspace, member). Every
 * TabMessage / WorkerMessage then travels as a `box` (AES-256-GCM; key = HKDF-SHA256(pairing secret, salt =
 * tab nonce ‖ worker nonce, info RELAY_BOX_INFO)) — the server forwards boxes it can neither read nor forge.
 * Only `key` (the two fresh nonces), `box` and the small `relay` control frames below are visible to it.
 */
export const RELAY_TAB_PATH = '/coding/tab'
export const RELAY_WORKER_PATH = '/coding/worker'
/** A cloud worker's token: "onew_" + 32 random bytes base64url (never an API token: those start "one_"). */
export const WORKER_TOKEN = /^onew_[A-Za-z0-9_-]{43}$/
/** The lowest local port a cloud preset uses for its own task tools and setup page — not 47322, so a local worker can run beside it. */
export const WORKER_CLOUD_PORT = 47323

/**
 * The local port of a workspace's cloud worker: WORKER_CLOUD_PORT + 0…499 from its id (FNV-1a) — cloud workers of
 * different workspaces run side by side on one computer; a new download for the same workspace uses the same port
 * (the older worker is stopped first, or ONE_WORKER_PORT picks another).
 */
export function cloudWorkerPort(workspaceId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < workspaceId.length; i++) h = Math.imul(h ^ workspaceId.charCodeAt(i), 0x01000193) >>> 0
  return WORKER_CLOUD_PORT + (h % 500)
}

/** Hosts plain http is allowed on for a cloud link (this computer). */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/** May a cloud worker dial this One origin? https — plain http only on this computer (the worker and the tab check the same). */
export function cloudOriginAllowed(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  } catch {
    return false
  }
}
/** The largest frame the relay forwards: an Import chunk (4 MiB → ~5.6 MB base64 → ~7.5 MB boxed) fits. */
export const RELAY_MAX_FRAME = 8 * 1024 * 1024 + 64 * 1024
/** The largest protocol frame (plain JSON) a side boxes — its box (base64 of the ciphertext) stays below RELAY_MAX_FRAME. */
export const RELAY_MAX_PLAIN = 6 * 1024 * 1024
/** HKDF info of the session key. */
export const RELAY_BOX_INFO = 'one-worker-relay v1'
/** A key-exchange nonce: 32 random bytes, base64url. An AES-GCM iv: 12 random bytes, base64url. */
export const RELAY_NONCE = /^[A-Za-z0-9_-]{43}$/
export const RELAY_IV = /^[A-Za-z0-9_-]{16}$/
/** Relay close codes (besides 4001 replaced / 4003 refused): token revoked or replaced, session ended · not (or no longer) allowed · a tab without a keepalive. */
export const RELAY_CLOSE_AUTH = 4401
export const RELAY_CLOSE_FORBIDDEN = 4403
export const RELAY_CLOSE_IDLE = 4408
/** The codes a worker may ask the relay to close its tab with (after a refusal). */
export const RELAY_CLOSE_TAB_CODES = [4001, 4003, 1008] as const
/** How often a cloud tab tells the relay it is alive (a frozen background tab stops; the relay lets it go after RELAY_TAB_IDLE_MS). */
export const RELAY_ALIVE_MS = 20_000
export const RELAY_TAB_IDLE_MS = 150_000

/** The two nonces of a pairing (`s` = the relay's pairing number, from `worker` / `tab-open`). */
export interface RelayKey {
  type: 'key'
  s: number
  n: string
}
/** One protocol frame, sealed. `seq` rises strictly per direction (AAD "tw:<s>:<seq>" / "wt:<s>:<seq>"); `k: 'e'` = an event the relay may drop under load. */
export interface RelayBox {
  type: 'box'
  s: number
  seq: number
  iv: string
  data: string
  k?: 'e'
}
/** server → tab (cloud), besides the worker's boxes */
export type RelayToTab =
  /** the member's cloud worker: connected? (`token` = its token's id: which download it is; `s` = the pairing) · registered = a live token exists */
  | { type: 'relay'; op: 'worker'; online: boolean; registered: boolean; token: string | null; s: number }
  /** the relay dropped this many of the worker's droppable events (log lines, progress, live git): the worker sent more at once than its budget */
  | { type: 'relay'; op: 'dropped'; n: number }
/** tab → server (cloud) */
export type TabToRelay = { type: 'relay'; op: 'alive' }
/** server → worker (cloud), besides the tab's boxes */
export type RelayToWorker =
  | { type: 'relay'; op: 'ready'; workspace: { id: string; name: string } }
  | { type: 'relay'; op: 'tab-open'; s: number }
  | { type: 'relay'; op: 'tab-gone'; s: number; reason: 'closed' | 'replaced' | 'ended' | 'idle' }
/** worker → server: close the current tab (after a refusal) */
export type WorkerToRelay = { type: 'relay'; op: 'close-tab'; s: number; code: (typeof RELAY_CLOSE_TAB_CODES)[number]; reason: string }

/** worker → tab */
export type WorkerMessage =
  | ({ type: 'welcome' } & WorkerInfo)
  /** `paired`: the worker came ready-paired from a download (its workspace and secret are fixed in the file) */
  | { type: 'refused'; reason: RefusedReason; paired?: boolean }
  | { type: 'status'; busy: BusyTask[]; spentToday: number }
  | {
      type: 'req'
      id: string
      op: 'next'
      repos: string[]
      worker: string
      /** it runs document stages of tasks without a repository too */
      docs?: boolean
      /** what it runs beyond the first protocol (WORKER_CAN) — One never hands an older worker a stage it would misread */
      can?: string[]
    }
  | { type: 'req'; id: string; op: 'heartbeat'; taskIds: string[] }
  /** `finishId`: the same for every retry of one outcome — One applies it once and answers ok again (older workers send none) */
  | { type: 'req'; id: string; op: 'finish'; taskId: string; stageId: string; outcome: StageOutcome; finishId?: string }
  | { type: 'event'; taskId: string; kind: 'log'; lines: LogLine[] }
  | { type: 'event'; taskId: string; kind: 'git'; git: GitInfo }
  | { type: 'event'; taskId: string; kind: 'progress'; progress: TaskProgress }
  | { type: 'event'; taskId: string; kind: 'note' | 'question'; text: string }
  | { type: 'event'; taskId: string; kind: 'intake'; intake: IntakeState }
  | { type: 'res'; id: string; ok: true; result: unknown }
  | { type: 'res'; id: string; ok: false; error: string }

/** The answer to `next`: a claimed task, or none. */
export interface NextResult {
  task: TaskPayload | null
}

/** The answer to a git verb. */
export interface GitResult {
  message: string
  url?: string
  git?: GitInfo
  /** discard / cleanup deleted the task's branch (One clears the Branch field: the next run makes a new one) */
  branchGone?: boolean
}
