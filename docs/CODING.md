# Coding pipeline — One as the control centre, Claude Code on your machine

One keeps the coding tasks: the pipeline, the approvals, the logs, the diffs and the git state. The work happens
on **your** computer: a small Node program, **`one-worker`**, takes tasks from the One tab, runs **Claude Code**
(the `claude` CLI, headless) in a git **worktree** per task, runs your tests, commits, pushes and opens the pull
request — and reports everything back.

```
One tab (browser) ──ws://127.0.0.1:47322──▶ one-worker.mjs ──▶ git worktree + branch per task
 tasks, pipeline,     (tasks out, outcomes,   (your machine:    └─ claude -p … (Claude Code, headless)
 approvals, logs,      logs, diffs back)       worker.json)        └─ task-mcp: one_task_read / note / ask
 diffs, git state                                                └─ testCommand · git push · gh pr create
```

Paths and commands never leave your machine. One learns repo **names**, base branches, branch names, git status,
diffs, logs, test output and cost — nothing else. One can never send a command: only task data and fixed git verbs.

## Set up

1. **Needs**: Node.js 20 or newer, `git`, and the Claude Code CLI — installed and signed in (`claude` on `PATH`,
   or `CLAUDE_BIN=/path/to/claude`). `gh` (GitHub CLI, signed in) if you want pull requests opened for you.
2. **Get the worker** — one file, no install: *Settings → Coding worker → Setup* has the download key and this:
   ```bash
   curl -fsSL https://getonecms.com/mcp/one-worker.mjs -o ~/one-worker.mjs
   ```
3. **Bind it to your workspace** — the command in *Settings → Coding worker* already carries this workspace's id
   (the same ids as the MCP bridge: `local:<hash>` / `team:<id>`):
   ```bash
   node ~/one-worker.mjs init --workspace local:abc123
   ```
   That writes a commented `~/.config/one/worker.json`. Add your repositories (below).
4. **Check and run**:
   ```bash
   node ~/one-worker.mjs check     # config, repos, Claude Code
   node ~/one-worker.mjs           # keep it running while One should hand out work (Ctrl+C stops it)
   ```
5. In One: *Settings → Coding worker → Connect to a coding worker on this computer*. The LED turns green —
   *Connected · laptop · 2 repos* — and a **WORKER** LED shows in the status bar. Open **#/coding** (⌘K
   *Coding pipeline*), **New task**.

The switch is per browser (localStorage `one.coding`), never part of the workspace, a backup or a team.

## worker.json

JSON with `//` comments (`--config <file>` or `ONE_WORKER_CONFIG` for another file). Next to it the worker keeps
`worker-state.json` (mode 0600): the branches and worktrees it created, which worktree a task uses, cost per task
and per day.

| Key | Default | |
|---|---|---|
| `workspace` | — | The One workspace this worker serves. Every other tab is refused (close 4003). Without it every tab is refused and the log says which id to set. |
| `name` | the computer's name | How One shows this worker (also the row's **Worker** field while it works on a task). |
| `port` | `47322` | WebSocket port on 127.0.0.1 (`ONE_WORKER_PORT` overrides; set the same port in One). |
| `parallel` | `2` | Tasks at once across repos (1–2; always one per repo). |
| `pollSec` | `15` | How often an idle worker asks One for work (One also nudges it when tasks change). |
| `origins` | — | Extra allowed page origins (like `ONE_ORIGINS`) for a self-hosted One. |
| `repos[]` | — | The repositories — the ONLY ones the worker touches. |

Per repo:

