---
id: agent
title: The AI terminal
section: ai
order: 3
keywords: mock, mocks, png, html, designsystem, design system, prototyp, atlas, ba, po, anforderungen, requirements, s9, agent, ai terminal, terminal, claude, automate, bulk, tasks, task blocks, list_work_items, update_work_item, owner, due, rows, pages, databases, board, workspace agent, apply, review, keyboard, commands, references, context, what claude reads, redo, edit, replace, rewrite, diff, sub-page per item, page per ticket, table of links, limit, continue, pipelines, coding task, approve, connect, sign in, mcp, KI-Terminal, Agent, Aufgaben, automatisieren, Kontext, ändern, ersetzen, Unterseite pro Ticket, weiter, verbinden, anmelden
related: custom-agents, governor, ai-menu, mcp-servers, mcp-bridge, coding-pipeline, pipelines
summary: Give Claude tasks by keyboard — it reads your workspace, proposes changes, and you apply them. Keeps working while hidden.
---
Press <kbd>Mod+J</kbd> (or ⌘K → *AI terminal*, or **AI** in the status bar). The terminal docks under the page — the sidebar stays — and on a phone it fills the screen.

1. Type a task, e.g. *“Turn this week's meeting notes into action items in Projects”* or *“Make a board of the open items on this page”*, and press <kbd>Enter</kbd> (<kbd>Shift+Enter</kbd> for a new line).
2. Claude searches and reads your pages and databases; the answer streams in, and every tool call is one line in the log (`→ search_pages "Delta"`, `✓ create_row … staged #2`).
3. Changes are **proposed**, not written: new pages, rows, databases and properties, changed values and titles land in a review list. Apply them one by one, **Apply all** (<kbd>Mod+Enter</kbd> or `/apply`) or discard them. One **Undo** reverts an applied batch.

## BA and PO · review requirements

Open the page containing the actual facts, then run **`/ba S9`** or **`/po S9`** in the terminal. `/ba` without a focus analyses the open page. An identifier such as S9 must match one real heading; ONE bounds the source catalogue to that section. Free text such as `/ba timestamp precision` supplies a topic for the entire page.

Your selected provider stays active, including **Atlas Flow · Frankfurt**. Two separate model requests produce:

1. **BA:** up to three concrete requirement drafts, original passages, discriminating proposed checks and missing specifications.
2. **PO:** review of every requirement and its checks against the same passages, with open questions and possible contradictions.

Conformance checks hold the same requirement condition: one hypothetical observation conforms, another violates it. “If A then B” does not imply “if not A then not B”. Error reactions absent from the source remain unspecified.

Progress notes show **1/2 · BA** and **2/2 · PO**. ONE checks structure, actual references, unsupported numeric values and the page version. Each round permits one correction of a technically invalid response. Excluded context or a changed source stops the run.

The report is **a draft in the terminal**. It changes no pages, creates no Atlas records and approves no decisions. Its source is the read ONE snapshot with timestamp and fingerprint; **Atlas is not refreshed in this workflow**. A second request to the same model is not independent acceptance. Proposed checks are not executed tests. Repeat with `/ba` or `/po`; model wording can vary between runs.

## A page for every item
Ask for *“a sub-page for every ticket, linked in a table on this page”* — the tickets may come from the page, a database or an [MCP server](help:mcp-servers) like your tracker. Claude stages all the pages in one step (up to 50 per call, each its own proposal in the review), then a table on the main page — the open page when you say *this page* or *main page* — with a link to every page and the items' key fields (status, owner, date …) as columns. After **Apply all** the links are page mentions: a click opens the sub-page. When the items share fields and you ask for a table or tracker instead, Claude makes a [database](help:databases) with a row per item.

## Changing existing text
Claude adds to a page with *append*. When a task asks to **fix, rewrite, update or remove** what is there, it changes exactly those blocks instead: it reads the page with a short label per block (`b3`) and names the blocks it changes — replace, delete, insert after, or rewrite the whole page when you ask for that. Every edit is one proposal, shown as a **diff** of the page: removed words struck through on red, new words on orange, unchanged blocks folded (*12 unchanged blocks — show*).

