---
id: coding-pipeline
title: Coding pipeline (Claude Code on your machine)
section: ai
order: 9
keywords: coding, pipeline, claude code, worker, permalink, page address, copy link, give a page, reference a page, mention a page, answer, rework, one-worker, download, setup, windows, powershell, cmd, wsl, pairing, model, opus, sonnet, haiku, fable, tick repositories, git, branch, worktree, pull request, pr, diff, tests, repo, repository, code review, programmieren, aufgaben, cloud worker, one-worker-cloud, build server, vm, relay, remote, another computer, local or cloud, offline, not connected, local network access, apps on device, api key, anthropic_api_key, console, billing
related: pipelines, workorders, legacy-modernisation, mcp-bridge, custom-agents, agent
summary: Hand coding tasks to Claude Code on your computer — plan, approve, implement, test, ship — and follow every step in One.
---
**#/coding** (⌘K *Coding pipeline*). One keeps the tasks, the approvals, the log and the diff; a small worker on **your** computer runs git and Claude Code. Your code never leaves your machine.

## Set up in three steps
You need Node.js 22 or newer, git and the **Claude Code** CLI, signed in once (`claude`) — on macOS, Linux or Windows 10 / 11 (see *Windows* below). Then **Settings → Coding worker** (or **#/coding**):

1. **Download the worker for this workspace.** The file comes ready-paired with this browser and this workspace — nothing to configure. One switches the link on by itself.
2. **Start it** in a terminal and keep it running. The card shows the line for your computer — switch **Windows | macOS · Linux**. macOS and Linux:
```
node ~/Downloads/one-worker.mjs
```
Windows — in PowerShell (first line) or the Command Prompt (second line); the quotes keep a user folder with a space together:
```
node "$env:USERPROFILE\Downloads\one-worker.mjs"
node "%USERPROFILE%\Downloads\one-worker.mjs"
```
The lines expect the usual Downloads folder. Did your browser save the file somewhere else (or is Downloads moved, e.g. into OneDrive)? Type `node` and a space, paste the file's path — in Explorer: Shift + right-click the file → **Copy as path** — and press Enter.
3. **Tick your repositories in the page that opens.** The worker finds the git repositories on your computer and opens a page in your browser: tick the ones One may work in, check the base branch and the test command (e.g. `npm test`), then **Save & start**. The card shows *Connected · laptop · 2 repos* and the **WORKER** LED in the status bar turns green.

Business analysis and QA have pipelines of their own — see [Business analysis and QA pipelines](help:pipelines). To have One plan a whole chain — analysis, coding, QA — from one written request, see [Work orders](help:workorders). Mention pages with **@** in a task: their text goes to Claude Code with it — see *Give Claude Code a page* below.

New code? The same page clones from **GitLab / GitHub** (an address, or a pick from your projects with `glab` / `gh`) or imports a **ZIP** as a new repository into `~/one-repos` — see [Modernise legacy code](help:legacy-modernisation). Per repository it can also give Claude Code your own MCP servers (e.g. a knowledge base), and it decides with **Use this repo's own Claude Code settings** whether Claude Code loads the repository's `.claude/`, `.mcp.json` and `CLAUDE.md`: on for your own repositories, off — with the reason — for one the worker cloned or imported, whose hooks would otherwise run on your computer as a task starts.

**MCP servers: two Claudes.** Your MCP servers in One (Settings → Claude AI → [MCP servers](help:mcp-servers)) serve One's own Claude — the AI menu, the terminal, agents. Claude Code on your computer gets only One's task tools unless the worker's setup page allows more: per repository **Own MCP servers for Claude Code**, and for tasks without a repository **Tasks without a repository — own MCP servers** — names as `claude mcp list` shows them. Add a server to Claude Code first, in the **user** scope: `claude mcp add -s user …` — one added in the default (local) scope belongs to a single folder, and reaches neither tasks without a repository nor a repository the worker cloned or imported (Claude Code leaves that repository's own settings out, and your local servers with them). The coding panel shows which servers a task may use (**Claude Code · MCP**) and warns when the task's text mentions one it may not use, with **Open the setup page**.

