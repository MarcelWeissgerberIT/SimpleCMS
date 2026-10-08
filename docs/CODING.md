# Coding pipeline — One as the control centre, Claude Code on your machine

One keeps the coding tasks: the pipeline, the approvals, the logs, the diffs and the git state. The work happens
on **your** computer: a small Node program, **`one-worker`**, takes tasks from the One tab, runs **Claude Code**
(the `claude` CLI, headless) in a git **worktree** per task, runs your tests, commits, pushes and opens the pull
request — and reports everything back.

```
One tab (browser) ──ws://127.0.0.1:47322──▶ one-worker.mjs ──▶ git worktree + branch per task
 tasks, pipeline,     (tasks out, outcomes,   (your machine:    └─ claude -p … (Claude Code, headless)
 approvals, logs,      logs, diffs back)       worker.json)        └─ task-mcp: one_task_read / note / ask
 diffs, git state                                  │             └─ testCommand · git push · gh pr create
                                                   └─ http://127.0.0.1:47322/setup — tick the repos (local only)
```

Paths and commands never leave your machine. One learns repo **names**, base branches, branch names, git status,
diffs, logs, test output and cost — nothing else. One can never send a command: only task data and fixed git verbs.

## Set up — three steps

**Needs**: Node.js 20 or newer, `git`, and the Claude Code CLI — installed and signed in (`claude` on `PATH`, or
`CLAUDE_BIN=/path/to/claude`). `gh` (GitHub CLI, signed in) if you want pull requests opened for you.

*Settings → Coding worker* (and **#/coding** while no worker with repos is connected) shows one card:

1. **Download the worker for this workspace.** One builds the file in the browser: the site's own
   `mcp/one-worker.mjs` with one line written right after the shebang —
   ```js
   globalThis.ONE_WORKER_PRESET = {"workspace":"local:abc123","origin":"https://getonecms.com","port":47322,"pair":"<32 random bytes, base64url>","name":"My workspace"}
   ```
   — the workspace id (the same ids as the MCP bridge: `local:<hash>` / `team:<id>`), this site's origin, the
   port, a **pairing secret** made for this download and the workspace's name (`"dev": true` is added when One
   itself runs on a loopback origin). The secret stays on this device (localStorage `one.coding` → `pairs`, per
   workspace; never synced, never in a backup). **A new download replaces it** — the older file stops pairing.
   The download switches the link on (it used to be a manual switch) and One looks for the worker every 1.5 s
   for ten minutes.
2. **Start it** — `node ~/Downloads/one-worker.mjs` (keep it running; Ctrl+C stops it). No config file is
   needed for the connection: workspace, accepted origin and port come from the preset.
3. **Tick your repositories in the page that opens.** With no repositories configured yet (or with
   `node one-worker.mjs setup`) the worker looks for git repositories on the computer and opens its **setup
   page** in the default browser: the repos found, a tick each, and per ticked repo the base branch, the test
   command (an argv list, shown as keycaps), push on / off, pull requests via gh on / off (when gh is installed)
   and a cost limit per task. **Save & start** writes `worker.json` and the worker tells One its repos at once —
   the card reads *Connected · laptop · 2 repos* and a **WORKER** LED shows in the status bar. Open **#/coding**
   (⌘K *Coding pipeline*), **New task**.

Later, **Change repositories** (in the card's step 3 and on #/coding) asks the worker to open its page again — a
fixed request (`open-setup`); One never learns the page's address or key and can never tick or add a repo.
Unticking a repo stops new tasks for it; a running task finishes (or is stopped in One).

The link's switch (*Connect to a coding worker on this computer*) and the port stay in *Settings → Coding
worker* — per browser (localStorage `one.coding`), never part of the workspace, a backup or a team.

### Finding the repositories

The usual places first — `~/code`, `~/projects`, `~/dev`, `~/src`, `~/repos`, `~/git`, `~/GitHub`,
`~/Documents/GitHub`, `~/Developer`, `~/workspace`, `~/Desktop` — then the whole home folder, at most 4 levels
deep. Symbolic links are never followed; hidden folders, `node_modules`, caches, `Library` / `AppData`, the trash,
`vendor`, virtual envs and build outputs (`dist`, `build`, `out`, `target`, `coverage` …) are skipped. A folder
with a `.git` **folder** is a repo (its inside is not searched further); a `.git` file (a linked worktree or a
submodule) is skipped, and so is the home folder itself. It stops after about 30 s (the page lists repos as they are found; a folder that does not answer within 4 s is skipped and named), 300 repos or 50 000 folders
(**Choose a folder…** opens this computer's own folder dialog — macOS `osascript` choose folder, Windows PowerShell,
Linux `zenity`, a fixed command the page cannot change; **Add a folder…** takes a path you type: inside the home folder,
or an absolute path).

Nothing of a repo's content is read except: the current branch, the base branch (`origin/HEAD`, else `main` /
`master`), the remote's **host** (never its URL — no user names, no tokens), the last commit's date, dirty or
clean, and a test-command guess from top-level files — `package.json` with a `test` script → `npm` / `pnpm` /
`yarn test` by lockfile, `Cargo.toml` → `cargo test`, `go.mod` → `go test ./...`, `pyproject.toml` /
`pytest.ini` → `pytest`, a `Makefile` with a `test:` target → `make test`. Git runs as an argument list with
`core.fsmonitor` off, so a repo's own config can never start a program during the scan.

