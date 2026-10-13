---
id: ai-autofill
title: AI autofill
section: databases
order: 10
keywords: autofill, ai, claude, summarize, extract, categorize, translate, fill column, KI, Autofill, ausfüllen, zusammenfassen
related: properties, claude-key, automations, governor
summary: Let Claude fill a property for every row — a summary, a category, a detail from the page.
---
1. Click the header of a property (text, number, select, multi-select, checkbox, URL …) → **AI autofill…**
2. **What Claude should do:** **Summary**, **Key info** (say what to extract), **Translate**, **Categorise** (picks from the property's options; **Allow new options** lets Claude suggest new ones) or **Custom prompt**.
3. Check the **Estimate** — rows, tokens in and out, cost — and run it: **Fill empty rows** or **Fill all rows**.

Claude reads each row's title, its other properties and the beginning of its page. Results wait for your review unless you choose **Apply without review**.

**Update automatically when the page changes** keeps the property current: a few seconds after a row changes, it is filled again — while One is open.

**At the red line.** With a [budget](help:governor) set, the panel shows a run's estimate against the rest before you start; a run pauses at the row that would cross the line (**+$1 once** goes on, **Stop** ends it). Rows the automatic update would fill wait as *paused* — also over a reload — and are filled when the budget rises, a new day starts, or with **E** in the panel.

> Autofill uses your own Claude key; Anthropic bills the usage to it. Only the rows being filled are sent.
