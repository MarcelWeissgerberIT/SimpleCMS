---
id: explain-code
title: Explain legacy code in One documents
section: ai
order: 12
keywords: explain code, legacy, old software, documentation, docs, document, understand, onboarding, component, module, architecture, page tree, static analysis, lint, linter, eslint, dotnet build, go vet, clippy, ruff, documentation check, doc check, knowledge base, atlas, Code erklären, Altsoftware, Dokumentation, Komponenten, statische Analyse, Doku-Check
related: legacy-modernisation, coding-pipeline, pipelines, review-merge
summary: Turn a codebase nobody understands into One pages — an overview, the static analysis, a page per component and a check of the documentation that exists. Nothing in the repository changes.
---
The template **Explain the code** lets Claude Code on your computer read old code and write what it finds as **One documents**: a page per component, linked together, searchable, with diagrams — for new colleagues, for an audit or before a rebuild. The repository is only read.

## Set it up
1. Connect the [coding worker](help:coding-pipeline) and tick the repository — or bring the code in the task itself: the template starts with an **Import** stage (drop a ZIP or paste a GitLab / GitHub address, see [Modernise legacy code](help:legacy-modernisation)).
2. On an empty **#/coding**: **Create it to explain code** — or in an existing pipeline **Pipeline → Explain the code → Save**. Want it next to your other tasks? **New project** with that template (see [Projects](help:pipelines)).
3. **New task**: the repository, and in the goal what you want to know — e.g. *How does invoicing work, and where does the money get rounded?*

## The stages
1. **Overview** — purpose, how to run it, the architecture with a diagram, the main flows with the files involved, the data model, external systems, a glossary.
2. **Static analysis** — the repository's analysis command (below); its findings become a section of the page.
3. **Components** — a section per component; One makes each section **its own page** under one documentation page (*<task> · Components*), top level in the sidebar. The task page lists them as mentions, so the next stage reads them.
4. **Documentation check** — what the README, docs and comments say versus what the code does: a table of what is missing, outdated or wrong, with the evidence in the code and a fix.
5. **Approve documentation** — read it; **Rework…** with a note sends it back.

Run it again later (**Rework…** or a new task): the pages of the same names are updated (a version of each is kept in its history), new components get new pages, pages you wrote in stay.

## Static analysis
On the worker's setup page each repository has a **Static analysis** field — prefilled from the repository: its `lint` script, ESLint, `dotnet build` (its analyzers), `go vet`, `cargo clippy`, `ruff`, `flake8`. Change it there, e.g. `npx eslint . --max-warnings 0`. The stage runs it in the task's worktree (or the main checkout when the task has none — it creates no branch); a non-zero exit is a finding, not a failure. Without a command the stage passes with a note.

Any pipeline can have it: in **Pipeline**, add a stage of the kind **Static analysis** — e.g. before a plan or a review.

## Your knowledge base
With your own MCP servers for Claude Code (setup page → *Own MCP servers for Claude Code*, e.g. `atlas`), every stage reads what is already known about the code first, and can record what it found.

> Tip: big code — start with one module in the goal. **Transform into** turns a section into a diagram or a table; **Copy for AI context** hands a page to any other AI.
