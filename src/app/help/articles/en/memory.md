---
id: memory
title: One memory
section: ai
order: 8
keywords: memory, one memory, remember, /remember, merk dir, preferences, facts, decisions, procedures, template, example, examples, #tag, pattern, usage log, memory log, recall, /no-memory, /example, Gedächtnis, One-Gedächtnis, merken, Vorlage, Beispiel, Verlauf
related: agent, ai-menu, custom-agents, claude-key, templates
summary: Claude remembers what you confirm — facts, preferences, decisions, procedures and whole pages as examples — and uses it as the template for new tasks.
---
The One memory is a database in your workspace: **One memory**, with one row per memory — one plain sentence, a **Type** (Fact, Preference, Decision, Procedure, Example), **Topics**, a **Source** and **Active**. A Procedure's page holds its template (steps, columns, wording). It is an ordinary database: edit, add, untick **Active** or delete rows by hand — One reads whatever is in it. In a team workspace it is private: only you see it.

## Remembering — always with your OK
- **After an AI-terminal task** Claude proposes 0–3 memories: a card **REMEMBER? · 2** at the end of the task. On an entry: <kbd>y</kbd> or <kbd>Enter</kbd> saves, <kbd>e</kbd> edits (type, sentence, topics, template), <kbd>n</kbd> dismisses, <kbd>a</kbd> saves all, <kbd>u</kbd> undoes. <kbd>Tab</kbd> on the empty prompt jumps to the card. Nothing is saved without your OK.
- **Yourself:** `/remember <sentence>` (`/merken`) in the terminal; in the AI menu a request starting with *remember …* or *merk dir …*; or select text → **Ask AI → Remember this** — Claude condenses it into one proposal you save, edit or discard.
- In the terminal Claude can also stage a memory itself (`remember`); it appears in the review list like any other change.
- **Almost the same** as an active memory? The proposal says so and offers **Update existing** instead of a second entry (**Save as new** still works).

## Using it as the template
Before every free-form request — a terminal task, your own request in the AI menu, ⌘K `?` and custom agents — One picks memories: every active Preference, plus the most relevant Facts, Decisions and Procedures for the request (at most 12, about 3,000 characters). Claude is told to follow a matching Procedure as the template, to say **[M3]** when it uses one, and to say so when your request contradicts a memory.
- The AI menu shows **MEMORY · 3** under *Reads*; the terminal shows it in its head. Click it: which memories went along (each opens its entry), **History**, the database and the log.
- Without memory for one request: `/no-memory` (`/ohne-gedächtnis`) before the next task, `/no-memory <task>` for that task, or **Use the memory for this request** in the AI menu's list.
- Claude can search the memory itself (`recall`) in the terminal and in custom agents.

## Pages as examples
Keep a page as an **example** and let Claude build new content on it: *“take #wochenbericht as the template and write the report for week 41”*.
- **Save:** the page's **⋯** menu → **Save as example in memory**, `/example <tag>` (`/beispiel`) in the terminal, or select blocks → **Ask AI → Remember as example…**. Give it a **tag** (a–z, 0–9, -), optionally what it is for and topics. When you marked blocks of the page for Claude, only those become the example.
- Claude describes the **Pattern** (sections, columns, tone, length); the entry keeps it and below it a copy of the **Example** — inline databases as their columns and up to 5 rows. Both are yours to edit.
- **Use:** name it in a request — `#wochenbericht`, or the tag as a word. The whole example goes along (up to 10,000 characters) with *same structure, new facts*. Type `#` in the terminal or the AI menu to pick a tag; an unknown `#tag` is said, the request runs without it.
- A taken tag offers to **replace** that example.
- **Template or example?** A [template](help:templates) copies a page 1:1. An example is a pattern Claude follows with new content.

## History: what was used, when
Next to the memory there is a second database, **Memory log**: one row per request that took memories along — when, where (AI terminal, AI menu, ⌘K, *Agent · name*), the request as you typed it, the page it ran on, **Memories** (all that went along) and **Cited** (those Claude cited). Open a memory and you see **Used in** and **Cited in** with each request; **Uses** and **Last used** count the citations.
- The log keeps the newest 500 rows; older ones go to the **trash** (never deleted for good).
- It stores what you typed and links — never page content or Claude's answer.

## Settings
**Settings → Claude AI → One memory** (per device): **Use the memory**, **Propose memories after AI-terminal tasks** (on by default once the memory is set up — one small extra request per task), **Keep a usage log** (off: no new rows; existing ones stay), **Set up memory** and links to both databases.

> Memories go to Anthropic with the requests they are picked for, like the page text you send. Keep secrets out of the memory.
