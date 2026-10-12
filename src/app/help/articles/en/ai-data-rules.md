---
id: ai-data-rules
title: Data rules — what may go to which AI
section: ai
order: 1
keywords: data rules, data, rules, privacy, presets, all, work data, marked only, selection, page text, rows, files, people, names, transcripts, private pages, mail, memory, mcp, operators, no data collection, zdr, deny list, limit, spend limit, team, admin, Datenregeln, Daten, Regeln, Voreinstellung, Betreiber, Datensammlung, Grenze, Ausgabenlimit
related: ai-providers, privacy, ai-costs, memory
summary: Per provider, which kinds of data a request may carry — set in the assistant's step 04, checked before every request.
---
Every AI request carries some kinds of data — the text you selected, a page, rows, a picture, people's names. **Data rules** say per provider which kinds may go there. One checks them before anything is sent: a request that would carry a refused kind stops with **Change rule**, and nothing leaves.

## The matrix
Step 04 of **Set up AI** shows a row per kind of data and a column per provider (**Settings → AI → Data** shows one line per provider; its **Change** key opens step 04):
**Help & instructions**, **Database & field names**, **Selected text**, **Page text**, **Database rows**, **Images & files**, **Many pages**, **People's names** (else they read “@Person 1”) and **Meeting transcripts**.

- **Claude** keeps what it had: everything, unless you change its column.
- **A new provider starts with nothing.** Pick a preset — **Everything**, **Work data** (no names, no transcripts) or **Selection only** (help, names of fields, the selection) — or switch single kinds.
- The line under the matrix says it in words, for example *Private pages: only to Claude. Mail: only to Claude.*

## Your own data
Private pages (in a team), the Mails databases, the One memory and MCP results are yours: they go to a provider only when **you** switch them on — on this device, per provider. A workspace rule can keep them away; it can never switch them on for you.

## Operators (OpenRouter)
OpenRouter hands a request to the operator of the model. One names the operators your rules allow, switches OpenRouter's fallbacks off and — unless you switch it off — asks for **operators that collect no data**. **Zero data retention only** narrows it further; a **deny list** names operators that never get a request. This applies to the [Jev Router](help:ai-providers) too: it forwards only to models of your list, and Jev (TypeSafe) reads the request to choose.

## Limits
A **monthly limit** per provider can be set in One (step 04). In this version it is only stored with the rules — One does not warn or stop at it yet; warnings and the brake come with the spending governor in a later update. The binding limit lives with the provider — the Claude Console, or the key's limit at OpenRouter (shown live in Settings → AI).

## In a team
Owners and admins set the workspace's columns; members see them read-only and can only be stricter on their own device (switch a kind off for themselves). Your own data stays yours either way.
