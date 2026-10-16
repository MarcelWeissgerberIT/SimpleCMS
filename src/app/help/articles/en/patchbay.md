---
id: patchbay
title: Patchbay: what runs by itself
section: ai
order: 19
keywords: patchbay, schaltplan, wiring, rack, cables, jacks, modules, what runs by itself, fuse, fuses, open path, way out, content from outside, private data, allow this path, allowed, lapsed, switch to proposals, by hand only, disconnect write tools, unknown here, almost open, setup lamps, set up a profile, drop a profile, integration.json, back to setup, live, runs today, patching, connect to, unplug, strands, net label, whole workspace, Sicherung, Weg zulassen, Zulassung, von außen, nach außen, Einrichten, Lampen, Patchen, Kabel, Buchse, Stränge
related: automations, custom-agents, integrations, mcp-servers, outbox, governor, agent-trust, ai-autofill, mcp-bridge, preflight
summary: One page shows everything that runs by itself — agents, automations, scripts, MCP servers, pipelines — as a rack with cables. Fuses mark the paths where content from outside could carry private data out with nobody in between.
---
Agents, automations, autofill, scripts, MCP servers, mail sorting, sync and the coding pipeline each have their own editor. The **Patchbay** puts them on one rack: what starts what, what reads and writes where, and which paths lead out of One. It answers two questions — *what runs here by itself?* and *where could a mail with a hidden instruction get my data sent out?*

Open it from the sidebar row **Patchbay** (between Scripts and Building blocks), with ⌘K **Patchbay**, from **Workspace settings → Automation** (**As patchbay**, or **Show in the patchbay** on a row), the status bar's **PATCHBAY** cell or Preflight's **FUSES** lamp. Opening it sends nothing to an AI and changes nothing.

## Reading the rack
- **Three columns.** **§ 01 Sources** — clocks, row triggers, MCP servers, incoming webhooks, sync, clippings, buttons and commands. **§ 02 Processing** — agents, automations, scripts, AI autofill, mail sorting, the bridge, pipelines. **§ 03 Targets** — databases and pages, the Outbox, and the ways out (labelled by their kind: WEBHOOK, GIT, HTTP, MCP, SYNC).
- **Jacks** on a module: **START**, **READ**, **WRITE?** (tools that may write), **OUT n · BY HAND** (tools only the [Outbox](help:outbox) calls). A **?** means read / write was guessed from the tool names.
- **Cables.** Solid: reads, writes, starts. **Dashed: can — the AI decides** (an agent *may* write there). **Hatched: content from outside.** **Orange: the path of a fuse.**
- **Net labels.** Two flags with the same name are the same connection — an agent sets *“Forward”* on the right, the automation listening to *“Forward”* starts on the left. This keeps every cable flowing left to right.
- **Whole workspace.** An agent allowed to use everything gets one dashed cable to **Whole workspace · n databases** instead of one cable per database. From the seventh cable leaving one jack, cables bundle into a **+n** chip; ↵ lists them.
- **Folds.** *n idle* (no cable), *n off* (switched off — runs only by hand), *n hidden* (by the filter). ↵ unfolds them.
- **The readout** counts modules, cables (*n chosen by the AI*), **runs today on this device** with their cost, and the fuses. **All databases ▾** narrows the rack (presets: *Everything*, *Fuse paths only*, *Running now*, one profile, chosen databases). **Picture · zoom** opens a static picture with a minimap and an SVG download; **As list** goes to Workspace settings → Automation.
- **§ In plain words** under the rack says every strand in a sentence — the same words a screen reader hears on each module.

Every number in the head matches what is drawn and folded, and the sidebar badge, the status bar and Preflight show the same fuse count.

## Fuses
A **fuse** lights on a path where four things meet:

1. **An AI decides** with nobody approving each action: a [custom agent](help:custom-agents) (also a switched-off one — *Run now* is one press away), [AI autofill](help:ai-autofill) set to fill automatically, mail sorting after each sync, or the [bridge](help:mcp-bridge) when Claude Desktop / Code may write without asking.
2. **Content from outside reaches it**: rows of a mail database, read results of an MCP server, the body of a webhook that starts a server agent, rows from an incoming webhook or API token, pages the GitHub sync picks up, clipped web pages — and any place written by something that was itself fed from outside.
3. **Private data is in reach** — more than the one row that brought the content and the agent's own report page: other rows, other pages, *everything*, another server's read tools, the memory.
4. **A way out with nobody in between**: an automation's webhook after the AI's direct write, the AI's own MCP write tools, the MCP servers autofill gets because they are set to *All AI calls*, this device's GitHub auto-push, a pipeline's Git step that needs no approval.

Each fuse gets a tag (**F1**, **F2** …) on its path and a plate under the rack: the three lamps with what lit them, the path as chips, one sentence, the facts (write mode, access, trigger, chain length) and the keys. Analysis follows every path to its end; the drawing only folds long ones (**+n steps**).

**A person in between closes a path**: proposals for review, a script effect that asks, the bridge asking before each write, a coding task that waits for Confirm or an approval, an Outbox send by hand. Such paths, and paths a data rule or a missing lamp closes, show in the fuse list as **Almost open** — never counted, so you see what keeps them shut. Proposals do not stop MCP tools: they run inside the AI's tool loop.

**Unknown here** (a grey **?**) is a part this device cannot see — another member's browser agent and its servers, a server agent runtime only owners and admins may read, newer settings, a script that names places by name, a coding pipeline whose tasks carry content from outside while Claude Code works on them and the git step goes out with nobody in between. It is never counted as a fuse and never read as safe.

**Tool lists.** A server's tools split into READ, WRITE? and OUT. A server nobody tested here, attached without an allow-list, counts with **all** its tools: *Tool list unknown — test the server or narrow the tools*. An integration profile may declare tools as reads; a tool whose name says it writes stays WRITE? anyway. Read tools whose names suggest the web (fetch, url, search …) stay listed as *still connected* — they may carry data in their arguments.

> A fuse is read from the settings — **no guard while it runs**. One does not see: imports and folder sync (counted as your own files), what you type, shared forms (their answers never land in One), read tools that leak through their arguments, and the own tools of Claude Code in the coding worker or of the Claude behind the bridge. Things that already help — the [pre-check](help:ai-jev), the Outbox's locked tools, web images that become links — are named in the facts but do not clear a fuse.

## The keys on a fuse
The plate's keys change the **real setting**, through the same writer as its editor:

1. **Take the AI off "direct"** — *Switch to proposals* (the agent), *Autofill by hand only*, *Sort mail by hand only*, or *Bridge: ask before each write*. The line under the key says what still happens ("applying it still fires …"). A fill you start by hand still carries the "All AI calls" servers and, with "Apply without review", writes straight into the cells — so *Autofill by hand only* is offered only where the review then stops the path; an autofill that already runs by hand only stays on its fuse, marked "runs only by hand".
2. **Cut the trigger or the tools** — *“Field” by hand only* (agents and the bridge never write that field, so they cannot set off the automation listening to it), *Disconnect write tools* (only the server's read tools stay with the agent), or *Server: no longer for autofill* (**this device only** — other devices keep the path).
3. **Allow this path** — your name and the date. The path no longer counts while nothing on it changes; any change to a module on it (a new webhook address, another write mode, more tools) ends the allowance: *No longer allowed: … changed*. **Withdraw** takes it back.

The digits <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> work while the fuse list or its plate has the keyboard. After key 1 or 2 the plate turns ink: **Closed for this visit** with its Undo. Every key raises a toast with **Undo** that works from any page; <kbd>Mod+Z</kbd> in the Patchbay takes back the newest key. Undo refuses when the setting changed since — *Changed since — open the editor*. **Copy link** hands a fuse to someone else (`#/patchbay?f=…`).

Where the setting lives, a line says so too: *On fuse F1 — show in the Patchbay* in the agent editor, its MCP tool list and the database's automations.

**In a team** every member who may edit uses keys 1 and 2 with the editors' own rights; when you are not the agent's creator, the creator must confirm the agent afterwards, and the key says so. Only **owners and admins** allow a path — the key names them otherwise. A fuse only another member's browser can see is shown to owners and admins as a grey row: that member can close it with key 1 or 2. Viewers see the rack; every key is inert for them.

Keys 1 and 2 work without an [integration profile](help:integrations) that unlocks "Only by hand" or tool lists: they only take capability away. Once a field is set to *Only by hand*, its property menu shows the switch to everyone, so it can always be switched off there.

## Setting up a profile
Drop an `.integration.json` on the rack, or use **Drop a profile here** (choose a file, or paste its text — checked before anything is saved). **Workspace settings → Integrations → Set up in the Patchbay** does the same for a profile that is there already (it only reads, so every member may). In a team only owners and admins add profiles.

The page shows the profile's part of the rack in a band — what exists, and dotted modules the setup will create — and folds the rest. Below, **§ 00 Set up · n lamps · in this order**:

- **00 Key** · **01 Server** · **02 Test** · **03 Profile** · and per recipe **04 Database** · **05 Agent** · **06 First run**.
- Each lamp says its state in words (*Done*, *Next*, *Later*) and, while dark, in one sentence what is missing. Only the next lamp has the primary key, and ↵ opens exactly that step — the key setup, the server settings, the agent editor or the mirror setup as a dialog over the Patchbay.
- A step that leads elsewhere (the test, the profile, the review of the first run's proposals) leaves a chip in the top bar: **Back to setup · 05 next ↵**.
- Undo (<kbd>Mod+Z</kbd> or the band's key) takes the drop back until a lamp step has made something; after that the profile is removed only in Integrations. Later visits show a one-line strip with the next step instead of the band.

## Live
While the page is open, runs on **this device** light up: the module's lamp blinks, a dot travels its cables, and small windows say *RUNNING 0:04 · $0.21*, *07:30:00 FIRED* or *+3 FOR REVIEW*. A failed run shows a red lamp and **! FAILED**; a run the Governor held says **HELD**, never red. Automations light only in the tab where they run; agents running in another tab of this browser show their lamp and window; server agents say *on the server*. With reduced motion there is no dot and no blink — the run's cables are drawn thicker.

## Patching
The **Patching** switch in the head (off by default, remembered on this device) lets you change wiring on the rack:

- Drag from a jack to a lit jack — or click, tap or press <kbd>J</kbd> on a jack for **Connect to …**, which lists what fits and why the rest does not. <kbd>Delete</kbd> on a plugged jack unplugs it.
- A cable means a real setting: an agent's trigger, its databases, its report page, its MCP servers and tools, an automation's trigger or script, a database command. The editors' own checks apply.
- **Ways out are made in their editor** — a webhook address is never typed here; ways out can only be unplugged.
- A cable that would open a way out shows **+F2** before you let go and asks first: *This opens a way out — fuse F2. Plug it anyway?*
- Owners and admins can lock a server's tool for the Outbox (**Lock a tool (OUT)**), through the matching integration profile.
- Every patch has Undo (toast, <kbd>Mod+Z</kbd> here). Viewers and read-only members cannot patch; model and budget knobs open their editor.

## Keyboard
<kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> move between modules · <kbd>Enter</kbd> opens a module's editor · <kbd>Space</kbd> shows its connections (and marks its sentence in *In plain words*) · <kbd>J</kbd> finds a jack · <kbd>F</kbd> goes to the next fuse · <kbd>Tab</kbd> leaves the rack for the fuse list · <kbd>Esc</kbd> cancels a drag, then deselects.

## On a phone
The rack becomes **strands** — one card per processor with its sources and targets in words, open fuses first, then *Not processed* for everything that runs nothing. A running strand lights in place; a chip at the top jumps to it. Fuse keys and setup lamps work there; patching does not.

## What stays on this device
The day's run counts, what the Patchbay read on opening (ids only, never text), the setup's progress, the Patching switch and the rack's order stay in this browser — never synced, exported or backed up — and go with the device copy. Allowed paths belong to the workspace: shared in a team, carried by full backups, and never taken from a backup on restore.
