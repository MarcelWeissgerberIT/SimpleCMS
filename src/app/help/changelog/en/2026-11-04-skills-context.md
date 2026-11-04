---
id: 2026-11-04-skills-context
date: 2026-11-04
order: 100
title: Select skills and continue after context limits
summary: Personal instruction skills, SKILL.md and a compact restart that retains the work record.
---

**Skills** in the page dialog and AI terminal opens a personal library for this workspace on this device. Create an instruction or import a `SKILL.md` with `name`, `description` and an instruction body. Tags help with searching. Changes create a new version; earlier versions remain selectable and can be exported as Markdown.

**Add to request** inserts a selector such as `$clear-writing@2`. Nothing starts automatically. The selected instructions are included in the next request across model providers. Without a version, `$clear-writing` selects the latest locally saved version. The run receipt records its name, version and hash; a program captured from that run pins the version and content hash number. If another device lacks that version, provide it there; ONE does not silently substitute it.

Skills describe a method. They grant no tool or write permissions, are not current source evidence and do not execute scripts. Imported tool declarations and relative file references are not activated or fetched automatically. Skill contents count as personal context and only reach models permitted to receive it. The receipt proves which instructions were supplied; you still need to review the result.

After a context or output-length limit, the terminal offers **Continue with compact context** beside the input. The new run receives a bounded work record, earlier decisions, source references and existing proposals. Old source contents do not replace fresh reads. This recovery reads and analyses; external changes need a separate explicit request. Accepted or uncertain writes are not automatically replayed.

At the tool-call limit, **Continue** is now also available beside the input. Budget and provider limits remain active. ONE cannot send an unlimited single request; an input that is too large on its own still needs a narrower scope.

For text requests in the page dialog, **Continue in terminal with compact context** opens a fresh read-only analysis after a context or output limit. The previous run remains available.
