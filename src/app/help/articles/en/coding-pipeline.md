---
id: coding-pipeline
title: Coding pipeline (Claude Code on your machine)
section: ai
order: 9
keywords: coding, pipeline, claude code, worker, one-worker, download, setup, pairing, model, opus, sonnet, haiku, fable, tick repositories, git, branch, worktree, pull request, pr, diff, tests, repo, repository, code review, programmieren, aufgaben, cloud worker, one-worker-cloud, build server, vm, relay, remote, another computer, local or cloud
related: pipelines, legacy-modernisation, mcp-bridge, custom-agents, agent
summary: Hand coding tasks to Claude Code on your computer — plan, approve, implement, test, ship — and follow every step in One.
---
**#/coding** (⌘K *Coding pipeline*). One keeps the tasks, the approvals, the log and the diff; a small worker on **your** computer runs git and Claude Code. Your code never leaves your machine.

## Set up in three steps
You need Node.js 20+, git and the **Claude Code** CLI, signed in once (`claude`). Then **Settings → Coding worker** (or **#/coding**):

1. **Download the worker for this workspace.** The file comes ready-paired with this browser and this workspace — nothing to configure. One switches the link on by itself.
2. **Start it** in a terminal and keep it running:
```
node ~/Downloads/one-worker.mjs
```
3. **Tick your repositories in the page that opens.** The worker finds the git repositories on your computer and opens a page in your browser: tick the ones One may work in, check the base branch and the test command (e.g. `npm test`), then **Save & start**. The card shows *Connected · laptop · 2 repos* and the **WORKER** LED in the status bar turns green.

Business analysis and QA have pipelines of their own — see [Business analysis and QA pipelines](help:pipelines). Mention pages with **@** in a task: their text goes to Claude Code with it.

New code? The same page clones from **GitLab / GitHub** (an address, or a pick from your projects with `glab` / `gh`) or imports a **ZIP** as a new repository into `~/one-repos` — see [Modernise legacy code](help:legacy-modernisation). Per repository it can also give Claude Code your own MCP servers (e.g. a knowledge base).

To change them later, press **Change repositories** — the worker opens its page again on your computer. One only ever learns the repos' names; paths and commands stay in `~/.config/one/worker.json` on your machine.

> Tip: a new download replaces the pairing — start the file you downloaded last. On a computer without a browser, `node one-worker.mjs --no-browser` asks in the terminal instead (numbers tick, Enter saves).

## Run the worker on another computer (Cloud)
In a **team workspace on a One server**, **Settings → Coding worker → Where the worker runs** offers **Local | Cloud**. With **Cloud** the worker runs on any computer — a build server, a VM, the desktop at the office — and connects **out** to your One server: no port to open, no VPN.

1. **Download one-worker-cloud.mjs.** It carries a worker token that is only for you and only for this workspace, and a key that only this browser has.
2. **Copy it to that computer and start it there**: `node one-worker-cloud.mjs` (keep it running — tmux or a service). The file is the key: keep it private (`chmod 600`).
3. **Tick the repositories on that computer** — its setup page opens there, or `node one-worker-cloud.mjs setup --no-browser` asks in its terminal.

The card then reads *Connected · build-box · 1 repo · via cloud*. Everything else works as with a local worker.

- **Keep One open.** Tasks run only while One is open in **this** browser (any page of the workspace) — this tab hands out the work and writes the results. Close it and the worker waits; nothing runs on the server. A newer tab takes the worker over; the older one takes it back by itself when that tab closes.
- **Sealed end to end.** The server passes messages between this browser and the worker but cannot read or change them — task text, code, diffs and logs stay between the two.
- **One device.** The worker is paired with the browser that downloaded it. Another device shows *Paired with another device* and offers **Download for this device** (it replaces the other one — One asks first; until the new file starts, the other device keeps working and this one waits, then connects by itself).
- **Replace or stop.** A new download takes over as soon as it starts — on the same computer, stop the old worker first. **Revoke** stops the worker for good. Removing someone from the workspace stops theirs too.
- **https only.** Cloud needs the One server on `https://`; on plain `http://` the option is greyed out with the reason.

Cloud is greyed out with the reason in a local workspace, for viewers, and on a server without the worker relay.

## Approvals — or just do it
In the coding panel, **Approvals** sets where the task waits for you: **Approve the plan and the review** (default), **Review only — the plan runs on**, or **None — just do it**: plan, work, tests and shipping then run through without a stop; tests that fail twice still stop at the review. The choice is per device and becomes the default for new tasks. A task already waiting at an approval you just switched off goes on at once.

The **Log** tab shows every step: *Fetching origin…*, the new branch, *Starting Claude Code…*, every tool Claude Code uses — and, while it works quietly, *still working* once a minute. When the worker can't fetch the remote (no network, or git would need a password or an SSH key passphrase), the log says so within 60 seconds and the task goes on with what your computer has. For push and pull requests git needs an SSH agent or a credential helper — the worker can't type anything.

## Model per stage
Which Claude model Claude Code uses is set in **Pipeline** (on #/coding): open a stage's details (plan, implement and document stages) and pick its **Model** — **Standard** (the repo's model in the worker's `worker.json`, else Claude Code's default), **Opus**, **Sonnet**, **Haiku**, **Fable**, or **Own…** for any other model name (letters, digits and `. _ : - [ ]`; One checks it while you type). A stage with a model shows it as a small chip in its row. Plan with a strong model, implement with a faster one — each stage runs with its own.

For one task, **Model** in the coding panel (next to Approvals) overrides every Claude Code stage of that task — on this device: **As the pipeline**, one of the models above, or an own name the pipeline already uses. While Claude Code runs, a chip under **Now** shows the model it really uses, and the log names the model the worker passed on. A worker downloaded before models existed never gets a stage with a model — the task says *This stage needs a newer coding worker*: download it again, then **Retry**.

## A task from start to finish
1. **New task**: title, repo, goal, acceptance criteria. Leave *The worker may start right away* ticked. The task itself is the task's **page** (below the coding panel) — that text is what Claude Code works from. When the page is empty, **Insert outline** adds Goal, Acceptance criteria and Notes to fill in.
2. **Plan** — Claude Code reads the code in plan mode (it changes nothing) and writes the plan into the task. The task waits at **Approve plan**.
3. **Approve**, or **Rework…** with instructions: it goes back to Plan with your note.
4. **Implement** — Claude Code changes the code in its own git worktree; **Test** runs your test command. If the tests fail, Implement gets one more try with their output.
5. **Review** — the **Diff** and **Tests** tabs show what changed. Approve, or send it back.
6. **Ship** — commit, push, pull request (with the GitHub CLI) or a compare link. **Done**.

Each task works on its own branch (`one/<title>-<id>`) in its own worktree — your main checkout stays as it is. Before a task runs, the coding panel lets you pick the **Repo** (the repos your worker announces) and the **Branch**: *New branch (automatic)* or an existing branch of that repo on your computer to continue on (the base branch is never offered). You can also type one into the **Branch** field.

## While it runs
- **Now** shows the worker's last line and how long ago it came; under it **Step 6/30** (Claude Code's turn of the stage's limit), **≈ +$0.07** (this stage so far, an estimate — the exact cost comes at the end) and **Files** (what changed so far; a click opens the diff). #/coding shows the same line under every running task.
- **Log** streams what Claude Code does — a tool call shows its name; a click opens what it was called with, for Edit / Write the change as a code diff; the worker's own lines show in your language. If Claude needs a decision, the task shows **Claude asks** — your **Answer** starts the stage again.
- **Notifications**: in **Settings → Coding worker**, switch on *Notify me while One is in the background* — the browser tells you when a task waits, asks, failed or is done while the tab is in the background (on this device).
- **Stop** ends Claude Code at once; **Retry** or **Run now** start the stage again.
- **Git**: Refresh, Commit, Push, Open PR, Update from base, Show folder (the path appears in the worker's terminal only). **Force push** and **Discard worktree** ask twice; **Clean up** waits until the branch is merged. **Merge request**: **Post review** and **Merge** (asked first, with your glab / gh) — see [AI review and merge requests](help:review-merge).
- **Pipeline** (on #/coding) changes the stages: names, which ones run by themselves, Claude Code's mode, turns, model and instructions. Templates: *Standard*, *Modernise legacy code*, *Explain the code* ([one page per component](help:explain-code)), *Review & merge*. A **Static analysis** stage runs the repository's linter / compiler (set on the worker's setup page) and puts its findings in the page.
- **Projects**: several Coding databases side by side — pick, create and delete them above the board ([Projects](help:pipelines)).

**Repos in iCloud Drive** (e.g. in Documents with "Desktop & Documents Folders" on): git waits whenever a file is only in the cloud, so steps can take minutes — the log says so. Faster: keep the folder downloaded, or clone it again with **Clone from GitLab / GitHub…** on the worker's setup page (into `~/one-repos`, which is not synced) and tick that one. The worker starts at once either way and names a repository whose git is slow in its log. The worker's own working copies never go into iCloud.

## From the AI terminal
Ask the [AI terminal](help:agent) (<kbd>Mod+J</kbd>) *“what waits for me in the pipelines?”*, *“create a task to fix the login form in website and start it”* or *“approve the plan of Fix login”*: Claude reads the pipelines and **proposes** tasks and actions, you apply them in its review. The card of a new task shows its whole page as Claude Code will read it; an approval shows the plan. What starts the worker (**STARTS WORKER**) is applied on its own, never with *Apply all*; a task waiting for **Confirm on this device** is confirmed only here in its panel. `/pipelines` lists the open tasks.

## Safety
The worker touches only the repos you ticked; One can send it task text and fixed git actions — never a command, and it can never tick a repo itself. A downloaded worker only accepts this browser and this workspace; a cloud worker's messages are sealed between this browser and the worker — the server only passes them on. Claude Code keeps its permission rules, and task text goes to it as data, not as instructions. A cost limit per task is set on the worker's page, one per day in `worker.json`. In a team workspace your worker only takes tasks you wrote or confirmed on this device (**Confirm on this device**) — a stage (its model too), repo or branch changed on another device asks again. A task one of your custom agents wrote waits for the same confirmation, also in your local workspace. The AI terminal never confirms a task: its actions are proposals you apply, those that start the worker one by one, and they are refused for a task that waits for Confirm.

> Tip: the full reference — config keys, protocol, troubleshooting — is `docs/CODING.md` in the repository.