### The setup page

`http://127.0.0.1:<port>/setup#k=<token>` on the worker's own port, printed in its terminal too. Its door:

- **Host** must be exactly `127.0.0.1:<port>` (DNS rebinding).
- The **token** (32 random bytes per worker start) lives only in the address fragment — browsers never send a
  fragment by themselves; the page's script sends it as `X-One-Setup`, compared in constant time.
- **POST**s also need `Origin: http://127.0.0.1:<port>` and a JSON body. No CORS headers: no other page can
  read or call it.
- The page is static HTML, CSS and JS from the bundle under a strict CSP (`default-src 'none'`, own script and
  style only, no CDN). Repo names, paths and branches are set as text, never as HTML.
- A folder is offered only when the scan found it, it is in `worker.json` already, or you typed it into the page —
  and only as a main checkout.

**New repositories from the page** (only on the person's click there — One can never ask for one):

- **Clone from GitLab / GitHub…** — a clone address (`https://host/group/project(.git)`, `ssh://…`,
  `user@host:group/project`) into the clone folder (`cloneDir`, default `~/one-repos`; never inside iCloud Drive).
  Refused: a user name or token inside an https address (it would stay in `.git/config` — git asks the credential
  helper instead), `ext::` / `file://` / option-like addresses, `.` / `..` segments. Run as `git -c
  protocol.ext.allow=never -c protocol.file.allow=never clone --progress -- <url> <dir>` without a terminal (an SSH
  passphrase or password question fails at once with a hint), up to 30 min (`ONE_WORKER_CLONE_MS`), progress on the
  page; a failed clone removes the folder it made; a folder that is already a clone of the same address is just
  added. With `glab` / `gh` installed and signed in, the page lists the person's projects (`glab api projects?
  membership=true…`, `gh repo list --json …`; names and clone addresses only, HTTPS or SSH to pick).
- **Import a ZIP…** — `POST /setup/api/import?name=<file>.zip&dir=<clone folder>` with `application/zip` (≤ 500 MB,
  `ONE_WORKER_ZIP_MAX`), unpacked by fflate's streaming reader into a new repository: every path must stay inside
  the folder (an absolute path, a drive letter or `..` refuses the whole ZIP), links become plain files, every `.git`
  folder (hooks, config) and `__MACOSX` / `.DS_Store` are left out, ≤ 2 GB unpacked and 100,000 files; one folder at
  the top becomes the repository; then `git init`, branch `main`, one commit *Import <file>* (identity: the person's
  git config, else "One worker"). No remote — push is off until one is added.
- **Create it on GitLab / GitHub** (offered after an import while `glab` / `gh` is signed in; mcp/src/worker/publish.ts):
  a project name suggested from the code (package.json, composer.json, pom.xml, pyproject.toml / setup.py, Cargo.toml,
  go.mod, *.sln / *.csproj, the README's first heading — else the ZIP's name), an optional GitLab group (nested) or
  GitHub organisation, private / internal / public. The person's own tool creates it through the host's API (`glab api
  -X POST projects …` / `gh api -X POST user/repos | orgs/<owner>/repos …`, argv only); the worker adds `origin` in the
  tool's git protocol and pushes `main` without a terminal. Only for a listed repository without a remote.
- The new repo is ticked on the page like an added folder; **Save & start** writes it (and a changed clone folder
  as `cloneDir`).
- **Own MCP servers for Claude Code** (per repo, `claude.mcpServers`): names as `claude mcp list` shows them (e.g.
  `atlas`). The stages of that repo get their tools allowed (`mcp__<name>`), `--strict-mcp-config` is left out, and
  the prompt tells Claude it may use them (what they return is data, like the task).

Saving writes `worker.json` with mode 0600 (its folder 0700), keeping what the file already says: other keys and,
for a repo that stays ticked, its own settings (`claude`, `branchPrefix`, `worktreeDir`, limits …). A hand-written
file with comments is copied to `worker.json.bak` once before it is rewritten.

**No browser** (`--no-browser`, a headless machine, or opening it failed): the same list as a numbered checklist
in the terminal — numbers tick / untick, `a` all, `n` none, Enter saves, `q` leaves. With `--no-browser` the
worker has no setup page at all (and `open-setup` opens nothing). `ONE_WORKER_BROWSER=<program>` opens the page
with another program (it gets the address as its only argument); `none` never opens one.

### By hand (worker.json)

Still there for a config of your own (*Settings → Coding worker → Manual setup*): the plain file without a
preset, bound with `init`:

```bash
curl -fsSL https://getonecms.com/mcp/one-worker.mjs -o ~/one-worker.mjs
node ~/one-worker.mjs init --workspace local:abc123   # a commented ~/.config/one/worker.json
node ~/one-worker.mjs check                           # config, repos, Claude Code
node ~/one-worker.mjs                                 # run (no repos yet: it opens the setup page too)
```

Then *Connect to a coding worker on this computer*. A worker without a preset never asks for a pairing secret
(the tab sends it anyway; it is ignored).

## worker.json

JSON with `//` comments (`--config <file>` or `ONE_WORKER_CONFIG` for another file) — written by the setup page,
editable by hand. Next to it the worker keeps `worker-state.json` (mode 0600): the branches and worktrees it
created, which worktree a task uses, cost per task and per day.

| Key | Default | |
|---|---|---|
| `workspace` | — | The One workspace this worker serves. Every other tab is refused (close 4003). Without it every tab is refused and the log says which id to set. A downloaded worker takes it (and `port`) from its preset instead. |
| `name` | the computer's name | How One shows this worker (also the row's **Worker** field while it works on a task). |
| `port` | `47322` | WebSocket port on 127.0.0.1 (`ONE_WORKER_PORT` overrides; set the same port in One). |
| `parallel` | `2` | Tasks at once across repos (1–2; always one per repo). |
| `pollSec` | `15` | How often an idle worker asks One for work (One also nudges it when tasks change). |
| `origins` | — | Extra allowed page origins (like `ONE_ORIGINS`) for a self-hosted One. |
| `cloneDir` | `~/one-repos` | Where the setup page and Import stages clone / import new repositories (`ONE_WORKER_CLONE_DIR` overrides). Never inside iCloud Drive. |
| `mcpServers` | `[]` | Your own Claude Code MCP servers for document stages of tasks **without a repository** (they run in `<config dir>/scratch/<task id>`). Set on the setup page. |
| `intake` | `true` | `false`: One may not hand this worker code for Import stages (the setup page still clones / imports). |
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
| `analyzeCommand` | none | The **Static analysis** stage — an argv list like `testCommand` (`["npx", "eslint", "."]`, `["dotnet", "build", "-nologo"]`); the setup page guesses one (the `lint` script by lockfile, ESLint config, `.sln` / `.csproj`, `go vet`, `cargo clippy`, ruff, flake8). |
| `analyzeTimeoutSec` | `900` | |
| `push` | `true` | `false`: Ship commits only. |
| `pr` | `"gh"` | `"gh"`: `gh pr create` on a GitHub host, `glab mr create` on a GitLab host (when the tool is installed and signed in); otherwise (and with `"none"`) a compare / new-merge-request link for GitHub / GitLab remotes. Posting a review and merging need `"gh"` and the host's tool. |
| `claude.model` | Claude Code's default | A model name Claude Code accepts. |
| `claude.maxTurns` | `30` | Upper bound per stage (a stage may ask for fewer). |
| `claude.permissionMode.implement` | the stage's | `acceptEdits` or `default` — overrides what the pipeline asks for. Plan stages always run in `plan` mode. A mode that skips permissions is refused. |
| `claude.allowedTools` / `disallowedTools` | `[]` | Claude Code's own syntax (`"Bash(npm test:*)"`). Headless runs cannot ask, so whatever needs permission must be allowed here. |
| `claude.strictMcp` | `true` | `--strict-mcp-config`: during a task Claude Code gets only the task tools, not your other MCP servers. |
| `claude.mcpServers` | `[]` | Your own Claude Code MCP servers this repo may use (e.g. `["atlas"]`): their tools are allowed and `--strict-mcp-config` is left out. Set on the setup page. |
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
- **No terminal for git**: git runs in its own session without a terminal (`GIT_TERMINAL_PROMPT=0`,
  `GCM_INTERACTIVE=never`), so a password, SSH passphrase or host-key question fails at once with git's message instead
  of waiting. Use an SSH agent / keychain or a credential helper. A fetch for a new task that fails or takes over 60 s
  (`ONE_WORKER_FETCH_MS`) is logged and the task goes on from the local refs.
