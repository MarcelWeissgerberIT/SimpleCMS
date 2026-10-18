---
id: workorders
title: Work orders: from a request to a running chain
section: ai
order: 20
keywords: work order, work orders, request, have it checked, check this, chain, planner, plan, chain ready, start chain, step, next step, basis, business analysis, coding, qa, stop after the analysis, go on, adjust, plan again from here, halt, resume, skip step, halt all chains, budget per chain, start without confirming, context, mcp server, read tools, outside, by hand, Prüfauftrag, Prüfaufträge, Prüfen lassen, Kette, Kette starten, Planer, Grundlage, nächster Schritt, Fortsetzen, Anhalten
related: coding-pipeline, pipelines, preflight, patchbay, mcp-servers, governor, ai-jev, sync, flight-recorder
summary: Write down what should be checked — One plans a chain of pipeline tasks from it (Business analysis, Coding, QA), shows every step in full, and runs them one after another once you start it.
---
Write down what should be checked — in a row of the **Work orders** database, or on any page with **Have it checked**. One press lets One read the request and the pages it links and plan a **chain** of pipeline tasks: [Business analysis](help:pipelines), then [Coding](help:coding-pipeline), then QA. You see every step in full on one plate; **↵ Start chain** creates them all, and they run one after another by themselves. By default the chain stops once after the analysis, so you see what Coding will do before it starts.

All of this needs **Coding switched on on this device** and a connected [coding worker](help:coding-pipeline). One of your own [MCP servers](help:mcp-servers) can add context — optional: without one, One plans from the request and its pages alone.

