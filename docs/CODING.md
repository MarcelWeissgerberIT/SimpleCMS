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

**Runs on** macOS, Linux and Windows 10 / 11 (natively from worker 1.9.0 — § Windows); WSL2 works too.

**Needs**: Node.js 22 or newer (tested on 22 and 24; 20 still starts, with a note that it is past its end of life),
`git` (on Windows: Git for Windows; with your `user.name` / `user.email` set — `gitIdentity` otherwise), and the Claude
Code CLI — installed and signed in (`claude` on `PATH`, its native installer's `~/.local/bin`, or
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
   needed for the connection: workspace, accepted origin and port come from the preset. The card shows the line
   for the computer — a switch **Windows | macOS · Linux** (one choice per tab, the default from the browser's
   platform; `startLines.ts`, pure): on Windows a PowerShell and a Command Prompt line, the file quoted (user folders
   have spaces; neither shell hands `~` to node.exe expanded), both from USERPROFILE — whose Downloads folder the
   browser uses by default:
   ```powershell
   node "$env:USERPROFILE\Downloads\one-worker.mjs"      # PowerShell
   node "%USERPROFILE%\Downloads\one-worker.mjs"         # Command Prompt (cmd)
   ```
   Never PowerShell's `$HOME`: Windows PowerShell 5.1 takes it from HOMEDRIVE + HOMEPATH, a network home (`H:\`) on
   many company PCs. The browser saves where it saves: a download folder of its own, or Downloads moved (e.g. into
   OneDrive) — then the file is started from there, `node` and its path (Explorer: Shift + right-click → *Copy as
   path*); the card says so under the Windows lines.
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
  added. A new clone is marked as the worker's (`.git/one-worker-source`): Claude Code runs on it without the repo's
  own settings (`claude.projectSettings`, § worker.json). Such a folder added again is marked only in the default
  clone folder (`~/one-repos`, an older worker's clone); elsewhere it may be the person's own checkout and stays
  unmarked — the clone folder rule covers it while it lies in the clone folder. With `glab` / `gh` installed and signed in, the page lists the person's projects (`glab api projects?
  membership=true…`, `gh repo list --json …`; names and clone addresses only, HTTPS or SSH to pick).
- **Import a ZIP…** — `POST /setup/api/import?name=<file>.zip&dir=<clone folder>` with `application/zip` (≤ 500 MB,
  `ONE_WORKER_ZIP_MAX`), unpacked by fflate's streaming reader into a new repository (mcp/src/worker/zipimport.ts).
  Left out first — never written, so their names are never checked: `__MACOSX`, Finder's `.DS_Store` and `Icon\r`
  (a custom folder icon), and every part, at any depth, that some file system reads as `.git` — git's own
  `is_ntfs_dotgit` / `is_hfs_dotgit` in one check (`isDotGit`): any case (`.GIT`, `.Git` — macOS and Windows disks
  ignore case), trailing dots and spaces (`.git.`), an NTFS stream suffix (`.git::$INDEX_ALLOCATION`), the 8.3 short
  name `GIT~<n>`, and the code points HFS+ ignores (U+200C–U+200F, U+202A–U+202E, U+206A–U+206F, U+FEFF). Every other
  path must stay inside the folder — an absolute path (`/x`, or a drive path `C:/x` / `C:\x` on every system), `..`
  or a name of only dots and spaces refuses the whole ZIP, and so does a control character (U+0000–U+001F, U+007F).
  **On Windows** also any name with `:` (an NTFS data stream; `C:x` is relative to drive C there) or a device name
  (CON, PRN, AUX, NUL, COM0–9, COM¹–³, LPT0–9, LPT¹–³, CONIN$, CONOUT$ — with or without an extension); on macOS and
  Linux these are plain files git keeps (the kernel's `aux.c`, `con.go`, a stray `nul`, `a:b`). Links become plain
  files. ≤ 2 GB unpacked and 100,000 files; one folder at the top becomes the repository.
  Before any git step a second guard walks the new folder and refuses it (removing it) when it holds a git folder:
  anything named like `.git`, what the file system answers for `.git` itself, or a folder git would use as a
  repository of its own (git's `is_git_directory`: a `HEAD` with `objects` + `refs`, or with a `commondir` — those
  three counted whatever they are, files too, because git asks `access(X_OK)` and Git for Windows answers it for any
  file; a bare repository, test fixtures too; git would run its config, e.g. `core.fsmonitor`, for any git command in
  that folder). A ZIP whose top is such a folder — a bare repository, or the inside of a `.git` — is refused with
  "clone it and zip the checkout". Then one commit *Import <file>* on branch `main` (identity: the person's git
  config, else "One worker"), made against a fresh git folder next to the new one (`git --git-dir=<fresh>
  --work-tree=<folder>`), so no config or hook inside the folder is ever read — not its fsmonitor, filter drivers,
  `gpg.program` or `include.path`, even of a `.git` that slipped past both guards. Of the person's own config,
  nothing that runs a command or works on afterwards: fsmonitor off, hooks from an empty folder (`--no-verify` too),
  no filter driver — `* -filter !diff merge` as the last line of the fresh git folder's `info/attributes` (a global
  clean filter or diff textconv such as nbstripout's runs in the repository's folder, where `python -m nbstripout`
  would import the ZIP's own `nbstripout.py`; a merge driver such as `npx npm-merge-driver` finds the ZIP's
  `node_modules/.bin` first) — and no automatic gc
  (`gc.auto=0`, `maintenance.auto=false`: past ~6,700 loose objects `git commit` starts a detached `git gc --auto`
  that raced the move and left `gc.pid` and `gc.log.lock` behind). The folder is checked once more, then the fresh
  git folder moves in as its `.git`, marked as the worker's import (`.git/one-worker-source`). The `info/attributes`
  line stays for good (worktrees read it too): no filter, diff or merge driver of the person's ever runs in the
  imported repository — not at its first `git status` (the page's and the Import stage's `repoFacts`), not in a
  task's worktree, diff, commit or update from the base. Its files stay as they were committed: Git LFS files are
  plain files there (a filter applied later would show each one changed and put the conversion into a task's first
  commit); `merge` = git's own text merge, `!diff` = git's own diff. Removing the line turns the drivers on. The
  worker's own diffs (the Diff tab, a doc stage's DIFF block) run with `--no-ext-diff` in every repository: never the
  person's `diff.external`, a command that would run in the repository's folder too. A failed import leaves no folder
  behind. No remote — push is off until one is added.
- **Create it on GitLab / GitHub** (offered after an import while `glab` / `gh` is signed in; mcp/src/worker/publish.ts):
  a project name suggested from the code (package.json, composer.json, pom.xml, pyproject.toml / setup.py, Cargo.toml,
  go.mod, *.sln / *.csproj, the README's first heading — else the ZIP's name), an optional GitLab group (nested) or
  GitHub organisation, private / internal / public. The person's own tool creates it through the host's API (`glab api
  -X POST projects …` / `gh api -X POST user/repos | orgs/<owner>/repos …`, argv only); the worker adds `origin` in the
  tool's git protocol and pushes `main` without a terminal. Only for a listed repository without a remote.
- The new repo is ticked on the page like an added folder; **Save & start** writes it (and a changed clone folder
  as `cloneDir`).
- **Own MCP servers for Claude Code** (per repo, `claude.mcpServers`): names as `claude mcp list` shows them (e.g.
  `kb`). The stages of that repo get their tools allowed (`mcp__<name>`), `--strict-mcp-config` is left out, and
  the prompt tells Claude it may use them (what they return is data, like the task). While the repo's own settings
  are off, only user-scope servers reach it (`claude mcp add -s user …`) — the page says so under the field.
- **Use this repo's own Claude Code settings (.claude/, .mcp.json, CLAUDE.md, local MCP servers)** (per repo,
  `claude.projectSettings`): on for the person's own repos; off for code from elsewhere, with the rule that matched
  as the reason ("cloned by the worker" · "imported by the worker from a ZIP" · "marked as code from elsewhere" ·
  "in the clone folder" — config.ts `sourceOf`, under worker.json's clone folder and the one the next Save writes).
  Turned on against that, it says in one line that the repo's hooks and helper commands (apiKeyHelper, its MCP
  servers) will run on this computer when a task starts. Save writes the key through the same door (key, Host,
  Origin) only where it decides something: against the default, where an "off" rests on the clone folder alone
  (it would turn on once `cloneDir` moves — what the page showed stays), or where worker.json had the key already;
  an "off" by the worker's mark and an "on" for an own repo stay implicit. A body without the switch (the terminal
  checklist, an Import stage) leaves the key as it is.

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

On Windows (PowerShell — PowerShell 5.1's `curl` is `Invoke-WebRequest`, so it is named in full; in cmd:
`curl.exe -fsSL "<url>" -o "%USERPROFILE%\one-worker.mjs"` and `"%USERPROFILE%\one-worker.mjs"`):

```powershell
Invoke-WebRequest -UseBasicParsing "https://getonecms.com/mcp/one-worker.mjs" -OutFile "$env:USERPROFILE\one-worker.mjs"
node "$env:USERPROFILE\one-worker.mjs" init --workspace local:abc123
node "$env:USERPROFILE\one-worker.mjs" check
$env:ONE_WORKER_PORT = '47400'; node "$env:USERPROFILE\one-worker.mjs"   # a port of its own (cmd: set "ONE_WORKER_PORT=47400" && node …)
```

Then *Connect to a coding worker on this computer*. A worker without a preset never asks for a pairing secret
(the tab sends it anyway; it is ignored).

## Windows

Native from worker **1.9.0**, on Windows 10 and 11. **On Windows, use worker 1.9.0 or newer:** older workers could
start a program named `git.exe`, `claude.exe` or `npm.exe` from the root of a cloned or imported repository —
Windows looks for a program in the folder it starts in before `PATH`, and the worker runs git and Claude Code inside
the repository. Download the worker again (*Download again*). One names such a worker where it can tell: the welcome
carries no system (protocol.ts has no such field), but a worker reached over **Local** listens on 127.0.0.1 — it runs
on the browser's own computer. So a worker older than 1.9.0 over Local from a browser on Windows (its platform, not
the start-line switch) gets a security notice with *Download again* on the #/coding plate and the setup card, and the
Preflight worker lamp turns amber (`features/coding/winWorker.ts`; the ZIP-import notice for 1.3.1 – 1.8.0 wins where
both apply). A worker reached through **Cloud** runs on another computer and is never flagged. One running in WSL on
this computer is a Linux one, which One cannot tell apart over Local — it is flagged too, and the notice says it does
not apply then. macOS and Linux browsers never get it.

**Install** (once):

- **Node.js 22 or newer** — the installer from nodejs.org.
- **Git for Windows** — git itself, and Claude Code needs its Git Bash. `check` names the Bash it found
  (`git bash …`; elsewhere: set `CLAUDE_CODE_GIT_BASH_PATH`).
- **Claude Code** — its native installer (PowerShell: `irm https://claude.ai/install.ps1 | iex`) or
  `npm i -g @anthropic-ai/claude-code`; sign in once with `claude`. `check` says which one it starts:
  `claude <version> · direct C:\…\claude.exe` or `· npm shim → C:\…\cli.js`.
- **Windows Terminal** (PowerShell 7, Windows PowerShell 5.1 or cmd — the card shows the line for PowerShell and for
  the Command Prompt). In the old console window, selecting text (QuickEdit) pauses the worker until Esc. Ctrl+C,
  Ctrl+Break or closing the window stops it.

**Start lines** quote the file — user folders have spaces, and neither shell hands `~` to node.exe expanded — and
spell the home folder as USERPROFILE in both (never PowerShell's `$HOME`, § Set up):
`node "$env:USERPROFILE\Downloads\one-worker.mjs"` (PowerShell), `node "%USERPROFILE%\Downloads\one-worker.mjs"` (cmd); a port
of its own: `$env:ONE_WORKER_PORT = '47400'; node …` / `set "ONE_WORKER_PORT=47400" && node …`.

**What the worker does differently on Windows**:

- **Programs** — the worker starts every program through one module (`mcp/src/worker/exec.ts`). A bare name (`git`,
  `claude`, `gh`, `npm`, `npx` …) is looked up in `PATH` only — never in the repository or worktree it runs in; system
  tools (`cmd.exe`, `taskkill`, PowerShell for the folder dialog) by their System32 path. git runs only as
  `git.exe`. An npm / pnpm / scoop `.cmd` shim (Claude Code installed with npm, `npx`, `pnpm`) is **read, not run**:
  the worker starts what it points to (Node with the script, or the `.exe`).
- **What the programs start** — the programs One starts by itself (git, Claude Code, gh, glab, the System32 tools) get
  `NoDefaultCurrentDirectoryInExePath=1` and a `PATH` of absolute folders only (a relative entry would be read against
  the working folder), so what they start by a bare name (cmd.exe's commands, a Node child's own spawn) is not looked
  up in their working folder either. Your own `testCommand` / `analyzeCommand` and `ONE_WORKER_BROWSER` /
  `ONE_WORKER_PICKER` keep your environment as it is: their scripts may call a program in the working folder by its
  bare name (`gradlew`), as in your terminal — tests and analysis run the repository's own code by design. Some
  lookups ignore that variable — node-which in cross-spawn / execa (Claude Code's own `git`, the launchers of the MCP
  servers it starts) and Bun's own — so a **Claude Code stage** (plan, implement, document) **does not start** while
  the top of its folder (the task's worktree, else the repository or the stage's scratch folder) holds a file such a
  lookup could take: an extension Windows runs (your `PATHEXT` plus `.exe .com .cmd .bat .ps1 .js .jse .vbs .vbe .wsf
  .wsh .msc`) on a base name (any case — `ı`, `ſ` and the Kelvin sign as the disk itself folds them: the worker asks
  the disk whether `git.exe` opens `gıt.exe`) that is a program on `PATH` outside Windows' own folders (`%SystemRoot%`
  / `%windir%`, `C:\Windows` while neither is set: System32's `find`, `sort`, `tree`, `format`, `help`, `route` … are
  everyday file names — `find.js`, `route.js`, `convert.py` pass), the launcher of one of your MCP servers (the stdio
  `command` of the servers in `~/.claude.json`; your organisation's `managed-mcp.json` and the `managedMcpServers` of
  its `managed-settings.json` / `managed-settings.d` in `C:\Program Files\ClaudeCode` — also under `%ProgramFiles%`,
  and `%ProgramData%\ClaudeCode` of older Claude Code versions; every installed Claude Code plugin's servers that
  start a program by its name — `installed_plugins.json` in `~/.claude/plugins` or `$CLAUDE_CODE_PLUGIN_CACHE_DIR` and
  in each folder of `$CLAUDE_CODE_PLUGIN_SEED_DIR`, the plugin folders in `$CLAUDE_CODE_PLUGIN_DIRS`, each plugin's
  `.mcp.json` and `.claude-plugin/plugin.json`; with the repo's own Claude Code settings on, also its project entry in
  `~/.claude.json` and the repo's `.mcp.json`), or one of `git claude node npm npx pnpm yarn corepack bash sh ssh gh
  glab rg cmd powershell pwsh where python py uv uvx bunx bun deno docker podman pipx java dotnet git-lfs pnpx python3
  cygpath taskkill tasklist reg rundll32 explorer` (Claude Code itself starts the last three by name). A file the worker
  cannot read adds no name (`PATH` and that list stay). Not read: a plugin folder given only on Claude Code's command
  line (the worker passes none), your organisation's settings in the Windows policy registry
  (`HKLM\SOFTWARE\Policies\ClaudeCode` / `HKCU\SOFTWARE\Policies\ClaudeCode`, value `Settings`) and Claude Code's copy
  of remotely managed settings (`<config dir>\remote-settings.json`) — a server set only there counts through `PATH` and
  that list alone. So `gradlew.bat`, `mvnw.cmd` or `build.cmd` pass unless such a program is on your `PATH`. Right after
  an implement stage the worker looks again (a program Claude Code wrote there ends the stage the same way). The log
  says `plantedProgram` and names the file (the worker's terminal names the folder). Remove or rename it in the
  repository **and** on the task's branch — an existing worktree keeps the file: change it there (Git → *Show folder*
  prints it in the worker's terminal), or commit and push the change on the base branch and press *Update from base*
  (for a branch the worker made, *Discard worktree* works too once the base branch has the change: the next run branches
  from it) — then **Retry**. Test and Analyze stages are never refused for it.
- **cmd.exe** — only the person's own `testCommand` / `analyzeCommand` (worker.json, the setup page) and the
  `ONE_WORKER_BROWSER` / `ONE_WORKER_PICKER` programs may run through `cmd.exe`, and only when they name a `.cmd` /
  `.bat` the reader cannot read (`.\gradlew.bat`, a script of your own) — escaped for cmd (`/d /v:off /s /c`, every
  special character caret-escaped, no variable expands); an argument with a line break is refused (`commandRefused`).
  Nothing One sends — task data, branch names, titles, pull request / review text, model names, clone addresses — and
  nothing from a repository's content ever reaches a cmd.exe line. Claude Code, gh and glab never run through cmd.exe:
  a Claude Code `.cmd` the worker cannot read is refused (`claudeCmdRefused` — use the native installer, or set
  `CLAUDE_BIN` to `claude.exe` or Claude Code's `cli.js`). What your own tools do inside (npm running `scripts.test`
  through cmd.exe) is theirs, as in your terminal. A command the worker does not find in `PATH` gets `commandMissing`:
  a program inside the repository needs its path (`.\gradlew.bat`).
- **Long paths** — the worker's own git runs with `-c core.longpaths=true` (every call, never written into a
  config), and a task's worktree folder gets a short, safe name (`/` `\` → `-`, `<>:"|?*` → `_`, no trailing dot or
  space, device names such as `con` prefixed `_`, at most 32 characters plus 6 hex of the branch's hash when changed
  or cut). Branch names stay as they are. For your own git and tools run `git config --global core.longpaths true`
  once and switch on long paths in Windows (`LongPathsEnabled`, needs an administrator) — or set a short
  `worktreeDir` (`C:\w`). A "Filename too long" from elsewhere gets the hint `longpaths`.
- **OneDrive** — a repo inside OneDrive (Documents and Desktop often are): OneDrive downloads online-only files on
  demand and locks files while it syncs. The log warns (`onedrive`), the repo's worktrees go to
  `%USERPROFILE%\.one-worktrees\<name>` unless `worktreeDir` is set, and the clone folder is never inside OneDrive
  (nor iCloud Drive or `~/Library/CloudStorage` on a Mac — `cloudStorage`). Keep repositories on a local disk
  (`C:\code`), not on a network drive.
- **SSH and HTTPS sign-in** — git never asks while the worker runs it (§ Git): an unknown host key or a key that
  needs its passphrase fails at once with `sshHostKey` / `sshKey`. Git for Windows runs **its own ssh**, which does
  not see Windows' *OpenSSH Authentication Agent* service — a key added there with Windows' `ssh-add` does not help
  it. What works:
  - a key without a passphrase (nothing else to do);
  - **Git's own agent**: in the Command Prompt run `start-ssh-agent` (it comes with Git for Windows and asks for the
    passphrase once), then start the worker in that same window — it inherits the agent (`SSH_AUTH_SOCK`). In Git
    Bash: `eval "$(ssh-agent -s)"` and `ssh-add`, then start the worker there;
  - **Windows' agent**: `git config --global core.sshCommand C:/Windows/System32/OpenSSH/ssh.exe` once, the service
    running (as an administrator once: `Get-Service ssh-agent | Set-Service -StartupType Automatic;
    Start-Service ssh-agent`) and your key in it (`ssh-add`). With `core.sshCommand` set the worker adds no
    BatchMode (§ Git).

  HTTPS: sign in once in a terminal (`git fetch` in the repo) — Git Credential Manager keeps the login; the worker
  never opens its window (`gitSignIn`).
- **Files held open** — Defender, the search indexer or an editor can hold a file for a moment: the worker retries
  renames and folder removals; a worktree folder still held is left for the next time (`folderBusy`). A repo
  copied from another user account: `dubiousOwnership` (`git config --global --add safe.directory <folder>`, the
  worker's terminal shows the line; the worker never sets it). A stale `index.lock` after a crash: `gitLock` (the
  terminal names the file).
- **Stop** ends Claude Code's whole process tree (`taskkill /T /F`). Known gap: a grandchild whose parent already
  ended is not in that tree.
- **Ports** — Hyper-V, WSL and Docker reserve port ranges; listening inside one fails. The worker says so instead of
  "another worker" (`netsh int ipv4 show excludedportrange protocol=tcp` lists them): start it with
  `ONE_WORKER_PORT` set to a free port and set the same port in One (*before* the download). It listens on 127.0.0.1
  only — no firewall dialog.
- **Private files** — `icacls` instead of `chmod 600` (the worker's `--help` names your account):
  ```powershell
  icacls "$env:USERPROFILE\one-worker-cloud.mjs" /inheritance:r /grant:r "${env:USERNAME}:F"   # PowerShell
  icacls "%USERPROFILE%\one-worker-cloud.mjs" /inheritance:r /grant:r "%USERNAME%:F"   # cmd
  ```
- **Autostart** — Task Scheduler with a PowerShell loop that restarts after a crash but never after exit code 2
  (revoked, replaced, removed …), like systemd's `RestartPreventExitStatus=2` (§ Cloud worker):
  ```powershell
  # %USERPROFILE%\one-worker-cloud.ps1
  do {
    node "$env:USERPROFILE\one-worker-cloud.mjs" --no-browser
    $code = $LASTEXITCODE
    if ($code -ne 0 -and $code -ne 2) { Start-Sleep -Seconds 10 }
  } while ($code -ne 0 -and $code -ne 2)
  ```
  ```powershell
  $ps1 = Join-Path $env:USERPROFILE 'one-worker-cloud.ps1'
  $run = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`""
  Register-ScheduledTask -TaskName 'one-worker-cloud' -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Action $run
  ```
  At log-on, as you — Claude Code uses your login. The same works for a local `one-worker.mjs` (drop
  `--no-browser` if its setup page should open).
- **WSL2** works too, as on Linux: the worker in WSL, the repos in WSL's own file system (not under `/mnt/c` —
  slow), and the Windows browser reaches `ws://127.0.0.1:<port>` through WSL's localhost forwarding.

Not covered, by design: which DLLs a program the worker starts loads from its own folder is that program's own
hygiene (Git for Windows and Node load theirs safely); the worker adds no DLL folder to a child's environment and
changes no search mode. On every OS the programs the worker starts by itself (git, Claude Code, gh, glab, the System32
tools) get a `PATH` of absolute folders only: an empty, `.` or relative entry — on macOS / Linux the one way the system
looks in the working folder — is left out for them (and so for what they start: Claude Code's own `git`, its MCP
servers' launchers); on macOS / Linux a `~` or `~/…` entry becomes your home folder, as bash reads it. Your own
`testCommand` / `analyzeCommand` and `ONE_WORKER_BROWSER` / `ONE_WORKER_PICKER` keep `PATH` as it is.

## Cloud worker

**Local | Cloud** (*Settings → Coding worker → § A Where the worker runs*, per device and workspace in localStorage
`one.coding` → `via`): in a **team workspace on a One server** the worker can run on any computer — a build server,
a VM, the desktop under the desk — and connect **out** to the team server. No port to open, no VPN, no SSH tunnel
for the work itself. The server's **coding relay** passes the protocol between the member's One tab and that
worker; every frame is sealed end to end (below), the relay can neither read nor forge one.

```
One tab (browser) ──wss://<server>/coding/tab──▶ team server (relay) ◀──wss://<server>/coding/worker── one-worker-cloud.mjs
  this device's pairing key   session cookie      pairs tab ⇄ worker per   worker token (Bearer)      the other computer:
  seals / opens every frame                       (workspace, member);     seals / opens every frame   worktrees, Claude Code,
                                                  forwards sealed boxes                                tests, git, push
```

Cloud is offered only in a team workspace, to members (viewers run no coding tasks), on a server with the relay
(`CODING_RELAY`, docs/SELF_HOSTING.md). Local workspaces and static hosts keep **Local** only — the option says
why in text (*Cloud needs a team workspace on a One server*).

**Set up** — the card *Cloud worker in 3 steps*:

1. **Download one-worker-cloud.mjs.** One asks the server for a **worker token** (`onew_…`, only for you, only in
   this workspace) and builds the file like the local download, with a cloud preset:
   ```js
   globalThis.ONE_WORKER_PRESET = {"workspace":"team:<id>","origin":"https://one.example.com","port":47511,"pair":"<32 random bytes>","name":"Team","cloud":{"token":"onew_…"}}
   ```
   The token lives **only in the file** (never in the browser's storage). The pairing secret is in the file and on
   **this device** — as a **non-extractable** WebCrypto key in IndexedDB `one-coding` (`cloud:<id>|cloudpair|<token
   id>`; wiped with the workspace's copy on this device): script in One can use it only while it runs and can never
   read it out. localStorage `one.coding` → `cloudPairs` holds only the token ids this device has keys for (per
   workspace, newest first, at most 4; never synced, never in a backup). `port` is the workspace's own local port
   (47323 + 0…499 from its id, `cloudWorkerPort`). A cloud worker is paired with the device that downloaded it:
   another device of yours shows *Paired with another device* and offers **Download for this device** (asked first:
   it replaces the other one once it starts — until then that device keeps working and this one waits, *Waiting for
   your new download to start*, then connects by itself).
2. **Start it on the computer that does the work** — copy the file there (`scp`, a shared folder) and run
   `node one-worker-cloud.mjs`. It dials the server (`https` origins only; plain `http` only to 127.0.0.1) and
   keeps the connection (reconnects after 1, 2, 5, 10, 20, 30 s ± 20 %). Keep it running (tmux, a service).
3. **Tick the repositories on that computer** — its setup page opens there when it has a browser; on a server
   `node one-worker-cloud.mjs setup --no-browser` asks in the terminal, or forward the page from your own
   computer: `ssh -L <port>:127.0.0.1:<port> <host>` (the card shows it with the workspace's port) and open the
   address the worker prints. The page and the task tools stay on that computer's 127.0.0.1:<port> — the cloud
   worker accepts no tab there.

**Tasks run only while one of your One tabs is open** on the device that holds the key (any workspace page; the
tab hands out the work and writes the outcomes, exactly as with a local worker). The server keeps no queue and
runs nothing by itself. A tab in the background does not take the worker over from the one you look at. A tab another
tab or device took the worker from (*Another tab or device uses the cloud worker*) takes it back by itself once that
tab lets it go — the server lists the worker online without a tab (checked every 15 s and when you look at the tab
again). A device whose own new download has not started yet never takes the place of your active worker, also not
while that worker is offline for a moment (a restart, a network blip, a server redeploy): it waits for its own file.
Stages
longer than 10 minutes need such a tab open somewhere — otherwise the claim goes stale (`CLAIM_STALE_MS`) and
another worker may take the task over.

**A new download replaces the old one — once it connects.** The new token starts *pending*; the relay makes it
the member's active token on its first connection and only then revokes the older one and closes its worker
(`replaced`, exit 2). A pending token that never connects expires after 24 hours; a newer download replaces it at
once. Until then the working worker keeps working — also when the person downloads again while connected (the
link stays as it is: the server announces the online worker's pairing only once) and after several downloads in a
row (this device keeps the keys of every download whose worker may still connect: the active one as the server
listed it before the download, and the newest; a connect drops the keys of tokens the server no longer lists).
While a worker is online, the card asks before downloading another. **On the same computer**, stop the old worker
first: both use the workspace's port, and the new file says so (`port … is in use — … stop it first … or start
this one with ONE_WORKER_PORT=<a free port>`). **Revoke** (asked first) ends the token at once; the worker exits
with code 2 and never comes back.

**Its own folder and port.** A cloud worker keeps `worker.json`, `worker-state.json`, its scratch folders and its
default worktrees in `~/.config/one/cloud/<workspace>/` (`team:abc` → `team-abc`), and its task tools and setup
page listen on the workspace's own port (47323–47822, from the workspace id) — a local worker (47322) and cloud
workers of several workspaces run side by side on one computer. `--config` / `ONE_WORKER_CONFIG` and
`ONE_WORKER_PORT` still win.

**As a service** (systemd, user unit):

```ini
[Service]
ExecStart=/usr/bin/node %h/one-worker-cloud.mjs --no-browser
Restart=on-failure
RestartSec=10
# exit 2 = revoked, replaced, removed from the workspace, wrong workspace or no relay: do not restart
RestartPreventExitStatus=2
```

`chmod 600 one-worker-cloud.mjs` — the file is the token (the worker warns when others can read it). On Windows:
`icacls` and Task Scheduler instead (§ Windows).
`node one-worker-cloud.mjs check` asks the server who the token belongs to (`GET /api/coding/worker`): workspace,
member, state, online. A private CA: `NODE_EXTRA_CA_CERTS=/path/ca.pem`. An outbound HTTPS proxy is not
supported (the worker connects directly).

**Logs in cloud mode** are batched (every 250 ms or 200 lines) to keep frames few. Only log lines, progress and
the live git state are marked droppable (`k: "e"`); an honest relay drops them only when the worker sends more than
its budget (2,000 frames / 128 MiB per 10 s), and the tab then says *The server passed on only part of the worker's
updates (n left out)*. Questions, notes, an import's progress and result, requests, answers and finishes are never
marked. An import's progress goes out at most every 250 ms per task (its result at once). What waited while no tab
was connected is made small before it goes out (per task its newest 2,000 log lines in frames of ≤ 200, the newest
git state and progress, every question, note and import result) and goes out in paced slices (≤ 100 frames /
4 MiB, then 600 ms); a tab that pairs during a pause (a reload, a newer tab, a reconnect) gets the rest, still before
anything newer. A finish carries a `finishId`; the tab applies each one once even when the worker sends it
again after a reconnect. An **Import** ZIP goes through in 4 MiB pieces, paced by the tab to ≤ 96 MiB per 10 s (a
500 MB ZIP takes about a minute and a half); a half-sent upload is given up when its tab goes away.

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
| `cloneDir` | `~/one-repos` | Where the setup page and Import stages clone / import new repositories (`ONE_WORKER_CLONE_DIR` overrides). Never inside a synced folder (iCloud Drive, `~/Library/CloudStorage`, OneDrive). |
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
| `worktreeDir` | `<path>/../.one-worktrees/<name>` | Where task worktrees go (a repo in a synced folder: `~/.one-worktrees/<name>`). |
| `testCommand` | none | The Test stage — an **argv list** (`["npm", "test"]`), never a shell line; run in the worktree. A string is refused. A bare program name is looked up in `PATH` only; a program inside the repository needs its path (`["./gradlew", "test"]`, on Windows `[".\\gradlew.bat", "test"]`). |
| `testTimeoutSec` | `600` | |
| `analyzeCommand` | none | The **Static analysis** stage — an argv list like `testCommand` (`["npx", "eslint", "."]`, `["dotnet", "build", "-nologo"]`); the setup page guesses one (the `lint` script by lockfile, ESLint config, `.sln` / `.csproj`, `go vet`, `cargo clippy`, ruff, flake8). |
| `analyzeTimeoutSec` | `900` | |
| `push` | `true` | `false`: Ship commits only. |
| `pr` | `"gh"` | `"gh"`: `gh pr create` on a GitHub host, `glab mr create` on a GitLab host (an open MR is found first: `glab mr view <branch>`, state opened — no second MR) (when the tool is installed and signed in); otherwise (and with `"none"`) a compare / new-merge-request link for GitHub / GitLab remotes. Posting a review and merging need `"gh"` and the host's tool. |
| `forge` | `"auto"` | Links in One and the request tool: `"auto"` = by the remote's host name ("github" / "gitlab" in it); `"gitlab"` / `"github"` for a self-hosted GitLab or GitHub Enterprise under its own name (the setup page's **Host type**). An unknown host with `"auto"`: no links, no compare link either. An unknown value is a problem in `check` and reads as `"auto"`. |
| `claude.model` | Claude Code's default | A model name Claude Code accepts (the same rule as a stage's model, § Model per stage). A model One sends for a stage — the stage's or the task's own — wins over it. |
| `claude.maxTurns` | `30` | Upper bound per stage (a stage may ask for fewer). |
| `claude.permissionMode.implement` | the stage's | `acceptEdits` or `default` — overrides what the pipeline asks for. Plan stages always run in `plan` mode. A mode that skips permissions is refused. |
| `claude.allowedTools` / `disallowedTools` | `[]` | Claude Code's own syntax (`"Bash(npm test:*)"`). They decide first; anything else that needs a permission is asked in One (worker 1.11.0, § Permissions — **Always allow for this repo** adds its rule here, ≤ 100 per repo; the setup page lists them with a remove key). A Claude Code without the permission prompt refuses it, as before. |
| `claude.strictMcp` | `true` | `--strict-mcp-config`: during a task Claude Code gets only the task tools, not your other MCP servers. |
| `claude.mcpServers` | `[]` | Your own Claude Code MCP servers this repo may use (e.g. `["kb"]`): their tools are allowed and `--strict-mcp-config` is left out. Set on the setup page. |
| `claude.projectSettings` | `true`; `false` for code from elsewhere | May Claude Code load the repo's own settings — `.claude/settings.json` / `settings.local.json` (hooks, `apiKeyHelper`, MCP approvals), `.mcp.json`, `CLAUDE.md` — and your **local-scope** MCP servers for that folder (`claude mcp add`'s default scope)? `false`: it runs with `--setting-sources user` — your own `~/.claude` settings and **user-scope** MCP servers only, so a server in `claude.mcpServers` must be added with `claude mcp add -s user …` (the log says so, code `mcpUserScope`). The default is `false` for code from elsewhere, by the first rule that matches (§ Safety, "Nor when Claude Code starts on it"): the worker's mark `.git/one-worker-source`, else a folder inside `cloneDir`. Such settings run commands the moment Claude Code starts, even in a read-only stage. Set `true` once you trust that repo — the setup page's switch **Use this repo's own Claude Code settings** writes it (§ The setup page). A Claude Code without `--setting-sources` refuses the stage while the repo has `.claude/` or `.mcp.json`. |
| `maxUsdPerTask` / `maxUsdPerDay` | none | Cost limits (Claude Code's own `total_cost_usd`). |

## The pipeline

A **Coding** database (found by `Database.system: 'coding'`; created with the first task or by *Create the Coding
database*; in a team workspace it is private to you). Rows are tasks: **Repo**, **Stage**, **Priority**, **Branch**,
**Git** (status text), **PR / commit**, **Cost**, **Worker**, **Claimed at**; the page holds the goal and the
acceptance criteria — and what the pipeline writes (the plan, summaries, rework notes, answers; origin `coding`).
Views: *Pipeline* (board grouped by Stage) and *All tasks*.

The stages are the options of the Stage select; `Database.pipeline` says what each one is (**Pipeline** on #/coding
edits it — name, kind, Auto, Claude Code mode, max turns, model, git action, next stage, instructions; a locked
database refuses):

| Default stage | Kind | Auto | |
|---|---|---|---|
| Backlog | queue | – | Waits. |
| Ready | queue | ✓ | The worker takes it on to the next stage. |
| Plan | plan | ✓ | Claude Code in **plan** mode (changes nothing) hands in a plan → the **Plan** section of the page. |
| Approve plan | gate | – | **Approve** · **Rework…** (instructions → back to Plan). |
| Implement | implement | ✓ | Claude Code (`acceptEdits`) changes the worktree; its summary goes into the page. |
| Test | test | ✓ | `testCommand`. Fails once → back to Implement with the output as rework note; fails again → the next gate. |
| Review | gate | – | Diff + tests. **Approve** · **Rework…** (→ Implement). |
| Ship | git (pr) | ✓ | Commit (`git add -A`, message = title + summary + `One-Task: <id>`), push `-u`, pull request (or compare link) → **PR / commit**, the ship note (§ What One records). |
| Done | done | – | **Clean up** removes the worktree + branch once merged. |

### Model per stage

A stage that runs Claude Code (plan · implement · doc) may name the model it runs with: `PipelineStage.model` — an
alias Claude Code accepts (`opus` · `sonnet` · `haiku`), a full model id (`claude-fable-5-1`, `claude-opus-5-5` …) or
an own name. **One rule** for every model name (protocol.ts `MODEL_NAME`, also `claude.model` in worker.json): letters,
digits and `. _ : - [ ]`, 1–100 characters, starting with a letter or digit (a leading `-` would read as a flag).
`readPipeline` sanitizes it (other kinds keep none), `savePipeline` writes it. The pipeline editor's stage details:
**Model** — *Standard (worker default)* · Opus · Sonnet · Haiku · Fable · *Own…* (a name, checked as it is typed;
Save waits while it fails and names the stage next to it). *Own…* is a state of its own (`Draft.own`), never worked
out from the text, so a name that passes through an alias while typed (`opus` → `opus[1m]`) keeps its field; picking an
entry never moves the focus, and an empty name is a hint until the field is left. A set model shows as a mono chip in
the stage's row (an own id without its `claude-` prefix, the full name as its title; on its own line in narrow rows;
*Model name?* for an own name not typed yet).

**Per task, per device**: the task panel's **Model** pick (next to Approvals) — *As the pipeline* or one model for
every Claude Code stage of the task (the known ones and the own names the pipeline uses). Kept in the task's local
state (`TaskLocal.model`, IndexedDB `one-coding`), never synced.

**Which model runs**: One sends `stage.model` = the task's pick ?? the stage's ?? `null` (tasks.ts `modelFor`, in
`pickNext`); the worker drops a name that fails the rule (sanitizeTask) and passes `--model <name>` — the model from One,
else the repo's `claude.model`, else none (Claude Code's default) — as one argument of the argument list, never through
a shell. The log says which (`Model: claude-fable-5-1 (chosen in One)` · `(worker.json)` · `Claude Code's default`); while
Claude Code runs, the task panel's chips show the model it reports (an alias resolves to the model behind it).

**Older workers**: a stage whose model is set needs the capability `model` (`stageNeeds`). A worker that does not
name it never gets such a stage — the task fails with *This stage needs a newer coding worker* (Retry after
downloading again, or clear the model) — while stages without a model still go to it.

A task is taken when its stage is **Auto** (or after **Run now** / **Retry** / an answer on this device), its repo
is free on a connected worker, it is not claimed by another worker within 10 minutes, and — in a team workspace —
it is confirmed on this device. Highest priority first, then the oldest. The claim (**Worker** + **Claimed at**) is
renewed every minute; a claim without heartbeat for 10 minutes may be taken over.

### The task panel

On a task's page, between its properties and its body: the stage timeline; what it waits for (**Approve**,
**Rework…**, **Answer**, **Stop**, **Retry**, **Run now**, **Confirm on this device**; worker 1.11.0: **Claude wants**
— a permission, § Permissions — and **Step limit reached (n/n)** with **Continue (+N steps)** · **Start over**, § Claude
Code); after a run that asked for permissions, one line "Permissions in the last run: n asked · n allowed · n
refused"; tabs **Log** (live, the last
2000 lines per task on this device), **Plan**, **Diff** (per file, unified, syntax colours, big files folded, binary
files skipped), **Tests** (the output's tail), **Git** (branch, base, ahead / behind, pushed, uncommitted, commits,
conflicts — and the git actions). The log, plan, diff, tests and git state live in this device's IndexedDB
`one-coding` (never synced, wiped with a team workspace's copy); the row carries what everyone sees.

### Git

Always an argument list through `mcp/src/worker/exec.ts` (git only as `git.exe` on Windows) — never a shell line;
hooks and your git config apply as usual. On Windows every git call gets `-c core.longpaths=true` (§ Windows).

- **A branch and a worktree per task**: `git fetch`, then `git worktree add -b <branch> <dir> <remote>/<base>`. The
  main checkout's working tree is never touched. `git worktree prune` runs on start.
- **No terminal for git**: git runs in its own session without a terminal (`GIT_TERMINAL_PROMPT=0`,
  `GCM_INTERACTIVE=never`), so a password, SSH passphrase or host-key question fails at once with git's message instead
  of waiting (on macOS / Linux an SSH askpass program you set up — `SSH_ASKPASS` with a display — may still ask, as
  before). Use an SSH agent / keychain or a credential helper.
- **SSH BatchMode — Windows only**: when you set nothing for SSH (`GIT_SSH_COMMAND` / `GIT_SSH` in the environment,
  `core.sshCommand` in the repo's, global or system config), the worker on Windows adds
  `GIT_SSH_COMMAND='ssh -o BatchMode=yes'` — ssh would otherwise ask on the worker's own console window, where nobody
  answers. A clone has no config of its own yet, so a conditional include cannot be checked before it exists: any
  `includeIf` section in your global or system config counts as set (it may set `core.sshCommand` for the new
  repository) and the worker adds nothing for that clone — its terminal says so. Setting `core.sshCommand` yourself
  — plain `ssh` too — opts out. **macOS and Linux: nothing is added**, as before 1.9.0.
- **Hints**: after git's error line the log adds a hint in your language: `sshHostKey`, `sshKey`, `gitSignIn`,
  `dubiousOwnership`, `gitLock`, `gitIdentity`, `longpaths`. git's own guess at who commits (`got '<account>@<computer>…'`)
  never reaches One. A fetch for a new task that fails or takes over 60 s
  (`ONE_WORKER_FETCH_MS`) is logged and the task goes on from the local refs.
- **iCloud Drive (macOS)**: a repo under iCloud Drive (or ~/Documents / ~/Desktop when they sync) gets a warning in
  the log — git waits whenever a file is only in the cloud. Its worktrees go to `~/.one-worktrees/<name>` (outside
  iCloud) unless `worktreeDir` is set. The same for a repo in `~/Library/CloudStorage` (`cloudStorage`) and, on
  Windows, in OneDrive (`onedrive`). A checkout (`git worktree add`) may take up to 10 min (`ONE_WORKER_CHECKOUT_MS`)
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
  input, cache reads at the model's rate; a model priced higher for long prompts counts a message whose whole prompt —
  input + cache writes + cache reads — is over its line at that tier; unknown model → none) until the result event's
  exact `total_cost_usd`. One keeps it in memory only (`useCoding.progress`) and drops it when the stage ends.
- **Live diff**: while a stage other than plan runs, the worker checks `git status --porcelain` every 30 s
  (`ONE_WORKER_LIVE_GIT_MS`) and sends a `git` event (the same snapshot as at the end) whenever the worktree changed —
  the panel's Files chip and the Diff tab follow along.
- **In One while it runs**: the task panel's *Now* line (the last log line, its age ticking), the chips *Step x/y*,
  *≈ +$* (this stage's estimate, on top of the task's cost) and *Files n +a −r* (opens the Diff tab); #/coding shows
  the Now line under each running task. **Notifications** (Settings → Coding worker, per device, localStorage
  `one.coding.notify`): the gate / question / failed / done toasts also become a browser notification while the tab
  is hidden or another window has the focus (coding/notify.ts); a click focuses One and opens the task.
- **Approvals** (One, per device): *all* (plan gate + review), *review* (the gate after a plan stage passes by itself),
  *none* (every gate passes). Kept per task in `TaskLocal.approvals`; a new task gets this device's default
  (localStorage `one.coding.approvals`, stamped by `createTask`), which only **Use for new tasks** (`setDefaultApprovals`)
  writes — a task's pick never changes it (another tab follows through the `storage` event). A row that becomes a task on
  this device gets a level of its own at that moment (tasks.ts `startApprovalsWatch`, local.ts `stampApprovals` — one
  read-modify-write of the stored state, a pick already there stays): a row new here (the board's "+ New", an agent, a
  team task arriving) the default in effect when it was created; a page dropped on a pipeline database in the sidebar or
  a row moved in (MCP `one_move_row`) **today's** default — never the one in effect when the page was written; never at
  load, for an eject, or between two pipeline databases. A task still without one (made before the stamp, or arrived
  while no tab was open) takes the default in effect when its row was created: each change notes the default it replaces
  with the time (localStorage `one.coding.approvals.history`, ≤ 50, in the order written — `u` only grows, a clock set
  back reorders nothing; state.ts `approvalsAt`) — and that level is frozen as its own once this device resolves it (the
  panel shows it, a stage finishes). Rows whose creation time is ahead of the change (another device's or the team
  server's clock) are stamped with the old default by `setDefaultApprovals` — a new default never changes an existing
  task. Limit: a task of another workspace of this browser created within the clock difference before the change and
  never shown here can still follow it. A gate with `hold`
  (**Always stop here**, pipeline editor; `PipelineStage.hold`, gates only) is never skipped (`skipsGate`; the log says
  *"<gate>" always stops — waiting for you.*); tests failing twice still stop at the next gate. `hold` joins the task
  version only when set (trust.ts `pipelineKey`, like a stage's model): a pipeline without one hashes as before.
- **Reuse a branch**: pick it in the task panel's Branch picker (the worker announces each repo's local branch
  names, newest first, ≤ 100 — names only, never the base branch), type it into the task's **Branch** field, or use
  *Existing branch* in New task. It must exist
  (locally or on the remote — then it is tracked); it is never reset. A branch checked out in the main checkout is
  refused, and so is the repo's base branch (Ship would push straight to it).
- **Git actions** in the panel are fixed verbs: **Refresh**, **Commit** (message), **Push**, **Open PR**, **Update
  from base** (first merges `<remote>/<branch>` in when the remote task branch has commits HEAD lacks — fast-forward
  when it can, never a rebase, never a force, log `remoteMerged`; then the base: rebase while the branch was never
  pushed, else merge; a worktree with uncommitted changes is refused; conflicts are listed per file and left for a stage — or you — to resolve, never auto-resolved), **Show
  folder** (the path is printed in the worker's terminal only). **Force push** (`--force-with-lease`) and **Discard
  worktree** are confirmed twice. Discard removes the worktree the worker made (with its uncommitted changes) and
  deletes the branch only if the worker created it. **Clean up** does the same only after the merge and never forced.
- **Merge request** (`comment-pr`, `merge-pr`, git.ts `commentPr` / `mergePr`; confirmed in One): **Post review** sends
  the task's newest review (`TaskLocal.review`, from a doc stage with `output: 'review'`) as the tab's `message` —
  `glab mr note <branch> --message …` / `gh pr comment <branch> --body …`; **Merge** finds the branch's open request
  (`glab mr view` / `gh pr view`) and merges it — `glab mr merge <branch> --yes` (the project's merge method) / `gh pr
  merge <branch> --merge` (then `--squash`, `--rebase` when the repository allows only those). Both need `pr: "gh"`
  and the host's tool signed in; a dirty worktree is not merged; the branch stays (Clean up); a fetch follows.
- **Log codes of a ship** (worker 1.10.0): `committed`, `nothingToCommit`, `pushed`, `forcePushed`, `pushOff`,
  `pushRejected` (a non-fast-forward push: Update from base, then Retry — the worker never force-pushes on its own; a
  `[remote rejected]` from a hook or a protected branch keeps git's own line), `requestOpened` / `requestExisting` /
  `requestLink` ({ kind: mr | pr, url }), `requestNone` ({ remote }: not a host the worker knows), `reviewPosted`,
  `requestMerged`, `remoteMerged` — the keys' lines are coded too. glab's / gh's own words stay uncoded (scrubbed).

### What One records (ship log)

Worker 1.10.0 (`can` 'ship' — it gates no stage: an older worker's git stages run as before and One writes their
summary note; a worker without it shows **Download again**, and the plate says what the newer one adds rather than
"skips stages" while 'ship' is all it lacks — protocol.ts `WORKER_EXTRAS` / `workerLacksOnlyExtras`). Every git stage (commit · push · pr · comment · merge;
also a `failed` outcome after its commit) and every git key (commit · push · force-push · pr · comment-pr · merge-pr)
returns a `ShipRecord` (protocol.ts) in `StageOutcome.ship` / `GitResult.ship`: `action`, `from` (stage | key), `at`,
`branch`, `commit` { sha } (null: nothing new to commit), `head`, `pushed` { remote, force? }, `pushOff`, `request`
{ url, how: opened | existing | link | commented | merged }, `web` (below) and `failed` { step: push | request, code?:
pushRejected }. The key 'pr' whose request fails after the push answers `GitResult.error` (and still `ship`) instead of
throwing; `message` says both in English for older apps. Update from base, refresh, reveal, discard and cleanup write
no record. The tab waits for a key's answer as long as the worker may take (service.ts `GIT_KEY_MS`: push 8 min, pr
12 min, merge-pr 18 min …; a link that drops ends the wait at once) — a key's record has no redelivery: a tab that
reloads meanwhile writes no note for it (the push / request happened; the device log has the coded lines).

- **Where**: One checks it again (coding/ship.ts `cleanShip`: the branch by git's own rules — any name git takes, umlauts
  too, no control / bidi marks —, shas, the remote's name, `cleanWeb`, a request only on `web.base` + "/" as a URL
  writes it, http(s), no credentials, no fragment) and writes ONE grey callout per record that says
  anything (`shipShows`; a record that says nothing — nothing new to commit, nothing pushed — writes none, and never
  the stage's English summary) at the end of the task page: **"<stage> · <date time>"** (`shipWhen`: "14 Oct 14:32" ·
  "14.10. 14:32", with the year when it is not this year's; a record delivered late keeps its own time — only a time
  more than 5 minutes ahead of the tab's clock becomes now) or **"Git (by hand) · …"** for a key, then the line *Commit a1b2c3d · Branch one/… · MR !42 · pushed
  to origin/one/…* in the person's language. A stage's note sits in finishStage's `keepTrust(aiWrite(…))` under the stage
  run's writer (`coding:<task>:<run>`); a key's in gitTask's `keepTrust(…)` under `you~ui` — the task version stays
  trusted (team: the version takes the page). Only the line and the PR / commit value go into the synced page / row;
  the full git snapshot, `git.web` and the log stay per device.
- **Links only to what is on the remote**: the commit, the head and the branch are linked when this record pushed them
  or a request on the host exists (opened · existing · commented · merged); a commit only on the person's computer
  (push off, push failed, the Commit key) shows its short sha as text. GitHub `<base>/commit/<sha>` · `<base>/tree/<branch>`,
  GitLab `<base>/-/commit/<sha>` · `<base>/-/tree/<branch>` (`commitUrl` / `branchUrl`, each path part encoded). The Git
  tab links the branch the same way (`GitInfo.web`) and each commit the worker marks as on the remote task branch
  (`GitCommit.remote`: not in `git rev-list <remote>/<branch>..HEAD` — per commit, never by its place in the by-date log,
  where local and pushed commits interleave after Update from base merged the remote branch in). Its **Find on the
  host** row shows `One-Task: <task id>` with a copy key; its request group's **Open** opens a request (or the link to
  create one), never the commit PR / commit holds without one (`isCommitUrl`).
- **PR / commit** = `prFieldNext`: the request's address wins (a 'link' never over an open request's address); else the
  pushed commit's link (commit, else head) — only into an empty field or over an older commit link of the same
  repository. Nothing else is overwritten.
- **The trailer**: commit messages the worker makes (stages and the Commit key — not a merge commit of Update from
  base) and request descriptions end with `One-Task: <task id>` (the page id; the Git tab shows the line to copy)
  — built as text (run.ts `withTaskTrailer` / `requestBody`), never with `git interpret-trailers` / `git commit
  --trailer` (a `trailer.<token>.cmd` in the person's or the repo's config runs commands). A `One-Task:` line in
  Claude's summary or a typed message is removed first.
- **`web`** = the repository's web address: scheme + host (+ the port of an http(s) remote) + project path, never a user
  name, token, query, fragment or local path (`cleanWeb` on both sides, the one rule); from the remote URL (`webOf`,
  worker.json `forge`; an ssh remote's host as ssh names it — `ssh -G <host>`'s `hostname`, so an alias in ~/.ssh/config
  such as `git@gitlab.com-work:…` links to gitlab.com; nothing connects, asked once per host per 10 minutes, the host as
  written when ssh is missing or says nothing usable. ssh's answer only resolves an alias, it never replaces a working
  web host: github.com / gitlab.com as written stay (ssh is not asked), an IP literal (`HostName 10.20.30.40`) or a host
  below the written one (`HostName ssh.gitlab.company.de` for gitlab.company.de) is ignored, and the "SSH over the HTTPS
  port" fronts `ssh.github.com` / `altssh.gitlab.com` — ssh's answer or the host as written — link to github.com /
  gitlab.com) — or, when gh / glab named the request, from that address (another
  web host). The request's address is kept as a URL writes it (host lower-cased, no default port): it always starts
  with the web address taken from it; One checks that and keeps that form.
  The owner agreed that host + project path go into the page; in a team the Coding database is the member's private one.
- An older app ignores `ship` and keeps writing `outcome.url` / `summary`, which the worker still sends.

### Claude Code

`claude -p --output-format stream-json --verbose --permission-mode <plan|acceptEdits|default> --max-turns N
[--model <the stage's model from One, else claude.model>] [--allowedTools …] [--disallowedTools …] [--max-budget-usd …] --mcp-config <temp file>
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
(they change nothing on the computer), so plan mode allows them too. `one_task_permission` (worker 1.11.0) is Claude
Code's `--permission-prompt-tool` (§ Permissions) — called by Claude Code itself, never meant for the model. Nothing
else in One is reachable through them; the token dies with the run.

**The run ends with Claude Code** (worker 1.11.0, every model): at its `result` the heartbeat stops and the worker
notes the process tree under Claude Code; once Claude Code's process has exited the stage ends after a short grace
(1.5 s for the last output lines) — it never waits for the output pipes to close. Anything Claude Code started and
left running (a dev server, a watcher holding its output open) is ended: SIGTERM, SIGKILL after 2 s on macOS / Linux
(found by the tree at the result, the process group and an environment mark `ONE_WORKER_RUN` only the worker's run
carries — read from `/proc` on Linux, `ps -E` on macOS); on Windows by the kept parent ids and creation times, with the
tree also sampled every few seconds and at every tool result while Claude Code runs (a shell that put a server in the
background and ended is seen while it ran). A process counts as the one seen only with the same id, name and start
time (Windows creation time, Linux `/proc` start ticks) — a reused id is never followed, nor an ended Claude Code's
id that another program holds now. Windows ends each process found with `taskkill /F` (never `/T`: the list is the
tree that was checked). One log line names what was ended (code `claudeLeftovers`). Not caught on Windows: a
program whose starting shell ended between two samples. A Claude Code that has not exited
30 s after its result is ended too (`claudeLingered`). **Stop** ends the whole tree as before. The JETZT line and the
progress clear when the stage ends — also when the link drops.

**Scratch folder** (worker 1.11.0): every task gets `<config dir>/scratch/<task id>` (mode 0700), passed with
`--add-dir` (read from `--help`; an older CLI runs without it, one log line `addDirOff`). The prompt names it for
temporary files (the path stays on the computer — log lines and everything One gets show `<scratch>`) and tells Claude
Code to edit files with its Edit / Write tools, never `sed -i` or a shell redirection, and to stop what it started. The
folder goes with the task's branch / worktree (Discard, Clean up).

**Step limit** (worker 1.11.0): a stage that ends at `--max-turns` (`error_max_turns`) fails as **Step limit reached
(n/n)** (`outcome.stepLimit`, log `stepLimit`). **Continue (+N steps)** — in the task panel, Preflight's failed card
(key A, VON HAND, never in ⇧A) and the AI terminal (`task_action` `continue`) — runs the stage once more on the same
worktree with the stage's Step limit as it is now (`+N` reads the pipeline, `stageSteps` — what `pickNext` hands the
worker; never the stopped run's) and a note that it stopped at its limit (`TaskPayload.resume`); its cost counts like
any run's. **Start over** runs the stage again with its original instructions in the SAME worktree (everything the
stopped run changed stays; Claude Code is not told about it) — Discard worktree first for a clean start. A worker that
does not name 'continue' gets Start over only (Preflight's failed card then says so instead of "Continue").
The pipeline editor's **Step limit** is each stage's `maxTurns` (≤ the repo's `claude.maxTurns`).

### Permissions

Worker 1.11.0, every model: Claude Code runs with `--permission-prompt-tool mcp__one-task__one_task_permission`
(detected from `--help`, or from version ≥ 1.0.0 — the flag is not listed; an older CLI runs without it and refuses as
before, log `permissionOff`). When Claude Code needs a permission:

0. Answered by the worker itself, never on a card: `ExitPlanMode` (Claude Code switches it on in headless runs with a
   permission prompt tool and asks "Exit plan mode?" — "Allow" would leave plan mode and implement inside a plan stage;
   the worker refuses with "your plan was received" and the plan comes from the call as before), `AskUserQuestion`
   (pointed to `one_task_ask`), `EnterPlanMode`. And never judged on a cut copy: the worker gets each field it judges
   whole — the command, the file, the address; an MCP tool's whole input as JSON — up to `PERMISSION_FIELD_MAX` (4,000
   characters). A longer one is refused at once (`how: long`; taskmcp refuses it whatever the worker answers), as is a
   text too long for the card (`PERMISSION_WHAT_MAX`). The allow returns Claude Code's input untouched — the fields
   judged and shown are that input's own. A line break shows as ↵ on the card.
1. The repo's `claude.allowedTools` / `disallowedTools` decide first (Claude Code's own rules; the worker checks them
   again) — `permissionAllowed` / `permissionDenied` with `how: rule`.
2. Otherwise the worker HOLDS the tool call and asks One: the task shows **WAITING FOR YOU · PERMISSION**, the card
   **Claude wants** says what (the tool and the worker's scrubbed description: the command, the file, the address) with
   **Allow once** · **Always allow for this repo** · **Refuse**; Preflight's lamp **Claude wants** lights (one VON HAND
   card per request, never in ⇧A or a swipe), and — with notifications on (Settings → Coding worker) — a browser
   notification comes while One is in the background. Only the worker's own tab (Local, or the paired tab through the
   relay) gets and answers it, and only a tab whose hello says `can: ['permission']` (TAB_CAN): with no such tab the
   request is refused at once (`how: away`); when the last one goes, the waiting ones are refused after 60 s. The card is
   keyed by the request: the next one is a fresh card whose keys wake after 400 ms (a double-click never answers a
   request nobody read).
3. One sends only the request's id and the verb (`once` · `always` · `deny`). **Always** is stored BY THE WORKER in its
   worker.json (`claude.allowedTools`) — the rule the card showed: a program and its subcommand (`Bash(npm test:*)`,
   `Bash(npm run lint:*)`), an MCP tool by its name, a web fetch by its domain. Broad rules are never offered: shells,
   interpreters in any version (`python3.12`, `node22`), runners of other programs (`npx`, `uvx`, `pipx`, `cross-env`,
   `tsx`, `npm exec` / `x`, `yarn dlx`, `uv run`, `go run` …), installs, a runner without its real subcommand
   (`npm --version` would give `Bash(npm:*)`), tools that read or write files by path (`cat`, `ls`, `grep`, `tar` …),
   `rm` / `sed` / `mv`…, `git`, `curl`, commands with quotes, globs, pipes or paths outside, file edits; a read outside
   the repo and the scratch folder is "once" only. The setup page's Save removes only the rules the page removed from
   the list it loaded (`allowedWas`): a rule "Always" added while it was open stays.
4. No answer in 15 minutes: refused (`how: timeout`). Stop, or the run ending, refuses what is open (`stopped`).

The stage summary carries `outcome.permissions` { asked, allowed, refused } — the panel's line. Log codes:
`permissionAsked`, `permissionAllowed`, `permissionDenied`, `permissionAlways`, `permissionAlwaysFailed`,
`permissionNeeded` { tool } (a refusal Claude Code reported without asking — instead of its raw warning).

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

**Pages that go along**: page mentions, `pageLink`s and `#/p/<id>` links in the readable part of a task — and the
pages linked in the readable part of THOSE pages (one level deeper) — are appended to the task text as read-only
Markdown (a row with its filled fields, a database with its entries' titles; coding/refs.ts `refPlan`), ≤ 8 in all:
the pages of the stage's own answers and rework note first (they are the turn's), then the task's, then the nested
ones (each says *Linked in “…”*). One level deeper only each page's first 8 linked pages count (`deeperOf`), and never
a page the person did not give: a mail (or a mail directory), a memory, a row of One's own databases (pipelines, test
cases …), or — for a shared task in a team — a private page. Pages Claude sees named but does not get — over the
limit, linked deeper, kept back — are listed after them with how to ask for them (≤ 20 names, the rest counted; a page
outside the version only by its id). The task version hashes every live page the task's whole content points to and
the first 8 each of those points to (`refIdsOf`: id, title, fields, content) — the same list the hand-out takes from,
whatever its order; only pages of the version that was checked go along. A Markdown link's label is no address: a page
titled `Kit #/p/…` names nothing but itself.

The person's text fields that go to Claude Code (the answer, the rework note, the new task's goal and criteria) are
`RefField`s: "@" / "one:" open the editor's page search; a pick shows as *@Title* and is sent as `[@Title](#/p/<id>)`
(a new task's page turns it into a page mention). "Give the page" offers the pages Claude's question names in quotes
(exact live titles; several of one name with their paths). Every page's permalink (`lib/permalink.ts`) — or a bare
`#/p/<id>` — pasted there becomes *@Title* too (a link to a block, `?b=`, stays as pasted; its page goes along all the
same). "Goes along" opens a page in the side peek, and an unsent answer or rework note is kept per task and stage in
the tab, so a look at a page never loses what is being written.

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
merge — gate, a hold gate in new pipelines (Approvals never skip it; stored pipelines are not changed) · Post review —
git `comment` · Merge — git `merge` · Done; nothing is posted or merged before the gate;
`help:review-merge`) and, for Business analysis, **Spec → stories** (… Approve spec · Stories — doc, output stories ·
Done). Git actions `comment` (needs a review; fails without one) and `merge` (refuses uncommitted or unpushed work).
A browser for reviews: the person's own Claude Code MCP server (e.g. `claude mcp add -s user playwright npx
@playwright/mcp@latest` — the user scope, so it reaches every repo, also one whose own settings stay out — then
`playwright` under the repo's MCP servers on the setup page) — One never reads the person's browser tabs.

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
  `<repo>`, worktrees folder → `<worktrees>`, home → `~`, temp → `<tmp>`; on Windows in every spelling — any case,
  `/` for `\`, MSYS `/c/Users/…`, JSON-escaped `\\`, `file:///C:/…`, the home folder's 8.3 short name). The config's
  commands are never sent; an error names a command by its program name only.
- **The repository's web address, nothing more.** Through ship records and `GitInfo.web` (worker 1.10.0) One learns the
  repository's web address — scheme, host, project path (`cleanWeb` on both sides) — never a user name, token or local
  path; request addresses come from gh / glab or the compare link and must lie on that address. The setup page's scan
  still learns the remote's host only (§ Finding the repositories).
- **No git or Claude Code from the repository.** Every program the worker starts goes through `mcp/src/worker/exec.ts`
  — an argument list, never `shell: true`. One never takes git or Claude Code from the repo folder: on every OS the
  programs One starts by itself get a `PATH` of absolute folders only (an empty or `.` entry would make macOS / Linux
  search the working folder); on Windows a bare name is looked up in `PATH` only, never in the repo or worktree it
  runs in; `.cmd` shims are read, not run; the programs One starts by itself look nothing up in their working folder
  either (`NoDefaultCurrentDirectoryInExePath`), and a Claude Code stage does not start while a program a lookup by
  name could take sits at the top of its folder (`plantedProgram`). Tests and analysis run the repository's own code
  (your worker.json commands, with your environment as it is). Only your own worker.json commands and
  `ONE_WORKER_BROWSER` / `ONE_WORKER_PICKER` may run through cmd.exe, never anything One sends or a repository holds
  (§ Windows).
- **One cannot command.** It sends task data and the fixed verbs (`stop`, the git verbs above) for repos in the
  config. Unknown verbs, unknown repos and malformed tasks are refused; tasks of a `gate` / `queue` / `done` stage
  are never run.
- **Claude Code keeps its permission rules.** No flag that skips permissions is ever passed (and a config that asks
  for one is refused). Task text is untrusted input: it is data in the prompt, after the worker's own rules.
- **Team workspaces**: a worker only takes tasks written or confirmed **on this device** — the SHA-256 of the task's
  title, page, **Repo**, **Branch** and **Stage** and the pipeline (every stage's name, kind, Auto, mode, turns, git
  action, next stage, instructions and model — a stage without a model hashes as it did before models existed, so
  confirmed tasks stay confirmed) must be in this device's trusted set (IndexedDB `one-coding`). A task's own model
  (`TaskLocal.model`) is not part of it: only the person at this device can set it, so there is nothing to confirm. New tasks made
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
- **Imported code never runs at import** (worker 1.8.1): a ZIP (setup page or an Import stage) can bring no git folder
  — no `.git` in any spelling (case-insensitive disks, macOS and Windows, would otherwise take a `.GIT/config` as the
  repository's own, whose `core.fsmonitor` `git add` runs as a command and whose hooks `git commit` runs) and no bare
  repository under another name — and the import's commit never reads a git config inside the folder (§ The setup
  page). A clone is a plain `git clone` (never `--recurse-submodules`); git keeps a remote's hooks and config out
  itself.
- **Nor when Claude Code starts on it**: headless Claude Code (`-p`) asks no workspace-trust question, so a repo's own
  `.claude/settings.json` hooks, `apiKeyHelper`, `settings.local.json`, `.mcp.json` servers (with an approval in those
  settings) would run as Claude Code starts — even in a read-only document or plan stage. On code from elsewhere
  (`claude.projectSettings` false, § worker.json) Claude Code runs with `--setting-sources user`: only the person's
  own settings and **user-scope** MCP servers load, not the repo's (its `CLAUDE.md` is left out too, and so are the
  person's local-scope servers for that folder — `claude mcp add`'s default; with `claude.mcpServers` set the log
  says to add them with `-s user`, code `mcpUserScope`). Code from elsewhere, by the first rule that matches
  (config.ts `sourceOf`) — the log line names it with the way to trust the repo (codes `projectSettingsOffCloned` ·
  `…Imported` · `…Marked` · `…Folder` — also when worker.json holds the "false", as Save writes it for a row it showed
  off; `…Set` only for a repo of the person's own that worker.json switches off), and so do the setup page and
  `check`:
  - the mark `.git/one-worker-source`: `clone` (a clone, and a folder already cloned from the same address that is
    added again in `~/one-repos`), `zip` (an import), or — once per config (worker 1.8.1, recorded in
    `worker-marks.json` next to worker.json) for repos of worker.json without a mark and without a `projectSettings`
    of their own, which older workers left unmarked — `zip` for an older import wherever it lies (1.8.0's page imported
    into any folder it was given): a root commit `Import <file>.zip` in a folder named as the worker names an import's
    (`folderName` of `<file>` without `.zip`, then `-2`, `-3` … — compared without case on macOS and Windows; in
    `~/one-repos` whatever the folder is called now). A person's own repository whose first commit only reads so (a
    legacy dump committed by hand, in a folder of another name) is never marked: no commit message alone marks a repo
    for good outside `~/one-repos`. One in a folder named after that very ZIP cannot be told from an import and is
    marked (fail-safe: its settings stay out until the setup page's switch turns them on). And `folder` for a clone in the DEFAULT clone folder `~/one-repos` (its folder named
    after its origin's project, as the worker names clones). A clone folder of the person's own choice is never marked from:
    1.8.0 took any (`~/code`, `~`), and the person's own checkouts there look like clones; the clone folder rule covers
    them while `cloneDir` points there (and Save writes the "off" it showed). The setup page names what was marked
    until the person takes note ("Got it" → `worker-marks.json` `seen`); the terminal log says it at the start. A mark
    stays with the repo wherever `cloneDir` points later.
  - else a folder inside `cloneDir` — compared as written and through links (realpath), without case on macOS and
    Windows. This rule follows `cloneDir`: a wide one (`~/code`, `~`) takes in the person's own repos too; their line
    says "lies in the worker's clone folder", never "cloned".
  An older Claude Code without `--setting-sources` refuses such a stage while the repo has `.claude/` or `.mcp.json`.
  The person trusts a repo with the setup page's switch (or `"claude": { "projectSettings": true }` by hand). The
  imported code itself runs only where the person lets it: the test and analysis commands, Claude Code's own
  permission rules.
- **Diffs never follow links**: an untracked symbolic link shows as its target, the file it points at is never read.
- **Cost**: per-task and per-day limits are checked before each stage and passed to Claude Code as
  `--max-budget-usd` (where the CLI knows it). **Stop** (One) or Ctrl+C (worker) kills Claude Code's whole process
  tree.

### Cloud worker

Everything above holds for a cloud worker too — the same protocol, the same trust rules (team tasks still need
*written or confirmed on this device*), the same refusal of paths and commands. The relay adds a path through the
server, so the protocol is sealed end to end:

- **Pairing.** The download made a 32-byte pairing secret: the file carries it, the browser keeps it as a
  non-extractable HKDF key in IndexedDB (it can derive session keys, never be read out). The server never sees it
  (One builds the file in the browser).
- **Session key.** For every pairing (the relay numbers them, `s`) both sides send a fresh 32-byte nonce in a
  plain `key` frame; the key is HKDF-SHA256(pair secret, salt = tab nonce ‖ worker nonce, info
  `"one-worker-relay v1"`) → AES-256-GCM. A new pairing (a reconnect, another tab) = new nonces = a new key.
- **Boxes.** Every protocol frame travels as `{ type: "box", s, seq, iv, data }` — a random 12-byte IV, AAD
  `tw:<s>:<seq>` (tab → worker) or `wt:<s>:<seq>`. `seq` must rise strictly per direction (gaps are allowed: dropped
  events); an old, repeated, reordered or undecryptable box ends the session. Browser: WebCrypto; worker:
  `node:crypto`.
- **Mutual proof.** The tab's first box is its hello; the worker opens it — a box that does not open means a tab
  without the secret (refused, `pair`, and the worker asks the relay to close that tab). The tab sends nothing else
  until the worker's boxed welcome opens; a box that does not open, or no answer within 20 s, means it is not the
  worker of this download (*Refused: a worker this device did not pair with*) — nothing more is sent.

**What the server still sees**: that a member's worker is online and since when, the pairing numbers, frame
sizes, directions and timing, which frames are droppable events (`k: "e"`: log lines, progress, live git), the worker token's id, its user agent
at download, first and last use. It never sees task text, page content, repo names, paths, diffs, logs or answers,
and cannot inject, change, replay or reorder a frame. It can **delay or drop** frames or end the connection
(denial of service) — the tab then shows the link as waiting.

| Threat | What it can do | What stops it |
|---|---|---|
| **The server operator** (or someone who took the server) | See metadata (above); drop or delay frames; refuse to pair; serve a modified One app | Cannot read or forge frames: the key is derived from a secret it never had. A **modified app** is out of scope for any web app: whoever serves the code can change it — run your own server, or use Local. Even then it can use this device's pairing key only while that code runs in an open tab: the key is non-extractable, so it cannot be sent away and used later |
| **Another member** of the workspace | Nothing on your worker: the relay pairs per (workspace, member) | Tokens are per member; another member's tab never reaches your worker, and their worker never reaches your tab (tenancy test). Their own cloud worker is theirs |
| **A stolen session cookie** | Open a tab link as you — the relay would pair it with your worker | Without this device's pairing secret its boxes do not open: the worker refuses it (`pair`). Signing out closes that session's relay links at once; `revoke-sessions` on the server within a minute (the relay re-checks sessions) |
| **A stolen worker token** (the file was copied) | Connect as your worker — the newest connection wins (the old one gets 4001 and stops) | With the file it also has the pairing secret: treat the file like a key (`chmod 600`; Windows: `icacls`, § Windows). **Revoke** in Settings ends it at once (`node dist/cli.js revoke-workers <email>` on the server: within a minute); your tab shows which worker connected (name, repos) |
| **A malicious tab** (injected script, another site) | — | The relay accepts tabs only from the server's own origin with a session cookie; a tab without the pairing secret is refused by the worker. Task text stays data: Claude Code's permissions, the stage rules and trust are unchanged |
| **A cloned or imported repository** (any worker, local or cloud) | Carry a program named `git.exe`, `claude.exe` or `npm.exe` at its root, for Windows to start in place of the real one | Worker 1.9.0 never takes git or Claude Code from the repo folder: it looks programs up in `PATH` only, never in the folder it runs in, reads `.cmd` shims instead of running them, keeps the programs it starts by itself from looking there (`NoDefaultCurrentDirectoryInExePath`) and starts no Claude Code stage while the folder's top holds a program a lookup by name could take (`plantedProgram` — for the lookups that ignore that variable, Claude Code's own among them; § Windows). Tests and analysis run the repository's own code by design. **Older workers on Windows could start such a program** — use 1.9.0 or newer there; One names one it can see (Local, a browser on Windows). macOS / Linux search the working folder only for an empty, `.` or relative `PATH` entry — 1.9.0 leaves those out of the `PATH` of every program it starts by itself |
| **Removed member / now a viewer** | — | Removal or a role change to viewer closes their relay links at once and revokes their tokens (removal); the worker exits (removed) or waits (viewer) |

## Protocol

JSON text frames, subprotocol `one-worker.v1`, defined in
[`src/app/features/coding/protocol.ts`](../src/app/features/coding/protocol.ts) (shared by the worker and the app).

| Direction | Message |
|---|---|
| tab → worker | `{ type: "hello", app: "one", version, workspace: { id, name, kind, readOnly }, pair?, can? }` (`pair`: this device's secret for a downloaded worker; `can`: what the tab handles — `TAB_CAN` = ['permission'], worker 1.11.0) · `status` (same workspace, or the tab is refused) · `nudge` |
| worker → tab | `welcome` { worker, name, repos: [{ name, baseBranch, branches?, mcp?, push?, pr? }], parallel, busy, spentToday, dayLimit, claude: { found, version }, setup, paired } (sent again when the setup page saves) · `refused` { reason: workspace \| unbound \| pair, paired? } + close 4003 · `status` { busy, spentToday } |
| worker → tab (req) | `next` { repos, worker, docs?, can? } → `{ task: TaskPayload \| null }` (claimed; `stage.model` = the model Claude Code runs with, or null; `can` = `WORKER_CAN` — 'analyze', 'git:comment', 'git:merge', 'doc', 'model' (a stage whose model is set), 'mcp-list', 'ship' (git stages and keys return a ShipRecord — it gates nothing), 'continue' (`TaskPayload.resume`: a stage that stopped at its step limit runs on — sent only to a worker that names it), 'permission' (permission requests in One; both gate nothing): a stage that needs one goes only to a worker that names it, else the task fails with "needs a newer coding worker" — an older worker ran unknown kinds as git stages or dropped the task as unreadable. Document stages came before `can`, together with `docs: true`: a worker that sends either knows them (`workerCan`), one with neither gets none; a worker that does not name all of `WORKER_CAN` shows "Download again" on #/coding; a worker whose welcome names 1.3.1 up to 1.8.0 — the ZIP import that could plant a `.git`, `workerUnsafe` — shows the security notice with its version instead, on #/coding and in the setup card) · `heartbeat` { taskIds } · `finish` { taskId, stageId, outcome } (`outcome.ship?` — § What One records; worker 1.11.0: `outcome.stepLimit?` { turns, max }, `outcome.permissions?` { asked, allowed, refused }; retried until confirmed; a task the worker cannot read — a stage kind it does not know — comes back at once as `{ status: 'refused' }`, so One does not hand it out again) |
| worker → tab (event) | `log` { lines } (a tool line of Edit / MultiEdit / Write carries `e`: { path, hunks: [{ old, new }], clipped? } — ≤ 6 changes × 4,000 characters, scrubbed) · `git` { git } (`git.web?`: the repo's web address; `git.commits[].remote?`: that commit is on the remote task branch) · `note` { text } · `question` { text } · `progress` { progress: { turns, maxTurns, cost, model } } · `permission` { ask: PermissionAsk \| null, settled? { id, how } } (worker 1.11.0: the request a stage waits for — { id, tool, kind, what, outside?, rule, repo, at, until }; `status` busy entries carry it as `ask` too) · `intake` { intake: { state, source, label, line, percent, repo?, suggest?, error? } } |
| tab → worker (req) | `stop` { taskId } · `git` { taskId, verb, repo, branch, title, message? } — verbs: refresh, commit, push, force-push, pr, update-base, discard, cleanup, reveal, comment-pr (`message` = the review), merge-pr → `{ message, url?, git?, branchGone?, ship?, error? }` (`error`: key 'pr' after the push) · `open-setup` → `{ opened, reason?: off \| no-browser }` · `intake-begin` { taskId, name, size } → `{ uploadId, chunk }` · `intake-chunk` { uploadId, data } · `intake-end` { uploadId } · `intake-clone` { taskId, url } · `permission` { taskId, ask: <request id>, verb: once \| always \| deny } → `{ ok, gone? }` (worker 1.11.0) |

`POST http://127.0.0.1:<port>/task` (`Authorization: Bearer <run token>`, no `Origin`): the task tools.
`/setup`, `/setup/app.css`, `/setup/app.js`, `/setup/api/state | status` (GET) and `/setup/api/scan | add | save`
(POST): the setup page (§ The setup page) — not served with `--no-browser`.

### Through the relay (cloud)

The tab opens `wss://<server>/coding/tab?workspace=<server workspace id>` (session cookie, same Origin, subprotocol
`one-worker.v1`); the worker dials `wss://<server>/coding/worker` with `Authorization: Bearer onew_…`,
`X-One-Workspace: team:<id>` and **no** Origin. The same messages as above travel inside boxes; only these frames
are plain (and the relay re-serialises them, so nothing extra rides along):

| Direction | Frame |
|---|---|
| relay → worker | `{ type: "relay", op: "ready", workspace: { id, name } }` · `tab-open` { s } · `tab-gone` { s, reason: closed \| replaced \| ended \| idle } |
| relay → tab | `{ type: "relay", op: "worker", online, registered, token, s }` (the member's worker came or went, or this tab joined — a new `s`; while no worker is online also when a token is created or revoked; `token` = its id. The same `s` again is news about the current pairing, never a new key exchange) · `dropped` { n } |
| tab → relay | `{ type: "relay", op: "alive" }` every 20 s (a tab silent for 150 s is let go, 4408) |
| worker → relay | `{ type: "relay", op: "close-tab", s, code: 4001 \| 4003 \| 1008, reason }` (after a refusal) |
| both ways | `{ type: "key", s, n }` (the fresh nonce, 43 base64url characters) · `{ type: "box", s, seq, iv, data, k? }` (`k: "e"` only from the worker: an event the relay may drop) |

Close codes: **4001** a newer tab / connection of the same token took over · **4003** refused (`pair`, …) ·
**4401** token revoked, replaced by a newer download (`replaced`) or session ended · **4403** not (or no longer)
allowed (`forbidden`, `viewer`) · **4408** idle · **1003** binary frame · **1008** malformed or far over the limits
(8,000 frames / 512 MiB per socket in 10 s; a tab is never closed for the soft budget) · **1009** a frame over 8 MiB · **1013** the receiving side could not keep up. Refused upgrades answer with HTTP:
401 bad token (rate-limited per IP), 403 `Forbidden: origin | membership | viewer | workspace`, 404 relay off,
429 too many connects. The worker exits with **code 2** on 401, 4401, 4403 forbidden / removed, a wrong
workspace, no relay or a takeover by another copy of its file; a viewer waits and tries again every 5 minutes.

`GET /api/coding/worker` (Bearer worker token, no Origin): `{ workspace: { id, name }, member: { email, name },
state: pending | active, online }` — what `node one-worker-cloud.mjs check` prints.

## Troubleshooting

- **Push rejected** (`pushRejected`) — the task branch on the remote has commits this one lacks (pushed from elsewhere,
  or changed on the host). **Update from base** merges them in first, then **Retry**; the worker never force-pushes
  on its own (Force push stays a confirmed key).
- **No links in the ship note** — the remote's host is not recognised (no "github" / "gitlab" in its name): pick the
  **Host type** on the setup page (`forge` in worker.json). The log says `requestNone`.

- **Waiting for the worker** — is it running (`node ~/Downloads/one-worker.mjs`) on the port One uses? Set the
  port in Settings *before* the download: the file carries it. Preflight's *Worker offline* card says the same ("The
  worker does not answer — is it running in a terminal?") with the time it went down.
- **Blocked by the browser** (Local only) — Chrome's Local Network Access permission for this site is denied: the tab
  asks the permission (`lib/localNetwork.ts`, shared with the MCP bridge) whenever a Local link closes before it ever
  opened. Denied → conn `blocked` / `blocked: 'permission'`, no retries until the permission's `change` event, *Retry
  now* or the tab is looked at again; still to be asked (`lna: 'prompt'`) → the waiting texts say to choose Allow.
  The fix: the icon left of the address → *Apps on device* / *Local network access* → Allow; in an installed app's
  window (no address bar; `inAppWindow()`, display-mode standalone / minimal-ui / window-controls-overlay) the texts
  name ⋮ → *App info* instead. A browser that does not
  let an https page open `ws://` at all (Safari) → `blocked: 'insecure'`: use Chrome, Edge or Firefox.
- **Refused: this worker belongs to another download** — the file was downloaded in another browser, or a newer
  download replaced its pairing. Browsers name a second download `one-worker (1).mjs`: start the newest file (or
  delete the old one and download again). A Local link a worker refused ('pair' · 'workspace' · 'unbound') tries once
  more when the tab comes back (focus / visible / online) — the refusal stays shown while it tries.
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
- **This stage needs a newer coding worker** (or *A newer worker is on the site* on #/coding) — the worker running
  was downloaded before One could hand out this kind of stage (document stages of Business analysis / QA, Static
  analysis, Post review, Merge, a stage with a model — worker 1.5 or newer). **Download again** (#/coding, or Settings → Coding worker), stop the old worker
  (Ctrl+C), start the new file — the browser may have saved it as `one-worker (1).mjs` — then **Retry** on the task.
- **Claude Code was not found** — install it and sign in once interactively, then **Retry** on the task: the worker
  looks for Claude Code again — on the `PATH` it started with and in its native installer's folder
  (`%USERPROFILE%\.local\bin`, `~/.local/bin`) —, and its setup page notices a new install within seconds; no restart
  needed. Installed elsewhere outside `PATH`: set `CLAUDE_BIN` and start the worker again (it reads the variable at
  start). `node one-worker.mjs check` shows what the worker sees (on Windows also how it starts Claude Code and which Git Bash it found). A
  Claude Code `.cmd` the worker cannot read is refused (`claudeCmdRefused`): the native installer, or `CLAUDE_BIN`
  set to `claude.exe` / its `cli.js`.
- **Windows: cannot listen on 127.0.0.1:<port> — Windows keeps the port for itself** — Hyper-V, WSL or Docker reserve
  that range (`netsh int ipv4 show excludedportrange protocol=tcp`). Pick a port outside it in One (Settings → Coding
  worker, then download again) or start with `ONE_WORKER_PORT` (§ Windows).
- **Windows: a repo in OneDrive is slow or a step fails with a locked file** — move it to a local folder (`C:\code`)
  and tick that one; until then its worktrees live in `%USERPROFILE%\.one-worktrees` (a cloud worker: in its config
  folder; an own `worktreeDir` wins). The warning says which — and when your `worktreeDir` lies in a synced folder
  too.
- **Windows: Filename too long** — `git config --global core.longpaths true` and long paths in Windows, or a short
  `worktreeDir` (§ Windows).
- **Windows: a Claude Code stage does not start — "holds a program named git.exe at its top level"**
  (`plantedProgram`) — the stage's folder holds a file a lookup by name could take (§ Windows › What the programs
  start; the worker's terminal names the folder). Remove or rename it in the repository **and** on the task's branch —
  an existing worktree keeps the file: change it there (Git → *Show folder* prints it in the worker's terminal), or commit and push the change on the base
  branch and press *Update from base* — then **Retry**. A flat package whose entry file is named like a tool (`node.js` with
  `.JS` in `PATHEXT`) needs that rename too. Test and Analyze stages are never refused for it.
- **git does not know who commits** (`gitIdentity`) — a fresh Git (Git for Windows sets neither) has no `user.name` /
  `user.email`: run `git config --global user.name "Your Name"` and `git config --global user.email you@example.com`
  once, then **Retry**.
- **A fetch or push fails at once with an SSH message** — `sshHostKey`: run `ssh -T git@<host>` once in a terminal
  and read what ssh says; `sshKey`: add the key to your SSH agent (`ssh-add`). On Windows Git's own ssh does not see
  the OpenSSH Authentication Agent service: `start-ssh-agent` in the Command Prompt and the worker started in that
  window, or `core.sshCommand` set to `C:/Windows/System32/OpenSSH/ssh.exe` (§ Windows). Setting `core.sshCommand`
  yourself also drops the worker's BatchMode on Windows; ssh still has no console to ask on there. On macOS / Linux
  the worker adds nothing: an askpass program may ask, as before.
- **A stage fails right away with a permission problem** — headless runs cannot ask: allow the tools in
  `claude.allowedTools` (`"Bash(npm test:*)"`), or use `acceptEdits` for implement stages.
- **The branch is checked out in the main checkout** — switch the main checkout to another branch, or clear the
  task's Branch field to get a fresh branch.
- **Port in use** — another worker runs (stop it first, or use *Change repositories* to reach its page); set the
  port in One (and download again) or `"port"` in a hand-written worker.json. A **cloud** worker: an older cloud
  worker of the same workspace runs on that computer — stop it first (the new file takes over once it connects),
  or start the new one with `ONE_WORKER_PORT=<a free port>`.
- **Cloud: Paired with another device** — the cloud worker was downloaded in another browser; only that one holds
  its key. Use One there, or **Download for this device** (it replaces the other one as soon as the new file
  starts; until then this device shows *Waiting for your new download to start* and the other keeps working).
- **Cloud is greyed out: needs https** — the One server runs on plain `http://` (other than this computer): the
  browser has no WebCrypto there and the worker dials only https. Set `PUBLIC_URL` to an https address.
- **Cloud: Waiting for your cloud worker** — is it running on that computer? Its log says *connected to … for
  "<workspace>"* once the server took it. `node one-worker-cloud.mjs check` shows whether the server knows the token.
- **Cloud: the worker stopped with exit code 2** — the log says why: revoked, replaced by a newer download, removed
  from the workspace, a token for another workspace, a server without relay, or another copy of the same file took
  over. Download again (and start only the newest file), or ask the workspace admin.
- **Cloud: tasks do not start** — tasks run only while a One tab of this device is open (any page of the
  workspace). A tab opened in the background waits until you look at it.
- **Cloud: certificate errors** — a private CA: `NODE_EXTRA_CA_CERTS=/path/ca.pem node one-worker-cloud.mjs`.
  An outbound HTTPS proxy is not supported: the worker needs a direct connection to the server.
- **Cloud: the worker logs "has no worker relay"** — the server is older or runs with
  `CODING_RELAY=off`; a self-hosted proxy must pass WebSocket upgrades on `/coding/…` (docs/SELF_HOSTING.md).
- Logs go to stderr (`ONE_WORKER_QUIET=1` silences them). Chrome logs refused connection attempts in the console
  while no worker runs — expected.

The worker's code: [`mcp/src/worker`](../mcp/src/worker) (bundled with the bridge by `npm run build:mcp` to
`public/mcp/one-worker.mjs`, committed; `npm --prefix mcp test` runs its tests against temp repos, a local bare remote
and a fake `CLAUDE_BIN`).