- **iCloud Drive (macOS)**: a repo under iCloud Drive (or ~/Documents / ~/Desktop when they sync) gets a warning in
  the log — git waits whenever a file is only in the cloud. Its worktrees go to `~/.one-worktrees/<name>` (outside
  iCloud) unless `worktreeDir` is set. A checkout (`git worktree add`) may take up to 10 min (`ONE_WORKER_CHECKOUT_MS`)
  with a line every 30 s; one that fails or runs out of time removes its folder, worktree entry and new branch.
- **Start**: the worker listens first (One connects at once), then checks each repo (`rev-parse`, `worktree prune`,
  branches — 30 s each) in the background and names a repo whose git takes over 8 s (iCloud Drive). A git that
  passes its time limit is given up at once, even when its process does not end yet.
- **Progress**: every step goes to the task's log; while Claude Code is quiet the worker adds a *still working* line per
  minute (`ONE_WORKER_QUIET_MS`). The worker's own lines carry a message code + values (`LogLine.c` / `v`, e.g.
  `stage`, `fetchFailed`, `testsPass`): One shows them in the person's language (`features.coding.log.c.<code>`,
  coding/lines.ts — unknown codes and every line without one show `s` as written). After every Claude Code turn a
  `progress` event carries { turns, maxTurns, cost, model }: turns are counted per assistant message id, the cost is an
  estimate from each message's `usage` (mcp/src/worker/price.ts, $ per million tokens per model; cache writes 1.25 ×
  input, cache reads at the model's rate; unknown model → none) until the result event's exact `total_cost_usd`. One
  keeps it in memory only (`useCoding.progress`) and drops it when the stage ends.
