---
id: 2026-10-07-explain-code
date: 2026-10-07
order: 1
title: Legacy code explained in One pages, AI review and merge, projects
summary: "Explain the code" turns a codebase into One pages — a page per component, with the static analysis and a documentation check; "Review & merge" lets Claude review the merge request and One merge it; each pipeline can have several projects.
image: assets/shots/changelog/explain-code.webp
alt: The documentation page "Billing service · Components" in One — written by the pipeline for the task Billing service, the intro, then a page per component: Invoice engine, Tax rules, PDF export, Payment import
help: explain-code, review-merge, pipelines
try: coding
---
**Explain the code.** A new template on **#/coding**: Claude Code reads the repository and writes an **Overview**, runs the **Static analysis**, documents every component — and One makes each one **its own page** under one documentation page. A **Documentation check** compares what the README and docs say with the code. Nothing in the repository changes — see [Explain legacy code](help:explain-code).

**Static analysis** is a stage of its own in every pipeline: the repository's linter or compiler (`npm run lint`, `dotnet build`, `go vet` …, guessed on the worker's setup page) — its findings land in the page and the next stages read them.

**Review & merge.** After **Ship**, Claude reviews the branch's diff; you read the review at the gate — then One posts it to the merge request and merges it with your `glab` / `gh`. By hand: **Post review** and **Merge** in the task's Git tab — see [AI review and merge requests](help:review-merge). Give Claude Code a browser with the Playwright MCP server and the review checks the screens too.

**Projects.** Several databases per pipeline — **New project**, pick one, **Delete project** with all its tasks (Undo brings it back). **Spec → stories** turns an approved specification into a new coding project with a task per story.