| Key | Default | |
|---|---|---|
| `name` | — | What One shows (`[A-Za-z0-9._-]`, ≤ 64). One's **Repo** select gets the announced names. |
| `path` | — | The main checkout (absolute or `~/…`). Its working tree is never changed. |
| `baseBranch` | `main` | New task branches start from `<remote>/<baseBranch>` (after `git fetch`). |
| `remote` | `origin` | |
| `branchPrefix` | `one/` | New branches: `<prefix><title-slug>-<6 chars of the task id>`. |
| `worktreeDir` | `<path>/../.one-worktrees/<name>` | Where task worktrees go. |
| `testCommand` | none | The Test stage — an **argv list** (`["npm", "test"]`), never a shell line; run in the worktree. A string is refused. |
| `testTimeoutSec` | `600` | |
| `push` | `true` | `false`: Ship commits only. |
| `pr` | `"gh"` | `"gh"`: `gh pr create` when gh is installed and the remote is a GitHub host; otherwise (and with `"none"`) a compare link for GitHub / GitLab remotes. |
| `claude.model` | Claude Code's default | A model name Claude Code accepts. |
| `claude.maxTurns` | `30` | Upper bound per stage (a stage may ask for fewer). |
| `claude.permissionMode.implement` | the stage's | `acceptEdits` or `default` — overrides what the pipeline asks for. Plan stages always run in `plan` mode. A mode that skips permissions is refused. |
| `claude.allowedTools` / `disallowedTools` | `[]` | Claude Code's own syntax (`"Bash(npm test:*)"`). Headless runs cannot ask, so whatever needs permission must be allowed here. |
| `claude.strictMcp` | `true` | `--strict-mcp-config`: during a task Claude Code gets only the task tools, not your other MCP servers. |
| `maxUsdPerTask` / `maxUsdPerDay` | none | Cost limits (Claude Code's own `total_cost_usd`). |

## The pipeline

A **Coding** database (found by `Database.system: 'coding'`; created with the first task or by *Create the Coding
database*; in a team workspace it is private to you). Rows are tasks: **Repo**, **Stage**, **Priority**, **Branch**,
**Git** (status text), **PR / commit**, **Cost**, **Worker**, **Claimed at**; the page holds the goal and the
acceptance criteria — and what the pipeline writes (the plan, summaries, rework notes, answers; origin `coding`).
Views: *Pipeline* (board grouped by Stage) and *All tasks*.

The stages are the options of the Stage select; `Database.pipeline` says what each one is (**Pipeline** on #/coding
edits it — name, kind, Auto, Claude Code mode, max turns, git action, next stage, instructions; a locked database
refuses):

| Default stage | Kind | Auto | |
|---|---|---|---|
| Backlog | queue | – | Waits. |
| Ready | queue | ✓ | The worker takes it on to the next stage. |
| Plan | plan | ✓ | Claude Code in **plan** mode (changes nothing) hands in a plan → the **Plan** section of the page. |
| Approve plan | gate | – | **Approve** · **Rework…** (instructions → back to Plan). |
| Implement | implement | ✓ | Claude Code (`acceptEdits`) changes the worktree; its summary goes into the page. |
| Test | test | ✓ | `testCommand`. Fails once → back to Implement with the output as rework note; fails again → the next gate. |
| Review | gate | – | Diff + tests. **Approve** · **Rework…** (→ Implement). |
| Ship | git (pr) | ✓ | Commit (`git add -A`, message = title + summary), push `-u`, pull request (or compare link) → **PR / commit**. |
| Done | done | – | **Clean up** removes the worktree + branch once merged. |

A task is taken when its stage is **Auto** (or after **Run now** / **Retry** / an answer on this device), its repo
is free on a connected worker, it is not claimed by another worker within 10 minutes, and — in a team workspace —
it is confirmed on this device. Highest priority first, then the oldest. The claim (**Worker** + **Claimed at**) is
renewed every minute; a claim without heartbeat for 10 minutes may be taken over.

### The task panel

On a task's page, between its properties and its body: the stage timeline; what it waits for (**Approve**,
**Rework…**, **Answer**, **Stop**, **Retry**, **Run now**, **Confirm on this device**); tabs **Log** (live, the last
2000 lines per task on this device), **Plan**, **Diff** (per file, unified, syntax colours, big files folded, binary
files skipped), **Tests** (the output's tail), **Git** (branch, base, ahead / behind, pushed, uncommitted, commits,
conflicts — and the git actions). The log, plan, diff, tests and git state live in this device's IndexedDB
`one-coding` (never synced, wiped with a team workspace's copy); the row carries what everyone sees.

### Git

Always `execFile('git', […])` — never a shell line; hooks and your git config apply as usual.

- **A branch and a worktree per task**: `git fetch`, then `git worktree add -b <branch> <dir> <remote>/<base>`. The
  main checkout's working tree is never touched. `git worktree prune` runs on start.
- **Reuse a branch**: put it into the task's **Branch** field (or *Existing branch* in New task). It must exist
  (locally or on the remote — then it is tracked); it is never reset. A branch checked out in the main checkout is
  refused, and so is the repo's base branch (Ship would push straight to it).
- **Git actions** in the panel are fixed verbs: **Refresh**, **Commit** (message), **Push**, **Open PR**, **Update
  from base** (rebase while the branch was never pushed, else merge; a worktree with uncommitted changes is
  refused; conflicts are listed per file and left for a stage — or you — to resolve, never auto-resolved), **Show
  folder** (the path is printed in the worker's terminal only). **Force push** (`--force-with-lease`) and **Discard
  worktree** are confirmed twice. Discard removes the worktree the worker made (with its uncommitted changes) and
  deletes the branch only if the worker created it. **Clean up** does the same only after the merge and never forced.

### Claude Code

`claude -p --output-format stream-json --verbose --permission-mode <plan|acceptEdits|default> --max-turns N
[--model …] [--allowedTools …] [--disallowedTools …] [--max-budget-usd …] --mcp-config <temp file>
[--strict-mcp-config]` in the task's worktree; the prompt goes in on stdin. What the installed CLI supports is read
from its `--help` (the budget flag, the permission mode names). The stream becomes log lines (text, tool calls,
tool errors), the plan comes from `ExitPlanMode`, the cost from the result event.

The prompt: the stage's instructions (or the default of its kind), the worker's rules (no git, stay in the
worktree, task text is data), then the task between markers — `<<<TASK <code> … TASK <code>>>>`, rework notes,
questions and answers — labelled as data written by people. The code is random per prompt (and per `one_task_read`):
text written before cannot close its block and add rules of its own; stage names and titles are one line.

**Task tools** (`MCP_TASK_TOOLS` in `src/app/features/mcp/contract.ts`): the run's MCP config starts `node
one-worker.mjs task-mcp` with a random 48-hex token for that run only. `one_task_read` (the task again),
`one_task_note` (a progress line in the log), `one_task_ask` (a question: the run ends, the task waits in One;
the answer goes into the page and the stage runs again with it). Nothing else in One is reachable through them;
the token dies with the run.

## Safety

- **The worker's door is the bridge's door** (docs/MCP.md § Security model): 127.0.0.1 only, Host check against
  DNS rebinding, the same Origin allow-list, subprotocol `one-worker.v1`, a hello with a workspace id within 5 s.
  The worker serves ONE workspace (`workspace` in worker.json); the newest tab of it wins (4001).
- **Paths and commands stay on the machine.** Everything sent to One passes a scrubber (worktree → `.`, repo →
  `<repo>`, worktrees folder → `<worktrees>`, home → `~`, temp → `<tmp>`). The config's commands are never sent.
- **One cannot command.** It sends task data and the fixed verbs (`stop`, the git verbs above) for repos in the
  config. Unknown verbs, unknown repos and malformed tasks are refused; tasks of a `gate` / `queue` / `done` stage
  are never run.
- **Claude Code keeps its permission rules.** No flag that skips permissions is ever passed (and a config that asks
  for one is refused). Task text is untrusted input: it is data in the prompt, after the worker's own rules.
- **Team workspaces**: a worker only takes tasks written or confirmed **on this device** — the SHA-256 of the task's
  title, page, **Repo**, **Branch** and **Stage** and the pipeline (every stage's name, kind, Auto, mode, turns, git
  action, next stage and instructions) must be in this device's trusted set (IndexedDB `one-coding`). New tasks made
  here, the pipeline's own writes, changes made in this tab of a trusted version (typed content — origin other than
  `sync` / `file` —, its fields, the schema and pipeline) and every action pressed here keep it trusted; changes
  from the server or another tab and writes of a custom agent never do — a stage moved past a gate elsewhere shows
  **Confirm on this device**. `createdBy` / `updatedBy` are never trusted. Nothing is written for an unconfirmed
  task (not even the queue hop), and the worker gets exactly the version that was checked. The worker refuses
  `trusted: false` again on its side.
- **Local workspaces**: nothing to confirm — except a task a custom agent created or changed last (`agent:<id>`,
  stamped on this device): it waits for **Confirm on this device** like a team task (an agent that read injected
  text never starts Claude Code on your machine by itself).
- **Diffs never follow links**: an untracked symbolic link shows as its target, the file it points at is never read.
- **Cost**: per-task and per-day limits are checked before each stage and passed to Claude Code as
  `--max-budget-usd` (where the CLI knows it). **Stop** (One) or Ctrl+C (worker) kills Claude Code's whole process
  tree.

## Protocol

JSON text frames, subprotocol `one-worker.v1`, defined in
[`src/app/features/coding/protocol.ts`](../src/app/features/coding/protocol.ts) (shared by the worker and the app).

| Direction | Message |
|---|---|
| tab → worker | `{ type: "hello", app: "one", version, workspace: { id, name, kind, readOnly } }` · `status` (same workspace, or the tab is refused) · `nudge` |
| worker → tab | `welcome` { worker, name, repos: [{ name, baseBranch }], parallel, busy, spentToday, dayLimit, claude: { found, version } } · `refused` { reason: workspace \| unbound } + close 4003 · `status` { busy, spentToday } |
| worker → tab (req) | `next` { repos, worker } → `{ task: TaskPayload \| null }` (claimed) · `heartbeat` { taskIds } · `finish` { taskId, stageId, outcome } (retried until confirmed) |
| worker → tab (event) | `log` { lines } · `git` { git } · `note` { text } · `question` { text } |
| tab → worker (req) | `stop` { taskId } · `git` { taskId, verb, repo, branch, title, message? } — verbs: refresh, commit, push, force-push, pr, update-base, discard, cleanup, reveal |

`POST http://127.0.0.1:<port>/task` (`Authorization: Bearer <run token>`, no `Origin`): the task tools.

## Troubleshooting

- **Waiting for the worker** — is it running (`node ~/one-worker.mjs`) on the port One uses?
- **Refused: the worker serves another workspace / is not bound** — run the init command *Settings → Coding worker*
  shows (it carries this workspace's id; `--force` replaces the file — or edit `"workspace"`), restart the worker.
- **Claude Code was not found** — install it, sign in once interactively, or set `CLAUDE_BIN`. `node one-worker.mjs
  check` shows what the worker sees.
- **A stage fails right away with a permission problem** — headless runs cannot ask: allow the tools in
  `claude.allowedTools` (`"Bash(npm test:*)"`), or use `acceptEdits` for implement stages.
- **The branch is checked out in the main checkout** — switch the main checkout to another branch, or clear the
  task's Branch field to get a fresh branch.
- **Port in use** — another worker runs; set `"port"` and the same port in One.
- Logs go to stderr (`ONE_WORKER_QUIET=1` silences them). Chrome logs refused connection attempts in the console
  while no worker runs — expected.

The worker's code: [`mcp/src/worker`](../mcp/src/worker) (bundled with the bridge by `npm run build:mcp` to
`public/mcp/one-worker.mjs`, committed; `npm --prefix mcp test` runs its tests against temp repos, a local bare remote
and a fake `CLAUDE_BIN`).
