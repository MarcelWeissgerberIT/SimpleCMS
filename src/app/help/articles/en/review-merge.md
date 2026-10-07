---
id: review-merge
title: AI review and merge requests from One
section: ai
order: 13
keywords: review, code review, ai review, merge request, mr, pull request, pr, merge, comment, gitlab, github, glab, gh, approve, browser, playwright, ui check, screenshot, static analysis, Review, Merge Request mergen, Kommentar, Browser
related: coding-pipeline, explain-code, pipelines, mcp-servers
summary: Claude reviews the merge request's diff, you read the review in One, then One posts it to the merge request and merges it — with your own glab / gh.
---
The template **Review & merge** carries a coding task to the end: after **Ship** (the merge / pull request is opened), Claude Code reviews what the branch changes, you decide — and the worker posts the review and merges.

## The stages after Ship
1. **AI review** — a document stage with the result *Review*. It runs in the task's worktree and gets the branch's whole diff against the base: correctness, security, error handling, tests, readability. The review is a section of the page: **Approve** or **Request changes**, then findings with file:line, severity and a fix.
2. **Approve review & merge** — the gate. Nothing has been posted or merged yet. Not happy? **Rework…** sends a note to the review; to change the code, move the task back to **Implement**.
3. **Post review** — the review becomes a comment on the merge request (`glab mr note` / `gh pr comment`), under your name.
4. **Merge** — `glab mr merge` / `gh pr merge` (merge commit; squash or rebase when the repository allows only those). What is not pushed is not merged: uncommitted or unpushed work stops the stage. The branch stays — **Clean up** removes it afterwards.

## By hand
In the task's **Git** tab: **Post review** (the task's newest review) and **Merge** — each asks first. They work in every coding pipeline with a review stage.

## Requirements
- `glab` (GitLab) or `gh` (GitHub) installed and signed in on the worker's computer (`glab auth login` / `gh auth login`), and for the repository *Pull requests: with glab / gh* on the setup page.
- Any pipeline can use it: in **Pipeline** a **Git** stage's action *Post the review to the merge request* / *Merge the merge request*, and a document stage's result *Review*.

## Checking the UI in a browser
Give Claude Code a browser: add the Playwright MCP server for Claude Code on the worker's computer (`claude mcp add playwright npx @playwright/mcp@latest`) and enter `playwright` under *Own MCP servers for Claude Code* on the setup page. Name the address where the change runs in the task (e.g. a preview link) — the review then opens it and checks the changed screens too. One never reads your own browser tabs.

## Static analysis first
Add a **Static analysis** stage before the review: its findings are in the page, and the review reads them — see [Explain legacy code](help:explain-code).