- **Live diff**: while a stage other than plan runs, the worker checks `git status --porcelain` every 30 s
  (`ONE_WORKER_LIVE_GIT_MS`) and sends a `git` event (the same snapshot as at the end) whenever the worktree changed —
  the panel's Files chip and the Diff tab follow along.
- **In One while it runs**: the task panel's *Now* line (the last log line, its age ticking), the chips *Step x/y*,
  *≈ +$* (this stage's estimate, on top of the task's cost) and *Files n +a −r* (opens the Diff tab); #/coding shows
  the Now line under each running task. **Notifications** (Settings → Coding worker, per device, localStorage
  `one.coding.notify`): the gate / question / failed / done toasts also become a browser notification while the tab
  is hidden or another window has the focus (coding/notify.ts); a click focuses One and opens the task.
- **Approvals** (One, per device): *all* (plan gate + review), *review* (the gate after a plan stage passes by itself),
  *none* (every gate passes; tests failing twice still stop at the review gate). Kept in the task's local state
  (`TaskLocal.approvals`); the last pick is this device's default (localStorage `one.coding.approvals`).
- **Reuse a branch**: pick it in the task panel's Branch picker (the worker announces each repo's local branch
  names, newest first, ≤ 100 — names only, never the base branch), type it into the task's **Branch** field, or use
  *Existing branch* in New task. It must exist
  (locally or on the remote — then it is tracked); it is never reset. A branch checked out in the main checkout is
  refused, and so is the repo's base branch (Ship would push straight to it).
