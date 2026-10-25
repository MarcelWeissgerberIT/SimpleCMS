import type { WorkerTextRequest, WorkerMcpRequest } from '../../../shared/ai/worker.ts'
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

export const CODING_AGENTS = ['claude', 'codex', 'local', 'minimax', 'ollama', 'copilot'] as const
export type CodingAgent = (typeof CODING_AGENTS)[number]
export const isCodingAgent = (v: unknown): v is CodingAgent => (CODING_AGENTS as readonly unknown[]).includes(v)

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
 * Code with another model than the one picked. 'ship' (git stages and keys return a ShipRecord — nothing is handed out
 * by it: an older worker's git stages run as before and One writes their summary). worker 1.11.0: 'continue' (a stage
 * that stopped at its step limit runs on from its worktree with TaskPayload.resume — One offers "Continue" only to a
 * worker that names it) and 'permission' (Claude Code's permission prompts come to One as PermissionAsk; the person
 * answers with a PermissionVerb).
 */
export const WORKER_CAN = ['data-flow', 'shared-models', 'source-review', 'copilot-options', 'text-models', 'copilot-chat', 'copilot-media', 'analyze', 'git:comment', 'git:merge', 'doc', 'model', 'mcp-list', 'ship', 'continue', 'permission', 'agent:codex', 'agent:local', 'agent:minimax', 'agent:ollama', 'agent:copilot', 'delivery-qa', 'harness-quality', 'personal-secrets'] as const
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
 * Capabilities no stage waits for ('ship': the ship note with links · 'continue': Continue after the step limit ·
 * 'permission': permission prompts in One) — a worker without them runs every stage as before.
 */
export const WORKER_EXTRAS: readonly string[] = ['ship', 'continue', 'permission', 'personal-secrets']
/**
 * An outdated worker that lacks only WORKER_EXTRAS (1.9.0 without 'ship'): it skips nothing — the #/coding plate says
 * what the newer one adds instead of "skips stages it does not know".
 */
export function workerLacksOnlyExtras(can: readonly string[] | null): boolean {
  if (!can) return false
  const has = workerCan(can)
  const lacks = WORKER_CAN.filter((c) => !has.has(c))
  return lacks.length > 0 && lacks.every((c) => WORKER_EXTRAS.includes(c))
}
/** The extras an outdated worker does not name (WORKER_EXTRAS order) — what the newer one adds. */
export function lackingExtras(can: readonly string[] | null): string[] {
  if (!can) return []
  const has = workerCan(can)
  return WORKER_EXTRAS.filter((c) => !has.has(c))
}
/**
 * The first worker without the ZIP-import gap: up to 1.8.0 an imported ZIP could plant a `.git` (spelled `.GIT`,
 * `.Git` … on a case-insensitive disk — macOS, Windows) whose core.fsmonitor or hooks ran during the import's git
 * steps. 1.8.0 names every capability, so `workerOutdated` never caught it: the version it reports does.
 */
export const WORKER_SAFE = '1.8.1'
/**
 * The first version with the ZIP import (and clones) on the setup page — older workers have no such gap. 1.3.1 was
 * built both before and after the import came; it counts in: a notice too many beats a gap nobody is told about.
 */