## Writing a request
- **On any page**: ⋯ → **Have it checked** (also in the sidebar row's menu and in ⌘K). The first use creates the **Work orders** database — the toast *Work orders created · WO-1* has **Undo**. One makes a row titled like the page, its body *Page: @the page*, and starts planning; the page itself is not changed. **Have it checked …** first asks for one line (*What should it look out for?*) that goes above the mention.
- A page an open request already links opens that request instead — *Already in WO-3 (Plan)*, with **New request** in the toast.
- **In the database**: a new row stays **Draft** while you write, for example *find out why the login stops after 30 s, see @Support case 4711, repo website*. Nothing plans by itself.
- **#/coding** has a key **Work orders · 2 open** beside the pipelines (<kbd>N</kbd> there makes a new request); **Settings → Coding worker → Work orders** creates or opens the database.

The database has a **Board** by Status — **Draft · Plan · Chain ready · Running · Halted · Done** — and a **Table**. Fields: Name, Status, Repo, Pipelines, Priority, ID (*WO-12*), Created. A row's own **Repo** and **Pipelines** come before the settings. Waiting for you is a chip on the card (*02 Coding · Review ●*), never a lane of its own.

## Planning
Planning starts only from your own press in this tab: Status → **Plan** (or a drag into that lane), the database command **Plan**, **↵ Plan** on the request's plate, or **Have it checked**. An agent, an automation, a script, the sync, a template, an import or an Undo never plans.

Before anything is read or sent, the plate checks: Coding on, the worker connected and up to date, a pipeline that can take a chain, AI set up for this kind of work, and a request that is not empty. What is missing is named with its key — and nothing is sent. Is the worker away? One keeps your press and plans as soon as it is back, for up to 24 hours (*Plans when the worker is back (until 14:30)*).

While it plans, the plate **§ WORK ORDER · WO-12 · PLANNER** shows what is read — *Request read · 1,240 characters · 1 linked page*, every call to your server with its tool, arguments and size — and what the planning costs. <kbd>Mod+.</kbd> stops it; nothing is created.

## The chain on the plate
When the plan is there, the request stands in **Chain ready** (also a card in [Preflight](help:preflight)):

- **Understood:** — the planner's summary. With a server: **Context · planner's summary**, marked **OUTSIDE**, above every call that was made; it *goes along in step 01*.
- **One station per step**, never cut: kind, title, project, repo, model, **stops at:** (where it waits for you under this device's Approvals), why, the goal, the criteria, the pages that go along (each with its tag — **PRIVATE**, **MAIL**, **OUTSIDE** — and its text in a fold), the branch (*new*, or *from step 02 (shared)* for QA) and the *next step*.
- **Open:** — the planner's questions, each with an answer field. Your answers go into the request under *Answers*, and it plans again.
- Above the start key: what Claude Code cost so far per kind of task (*avg $1.20 per coding task (last 10) · the Regler does not limit this*) and the field **Budget per chain** — *halts before the next step, never mid-step*.

Keys, with focus in the plate: <kbd>E</kbd> edit a step · <kbd>Delete</kbd> remove one (<kbd>Z</kbd> brings it back) · <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> move it · <kbd>R</kbd> plan again · <kbd>O</kbd> plan again without the server · <kbd>D</kbd> discard (back to Draft; <kbd>Z</kbd> undoes it) · <kbd>Esc</kbd> only leaves the plate.

**↵ Start chain** works once every station, every page fold and the server's context were on screen in full — the line under it says what you have not seen yet. It is a **BY HAND** key: a fresh press of its own, never part of a bulk apply. With server content it reads **Start chain · with server content**.

## Starting and running
↵ creates every step as a parked task in its pipeline — in #/coding at once. Step 01 starts after **10 seconds**: until then <kbd>Z</kbd> takes the whole chain back, ↵ starts it now. A failure while creating leaves nothing behind.

Then the chain runs by itself:
- When a step is done, the **next step** gets its result copied in at the top as its **basis** — *From step 01 (analysis): …* — and starts. QA works on the coding step's branch.
- Your Approvals stop it as always. A gate whose approval starts the next step says so (*Approving starts the next step: 03 · QA ‹…›*) and is BY HAND too.
- **Stop after the analysis** (on by default): after a business analysis, One shows you the coding step as it will run — **↵ Go on**, **E Adjust**, **R Plan again from here** (the planner reads the analysis) or **H Halt**. When the analysis has its own approval and you open the next step in that card, that one approval is this stop — no second press.
- The plate becomes the run bar: each step with its state in words — *running · waits for you · failed · done · parked*. #/coding shows *WO-12 · 2/3* on each chain card, the task panel *Part of work order WO-12 · step 2 of 3*.
- At the end the plate shows each step's result — merge request, test cases, Claude Code cost. <kbd>W</kbd> writes this summary into your request as one box.

## Stopping
- <kbd>H</kbd> **Halt after this step** works on every device: the running step finishes, nothing more starts. A drag into **Halted** is the same.
- <kbd>Mod+.</kbd> **Stop now** ends the running step at once — on the device with the worker.
- **↵ Resume** goes on. It is the only way out of a halt: no other change of the Status lifts it.
- <kbd>S</kbd> **Skip step** for a failed, stopped, trashed or ejected step — the next step then gets no basis.
- **Halt all chains** sits at the head of the Work orders board and on #/coding.

## What stays safe
- **Only you start.** Planning, the start and every key that hands work to the worker — Start chain, Go on, Resume, Skip, an approval that starts the next step — are your own presses: **BY HAND** in Preflight, never in ⇧A or a swipe.
- **You see everything Claude Code gets** before ↵: every step whole, the pages that go along, the server's content. Your request goes into every step word for word. Links the planner makes up become plain text; key-shaped text is removed, and the plate names the step.
- **Your MCP server is only read.** Pick it in the work order settings (⚙ on the plate): **Context · MCP server (optional)** lists your servers by the names you gave them, none picked. Only that server takes part, only with its read tools; the tools left out are listed with the reason. Without a pick no server is attached — not even one set to *All AI calls*.
- **The chain follows only what you confirmed.** This device keeps which tasks belong to it. A copied row, a renumbered step or a Status set by hand never starts anything.
- **Who set "done" counts.** The worker, you, or the AI terminal: the chain goes on. An agent, an automation, the sync or another device: One asks first — *Step 01 was set to done by an agent — go on?*
- **Agents cannot slip in.** A step an agent changed waits until you confirmed that version on this device. Agents and the MCP bridge never write a request's Status, nor a task's Stage, Repo or Branch.
- **Folder / GitHub sync**: a task file picked up from the [sync](help:sync) cannot move a task — Stage, Repo, Branch and Then stay as One has them, and the file is written again —, and a task whose text came from the file waits for **Confirm on this device**.
- **One branch, two steps**: while QA works on the coding step's branch, **Discard worktree** and **Clean up** stay off — the branch belongs to both.

## Costs
Planning is one AI request, metered and braked by the [Regler](help:governor) like any other (usually a few cents); at the Regler's line the plate asks first. What Claude Code spends on the worker is **not** limited by the Regler — the plate says so. The **Budget per chain** counts this device's worker reports and halts the chain before the next step once it is reached, never in the middle of one.

## Start without confirming
In the work order settings, **Start without confirming** lets a finished plan start without ↵ — on **this device**, in **local workspaces** only, and only with a **Budget per chain**. Switching it on asks the [Patchbay](help:patchbay): a path that would trip a fuse is named, with **Show in the Patchbay** and **Allow this path**; it is asked again at every start. Any doubt falls back to **Chain ready** and says why — an open question, a missing or other repo, a named branch, content from mails or written from outside, a request changed since your press, a removed key: *Not started automatically: 1 open point · repo missing at 02*. A change to the settings, the pipelines or your Approvals switches it off (*Settings changed since you switched it on — switch it on again*). A backup or a restore never switches it on.

In the Patchbay every Work orders database is a **Planner** module; its next steps — and the pipelines' own hand-ons (Then, stories) — are drawn as chain cables.

## In a team
The Work orders database is private. Planning, starting and going on happen on the device with the worker link. Another device can ask for a plan — the worker device then shows a BY HAND card *Requested on another device · ↵ Plan here* — and halt a chain, but never start or resume one. Start without confirming does not exist in a team. A device that holds no record of a chain (its worker moved there) gets one Preflight card **Confirm chain**, with every step under its own Approvals.

## Not the pre-check
**Have it checked** hands your request to Claude Code in the pipelines. Jev's [pre-check](help:ai-jev) is something else: a decision model that marks your agents' proposals before you decide. Work orders' plans are not pre-checked by Jev.

## What stays on this device
The plan, the chain's record (which tasks belong to it, who set each one done), what it spent and the switch for starting without confirming live in this browser — never synced, exported or backed up — and go with the device copy and the local reset. Full backups carry the database's settings, never a plan or a chain. The [flight recorder](help:flight-recorder) can eject a chain's steps: an ejected step halts its chain, and <kbd>S</kbd> decides.
