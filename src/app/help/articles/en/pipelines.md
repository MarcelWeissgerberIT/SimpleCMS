---
id: pipelines
title: Business analysis and QA pipelines
section: ai
order: 11
keywords: business analysis, ba, spec, specification, sdd, software design document, requirements, analysis, qa, quality assurance, test cases, test design, then, follow-up, chain, pipeline, document stage, import stage, zip, clone, reference, mention, knowledge base, atlas, mcp, Business-Analyse, Spezifikation, Anforderungen, Testfälle, Danach, Folgeaufgabe
related: coding-pipeline, legacy-modernisation, mcp-servers
summary: Next to Coding: a Business analysis pipeline that writes analyses and specifications, a QA pipeline that designs test cases — each on its own, or chained.
---
**#/coding** has three pipelines — switch at the top: **Coding · Business analysis · QA**. Each has its own database, board and stages, and each works on its own: a pure business analysis needs no repository and no Coding task. They run on the same [coding worker](help:coding-pipeline) with Claude Code on your computer.

## Business analysis
**#/coding/spec → Create the Business analysis database → New task.** The repository is optional — without one, Claude Code works from the task page, the pages it mentions and your knowledge base. The stages:
1. **Analysis** — context, stakeholders, requirements (FR / NFR, each testable), business rules, open questions, risks.
2. **Specification** — scope, user stories with acceptance criteria, flows (mermaid), data model, interfaces, traceability.
3. **Approve spec** — read both sections in the page; **Rework…** sends a note back.
4. **Record** — with your knowledge-base MCP servers (e.g. `atlas`), Claude Code records the approved result there and writes a short summary.

## QA
**#/coding/qa.** The **Test cases** stage writes a test strategy and coverage — and its test cases become rows of the **Test cases** database (ID, status *Not run*, priority, test type, area, preconditions, steps, expected result), each linked to its task. Then **Approve test cases** and **Record**.

## Document stages
Business analysis and QA stages are **Document** stages: Claude Code only reads — the repository if the task has one, the task, the pages it mentions, your knowledge-base tools — and its last message becomes a section of the task page, headed like the stage. Edit, Write and Bash are switched off. In the **Pipeline** editor a document stage has an **Result**: *Document in the page* or *Document + test cases (database)*.

For tasks without a repository the worker uses its own scratch folder. Your knowledge base there: on the worker's setup page, **Tasks without a repository — own MCP servers** (names as `claude mcp list` shows them).

## Chained — or on its own
**Then** (in New task and in the task panel) picks what happens when a task is done: Business analysis → **Coding** and/or **QA**, QA → **Coding**. One creates the follow-up task in that pipeline with the whole page (and a mention of where it came from); the done task links to it. Nothing ticked: nothing follows. A done task can also be handed on later (**Hand on to …**).

## Pages that go along
Mention a page with **@** (or link it) in a task — its text goes to Claude Code with the task, read only: up to 8 pages, a database row with its fields, a database with its entries' titles. The task panel shows them under **Goes along**. In a team, a mentioned page that changed waits for **Confirm on this device** like a changed task.

## Import stage
A pipeline can start with the code: **Import** (the template *Modernise legacy code* begins with it, as does *Create it for legacy code* on an empty #/coding). A task there shows a box in its panel: drop a **ZIP**, paste a **GitLab / GitHub address** or take a repo the worker has. The worker makes a new repository in `~/one-repos`, the task takes it as its **Repo** and moves on — see [Modernise legacy code](help:legacy-modernisation).

> Tip: questions work in every stage — Claude Code asks in the task panel (**Claude asks**) instead of guessing, also while it plans.
