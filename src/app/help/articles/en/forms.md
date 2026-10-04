---
id: forms
title: Forms
section: databases
order: 7
keywords: form, survey, questionnaire, questions, responses, share form, public link, webhook, logic, Formular, Umfrage, Fragen, Antworten
related: views, automations, share-links
summary: A form asks for the properties of a database — every answer becomes a row.
---
## Create a form
- **In a page:** type `/form` (German `/formular`). One inserts a database with a form view and three starter questions — name, email, message.
- **For an existing database:** **+** next to its views → **Form**.

The form has two modes: **Build** and **Fill**. In **Build** every question is a property: add one with **Add a question** (or name a new property), mark it **Required**, add help text and a placeholder, choose how options **Show as**. **Show only if** adds logic — a question appears only when earlier answers match. **After submitting** sets the closing heading, the message and an optional address to continue to.

In your workspace every response becomes a new row; **Responses** lists them.

## Share the form
**Share form** creates a link anyone can open — no account, no server. The link carries only the questions: no rows, no people, no ids. Answers from the link are sent from the respondent's browser as JSON to **your webhook** (n8n, Make, Zapier …), so a webhook URL is required. **What your webhook receives** shows the exact payload.

> Person and relation questions are asked as free text on a shared link; files are limited to 1.5 MB each, 5 MB in total.
