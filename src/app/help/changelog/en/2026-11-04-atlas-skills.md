---
id: 2026-11-04-atlas-skills
date: 2026-11-04
order: 110
title: Import skill instructions from Atlas
summary: Find personal Atlas sources, preview their instructions and bind an immutable skill version.
---

Open **Skills → From Atlas** in the page dialog or AI terminal. Select your personal connection, enter the tenant and optionally a project. Search for instructions or read a known numeric Atlas Ref directly. Search displays up to 20 candidates; this is neither a complete skill catalogue nor proof that other matches do not exist.

**Read source** loads a complete, active record in the selected tenant and checks the optional project. The preview expects a complete `SKILL.md`, one Markdown code block containing it, or a JSON definition with `name`, `description`, `tags` and `instructions`. A title or tag alone never becomes a skill. Attachments and relative file references are not loaded automatically.

**Import these instructions** stores a personal snapshot on this device and workspace. The connection, origin, tenant, project, Ref, content hash and metadata hash remain bound and appear in the skill receipt. The local version identifies this snapshot; it is not the Atlas revision. **Add to request** selects that version for the next AI request. Search, preview and import send no model request and write no Atlas records.

**Check Atlas source** reads the same Ref again. Changed content becomes a new version only after explicit import. Existing compiled tasks keep their old snapshot. Same-named skills from different sources never silently replace each other. Saving a manually edited copy creates a new version without the original Atlas source binding. Markdown exports preserve the fixed binding when imported on another device.

**My skills → Template: Atlas alignment** provides an editable German instruction: work from ONE context, clarify creation versus update versus comment when needed, read actual sources and verify the result. Atlas stays optional. The template starts nothing and grants no write permissions.

Markdown import accepts descriptions up to 2,000 characters, including existing German and English SDD skills. Their scripts are not executed. A stored source binding records historical provenance; it does not replace fresh task evidence or approvals.
