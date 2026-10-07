---
id: 2026-10-07-legacy-modernise
date: 2026-10-07
order: 3
title: Modernise legacy code — from a ZIP or GitLab to a rebuild
summary: The coding worker clones from GitLab or GitHub and imports a ZIP of old code as a new repository; the pipeline template "Modernise legacy code" analyses, designs and pins today's behaviour down with tests before the rebuild.
image: assets/shots/changelog/legacy-modernise.webp
alt: The pipeline editor with the template Modernise legacy code — Analysis, Design, Test design, Approve concept, Write tests, Tests on the old code, Rebuild, Test, Review, Ship
help: legacy-modernisation, coding-pipeline
try: coding
---
**New code for the worker.** Its setup page (**Settings → Coding worker → Change repositories**) now has **Clone from GitLab / GitHub…** — paste the clone address, or pick one of your projects when `glab` or `gh` is signed in — and **Import a ZIP…**, which turns a ZIP of source code into a new repository with one commit — and, with `glab` or `gh` signed in, creates the project on GitLab or GitHub right after (its name suggested from the code or the ZIP) and pushes it. Both go to `~/one-repos`, a folder that is not synced. A ZIP's own `.git` folders are left out, and a ZIP with a path outside its folder is refused.

**The template.** **#/coding → Pipeline → Modernise legacy code**: **Analysis**, **Design** and **Test design** each write their own section into the task's page — architecture with a diagram, risks, the behaviour to keep, the target design, a table of test cases. After you approve the concept, Claude Code writes tests against the old code, then rebuilds, and the same tests have to pass on the new code.

**Your knowledge base.** Per repository, the setup page can give Claude Code your own MCP servers — e.g. `atlas` — to read and record what is known about the code. On GitLab, Ship opens a merge request with `glab`. The walk-through: [Modernise legacy code](help:legacy-modernisation).
