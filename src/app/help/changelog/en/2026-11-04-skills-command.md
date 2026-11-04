---
id: 2026-11-04-skills-command
date: 2026-11-04
order: 120
title: /skills opens the skill preview
summary: Open the library from the terminal, page AI or a page slash command.
---

`/skills` and Enter opens the skill library in the AI terminal. `/ski` shows completion and a description; Tab completes the command, and clicking it opens the library directly. `/skills name` opens it with a matching search. `/skill`, `/fähigkeiten` and `/faehigkeiten` work as aliases.

The page AI dialog recognizes the same local command. On an empty page line, `/skills` shows a slash-menu entry and preview. Enter opens the library; selecting a skill transfers it to page AI. The slash text is removed while existing page content stays intact.

The first matching saved skill opens with its version and instructions. An empty library offers creation/import; an unmatched search shows a clear message. **Add to request** selects the version for the next request. Opening works without a model key, sends no inference request and leaves pending human confirmations unanswered.