- **Git actions** in the panel are fixed verbs: **Refresh**, **Commit** (message), **Push**, **Open PR**, **Update
  from base** (rebase while the branch was never pushed, else merge; a worktree with uncommitted changes is
  refused; conflicts are listed per file and left for a stage — or you — to resolve, never auto-resolved), **Show
  folder** (the path is printed in the worker's terminal only). **Force push** (`--force-with-lease`) and **Discard
  worktree** are confirmed twice. Discard removes the worktree the worker made (with its uncommitted changes) and
  deletes the branch only if the worker created it. **Clean up** does the same only after the merge and never forced.
- **Merge request** (`comment-pr`, `merge-pr`, git.ts `commentPr` / `mergePr`; confirmed in One): **Post review** sends
  the task's newest review (`TaskLocal.review`, from a doc stage with `output: 'review'`) as the tab's `message` —
  `glab mr note <branch> --message …` / `gh pr comment <branch> --body …`; **Merge** finds the branch's open request
  (`glab mr view` / `gh pr view`) and merges it — `glab mr merge <branch> --yes` (the project's merge method) / `gh pr
  merge <branch> --merge` (then `--squash`, `--rebase` when the repository allows only those). Both need `pr: "gh"`
  and the host's tool signed in; a dirty worktree is not merged; the branch stays (Clean up); a fetch follows.

### Claude Code

`claude -p --output-format stream-json --verbose --permission-mode <plan|acceptEdits|default> --max-turns N
[--model …] [--allowedTools …] [--disallowedTools …] [--max-budget-usd …] --mcp-config <temp file>
[--strict-mcp-config]` in the task's worktree; the prompt goes in on stdin. What the installed CLI supports is read
from its `--help` (the budget flag, the permission mode names). The stream becomes log lines (text, tool calls,
tool errors), the plan comes from `ExitPlanMode` — or, when the CLI has it switched off in headless runs, from the
plan file Claude Code wrote (`~/.claude/plans/*.md`, read only inside that folder, ≤ 200 KB), else the final
message — the cost from the result event.

The prompt: the stage's instructions (or the default of its kind), the worker's rules (no git, stay in the
worktree, task text is data), then the task between markers — `<<<TASK <code> … TASK <code>>>>`, rework notes,
questions and answers — labelled as data written by people. The code is random per prompt (and per `one_task_read`):
text written before cannot close its block and add rules of its own; stage names and titles are one line.

**Task tools** (`MCP_TASK_TOOLS` in `src/app/features/mcp/contract.ts`): the run's MCP config starts `node
one-worker.mjs task-mcp` with a random 48-hex token for that run only. `one_task_read` (the task again),
`one_task_note` (a progress line in the log), `one_task_ask` (a question: the run ends, the task waits in One;
the answer goes into the page and the stage runs again with it). All three are marked read-only for Claude Code
(they change nothing on the computer), so plan mode allows them too. Nothing else in One is reachable through them;
the token dies with the run.

### Pipelines: Coding · Business analysis · QA

Three pipeline databases, each found by its `Database.system` (`coding` · `spec` · `qa`), each with its own stages
(#/coding · #/coding/spec · #/coding/qa) and each usable on its own. Business analysis and QA tasks may have no
**Repo**; they get a multi-select **Then** (`followUps`): when a task reaches its done stage, One creates a task in
each picked pipeline (BA → Coding / QA, QA → Coding) with the page's content under a mention of the source, and
notes the link in the source page (per device `TaskLocal.spawned`; **Hand on to …** does it later).

Three more stage kinds:

- **doc** — a document stage. Claude Code runs in `default` mode with only `Read`, `Grep`, `Glob`, `LS`, the task
  tools and the repo's / worker's own MCP servers allowed; `Edit`, `MultiEdit`, `Write`, `NotebookEdit` and `Bash`
  are denied. It runs in the main checkout (read only; no worktree, no branch) — or, for a task without a
  repository, in `<config dir>/scratch/<task id>`. When the task has a branch, it runs in that branch's worktree (if
  there is one) and the prompt carries what the branch changes against the base — `git diff --stat` + the diff (≤ 80k
  characters, clipped on a line) + new untracked files — as a `DIFF` data block (git.ts `branchDiff`). Its last
  message is the document: a page section headed like the stage. Outputs (`PipelineStage.output`, coding/outputs.ts +
  tasks.ts):
  - `testcases`: the last fenced `json` block (an array of `{ id, title, area, type, priority, preconditions, steps[],
    expected }`) becomes rows of the **Test cases** database (`system: 'testcases'`) and leaves the page.
  - `pages`: the document's `##` sections (fences respected) become pages under one documentation page "<task> ·
    <stage>" (top level; private in a team), the root holding the intro and a `pageLink` per page; `###` become `##`. The
    task's section keeps the intro and mentions the pages (so later stages read them, refs.ts). A re-run on the same
    device (`TaskLocal.docPages[stageId]`) updates pages of the same title (inside `aiWrite`: a version first), adds
    new ones, leaves the rest.
  - `review`: the document is also the task's review (`TaskLocal.review`): payload `review` for a git `comment`
    stage, **Post review** in the Git tab.
  - `stories`: the last fenced `json` block `{ project?, stories: [{ title, story, criteria[], priority }] }` (≤ 100)
    becomes a NEW coding project "<project> — Stories" (schema.ts `createProject`, the pipeline copied from the
    coding project shown on this device, not switched to) with a task per story in its first stage, each mentioning
    the source; a re-run adds only titles not there yet (`TaskLocal.storiesDb`).
  Only document stages run without a repository (`next` carries `docs: true`).
- **analyze** — static analysis: the repo's `analyzeCommand` (argv, no shell) in the task's worktree, or the main
  checkout when the task has none (no branch is made). The output (scrubbed; head 16k + tail 4k characters) becomes
  the stage's section — the program's name (never its path), the verdict, a fenced block; a non-zero exit is a finding
  (status ok), only a program that cannot start or runs past `analyzeTimeoutSec` fails. Without a command the stage
  passes with a note.
- **import** — the task's code arrives here; the worker never takes a task standing there. The task panel sends a
  ZIP (`intake-begin` → `intake-chunk` … → `intake-end`, base64 pieces of ≤ 4 MB, the declared size must match, one
  intake at a time, ≤ `ONE_WORKER_ZIP_MAX`) or a clone address (`intake-clone`, `parseCloneUrl`'s checks); the worker
  unpacks / clones into `cloneDir` with the setup page's checks (intake.ts), adds the new folder to worker.json
  (nothing else changes) and sends `intake` events; on `done` the task takes the repo name as its **Repo** and moves
  to the next stage. One never names a path.

**Pages that go along**: page mentions, `pageLink`s and `#/p/<id>` links in the readable part of a task (≤ 8) are
appended to the task text as read-only Markdown (a row with its filled fields, a database with its entries'
titles; coding/refs.ts). Their id, title, fields and content are part of the task version.

### Templates

**Projects.** A kind may have several pipeline databases ("projects"): `pipelineDbIdsOf(kind)` (oldest first),
`pipelineDbId(kind)` = the first, `pipelineDbIds()` = every project of every kind (the worker takes tasks from all).
#/coding shows `currentProjectId(kind)` — per device, localStorage `one.coding.project.<kind>`, set with
`chooseProject()`; New task creates there (`NewTask.dbId`). **New project** (`createProject`: a copy of the shown
project's pipeline under new option ids, or a template); **Delete project** (`trashProject`: the database page and its
rows to the trash, refused when locked; Undo = `restorePage`).

**Pipeline → Template** replaces the draft (nothing is saved until Save; a stage of the same kind keeps its id, so
tasks standing there stay in a stage): **Standard** (Backlog · Ready · Plan · Approve plan · Implement · Test · Review ·
Ship · Done), **Business analysis** (Backlog · Ready · Analysis · Specification — doc · Approve spec · Record — doc ·
Done), **QA** (Backlog · Ready · Test cases — doc, output test cases · Approve test cases · Record · Done) or
**Modernise legacy code** (Backlog · Import · Ready · Analysis · Design · Test design — three plan stages with
their own instructions — · Approve concept · Write tests (characterisation tests against the old code) · Tests on the
old code · Rebuild · Test · Review · Ship · Done; schema.ts `templatePipeline`). With more than one plan stage each
writes its own section into the task page, headed like the stage; the page's Markdown (with those sections) is the
task text of every later stage. Help: *Modernise legacy code* (`help:legacy-modernisation`). Modernise now runs a
**Static analysis** stage after Ready. More templates: **Explain the code** (Backlog · Import · Ready · Overview —
doc · Static analysis · Components — doc, output pages · Documentation check — doc · Approve documentation · Done;
`help:explain-code`), **Review & merge** (Standard up to Ship, then AI review — doc, output review · Approve review &
merge — gate · Post review — git `comment` · Merge — git `merge` · Done; nothing is posted or merged before the gate;
`help:review-merge`) and, for Business analysis, **Spec → stories** (… Approve spec · Stories — doc, output stories ·
Done). Git actions `comment` (needs a review; fails without one) and `merge` (refuses uncommitted or unpushed work).
A browser for reviews: the person's own Claude Code MCP server (e.g. `claude mcp add playwright npx
@playwright/mcp@latest`, then `playwright` under the repo's MCP servers on the setup page) — One never reads the
person's browser tabs.

## Safety

- **The worker's door is the bridge's door** (docs/MCP.md § Security model): 127.0.0.1 only, Host check against
  DNS rebinding, the same Origin allow-list, subprotocol `one-worker.v1`, a hello with a workspace id within 5 s.
  The worker serves ONE workspace (`workspace` in worker.json); the newest tab of it wins (4001).
- **A downloaded worker is paired.** It accepts only the origin the download came from (plus any loopback port
  when the preset says `dev`; `ONE_ORIGINS` / `"origins"` still add), only its workspace, and only a hello that
  carries the download's pairing secret — compared in constant time; none or another one is refused (4003,
  `reason: "pair"`), and the secret is never logged. Another browser profile, another person's One on the same
  computer, or an older download cannot use it. A broken preset is ignored as a whole (the file then behaves like
  the plain download).
- **The setup page is the person's only.** One can ask the worker to open it (`open-setup`) and hears back only
  whether a browser opened — never the address or the key. Ticking, adding a folder and saving happen on this
  computer only (§ The setup page).
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
- **The AI terminal** (features/ai/agent/coding.ts → coding/terminal.ts): Claude reads the pipelines directly
  (`list_pipelines`, `list_tasks`, `read_task` — the worker's / Claude Code's text framed in `<task_output>`, and
  withheld under the person's context marks) and **proposes** tasks and actions (`create_task`, `task_action`:
  approve · rework · answer · run · stop · then · hand_on) as staged changes of kind `coding`, applied only in the
  review. A new task's card shows its whole page exactly as Claude Code will read it (plus the pages that go along —
  pages proposed in the same conversation too, marked *staged*; applying refuses when the live list has a page the
  card did not list); only such a reviewed task is created trusted. Creates staged for "a new project" of a kind land
  in the project the first applied one made (same template, compared live: start, stop, git stages). Changes that
  **start the worker** — computed live: where a new task lands (automatic queues hopped, like the worker's pick),
  approve / rework / answer / run / hand_on, an approval into done with *Then*, a *Then* that adds a pipeline to a task
  not done yet (a done task's *Then* is refused: hand_on) — and text appended to a task's page (shown in full,
  **GOES TO CLAUDE CODE**) are never part of "apply all". Text the terminal writes into a task's page (append, edit)
  lists the pages it links (they go along — a staged one is marked and shown in full as GOES TO CLAUDE CODE; applying
  refuses a page the card did not list). Applying **never confirms** a version: every action but Stop — *Then* too —
  is refused for a task this device has not trusted (Confirm stays on the task page), and the actions run with
  `confirm: false` (keepTrust only). In a local workspace a write from the person's tab clears an agent's "last
  edited" stamp, which ends the wait for Confirm: the terminal never writes such a task (its Undo leaves it alone
  too). A fingerprint (stage, phase, title + the page's Markdown, Repo / Branch, this device's local state, the open
  question) refuses a stale action — except through the terminal's own reviewed writes of the task applied
  since (a chain of fingerprints; an edit made elsewhere breaks it; in a team the terminal's edit of the open task
  page is handed from its document to the store at once, so the step is recorded from the edited page). An approval
  shows Claude Code's plan while the page's section still says the same (a hash kept when the worker writes it), else
  the section as it stands on the page. Task actions stay applied on Undo, a created task the worker took is kept. The
  terminal adds no worker verb (Stop only); it never moves a task to a stage, confirms it, changes approvals, runs git
  verbs, hands over an Import's code or edits a pipeline. Its row tools refuse a pipeline database's rows / properties
  (`create_row`, `add_property`), the role fields Stage, Repo, Branch, Then, Git, PR, Cost, Worker, Claimed at
  (`update_row`; Then: `task_action then`), and any row / page / title change of a task that waits for Confirm.
  `coding` changes apply only from the terminal (never from a custom agent's run, never from a server run's `KINDS`).
- **Diffs never follow links**: an untracked symbolic link shows as its target, the file it points at is never read.
- **Cost**: per-task and per-day limits are checked before each stage and passed to Claude Code as
  `--max-budget-usd` (where the CLI knows it). **Stop** (One) or Ctrl+C (worker) kills Claude Code's whole process
  tree.

## Protocol

JSON text frames, subprotocol `one-worker.v1`, defined in
[`src/app/features/coding/protocol.ts`](../src/app/features/coding/protocol.ts) (shared by the worker and the app).

| Direction | Message |
|---|---|
| tab → worker | `{ type: "hello", app: "one", version, workspace: { id, name, kind, readOnly }, pair? }` (`pair`: this device's secret for a downloaded worker) · `status` (same workspace, or the tab is refused) · `nudge` |
| worker → tab | `welcome` { worker, name, repos: [{ name, baseBranch }], parallel, busy, spentToday, dayLimit, claude: { found, version }, setup, paired } (sent again when the setup page saves) · `refused` { reason: workspace \| unbound \| pair, paired? } + close 4003 · `status` { busy, spentToday } |
| worker → tab (req) | `next` { repos, worker, docs?, can? } → `{ task: TaskPayload \| null }` (claimed; `can` = `WORKER_CAN` — 'analyze', 'git:comment', 'git:merge': a stage that needs one goes only to a worker that names it, else the task fails with "download the worker again" — an older worker ran unknown kinds as git stages) · `heartbeat` { taskIds } · `finish` { taskId, stageId, outcome } (retried until confirmed) |
| worker → tab (event) | `log` { lines } (a tool line of Edit / MultiEdit / Write carries `e`: { path, hunks: [{ old, new }], clipped? } — ≤ 6 changes × 4,000 characters, scrubbed) · `git` { git } · `note` { text } · `question` { text } · `progress` { progress: { turns, maxTurns, cost, model } } · `intake` { intake: { state, source, label, line, percent, repo?, suggest?, error? } } |
| tab → worker (req) | `stop` { taskId } · `git` { taskId, verb, repo, branch, title, message? } — verbs: refresh, commit, push, force-push, pr, update-base, discard, cleanup, reveal, comment-pr (`message` = the review), merge-pr · `open-setup` → `{ opened, reason?: off \| no-browser }` · `intake-begin` { taskId, name, size } → `{ uploadId, chunk }` · `intake-chunk` { uploadId, data } · `intake-end` { uploadId } · `intake-clone` { taskId, url } |

`POST http://127.0.0.1:<port>/task` (`Authorization: Bearer <run token>`, no `Origin`): the task tools.
`/setup`, `/setup/app.css`, `/setup/app.js`, `/setup/api/state | status` (GET) and `/setup/api/scan | add | save`
(POST): the setup page (§ The setup page) — not served with `--no-browser`.

## Troubleshooting

- **Waiting for the worker** — is it running (`node ~/Downloads/one-worker.mjs`) on the port One uses? Set the
  port in Settings *before* the download: the file carries it.
- **Refused: this worker belongs to another download** — the file was downloaded in another browser, or a newer
  download replaced its pairing. Browsers name a second download `one-worker (1).mjs`: start the newest file (or
  delete the old one and download again).
- **No page opened** — the address is in the worker's terminal (*Tick your repositories: http://127.0.0.1:…*);
  open it in a browser on that computer, or run with `--no-browser` and pick the repos in the terminal.
- **A repo is missing from the list** — deeper than 4 levels, behind a symbolic link, or in a skipped folder:
  **Add a folder…** on the setup page.
- **Two workspaces on one computer** — a worker serves one workspace. A download for another workspace uses the
  same `~/.config/one/worker.json` (the repos ticked there show ticked on its page — untick what does not belong).
  To run two at once, give the second its own port (Settings → Coding worker, *before* downloading) and its own
  folder: `node one-worker.mjs --config ~/.config/one-team/worker.json` (`worker-state.json` lives next to it).
- **Refused: the worker serves another workspace / is not bound** — a downloaded worker belongs to the workspace
  it was downloaded for: download it in this one. A hand-made one: run the init command *Settings → Coding worker
  → Manual setup* shows (it carries this workspace's id; `--force` replaces the file — or edit `"workspace"`),
  restart the worker.
- **Claude Code was not found** — install it, sign in once interactively, or set `CLAUDE_BIN`. `node one-worker.mjs
  check` shows what the worker sees.
- **A stage fails right away with a permission problem** — headless runs cannot ask: allow the tools in
  `claude.allowedTools` (`"Bash(npm test:*)"`), or use `acceptEdits` for implement stages.
- **The branch is checked out in the main checkout** — switch the main checkout to another branch, or clear the
  task's Branch field to get a fresh branch.
- **Port in use** — another worker runs (stop it first, or use *Change repositories* to reach its page); set the
  port in One (and download again) or `"port"` in a hand-written worker.json.
- Logs go to stderr (`ONE_WORKER_QUIET=1` silences them). Chrome logs refused connection attempts in the console
  while no worker runs — expected.

The worker's code: [`mcp/src/worker`](../mcp/src/worker) (bundled with the bridge by `npm run build:mcp` to
`public/mcp/one-worker.mjs`, committed; `npm --prefix mcp test` runs its tests against temp repos, a local bare remote
and a fake `CLAUDE_BIN`).