To change them later, press **Change repositories** — the worker opens its page again on your computer. One only ever learns the repos' names; paths and commands stay in `~/.config/one/worker.json` on your machine.

> Tip: a new download replaces the pairing — start the file you downloaded last. On a computer without a browser, `node one-worker.mjs --no-browser` asks in the terminal instead (numbers tick, Enter saves).

## When the worker does not connect
The **WORKER** LED stays dark; **Settings → Coding worker** and the *Worker offline* lamp of [Preflight](help:preflight) say why:
- **The worker does not answer** — it is not running: start it again in a terminal (step 2) and keep that window open.
- **An older download is running** — stop it (<kbd>Ctrl+C</kbd>) and start the file you downloaded last. Your browser may have saved it as `one-worker (1).mjs`: start that name, or delete the old copies and download again. One tries again when you switch back to it — or press **Retry now**.
- **Blocked by the browser** — Chrome asks whether One may reach apps on this device: choose **Allow**. Said no? Allow it in the site settings (the icon left of the address: **Apps on device** / **Local network access**; in One's app window, which has no address bar: ⋮ → **App info**), then **Retry now**.

## Run the worker on another computer (Cloud)
In a **team workspace on a One server**, **Settings → Coding worker → Where the worker runs** offers **Local | Cloud**. With **Cloud** the worker runs on any computer — a build server, a VM, the desktop at the office — and connects **out** to your One server: no port to open, no VPN.

1. **Download one-worker-cloud.mjs.** It carries a worker token that is only for you and only for this workspace, and a key that only this browser has.
2. **Copy it to that computer and start it there**: `node one-worker-cloud.mjs` (keep it running — tmux or a service). The file is the key: keep it private (`chmod 600`; on Windows `icacls`, below).
3. **Tick the repositories on that computer** — its setup page opens there, or `node one-worker-cloud.mjs setup --no-browser` asks in its terminal.

The card then reads *Connected · build-box · 1 repo · via cloud*. Everything else works as with a local worker.

- **Keep One open.** Tasks run only while One is open in **this** browser (any page of the workspace) — this tab hands out the work and writes the results. Close it and the worker waits; nothing runs on the server. A newer tab takes the worker over; the older one takes it back by itself when that tab closes.
- **Sealed end to end.** The server passes messages between this browser and the worker but cannot read or change them — task text, code, diffs and logs stay between the two.
- **One device.** The worker is paired with the browser that downloaded it. Another device shows *Paired with another device* and offers **Download for this device** (it replaces the other one — One asks first; until the new file starts, the other device keeps working and this one waits, then connects by itself).
- **Replace or stop.** A new download takes over as soon as it starts — on the same computer, stop the old worker first. **Revoke** stops the worker for good. Removing someone from the workspace stops theirs too.
- **https only.** Cloud needs the One server on `https://`; on plain `http://` the option is greyed out with the reason.

Cloud is greyed out with the reason in a local workspace, for viewers, and on a server without the worker relay.

## Windows
The worker runs natively on Windows 10 and 11 from version **1.9.0** — WSL2 works too. **On Windows, use worker 1.9.0 or newer**: older workers could start a program named `git.exe`, `claude.exe` or `npm.exe` from the root of a cloned or imported repository. If yours is older, **Download again** and start the new file. When an older worker runs on this computer (**Local**), **#/coding** and the setup card say so themselves, with the download key. One cannot tell whether it runs in WSL: a worker in WSL gets the notice too, and the notice says it does not apply there.

- **Install**: Node.js 22 or newer, **Git for Windows** (Claude Code needs its Git Bash) and Claude Code — its own installer or `npm i -g @anthropic-ai/claude-code` — signed in once with `claude`. `node one-worker.mjs check` shows what the worker found. A fresh Git needs your name and email once: `git config --global user.name "Your Name"` and `git config --global user.email you@example.com` — otherwise the worker cannot commit, and the log says so. Installed Claude Code while the worker runs? **Retry** on the task finds it (the worker's setup page notices it too) — no restart.
- **Windows Terminal** is the best place to run it: in the old console window, selecting text pauses the worker until you press <kbd>Esc</kbd>.
- **Keep repositories on a local disk**, e.g. `C:\code`. A repository in **OneDrive** (Documents and Desktop often are) works, but OneDrive locks files while it syncs — the log warns and says where the task worktrees are (by default `.one-worktrees` in your user folder, outside OneDrive).
- **Long paths**: the worker's own git handles them. For your git and tools run `git config --global core.longpaths true` once.
- **Sign in once**: git never asks while the worker runs it. **SSH**: the ssh that comes with Git does not see Windows' **OpenSSH Authentication Agent** service. Either run `start-ssh-agent` in the Command Prompt (Git's own agent — it asks for the passphrase once) and start the worker in that window, or run `git config --global core.sshCommand C:/Windows/System32/OpenSSH/ssh.exe` once and add your key to that service (`ssh-add`). A key without a passphrase needs neither. **HTTPS**: run `git fetch` once in a terminal — Git Credential Manager keeps the login. The log says which one is missing.
- **Programs**: One never takes git or Claude Code from the repository folder — the worker looks them up in `PATH` only, and the first word of your test command too: a program inside the repository needs its path, e.g. `.\gradlew.bat test`. A Claude Code stage (plan, implement, document) does not start while a program a lookup by name could take sits at the top of its folder (`git.exe`, `node.exe`, `npm.cmd`, a program from your `PATH` — Windows' own folders aside, so `find.js` or `sort.js` pass —, the launcher of one of your MCP servers …) — the log names the file. Remove or rename it in the repository **and** on the task's branch (an existing worktree keeps it: change it there — **Git → Show folder** prints where it is, in the worker's terminal — or commit and push the change on the base branch and press **Update from base**), then **Retry**. Tests and analysis run your repository's own code, as in your terminal. Nothing One sends ever runs through `cmd.exe`.
- **The cloud file** is a key: `icacls "$env:USERPROFILE\one-worker-cloud.mjs" /inheritance:r /grant:r "${env:USERNAME}:F"` (PowerShell) keeps it yours. For autostart use Task Scheduler — `docs/CODING.md` has the recipe.
- **Port refused?** Hyper-V, WSL or Docker can reserve a range of ports. The worker's terminal says so — pick another port in **Settings → Coding worker** before you download.

## Approvals — or just do it
In the coding panel, **Approvals** sets where the task waits for you: **Approve the plan and the review** (default), **Review only — the plan runs on**, or **None — just do it**: plan, work, tests and shipping then run through without a stop; tests that fail twice still stop at the review. The choice is per task, on this device. **Use for new tasks** makes it this device's default for tasks created from then on — neither a pick for one task nor a new default changes any other task (one without a pick of its own keeps the default it was created under; a page that becomes a task — dragged onto the board, moved in — takes the default of that moment). In **Pipeline**, a gate can be set to **Always stop here**: Approvals *None* runs past every other gate but waits there (new *Review & merge* pipelines set it for *Approve review & merge*). A task already waiting at an approval you just switched off goes on at once.

The **Log** tab shows every step: *Fetching origin…*, the new branch, *Starting Claude Code…*, every tool Claude Code uses — and, while it works quietly, *still working* once a minute. When the worker can't fetch the remote (no network, or git would need a password or an SSH key passphrase), the log says so within 60 seconds and the task goes on with what your computer has. For push and pull requests git needs an SSH agent or a credential helper — the worker can't type anything.

## Model per stage
Which Claude model Claude Code uses is set in **Pipeline** (on #/coding): open a stage's details (plan, implement and document stages) and pick its **Model** — **Standard** (the repo's model in the worker's `worker.json`, else Claude Code's default), **Opus**, **Sonnet**, **Haiku**, **Fable**, or **Own…** for any other model name (letters, digits and `. _ : - [ ]`; One checks it while you type). A stage with a model shows it as a small chip in its row. Plan with a strong model, implement with a faster one — each stage runs with its own.

For one task, **Model** in the coding panel (next to Approvals) overrides every Claude Code stage of that task — on this device: **As the pipeline**, one of the models above, or an own name the pipeline already uses. While Claude Code runs, a chip under **Now** shows the model it really uses, and the log names the model the worker passed on. A worker downloaded before models existed never gets a stage with a model — the task says *This stage needs a newer coding worker*: download it again, then **Retry**.

## Who pays for Claude Code
Claude Code uses your own sign-in — unless the worker was started with `ANTHROPIC_API_KEY` set in that shell. In the runs the worker starts (`claude -p`), an API key from the environment (or `ANTHROPIC_AUTH_TOKEN`, or a cloud provider's settings) takes precedence over your subscription and an `apiKeyHelper`, without asking. Handy for a workshop or a team account: set a Claude Console key (`export ANTHROPIC_API_KEY=…`, in PowerShell `$env:ANTHROPIC_API_KEY = "…"`), start the worker from that shell, and give the key's Console workspace a spend limit. At each Claude Code stage the log says which one it uses — *API key from ANTHROPIC_API_KEY · …1a2b* (the last 4 characters only) or *your Claude Code sign-in*. Keys never reach One: the worker removes them from every log line, section, diff and error.

## A task from start to finish
1. **New task**: title, repo, goal, acceptance criteria. Leave *The worker may start right away* ticked. The task itself is the task's **page** (below the coding panel) — that text is what Claude Code works from. When the page is empty, **Insert outline** adds Goal, Acceptance criteria and Notes to fill in.
2. **Plan** — Claude Code reads the code in plan mode (it changes nothing) and writes the plan into the task. The task waits at **Approve plan**.
3. **Approve**, or **Rework…** with instructions: it goes back to Plan with your note.
4. **Implement** — Claude Code changes the code in its own git worktree; **Test** runs your test command. If the tests fail, Implement gets one more try with their output.
5. **Review** — the **Diff** and **Tests** tabs show what changed. Approve, or send it back.
6. **Ship** — commit, push, pull request (with the GitHub CLI) or a compare link — noted in the page with links (**What One records**). **Done**.

Each task works on its own branch (`one/<title>-<id>`) in its own worktree — your main checkout stays as it is. Before a task runs, the coding panel lets you pick the **Repo** (the repos your worker announces) and the **Branch**: *New branch (automatic)* or an existing branch of that repo on your computer to continue on (the base branch is never offered). You can also type one into the **Branch** field.

## While it runs
- **Now** shows the worker's last line and how long ago it came; under it **Step 6/30** (Claude Code's turn of the stage's limit), **≈ +$0.07** (this stage so far, an estimate — the exact cost comes at the end) and **Files** (what changed so far; a click opens the diff). #/coding shows the same line under every running task.
- **Log** streams what Claude Code does — a tool call shows its name; a click opens what it was called with, for Edit / Write the change as a code diff; the worker's own lines show in your language. If Claude needs a decision, the task shows **Claude asks** — your **Answer** starts the stage again.
- **Notifications**: in **Settings → Coding worker**, switch on *Notify me while One is in the background* — the browser tells you when a task waits, asks, failed or is done while the tab is in the background (on this device).
- **Stop** ends Claude Code at once; **Retry** or **Run now** start the stage again.
- **Git**: Refresh, Commit, Push, Open PR, Update from base, Show folder (the path appears in the worker's terminal only). **Force push** and **Discard worktree** ask twice; **Clean up** waits until the branch is merged; while another task works on the same branch (a QA step on its coding step's), **Discard worktree** and **Clean up** stay off and name that task. **Merge request**: **Post review** and **Merge** (asked first, with your glab / gh) — see [AI review and merge requests](help:review-merge).
- **Pipeline** (on #/coding) changes the stages: names, which ones run by themselves, Claude Code's mode, step limit, model and instructions. Templates: *Standard*, *Modernise legacy code*, *Explain the code* ([one page per component](help:explain-code)), *Review & merge*. A **Static analysis** stage runs the repository's linter / compiler (set on the worker's setup page) and puts its findings in the page.
- **Projects**: several Coding databases side by side — pick, create and delete them above the board ([Projects](help:pipelines)).
- **When Claude Code is done, the stage is done** — with every model. Anything it started and left running (a dev server, a watcher) is ended, and the log names it. A server your other tools share — a Gradle or Kotlin daemon, an ssh connection, watchman — keeps running and is named in the log instead; so is a program that set itself up as a service of its own. Each task has its own scratch folder for temporary files on your computer; it goes with the task's branch.

## When Claude Code needs a permission
Claude Code asks before it runs a command or uses a tool your repository's rules do not cover. The task then shows **WAITING FOR YOU · PERMISSION** and the card **Claude wants** says exactly what — for example *Bash* `npm run lint`:

- **Allow once** — just this time.
- **Always allow for this repo** — the worker keeps the rule the card names (e.g. `Bash(npm run lint:*)`) in its own `worker.json`; the worker's setup page lists these rules under **Allowed without asking**, each with a key to remove it. Only narrow rules are offered: never a shell, `git`, `rm`, `curl` or a file outside the project — those are **once** only.
- **Refuse** — Claude Code goes on without it.

The card always shows the request whole; one too long to show whole (over 4,000 characters) the worker refuses without asking. In a plan stage Claude Code hands its plan straight to One — it never comes as a request. The lamp **Claude wants** on Start shows every waiting request (each one by hand, never in a bulk apply), and — with notifications on in **Settings → Coding worker** — the browser tells you while One is in the background. Without an answer the worker refuses after 15 minutes; with no One tab open that can answer, it refuses at once (a waiting request after a minute without a tab). Only the device whose worker runs the task can answer; One sends the worker the answer and nothing else. After the run, one line counts what was asked, allowed and refused.

## Step limit
Each stage may take a number of steps (**Step limit** in the pipeline). When Claude Code uses them all, the task shows **Step limit reached (40/40)**: **Continue (+40 steps)** runs the stage on from where it stopped — same worktree, everything so far kept, the cost counted like any run — and **Start over** runs the stage again with its original instructions — in the same worktree; for a clean start, **Discard worktree** first (Git tab). **Continue** gives as many steps as the stage's Step limit allows now. **Continue** needs worker 1.11.0; it is also in Preflight's *Task failed* card and in the AI terminal.

**Repos in iCloud Drive** (e.g. in Documents with "Desktop & Documents Folders" on): git waits whenever a file is only in the cloud, so steps can take minutes — the log says so. Faster: keep the folder downloaded, or clone it again with **Clone from GitLab / GitHub…** on the worker's setup page (into `~/one-repos`, which is not synced) and tick that one. The worker starts at once either way and names a repository whose git is slow in its log. The worker's own working copies never go into iCloud.

## Give Claude Code a page
Claude Code reads the task — never the rest of your workspace. What it may read goes along with the task as read-only text: the pages the task mentions with **@** or links, and the pages linked in **those** pages (one level deeper) — at most 8, each up to 20,000 characters, and only what Claude may read of it (marked blocks). **Goes along** in the coding panel lists them before a stage runs; ↳ marks a page linked in another one.

- **In your answer, a rework note or a new task**: type **@** (or `one:`) and a few letters of the title — the same search as in a page. <kbd>↑</kbd> <kbd>↓</kbd> choose, <kbd>Enter</kbd> or <kbd>Tab</kbd> takes the page, <kbd>Esc</kbd> closes the list. The page shows as *@Title* in the field and goes along with this very run, before the task's own pages; **Goes along** marks it *new* while you write. <kbd>Backspace</kbd> right after it takes it out whole.
- **Give the page**: when Claude's question names a page in quotes — *“Launch plan”*, *„Launch plan“*, *'Launch plan'* — and a page here has exactly that title, a key under the question puts it into your answer. Several pages with that title: each shows where it lives. Nothing is sent before you press **Answer**.
- **Paste an address**: a page's permalink (or `#/p/<id>`) pasted into the field becomes *@Title* too.
- One level deeper, a page brings its first 8 linked pages at most — and never a mail, a memory entry or a page of One's own databases (pipelines, test cases), nor, in a shared task, a private page. Those go along only when you give them yourself.
- A page Claude sees named but does not get — over the 8, linked deeper, or kept back — is listed for Claude under the pages it gets, and under **Goes along** for you: give it with **@** in your answer. A page in **Goes along** opens beside the task — what you are writing stays.
- In a team, the pages that go along are part of what you confirm: a teammate changing one makes the task wait for **Confirm on this device** again.

## Permalinks
Every page has a permalink: One's address with `#/p/<id>` at the end. **Copy permalink** is in the page's ⋯ menu, the sidebar's row menu and ⌘K; the plate at the end of every page has a **Permalink** key, the side peek a link key next to the page's path. The toast shows the address. It works
- in the browser's address bar — the page opens;
- as a link in any page — pasted into a page, it becomes a page mention (a link to a block, from **Copy link to block**, stays a link and opens at the block);
- in a coding answer, a rework note or a new task — the page goes along to Claude Code;
- in the AI terminal — it becomes *@Title*;
- in ⌘K — paste a permalink, `#/p/<id>`, a page id or the plate's short ID (*ID ABCD·1234*): the page comes first, <kbd>Enter</kbd> opens it. An address of a page this device does not have says so — it never makes a new page.

The short ID also works after `#/p/` in the address bar.

## What One records
When a git stage or a key in the **Git** tab commits, pushes or opens a merge / pull request, the task page gets one grey note — for example **Ship · 14 Oct 14:32** with the line *Commit a1b2c3d · Branch one/fix-login-ab12cd · MR !42 · pushed to origin/one/fix-login-ab12cd*.

- The commit, the branch and the request are links to your GitLab / GitHub — once they are on the remote. A commit whose push or request then failed is noted too (*push failed*, *MR could not be opened*): you see what is only on your computer.
- **PR / commit** (the task's field) holds the merge / pull request — without one, the link to the pushed commit. A request link is never replaced by a commit link.
- The commits the worker makes for a task (git stages and the **Commit** key) and its merge / pull request description end with `One-Task: <task id>`. The task's **Git** tab shows that line under **Find on the host**, with a copy key: search for it on GitLab / GitHub to find what a task shipped. (A merge commit made by **Update from base** does not carry it.)
- The note names the repository's web address (host and project) — never a folder of your computer. The full git state and the log stay on this device (**Git** and **Log** tabs).
- A self-hosted GitLab or GitHub Enterprise whose address does not say *gitlab* / *github*: pick its **Host type** on the worker's setup page — links and merge requests then work there too. An open merge request is found again instead of a new-request link.
- **Push rejected?** The branch on the remote has commits this one does not have. **Update from base** merges them in first, then **Retry**. The worker never force-pushes on its own.
- A worker older than 1.10.0 keeps writing the stage's summary instead — **Download again** for the note with links.

## From the AI terminal
Ask the [AI terminal](help:agent) (<kbd>Mod+J</kbd>) *“what waits for me in the pipelines?”*, *“create a task to fix the login form in website and start it”* or *“approve the plan of Fix login”*: Claude reads the pipelines and **proposes** tasks and actions, you apply them in its review. The card of a new task shows its whole page as Claude Code will read it; an approval shows the plan. What starts the worker (**STARTS WORKER**) is applied on its own, never with *Apply all*; a task waiting for **Confirm on this device** is confirmed only here in its panel. `/pipelines` lists the open tasks.

## Safety
The worker touches only the repos you ticked; One can send it task text and fixed git actions — never a command, and it can never tick a repo itself. A downloaded worker only accepts this browser and this workspace; a cloud worker's messages are sealed between this browser and the worker — the server only passes them on. Claude Code keeps its permission rules, and task text goes to it as data, not as instructions. A cost limit per task is set on the worker's page, one per day in `worker.json`. For the note, One learns the repository's web address (host and project) — never a path. In a team workspace your worker only takes tasks you wrote or confirmed on this device (**Confirm on this device**) — a stage (its model too), repo or branch changed on another device asks again. A task one of your custom agents wrote waits for the same confirmation, also in your local workspace. The AI terminal never confirms a task: its actions are proposals you apply, those that start the worker one by one, and they are refused for a task that waits for Confirm. A task file the [folder / GitHub sync](help:sync) picks up never moves a task — Stage, Repo, Branch and the other pipeline fields stay as One has them, and the file is written again — and a task whose text came from the file waits for **Confirm on this device**, also in your local workspace.

> Tip: the full reference — config keys, protocol, troubleshooting — is `docs/CODING.md` in the repository.
