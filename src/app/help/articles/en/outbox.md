---
id: outbox
title: Outbox
section: ai
order: 15
keywords: outbox, slip, slips, send, send route, sends, reads, draft, by hand, copy and open, mark as sent, receipt, reset row, changed, foreign, FOREIGN, hold, redraft, send anyway, withdraw, OUT, lock, ticket, reply, log work, Ausgang, Zettel, senden, Sendeweg, Quittung
related: integrations, custom-agents, mcp-servers, database-commands
summary: Claude drafts a reply or a change for another tool, you see exactly what would go out, and you send it yourself — slips, FOREIGN marks, CHANGED per mirror, receipts.
---
Writing into another tool — a comment in a ticket, a status, booked time — is where a mistake costs the most. The Outbox splits it into three steps, and only the last one is yours alone:

1. **Claude drafts.** ⌘ on a mirrored row → **Reply in the ticket tool**. Claude writes the text in a request **without any tools** — it cannot send anything, whatever the row says.
2. **You look.** The draft becomes a **slip**: the text exactly as it goes out, the tool's inputs, what changes in One afterwards, what Claude read — with every piece of someone else's text marked **FOREIGN**.
3. **You send.** **Copy & open**, post it in the other tool, **Mark as sent**. One updates the row and keeps a receipt.

Nothing in One sends by itself: not the AI menu, not ⌘K, not the [AI terminal](help:agent), not an agent — not even with “Apply directly”.

## Send routes
A send route belongs to an [integration profile](help:integrations) (`sends`). It names the tool that writes, its inputs as a template and what the row looks like afterwards:

```json
"sends": [{
  "id": "reply", "role": "reply",
  "label": { "en": "Reply in the ticket tool", "de": "Im Ticket-Tool antworten" },
  "tool": "add_comment",
  "args": { "ref": "{key}", "visibility": "team", "body": "{draft}" },
  "params": [{ "name": "draft", "type": "text", "max": 4000, "style": "Short and friendly" }],
  "after": [{ "property": "waiting", "value": false }],
  "via": ["hand"]
}]
```

- `{key}` is the row's key property; it may sit inside a text (`"LDG-{key}"`), `"{key|number}"` makes it a number.
- `{draft}` is the text Claude (or you) writes; every param fills a **whole** value — the inputs are built as values, never as glued-together text. `{sentAt}` is the time you press.
- `params` of type `option` (a list of `values`), `minutes` (`max`, `round`) or `number` give routes **without** a text — move a status, book time. They never call Claude.
- `after` sets row properties (by role or name) once the slip is sent.
- `check`, `confirm` and `reads` describe how the result can be read back; sending by hand does not use them yet.

The profile needs the unlocks `sends` and `keys` and must match its server **by name or host**. Every `sends[].tool` is then **OUT**: switched off in every Claude request One makes for that server, whatever allow-lists, codewords or picked tools say. **Settings → Claude AI → MCP servers** shows an OUT count per server.

## Drafting a slip
A route shows up as a [database command](help:database-commands) of the mirrored database: the ⌘ key on its sidebar row, the right-click menu, the toolbar's ⌘ key (pick a row first) and ⌘K “<database>: Reply in the ticket tool”. The **send routes** plate under the table lists them too.

The popover takes an optional instruction — `@` or `one:` mentions your own pages — and offers **Claude drafts** (↵) or **Write it myself**. Claude reads the row (as text from someone else), the pages you mention (only what their context marks let through), your [memory](help:memory) and your instruction; the cost line shows what it cost. With several rows selected, each gets its own slip (up to 10). Closing the popover never stops a draft.

## Reading a slip
- **The text** is shown raw — no formatting, no images, link targets listed in full. Hidden characters appear as `⟦U+202E⟧` and light **HIDDEN CHARS**. Nothing goes out before its whole text was on screen in the slip: a short one once it shows, a long one after **Show full text** (a card on #/outbox shows only its start). **E** edits it; afterwards Claude's draft and your text are compared word by word.
- **INPUTS** are the tool's arguments exactly as they will be used. **AFTER** lists the row changes and the inbox note that will be archived. **READ** lists the sources.
- **FOREIGN** marks text you did not write yourself: the mirror's fields (also the options it made from the source — a status, a tag), comments, mails, pages an agent, Claude, an import or someone's shared page wrote. An address in the draft — a link of any kind, a host, an IP address, an e-mail address — that appears only in foreign text, or in no source at all, is flagged in the text and needs its tick before the slip can go out. An address you typed into the instruction, or typed new into the text yourself, is yours; a dot or a slash added next to a flagged one changes nothing.
- The lamps: **FOREIGN TEXT**, **CHANGED**, **SENT**, **CONFIRMED**; **HIDDEN CHARS** and **UNCLEAR** only when they light. A slip sent by hand is never CONFIRMED — nobody read it back.

## CHANGED per mirror
When Claude drafts, the slip notes the row's source fields — comment count, the last comment's time, the source status. When the next mirror run changes them, **CHANGED** lights and a band quotes the newest comment: “Comments 7 → 8 · Source status unchanged — Last comment today 08:09 “It is settled, B7 fits.””. A comment that arrives while Claude is still drafting counts too. **H** holds the slip, **R** drafts again from the row as it is now, **Send anyway** says you read it. The line **PER MIRROR 07:30** is honest about where this comes from: the time the mirror last ran on this device (“run not seen here” when it ran elsewhere), and **READ 07:48** when the slip read the row. One compares what the mirror wrote; it does not ask the other tool itself. The comment you sent yourself does not count as a change.

## Sending by hand
**Copy & open** (⌘↵) copies the text and opens the row's link — **OPENS** shows where to; a link that leads away from the server's address is marked FOREIGN and needs its own tick. The other inputs are listed under “Set there too”. Post it there, then answer **Sent in tracker?** with **Yes, mark as sent** — or **Not yet**. Change the text in between and the question goes: copy it again. Marking it sent:
- writes the route's `after` values to the row as **one** version (“Outbox · Reply in the ticket tool” in its [history](help:history)); a field you changed since the slip was made is left alone;
- archives the mirror agent's inbox note for that row;
- keeps a receipt **BY HAND · not checked**.

**Reset row** on the receipt puts the row back — only fields that still hold what the Outbox wrote; what went out stays out. A sent slip cannot be withdrawn.

## Where slips are
- **The dock** beside the database: a column from 1200 px, a sheet below that, full screen on a phone with **Hold** and **Copy & open** at the bottom. Keys: **J** / **K** next / previous slip, **H** hold, **E** edit, **R** redraft, **⌘↵** copy & open, **Esc** back.
- **#/outbox**: counters (going out, foreign text, held), tabs, the clean slips and the ones to check one by one (each with why), today's receipts and every send route. Keys act on the card you are on; **⌘↵** there opens its slip in the dock.
- The sidebar row **Outbox**, a count on the database's row, **IN OUTBOX** / **SENT TODAY** on the database page and the status bar — the same numbers everywhere.

## What stays on this device
Slips and receipts live in this browser, per workspace (in a team workspace: per member) — shared between its tabs, never synced, exported or sent to Claude, and removed with the workspace copy. Up to 500 open slips per workspace; withdrawn slips are kept 30 days, sent ones a year. When the browser refuses storage, nothing is staged and the dock says why.