export const WORKER_IMPORT_SINCE = '1.3.1'
/** "1.8.0", "v1.10.2", "1.8.1-rc.1+abc" → numeric parts + pre-release; anything else (missing, "dev", "1.x") → null. */
function parseVersion(v: unknown): { parts: number[]; pre: boolean } | null {
  if (typeof v !== 'string' || v.length > 64) return null
  const m = /^v?(\d+(?:\.\d+){0,3})(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return null
  const parts = m[1]!.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) return null
  return { parts, pre: !!m[2] }
}
/** Numeric, part by part ("1.10.0" > "1.9.9"; missing parts are 0); a pre-release ranks below its release (semver). */
function compareVersions(a: { parts: number[]; pre: boolean }, b: { parts: number[]; pre: boolean }): number {
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
    const d = (a.parts[i] ?? 0) - (b.parts[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return a.pre === b.pre ? 0 : a.pre ? -1 : 1
}
/**
 * A worker with the ZIP-import gap (WORKER_IMPORT_SINCE ≤ version < WORKER_SAFE), read from the version its welcome
 * names (`WorkerInfo.worker` — local and through the relay alike). A version One cannot read is never flagged: every
 * published worker sends its package version; "dev" is a worker run from source, and garbage names nothing One could
 * honestly put in "This worker (…) has a security gap" — a notice that cries wolf gets ignored. Such a worker is still
 * named by `workerOutdated` when it lacks a capability.
 */
export function workerUnsafe(version: string | null | undefined): boolean {
  const v = parseVersion(version)
  if (!v) return false
  return compareVersions(v, parseVersion(WORKER_IMPORT_SINCE)!) >= 0 && compareVersions(v, parseVersion(WORKER_SAFE)!) < 0
}
/**
 * The capabilities a stage needs ([]: every worker runs it). `model` = the model the stage runs with (the task's own
 * pick on this device, else the stage's): a worker that does not name 'model' would ignore it.
 */
export function stageNeeds(stage: { kind: string; gitAction?: string | null; model?: string | null; agent?: CodingAgent }): string[] {
  const needs: string[] = []
  if (stage.kind === 'analyze') needs.push('analyze')
  if (stage.kind === 'doc') needs.push('doc')
  if (stage.kind === 'git' && (stage.gitAction === 'comment' || stage.gitAction === 'merge')) needs.push(`git:${stage.gitAction}`)
  if (stage.model && claudeRuns(stage.kind)) needs.push('model')
  if (claudeRuns(stage.kind) && stage.agent && stage.agent !== 'claude') needs.push(`agent:${stage.agent}`)
  if (claudeRuns(stage.kind) && stage.agent === 'copilot') needs.push('copilot-options')
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

/* ------------------------------------------------------------------ the ship log (worker 1.10.0) */

/** worker 1.10.0: every commit message and merge / pull request body ends with "One-Task: <task id>" (built as text, never by git's trailer machinery). */
export const SHIP_TRAILER = 'One-Task'

/** A repository host the worker knows: web links and merge / pull requests (gh · glab). */
export const FORGES = ['github', 'gitlab'] as const
export type Forge = (typeof FORGES)[number]
/** worker.json "forge" per repo: 'auto' = by the remote's host name ("github" / "gitlab" in it), else that forge (a self-hosted GitLab, GitHub Enterprise). */
export const FORGE_SETTINGS = ['auto', 'github', 'gitlab'] as const
export type ForgeSetting = (typeof FORGE_SETTINGS)[number]

/**
 * A repository's web address: scheme + host (+ the port of an http(s) remote) + project path — e.g.
 * "https://gitlab.example.test/nordlicht/website". Never credentials, a query, a fragment or a local path.
 */
export interface ForgeWeb {
  base: string
  forge: Forge
}

const WEB_BASE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9_.-]+){2,}$/

/** A ForgeWeb as One and the worker accept it (null: anything else) — the one rule for both sides. */
export function cleanWeb(raw: unknown): ForgeWeb | null {
  if (!raw || typeof raw !== 'object') return null
  const { base, forge } = raw as Record<string, unknown>
  if (typeof base !== 'string' || base.length > 300 || !WEB_BASE.test(base)) return null
  if (base.split('/').slice(3).some((seg) => seg === '.' || seg === '..')) return null
  return forge === 'github' || forge === 'gitlab' ? { base, forge } : null
}

/** A git object id (sha-1 or sha-256). */
export const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

const encPath = (s: string) => s.split('/').map(encodeURIComponent).join('/')
/** GitHub: <base>/commit/<sha> · GitLab: <base>/-/commit/<sha> */
export const commitUrl = (web: ForgeWeb, sha: string): string => `${web.base}${web.forge === 'gitlab' ? '/-' : ''}/commit/${sha}`
/** GitHub: <base>/tree/<branch> · GitLab: <base>/-/tree/<branch> (each path part encoded, "/" kept) */
export const branchUrl = (web: ForgeWeb, branch: string): string => `${web.base}${web.forge === 'gitlab' ? '/-' : ''}/tree/${encPath(branch)}`
/** A merge / pull request's number from its address: ".../-/merge_requests/42" → mr 42 · ".../pull/7" → pr 7; else null (a compare / new-request link). */
export function requestNumber(url: string): { kind: 'mr' | 'pr'; n: number } | null {
  const mr = /\/-\/merge_requests\/(\d{1,9})(?:[/?#]|$)/.exec(url)
  if (mr) return { kind: 'mr', n: Number(mr[1]) }
  const pr = /\/pull\/(\d{1,9})(?:[/?#]|$)/.exec(url)
  return pr ? { kind: 'pr', n: Number(pr[1]) } : null
}

/** What a ship record says a step did with the merge / pull request. */
export const SHIP_ACTIONS = ['commit', 'push', 'force-push', 'pr', 'comment', 'merge'] as const
export type ShipAction = (typeof SHIP_ACTIONS)[number]
export const SHIP_REQUEST = ['opened', 'existing', 'link', 'commented', 'merged'] as const
export type ShipRequestHow = (typeof SHIP_REQUEST)[number]

/**
 * worker 1.10.0 ('ship'): what a git stage or a git key did with commits, the push and the merge / pull request —
 * One writes it into the task page as one dated, linked line in the person's language (coding/ship.ts). Data only:
 * ids, names, the repo's web address and the request's address — never a local path, a command or a credential.
 */
export interface ShipRecord {
  /** the stage's git action, or the key's verb ('force-push' only from a key) */
  action: ShipAction
  /** a pipeline stage or a key in the task panel's Git tab */
  from: 'stage' | 'key'
  /** when the worker finished the step (ms) */
  at: number
  /** the task's branch */
  branch: string
  /** the commit this step made; null: nothing new to commit, or a step that commits nothing (push · comment · merge) */
  commit: { sha: string } | null
  /** HEAD of the branch after the step — what was pushed / merged (null: unknown) */
  head: string | null
  /** pushed to this remote (the branch keeps its name there); null: not pushed */
  pushed: { remote: string; force?: true } | null
  /** the stage wanted to push, worker.json "push": false */
  pushOff?: true
  /**
   * the merge / pull request: its address on the host (from gh / glab) — or, how 'link', the compare / new-request link
   * to create one. null: none (not asked for, "pr": "none" on an unknown host, or it failed: see `failed`)
   */
  request: { url: string; how: ShipRequestHow } | null
  /** the repository's web address and forge (cleanWeb); null: not a GitHub / GitLab address the worker knows — no links */
  web: ForgeWeb | null
  /** a step after the commit failed (status 'failed' of a stage; GitResult.error of a key); the commit / push before it stays recorded */
  failed?: { step: 'push' | 'request'; code?: 'pushRejected' }
}

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
  /** Same-origin release bundle; update preserves the existing pairing. */
  updateUrl?: string;
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
  copilot?: import('../../../shared/copilot').CopilotChoice
  copilotSource?: 'task' | 'role' | 'worker'
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
  /** Snapshot of explicit destinations, checked again by the worker. Never prompt text. */
  dataFlow?: import('../../../shared/ai/dataFlow.ts').DataFlowRules
  /** Ephemeral, explicitly granted by this person. Never persisted or included in prompts. */
  personalMcp?: import('../../../shared/personalVault').PersonalConnection[]
  /** Confirmed work-order acceptance, separate from model-authored page text. */
  quality?: { review: boolean; requirements: string[]; acceptance: string[]; repair?: import('../../../shared/coding/repair').RepairPolicy; packages?: Array<{ id: string; title: string; requirements: string[] }>; remainingUsd?: number }
  /** Missing: historical Claude Code default. Unknown explicit choices are refused. */
  agent?: CodingAgent
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
  /**
   * worker 1.11.0 ('continue'): this stage's previous run stopped at its step limit (`turns` of `max`) and the person
   * pressed Continue — the worker runs it again on the same worktree and tells Claude Code to go on from there. Only
   * plan / implement / doc stages; null / absent: a run from the start.
   */
  resume?: { turns: number; max: number } | null
  /** team workspaces: written / confirmed on this device (local workspaces: always) */
  trusted: boolean
}

/* ------------------------------------------------------------------ worker 1.11.0: permissions, step limit */

/**
 * How long the worker holds Claude Code's tool call while One asks the person ('permission'): then it is refused, with a
 * message to Claude Code. ONE_WORKER_PERMISSION_MS shortens it (tests).
 */
export const PERMISSION_WAIT_MS = 15 * 60_000

/**
 * The person's answer to a permission request — the ONLY thing One sends back (with the request's id): allow once ·
 * always allow it for this repo (the worker writes the rule it showed into its own worker.json) · refuse. Never a
 * command, a pattern or a path.
 */
export const PERMISSION_VERBS = ['once', 'always', 'deny'] as const
export type PermissionVerb = (typeof PERMISSION_VERBS)[number]

/** What kind of action Claude Code asks for (One names it in the person's language). */
export const PERMISSION_KINDS = ['bash', 'read', 'edit', 'web', 'mcp', 'other'] as const
export type PermissionKind = (typeof PERMISSION_KINDS)[number]

/**
 * worker 1.11.0 ('permission'): Claude Code needs a permission it does not have (`--permission-prompt-tool` → the task
 * tools' one_task_permission). The worker decides by the repo's own lists first (worker.json allowedTools /
 * disallowedTools); otherwise it holds the tool call (≤ PERMISSION_WAIT_MS) and One asks the person on the worker's
 * tab. Every text is the worker's scrubbed text (no path of this computer), clipped.
 */
export interface PermissionAsk {
  /** the request (24 hex) — One answers with it and a verb */
  id: string
  /** Claude Code's tool name ("Bash", "Read", "mcp__kb__search") */
  tool: string
  kind: PermissionKind
  /** what it wants: the command, the file, the address (scrubbed, ≤ PERMISSION_WHAT_MAX) */
  what: string
  /** a file outside the repository and the task's scratch folder (Read / Edit tools) */
  outside?: boolean
  /** what "Always for this repo" adds to the repo's allowedTools in worker.json — null: only "Once" (a broad or unsafe rule) */
  rule: string | null
  /** the repository the rule would be stored for */
  repo: string
  /** asked at, and when the worker refuses it on its own (ms) */
  at: number
  until: number
}

/**
 * What of a tool's input the worker judges and One shows (its command, file, address — an MCP tool's whole input as
 * JSON): each field whole up to PERMISSION_FIELD_MAX characters. A longer one is never cut and judged: the request is
 * refused at once (taskmcp.ts and the worker both), so nothing is allowed that nobody saw whole.
 */
export const PERMISSION_FIELD_MAX = 4000
/** The request's text as One shows it (scrubbed; a little room for the scrubber's names) — longer: refused, never cut. */
export const PERMISSION_WHAT_MAX = 4500

const ASK_ID = /^[a-f0-9]{24}$/
const clipText = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, n) : '')

/** A PermissionAsk as One and the worker accept it (null: anything else) — the one rule for both sides. */
export function cleanAsk(raw: unknown): PermissionAsk | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (typeof a.id !== 'string' || !ASK_ID.test(a.id)) return null
  const tool = clipText(a.tool, 120).trim()
  if (!tool) return null
  const kind = (PERMISSION_KINDS as readonly string[]).includes(String(a.kind)) ? (a.kind as PermissionKind) : 'other'
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  const rule = typeof a.rule === 'string' && a.rule.trim() ? clipText(a.rule, 300).trim() : null
  return { id: a.id, tool, kind, what: clipText(a.what, PERMISSION_WHAT_MAX), ...(a.outside === true ? { outside: true } : {}), rule, repo: clipText(a.repo, 64), at: num(a.at), until: num(a.until) }
}

/**
 * A stage's permission requests: asked (the person was asked) · allowed (by the person or the repo's allowedTools) ·
 * refused (by the person, the repo's disallowedTools, the time limit, Stop — or Claude Code itself, when it could not ask).
 */
export interface PermissionCount {
  asked: number
  allowed: number
  refused: number
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
  /**
   * worker 1.10.0: the commit is on the remote task branch (pushed) — the Git tab links only these. Per commit, never by
   * position: after Update from base merged commits pushed from elsewhere, local and pushed ones interleave by date.
   * Absent / false: only on this computer, or not known (no link).
   */
  remote?: boolean
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
  /** worker 1.10.0: the repo's web address (cleanWeb) — the Git tab links commits and the branch; null / absent: none */
  web?: ForgeWeb | null
}

export interface TestResult {
  /** Actual host execution only; absent for legacy/skipped/not-started checks. Never inferred from model text. */
  execution?: { command:string[]; commit:string|null; dirty:boolean; changedDuring:boolean; platform:string; startedAt:number; finishedAt:number }

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
  copilotReceipts?: import('../../../shared/copilot').CopilotReceipt[]
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
  repairs?: Array<{ attempt: number; packageIds: string[]; finding: string; outcome: string }>
  git?: GitInfo
  /** worker 1.10.0: git stages (commit · push · pr · comment · merge) — also on a 'failed' outcome after the commit */
  ship?: ShipRecord
  /** worker 1.11.0: Claude Code stopped at the stage's step limit ('failed' — One offers Continue) */
  stepLimit?: { turns: number; max: number }
  /** worker 1.11.0: the stage's permission requests (only when there were any) */
  permissions?: PermissionCount
}

export interface BusyTask {
  taskId: string
  repo: string
  stageId: string
  since: number
  /** worker 1.11.0: the permission request the stage waits for (the first one; more follow when it is answered) */
  ask?: PermissionAsk | null
}

export interface WorkerRepo {
  name: string
  baseBranch: string
  /** local branch names, newest first (≤ 100; older workers send none) — the task's Branch picker */
  branches?: string[]
  /** the person's own Claude Code MCP servers this repo's stages may use — names only (older workers send none) */
  mcp?: string[]
  /** worker.json "push" for this repo (older workers send none: One warns about nothing) */
  push?: boolean
  /** worker.json "pr" for this repo ("none": no gh / glab — a compare link only; posting a review / merging fail) */
  pr?: 'gh' | 'none'
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
  /** Multiple explicitly granted workspace contexts share this device's model/MCP configuration. */
  multiWorkspace?: boolean
  managed?: boolean
  personalSecrets?: boolean
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
  /** `can`: what this tab handles beyond the first protocol (TAB_CAN; older tabs send none) */
  | { type: 'hello'; app: 'one'; version: string; workspace: WorkspaceRef; pair?: string; can?: string[]; authorizeWorkspace?: { nonce: string; signature: string } }
  | { type: 'status'; workspace: WorkspaceRef }
  /** tasks changed: ask for work now */
  | { type: 'nudge' }
  | { type: 'res'; id: string; ok: true; result: unknown }
  | { type: 'res'; id: string; ok: false; error: string }
  | { type: 'req'; id: string; op: 'stop'; taskId: string }
  | { type: 'req'; id: string; op: 'git'; taskId: string; verb: GitVerb; repo: string; branch: string | null; title: string; message?: string }
  /** "Change repositories": the worker opens its setup page locally (a fixed verb — One can never tick or add a repo) */
  | { type: 'req'; id: string; op: 'open-setup' }
  | { type: 'req'; id: string; op: 'worker-manage'; action: 'status' | 'update' | 'rollback' | 'cancel' }
  | { type: 'req'; id: string; op: 'model-share-status' }
  | { type: 'req'; id: string; op: 'model-share-config'; choice: {model:string;label:string;enabled:boolean} }
  | { type: 'req'; id: string; op: 'text-models' }
  | { type: 'req'; id: string; op: 'model-mcp'; requestId: string; request: WorkerMcpRequest }
  | { type: 'req'; id: string; op: 'text-request'; requestId: string; request: WorkerTextRequest }
  | { type: 'req'; id: string; op: 'text-stop'; requestId: string }
  /**
   * Import stage: the code a task starts from — a ZIP the person picked in the task panel (begin → chunk … → end,
   * base64 pieces of ≤ `chunk` bytes) or a clone address they typed. The worker makes it a NEW repository in its
   * clone folder and adds it to its config; One never names a path.
   */
  | { type: 'req'; id: string; op: 'intake-begin'; taskId: string; name: string; size: number }
  | { type: 'req'; id: string; op: 'intake-chunk'; uploadId: string; data: string }
  | { type: 'req'; id: string; op: 'intake-end'; uploadId: string }
  | { type: 'req'; id: string; op: 'intake-clone'; taskId: string; url: string }
  /** worker 1.11.0: the person's answer to a permission request — its id and a fixed verb, nothing else */
  | { type: 'req'; id: string; op: 'permission'; taskId: string; ask: string; verb: PermissionVerb }

/**
 * What a One tab handles beyond the first protocol, sent in its hello (`can`): 'permission' — it shows a PermissionAsk and
 * answers it. A worker asks the person only while a tab that says so is connected; otherwise it refuses at once (an
 * older tab never shows the request — the stage would wait for nothing).
 */
export const TAB_CAN = ['permission'] as const

/** How a permission request ended: the person's verb · the time limit · Stop / the run's end · One went away (no tab that answers). */
export type PermissionEnd = PermissionVerb | 'timeout' | 'stopped' | 'away'

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
  | { type: 'refused'; reason: RefusedReason; paired?: boolean; workspaceGrant?: boolean; workspaceOwner?: string; workspaceNonce?: string }
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
  /**
   * worker 1.11.0: a permission request the stage waits for (`ask`) — or, `ask: null`, none any more; `settled` says how
   * the last one ended (answered here, at the time limit, by Stop, or One went away). The status's `busy` carries the
   * open one too (a tab that connects later sees it).
   */
  | { type: 'event'; taskId: string; kind: 'permission'; ask: PermissionAsk | null; settled?: { id: string; how: PermissionEnd } }
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
  /** worker 1.10.0: what the key did (commit · push · force-push · pr · comment-pr · merge-pr) */
  ship?: ShipRecord
  /** worker 1.10.0, key 'pr' only: the push went through but the request could not be opened — One shows this as an error and still records the push (`message` says both, in English, for older apps) */
  error?: string
}

/* ------------------------------------------------------------------ the Outbox: exactly the reviewed bytes */

/**
 * Canonical JSON (the Outbox's `argsHash = sha256(canonicalJson(args))`, the same in tab and worker): object keys
 * sorted by code unit, no whitespace, strings exactly as JSON.stringify writes them, arrays in order. `undefined`
 * members are left out (as JSON does); a non-finite number, a function or a cycle throws — never hashed silently.
 */
export function canonicalJson(v: unknown): string {
  const seen: unknown[] = []
  const walk = (x: unknown): string => {
    if (x === null) return 'null'
    if (typeof x === 'string' || typeof x === 'boolean') return JSON.stringify(x)
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) throw new Error('canonicalJson: a non-finite number')
      return JSON.stringify(x)
    }
    if (typeof x !== 'object') throw new Error(`canonicalJson: ${typeof x}`)
    if (seen.includes(x)) throw new Error('canonicalJson: a cycle')
    seen.push(x)
    let out: string
    if (Array.isArray(x)) out = `[${x.map((e) => (e === undefined ? 'null' : walk(e))).join(',')}]`
    else {
      const o = x as Record<string, unknown>
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      out = `{${keys.map((k) => `${JSON.stringify(k)}:${walk(o[k])}`).join(',')}}`
    }
    seen.pop()
    return out
  }
  return walk(v)
}