- Apply or discard each edit on its own. The edits of one page you apply together go in as one step: a version is kept first (**AI** in the [version history](help:history)), and <kbd>Mod+Z</kbd> in the open page takes the whole edit back.
- A block you changed after Claude proposed the edit is **skipped**, never overwritten — the review says so.
- Blocks you left out of what Claude reads (see below) can't be changed either, and a full rewrite of such a page is refused.
- [Custom agents](help:custom-agents) can propose edits too; even an agent that writes directly waits for your OK before it replaces text.

## Task blocks
Claude writes [tasks](help:tasks) into pages as `> [!TODO] Title` with a line of fields (*Owner: Alex · Due: 2026-10-17 · Blocked by: …*) — One turns them into task blocks with ids of its own; the tool answer tells Claude the id each new task got. It finds tasks across the workspace (**list_work_items**: open, mine, blocked, overdue, by person, page or title) and changes a task's status, due date, reminder, owners or links (**update_work_item**). It is not the coding pipeline: those tasks have their own tools (below).

- The review shows each task as a row: **TASK · NEW** with its chips (status, due, owners, blocked by), **KEPT**, **CHANGED** with every field before → after, **REMOVED** when a rewrite leaves one out. A line **Waits for your review · Names a person** (or *Sets a reminder*, *Changes an assigned task*, *Adds a blocker*, *Removes tasks*) says what to look at.
- Owners are only people of your workspace: an unknown name is refused with the list of names, and Claude asks again — One never creates a person, and never tells Claude an email.
- Links reach only tasks Claude may read (what **What Claude reads** allows; a task elsewhere is named by its id only). A task that waits for a task another proposal makes needs that proposal first — applying it alone says so.
- Editing a task's field line in text changes nothing; the review says so. Text that keeps a task's quote with its `{#wi_…}` keeps the task — leaving it out removes it (shown as **REMOVED**).

## Coding pipelines from the terminal
When you use the [coding pipelines](help:coding-pipeline), Claude can read them — what waits for you, a task's stage, its plan, test result and log — and **propose** what you ask for: a new task (Coding, Business analysis or QA), or an action on one: approve, send back with a note, answer its question, run it once, stop it, set *Then* or hand it on.

- Every such change is a proposal in the review, like the rest. A new task shows **all** of it: project, repo, branch, where it starts and stops, its whole page exactly as Claude Code will read it (scroll the box) and the pages that go along. An approval shows the plan it approves and what runs on its own after it.
- Proposals that **start the worker** on your computer carry **STARTS WORKER** and are never part of *Apply all* (<kbd>a</kbd>, `/apply`, <kbd>Mod+Enter</kbd>): apply each with its **Apply** key or <kbd>Enter</kbd> on it. The same goes for text Claude adds to a task's page (**GOES TO CLAUDE CODE**, shown in full): Claude Code reads it at the task's next stage, along with the pages it links — the card lists them, and a page Claude proposes alongside is shown in full too. *Then* starts nothing at once — a task of the pipeline it names starts when this one is done; a done task is handed on with *hand on*.
- A task written or changed elsewhere (another device, or an agent) shows **CONFIRM FIRST**: applying is refused until you press **Confirm on this device** on the task page — the terminal never confirms a task for you.
- A task that moved, changed or got a new question after Claude proposed the action is refused (*changed since — ask again*). Undo leaves an applied task action in place: the worker may have started.
- `/pipelines` (or `/pipelines qa`) lists the open tasks — what waits for you first — with **Open** and, for a running one, **Stop**.
- Claude can't move a task to any stage, change Repo or Branch of a task, confirm it, change approvals, run git commands or edit the pipeline.

## Connect an MCP server
Basic ONE readers are already loaded for tool-capable local models. ONE can load missing permitted read descriptions through bounded corrections; you do not need to install tools. Your personal Atlas connection and its permissions remain required.

After an Atlas write, ONE distinguishes **read failed** from **read succeeded, stored content differs**. Atlas may translate text when saving. A difference still needs content review; it is neither a token error nor verified equivalence. Check existing records before repeating a sync.

