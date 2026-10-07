/**
 * Coding pipeline — the shared contract of `one-worker` (mcp/src/worker, bundled to public/mcp/one-worker.mjs)
 * and the app (features/coding). Pure data, no imports: the worker bundles this file as it is, so the
 * tab ⇄ worker protocol is defined exactly once.
 *
 * One (the browser tab) keeps the tasks, the pipeline, approvals, logs and diffs. The worker runs on the
 * person's machine: it owns the repositories (paths and commands never leave the machine), runs git and
 * Claude Code there, and talks to the tab over ws://127.0.0.1:<port> — origin allow-list, host check and
 * workspace binding exactly like the MCP bridge (docs/MCP.md § Security model, docs/CODING.md).
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
 */
export const STAGE_KINDS = ['queue', 'import', 'plan', 'doc', 'gate', 'implement', 'test', 'git', 'done'] as const
export type StageKind = (typeof STAGE_KINDS)[number]
/** Claude Code permission modes a stage may ask for — never one that skips permissions. */
export const PERMISSION_MODES = ['plan', 'acceptEdits', 'default'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]
/** What a git stage does: commit · commit + push · commit + push + pull request · merge the base in. */
export const GIT_ACTIONS = ['commit', 'push', 'pr', 'update-base'] as const
export type GitAction = (typeof GIT_ACTIONS)[number]
/**
 * The person's git actions in One — fixed verbs the worker maps to its own commands. "reveal" only prints
 * the worktree's path in the worker's terminal (it never comes to One); "discard" and "force-push" are
 * double-confirmed in One; "discard" / "cleanup" touch only branches and worktrees the worker created.
 */
export const GIT_VERBS = ['refresh', 'commit', 'push', 'force-push', 'pr', 'update-base', 'discard', 'cleanup', 'reveal'] as const
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
}

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
}

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

/** worker → tab */
export type WorkerMessage =
  | ({ type: 'welcome' } & WorkerInfo)
  /** `paired`: the worker came ready-paired from a download (its workspace and secret are fixed in the file) */
  | { type: 'refused'; reason: RefusedReason; paired?: boolean }
  | { type: 'status'; busy: BusyTask[]; spentToday: number }
  | { type: 'req'; id: string; op: 'next'; repos: string[]; worker: string; /** it runs document stages of tasks without a repository too */ docs?: boolean }
  | { type: 'req'; id: string; op: 'heartbeat'; taskIds: string[] }
  | { type: 'req'; id: string; op: 'finish'; taskId: string; stageId: string; outcome: StageOutcome }
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
