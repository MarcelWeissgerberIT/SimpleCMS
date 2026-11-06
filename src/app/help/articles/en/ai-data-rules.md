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

## Jev as a pre-checker
A [pre-check](help:ai-jev) is an OpenRouter request like any other: the OpenRouter column decides what Jev may read. It reads the agent's instructions, the change and the row — never ids, e-mail addresses or keys; names only when names may go to OpenRouter (else "@Person 1"); a page OpenRouter may not see shows as "[Page]". A kind of data the rule refuses means **no request at all**, and the card says which ("Jev may not see …") — with **Hold back** such a proposal is held, with the write gate the run waits.

## Limits
A **monthly limit** per provider can be set in One. The [spending governor](help:ai-costs) explains warnings and the brake. Set an additional binding account limit with the provider — the Claude Console, or the key's limit at OpenRouter (shown live in Settings → AI).

## In a team
Owners and admins set the workspace's columns; members see them read-only and can only be stricter on their own device (switch a kind off for themselves). Your own data stays yours either way.

## Data routes: hints first, boundaries when needed
In **Settings → AI → Data routes**, existing permissions remain in force unless you explicitly add a boundary. The compact **Data routes** control beside the model picker and on coding tasks identifies inference on the paired local worker, a shared local model host or the cloud provider. A shared local host uses encrypted transport through the ONE team server; local inference does not mean all workspace contents exist only on your laptop.

ONE checks locally for a few clear signals, such as confidentiality markings, internal technical descriptions or explicitly labelled personal data. This is a heuristic, not complete detection. It sends no additional AI request. A hint blocks nothing, asks for no confirmation and changes no rule. Dismiss it for that context or disable hints on this device. No detected names or text excerpts are stored as a detection log.

Only an explicit boundary is enforced: **Local inference only**, selected providers or no model destinations. A boundary does not grant a provider new permissions. Select a page, coding task or database in the control to bound its subtree. Ancestor boundaries intersect; a child cannot reopen them. In team workspaces, owners/admins change these rules. An unavailable local model cannot fall back to the cloud across the boundary. Older clients must update; a coding worker without support receives no bounded task. Changed boundaries stop further model rounds and request that the connected coding worker stop; already transmitted data cannot be recalled.

**MCP is a separate route.** Optionally allow exact MCP origins for the workspace, such as `https://aj-atlas.com`. An enabled empty list allows no external MCP connection. These rules guard ONE-managed model and MCP routes, not all network traffic: shell, Git, other programs, existing cloud sync and provider-internal routing are not comprehensively monitored. Copied text loses provenance; the heuristic is not a DLP system. Native CLI agents may have additional settings/tools. Under an MCP boundary, native MCP configurations that cannot be constrained are refused; use explicitly selected personal connections.

The legacy local MCP assistant in AI settings cannot attest these explicit boundaries. Under a destination boundary, use the current coding worker. Without a new boundary, the existing setup remains usable.