`/connect` lists your [MCP servers](help:mcp-servers) and how they stand. `/connect wiki` (a name, a codeword like `kb:` or an address) signs in — the sign-in window opens right from your <kbd>Enter</kbd> — or only tests the server when its token works. `/connect https://…` adds a new server first. When a task fails because a server rejected its token, **Sign in to <server>** sits under it (or press <kbd>Enter</kbd> on the empty prompt); once connected, **Run the task again** (<kbd>Enter</kbd>) runs it with the new sign-in.

## It keeps working
Hide the terminal with <kbd>Esc</kbd> or <kbd>Mod+J</kbd> and go on working — the task runs on. The status bar shows **AI · working** and then **AI · 3 changes to review**; a toast tells you when it is done, and a click brings the terminal back. Only **Stop** ends a task: <kbd>Mod+.</kbd>, <kbd>Ctrl+C</kbd> (with nothing selected), `/stop` or the Stop key. Proposals so far stay.

**At the red line.** With a [budget](help:governor) set, a task whose next step would cross it waits **between two steps** with a halt card — nothing is sent or reserved while it waits. **E** allows $1 more for this task today, **H** finishes with a cheaper model of the same provider when it can carry the conversation, <kbd>Mod+.</kbd> stops (staged changes stay). `/cost` adds a line with the day's rest.

