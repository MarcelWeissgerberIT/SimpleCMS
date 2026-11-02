---
id: buttons
title: Buttons
section: writing
order: 10
keywords: button, action, click, automate, insert blocks, add row, webhook, Schaltfläche, Knopf, Aktion
related: automations, templates, databases
summary: A button runs a list of actions with one click.
---
Insert one with `/button`, give it a **Label** and a style (**Signal**, **Ink**, **Ghost**), then add **Actions — run in order**:

- **Insert blocks** — e.g. a meeting agenda, written in the button's own little editor,
- **Add a page to a database** — with property values, optionally opened,
- **Edit properties of this page** — on a database row,
- **Send webhook** — to n8n, Make, Zapier or any URL,
- **Open a link or page**,
- **Show a message**.

Texts can contain `{{date}}`, `{{time}}` and `{{user}}`, filled in when the button is clicked; date properties can be set to today or now, a person property to **Me**. Click **Edit** on the button to change it.

> Share links, exports and published sites keep the button's label but never its actions (no webhook URL leaves your workspace).


The **Prepare an AI task** button action stores a concrete prompt. Clicking opens it in the AI terminal with the workspace default; the person visibly starts it. In a prepared AJ-Atlas workspace, a missing personal token sends them to Atlas setup first. The button grants no permissions and never starts inference on import.
