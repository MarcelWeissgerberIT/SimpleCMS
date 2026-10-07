---
id: 2026-10-07-pipelines
date: 2026-10-07
order: 1
title: Business analysis and QA next to Coding — and the Import stage
summary: Two more pipelines on the coding worker — Business analysis writes analyses and specifications (no repository needed), QA designs test cases into a database — each on its own or chained; legacy code arrives in the task itself.
image: assets/shots/changelog/pipelines.webp
alt: A Business analysis task waiting at Approve spec — the stages Backlog to Done, Approve and Rework, Then with Coding ticked, the policy page it mentions under Goes along
help: pipelines, legacy-modernisation, coding-pipeline
try: coding
---
**Three pipelines.** **#/coding** switches between **Coding**, **Business analysis** and **QA** — each with its own database and stages, each usable on its own. Business analysis writes an **Analysis** and a **Specification** into the task page (no repository needed), waits for your approval and records the result in your knowledge base. QA writes a test design — and its test cases become rows of the **Test cases** database.

**Chained when you want it.** **Then** hands a done task on: Business analysis → Coding and/or QA, QA → Coding. The follow-up task gets the whole page.

**Pages go along.** Mention a page with **@** in a task — Claude Code gets its text, read only. The panel lists them under **Goes along**.

**The code arrives in the task.** *Modernise legacy code* now starts with an **Import** stage: drop a ZIP or paste a GitLab / GitHub address in the task panel, and the worker makes it the task's repository. Claude Code can also ask questions while it plans. The worker needs a new download for all of this. More: [Business analysis and QA pipelines](help:pipelines).