## Context
- The **open page** goes along as a chip — remove it with × if the task is not about it.
- **References:** select text in a page and press **Add to terminal** in the toolbar or <kbd>Mod+Shift+J</kbd> (also in read-only pages and database rows). The passage becomes a chip; up to 10 go along with the next task as Markdown with their page, then move into that task's log line. <kbd>Backspace</kbd> at the start of the prompt removes the last chip.
- **Mentions:** type `@` and part of a title, then <kbd>Tab</kbd>: the page or database becomes context. `one:` lists the pages and entries on the level of the open page first (then a title search); `<codeword>:` at the start (e.g. `kb:`) lists that [MCP server's](help:mcp-servers) tools — pick one and Claude uses it.

## What Claude reads
The open page's chip says how much of it Claude may read: just the title for the whole page, *· 3 blocks* when you marked blocks, *· nothing* when you left it out. Click the chip for **Whole page**, **Only marked blocks**, **Mark blocks…** (or `/context`) and **Nothing from this page** — the same marks as in the [AI menu](help:ai-menu). Then `read_page` (and search) return only the marked blocks of that page, or withhold it, and Claude is told so; writing to it works as before, with your review. Other pages are not affected; references still send exactly the text you selected. `/redo` marks passages of the open page to redo with instructions.

## Keys and commands
- <kbd>↑</kbd> / <kbd>↓</kbd> on the first / last line: earlier prompts (the last 50 on this device and workspace, never synced).
- <kbd>Tab</kbd> completes `/commands`, `@` mentions, `one:` and a codeword's tools; on an empty prompt it moves into the review list.
- <kbd>Enter</kbd> on the empty prompt: **Continue** a task stopped at the limit, **sign in** to a server that rejected its token, or **run the task again** after that sign-in.
- In the review list: <kbd>j</kbd> / <kbd>k</kbd> (or arrows) move, <kbd>Space</kbd> marks, <kbd>Enter</kbd> applies the marked (or the current) entry, <kbd>a</kbd> applies all (not those that go to the coding worker), <kbd>d</kbd> discards, <kbd>o</kbd> opens the page, <kbd>u</kbd> undoes the last apply, <kbd>Esc</kbd> goes back to the prompt.
- <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> or dragging the top edge change the height; the maximise key fills the content area.
- `/new` (or `/clear`) starts over · `/stop` · `/continue` (a task that stopped at the limit goes on) · `/apply` · `/discard` · `/history` · `/clear-history` (forgets this device's prompts of the workspace — after a *y / n*) · `/mcp` (servers in use) · `/pipelines` (open pipeline tasks) · `/connect` (sign in to or test an MCP server, add one) · `/cost` (tokens and cost per model) · `/context` (what Claude reads on the open page) · `/redo` (redo passages with instructions) · `/remember <sentence>`, `/no-memory`, `/example <tag>` ([One memory](help:memory)) · `/help`. German names work too: `/neu` (`/leeren`), `/stopp`, `/weiter`, `/übernehmen`, `/verwerfen`, `/verlauf`, `/verlauf-leeren`, `/verbinden`, `/kosten`, `/kontext`, `/neu-machen`, `/merken`, `/ohne-gedächtnis`, `/beispiel`, `/hilfe`.

## Good to know
- Claude can create databases (a table or a board grouped by a column) and add properties, then fill them with rows in the same task. Locked databases refuse new properties.
- A task has a budget of **120 tool calls**. This counts individual calls, not the number of available tools. MCP discovery and execution dispatched by ONE count too. Context, cost and loop guards still apply and may stop a task earlier. At the call limit the AI wraps up and the task shows **Limit reached** with a **Continue** key — or press <kbd>Enter</kbd> on the empty prompt, or type `/continue`: the same task goes on with a fresh budget, in the same conversation; what is staged stays and is not staged twice. MCP servers you added are available to it.
- The meter shows tokens (in, cache write / read, out) and what the conversation cost by One's price table ([what AI requests cost](help:ai-costs); `≈` only when an answer was cut short and estimated) — Anthropic bills your key. Nothing changes until you apply; in a team workspace, viewers see proposals but cannot apply them.
- The [One memory](help:memory) goes along with every task (**MEMORY · 3** in the head), and after a task Claude may propose what to remember — saved only with your OK. `#tag` takes a saved example along in full.

## Compiled task and decision cube

Open **Compiled task** below your request. The task compiler binds the goal, role instructions, input fingerprint, source pointers, actor and workspace. Its JSON packet is sent as the model's system context. Seven dimensions display the actual bounded checks. **Actual compiled model packet** and **Full host check receipt** expose the details; Frankfurt live tests also record these host checks in your personal live log.

Choose a dimension under **Decision cube and compiled dimensions**: the active plane and its reference cubes with connections to the core change according to recorded compiler checks. Numbers match the list below the image; evidence shows its actual ID. Dashed cubes represent open checks without recorded evidence. Evidence shared by several dimensions keeps its number and ID. Selecting a dimension starts no new model or MCP request.

For missing prerequisites the model first inspects available ONE and Atlas sources. Tool discovery is not a source read. If a prerequisite remains open or a source is unavailable, the decision cube asks a precise question and names the dependent step. Choose an option or enter your specification. Only your UI answer resolves the question and binds a new revision; permissions do not expand. Independent reads remain permitted and dependent effects stay blocked. Background agents stop for human decisions: specify their missing input and run them again.

An analysis can list unresolved questions in its answer without interrupting you. The decision cube is for an answer that the requested next action cannot proceed without. If the model asks before inspecting the available sources, it receives a bounded correction result. This opens no decision, supplies no answer for you and grants no additional permissions.

**Ready for review** confirms technical task bounds, observed tool data and output format. It does not prove every statement or domain completeness. **I reviewed the result** records your review without applying proposals. Existing data and tool permissions still apply. Unknown effects or stale actor, workspace and provider bindings block execution.

## Repeat saved compiled programs

Open **Programs** in the AI terminal header. After a successful regular task, expand **Compiled task** and choose **Save as executable program** to review a draft of the actual successful tool calls in order. Text-only tasks without tool calls cannot be captured as executable programs.

1. Review the name and definition, then **Compile and save**. The library is personal to your account in this workspace. Cloud versions are encrypted and unavailable to other members; local workspaces store them on this device.
2. Select an immutable version. Inputs use JSON syntax, such as `"page-id"`, `42` or `{"ref":42}`. Read arguments may have reviewed defaults. Effect arguments and calls following an effect require fresh inputs or explicit bindings to fresh results. Old generated content is not automatically reused as fresh input.
3. **Run this version** uses the current terminal model and your current personal connections. Review inputs and effects before an effectful run. ONE changes remain staged; permitted external writes and execution run immediately.
4. Each run reads fresh sources and asks prerequisite decisions again in the decision cube. Changed schemas, missing bindings or revoked access stop the program. There is no tool substitution or automatic restart of a write step.
5. **Run receipts** retains the latest 100 runs with artifact hash, version, unique run ID, model, per-step input/output hashes and answer or error. After a partial external effect, inspect the actual state before repeating the run.

**Edit as new version** never changes an earlier version. The hash identifies a canonical compiled JSON definition: fixed tools, order, data bindings and generation instructions. Execution interprets this checked intermediate representation; it never evaluates JavaScript. Generation steps have no tools and may produce different wording on each run. A repeatable program does not guarantee identical text or domain correctness; human acceptance remains necessary.

In the advanced definition, `{"input":"name"}` binds an input, `{"result":"step_id","path":["id"]}` binds a field from an earlier result, and `{"literal":…}` binds a constant JSON value. `object` and `array` combine bindings. A `generate` step can require a fixed JSON schema and consume fresh source results; later tool steps can bind individual generated fields. The model cannot choose additional tools. Missing result paths or unsupported schema checks stop before the affected operation.

The fixed generation step omits the exact generic ONE manuals for interactive tool planning. Custom role rules, personal MCP instructions, data permissions and access checks remain. The compiled goal is the actual trusted user instruction; retrieved source text stays separate input data and is not sent again as the task goal.

A remote MCP tool step can use `"decode":"mcp-json"` in the advanced JSON definition. This requires exactly one successful text result containing JSON. Fresh data is then under `source`, with host receipts separate under `oneObservedFacts`. A binding such as `{"result":"atlas","path":["source","item","body"]}` passes only the actual body field; missing paths or unsuitable responses stop the step. Large metadata need not be sent to the model.


## Rewrite an existing page from a URL

Open the target page and ask, for example: **“Rewrite this page using this EARS description: https://alistairmavin.com/ears/”**. In a signed-in team workspace, ONE reads the target and the explicitly supplied public HTTPS source before drafting. It does not automatically follow links in that source.

The guided path pins the existing page, checks exact source quotations and preserves existing ticket references. EARS drafts need concrete requirement sentences linked to original page quotations and acceptance checks; a table of feature labels is insufficient. An invalid draft gets one correction attempt. If minimum checks still fail, no substitute document is staged.

These checks establish source retrieval, quotation matches, the page target and minimum structure. They do not establish semantic correctness or team approval. You still review the diff and apply it yourself. If a URL cannot be read, import its original text as an external source; ONE does not silently substitute model knowledge.

For grounded rewrites ONE supplies numbered original passages, copies their actual text and renders the requirement/acceptance/original-passage table itself. Valid reference IDs prove origin, not semantic support. Existing ticket links and branch references are retained.

## Checking code output

A code block is not build evidence. ONE statically detects a narrow set of C++ defects, including missing direct integer-limit headers and unsafe character classification. Local and Copilot routes allow at most one tool-free correction, then stop on repeated defects. This is not a compiler, test runner or security review; use the repository task worker verification stage.
# BA/PO mocks from the current Atlas design system

In the AI terminal, try:

```text
/mock Create a conflict-screen proposal for Atlas record 32155 using its requirements and the currently applicable FluX design system. Show unresolved design questions.
```

The selected model reads requirements, the design catalogue and its current applicability/version rule through your personal Atlas connection. `read_design_source` supplies bounded original component/token/version passages from a large catalogue. Search excerpts and remembered facts are insufficient. Missing versions or components require source investigation and, when necessary, a focused prerequisite question.

The mock card presents **static HTML/CSS** with component and requirement mappings. PNG is rendered from that exact HTML. You can download HTML, PNG and a JSON source receipt. **Attach to Atlas record** stores all three files on the displayed requirement record using `atlas_attach`. ONE is the transient creation/preview/controller surface, not a document repository; this action changes no ONE page. Direct attachment currently requires the prepared personal AJ-Atlas connection in a cloud workspace; older local workers have a smaller attachment bound.

Before uploading, ONE rereads every source and compares its content hash. Changed or inaccessible sources stop the upload. Atlas must then confirm each file's size and SHA-256. Partial uploads are listed individually; retrying the same proposal uses the same filenames. The files remain **proposals**, never approved specifications.

Automatic checks cover citation origin, component references, some token mechanics and static HTML without scripts or external resources. They do not prove semantic completeness or pixel-perfect design compliance. External font files and images are not loaded in this first static version; missing assets and interactions must remain explicit. BA and PO review states, exceptions, priorities and acceptance criteria. The model makes no business decisions.

For known source records, ONE can control the reads directly:

`/mock One dialog for Atlas-Record 32155. Read ref 1174 as the design rule and ref 1179 as the current catalogue. Preview only; save nothing.`

ONE reads those three explicitly supplied records through your personal Atlas connection and supplies exact excerpts plus a complete output schema. There is at most one correction. Missing sources or failed checks never produce a substitute mock. Quote origin, static markup and token mechanics are minimum checks; semantic completeness and visual conformity still need human review.

With `/pm 9602 <task>`, ONE reads your personal Atlas identity and exactly the requested record itself. Supply at most three comma-separated refs. Without model-controlled tools, the model drafts a small PM brief with verbatim quotations, at most three open questions and one proposed next step. No decisions or writes occur. Only those bodies are refreshed; comments and attachments remain explicitly unchecked.


## Cube profiles and compilation

Open **Cube profiles** in the terminal header. The clickable diagram explains task and profile binding, Rust/WebAssembly compilation, tool dispatch checks, real evidence, output checks and human acceptance. It is an explanation; actual run receipts are in the **Compiled task** card.

Choose a dimension on the glass cube. Its clickable legend names edges and counterpart checks in other dimensions. A cross-check is a complementary requirement, not proof that domain contradictions are impossible.

Set required ONE page IDs or global Atlas refs, require actual body reads, enforce these before effects, restrict tasks to reading, or limit Atlas write targets. A target allowlist blocks new records without a fixed target ref. JSON and literal output terms are formal checks. Domain guidance is sent to the model and stays open until human acceptance.

**Save version and activate** applies from the next terminal run across supported providers. **Save version only** keeps the current selection. **Disable additional profile** restores base checks. Each task keeps its bound version and hash. The library is private on this device, scoped to workspace and account. Keep credentials out of profiles.

A profile grants no permissions and cannot loosen provider policies. It does not guarantee domain truth. ONE proposals need separate application; permitted external writes may take effect during the tool call.

## Errors beside the input

The latest task failure stays above the input even below a long proposal list. Edit the stopped task, jump to its log or open the relevant connection settings there. No action retries automatically. Review already completed external actions before a new start. If a true page rewrite has no context, explicitly select the open page as context again.


## My compiled tasks

**My compiled tasks** in the sidebar opens your internal ONE database. Find it through search (⌘K → My compiled tasks), the terminal **Programs** button or `/programs`. Only your entries in the current workspace are shown; other members and workspace administrators cannot access your library through these endpoints. Team entries and receipts are encrypted on the server; local entries remain in this browser.

Completed source-backed terminal tasks are saved automatically. Failed or paused tasks and sign-ins do not automatically become executable programs. Search names or hashes and select **Show all versions** for immutable earlier versions. Choose an entry, review inputs and select **Run this version**. **Run receipts** contains results, failures and version bindings. A completed analysis remains a proposal for domain review.

BA, PO, PM and mock tasks save a recipe with its goal and source bindings. Every run rereads its bound ONE page or explicit Atlas records and current design system, with no previous conversation, decisions or approvals. A missing source page or changed personal MCP endpoint stops the run; the currently open page is never substituted. Mocks are generated anew and only attached to an Atlas record through a separate explicit action. ONE does not become a document repository.

Fixed tool programs retain their order and schemas. Analysis recipes run the current domain checks. Both use the currently selected model and your personal access; generated wording and changed sources may produce different results.
