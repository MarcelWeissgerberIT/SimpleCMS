---
id: legacy-modernisation
title: Modernise legacy code
section: ai
order: 10
keywords: legacy, old software, modernise, modernize, rewrite, rebuild, migration, zip, import, clone, gitlab, github, glab, gh, code analysis, architecture, design, test design, characterisation tests, atlas, knowledge base, mcp, altsoftware
related: explain-code, coding-pipeline, pipelines, review-merge, mcp-servers, agent
summary: From a ZIP or a GitLab project to a rebuilt version — analysis, design and test design as sections of a page in One, tests that pin today's behaviour, then the rebuild.
---
One, the [coding worker](help:coding-pipeline) and Claude Code take old software apart and build it again. Every step lands in the task's page, where you read it, discuss it and approve it. Your code stays on your computer.

## 1. Bring the code to the worker
Quickest **in the task itself**: the template *Modernise legacy code* (or **Create it for legacy code** on an empty #/coding) starts with an **Import** stage. A new task without a repo waits there, and its panel shows a box: drop or choose a **ZIP**, paste a **GitLab / GitHub address** to clone, or take a repo the worker has. The worker makes the new repository in `~/one-repos`, the task takes it as its **Repo** and moves on to the analysis.

Or on the worker's setup page (**Settings → Coding worker → Change repositories**):
- **Import a ZIP…** — a ZIP of the source becomes a new repository in `~/one-repos`: one commit *Import <file>*. The ZIP's own `.git` folders are left out; a path that leads outside its folder refuses the whole ZIP. Right after, **Also create it on GitLab / GitHub** (with `glab` or `gh` signed in) makes the project — its name suggested from the code (package.json, pom.xml, README …) or the ZIP — adds it as the remote and pushes, so **Ship** can open merge requests.
- **Clone from GitLab / GitHub…** — paste the clone address (HTTPS or SSH) or pick one of your projects (with `glab` or `gh` installed and signed in). git signs in with your SSH key or credential helper; the worker cannot type a password.

Tick the repository, set its **test command** if it has one, and **Save & start**. `~/one-repos` is not synced — keep repositories out of iCloud Drive and Dropbox, git would wait for files from the cloud.

## 2. The pipeline
On **#/coding → Pipeline**, pick the template **Modernise legacy code** and save:
0. **Import**: the task's code — a ZIP, a clone address or an existing repo (see above).
1. **Static analysis**: the repository's linter / compiler (the setup page's *Static analysis* field) — its findings land in the page, and the analysis reads them.
2. **Analysis** (plan mode — nothing changes): overview, architecture with a diagram, data model, dependencies, quality hot spots, risks, the behaviour to keep.
3. **Design**: target architecture, UI and design, migration, what gets better.
4. **Test design**: characterisation tests — a table of cases that pin today's behaviour down.
5. **Approve concept**: read the three sections in the task page; **Rework…** with a note if something is off.
6. **Write tests** against the old code, then **Tests on the old code** — they must pass.
7. **Rebuild**, **Test** (the same tests on the new code), **Review**, **Ship**.

Each plan stage writes its own section into the page (*Analysis*, *Design*, *Test design*), so the later stages read what the earlier ones found. If the tests fail, the task goes back to the stage before once, with the output.

## 3. The task
**New task**: the imported repository as **Repo**, the goal in a few lines — e.g. *Understand the billing module and rebuild it as a typed web service with a clean interface. Keep the invoice rules.* **Approvals**: *Approve the plan and the review* stops after the concept; *Review only* runs on to the review.

## 4. Your knowledge base (e.g. Atlas)
- **Claude Code on the worker**: on the setup page, enter the server under *Own MCP servers for Claude Code* (the name `claude mcp list` shows, e.g. `atlas`). The stages may then read what is known about the code and record findings and decisions.
- **In One**: the AI terminal (<kbd>Mod+J</kbd>) with the server's codeword — e.g. `atlas: record the risks of this analysis` — see [MCP servers](help:mcp-servers).

## Only understand it?
To explain the code without rebuilding it — a One page per component, a documentation check — use the template **Explain the code**: [Explain legacy code in One documents](help:explain-code).

## Tips
- Big old code: start with one module — the analysis stays readable.
- **Transform into** turns a section of the analysis into a diagram or a table.
- The diff and the test output of every stage are in the task panel (**Diff**, **Tests**).
