# SimpleCMS One: market and feature research

| | |
|---|---|
| **As of** | 2026-10-02 |
| **Scope** | Notion (3.0 to 3.7), knowledge-tool competitors, CMS platforms, serverless sharing techniques |
| **Product** | SimpleCMS One: a client-side, local-first (IndexedDB) rebuild of Notion, published as a static app on GitHub Pages. React + TipTap, EN/DE UI, no backend. |
| **Method** | Official pricing pages, release notes and help centres first. Third-party reviews only for pain points and for prices a vendor does not publish. Third-party figures are marked *(3rd party)*. |

---

## 1. Summary

Notion is still the reference for block editing and databases. Since Notion 3.0 (September 2025), most of its product work has gone into AI agents, and those agents sit behind the Business plan ($20 to $24 per seat per month) plus usage credits. The gaps users complain about most are structural:

1. **No real offline.** Offline mode exists only in the desktop and mobile apps, never in the browser, and caches just 50 rows of a database.
2. **AI paywall.** Free and Plus get a "limited trial". There is no bring-your-own-key option.
3. **Lock-in.** Markdown and CSV exports drop database views and flatten relations and formulas.
4. **Missing knowledge-tool basics.** No graph view, no daily notes, no side-by-side pages. History is capped at 7, 30 or 90 days by plan and has no diff.
5. **Per-seat pricing that keeps rising.** Plus went up in 2024, Business in 2025 and Enterprise list prices in Q1 2026.

Each of these is a problem that **a local-first app solves by design rather than by price tier**. SimpleCMS One should match Notion's interaction model, so users feel at home on day one. It should then win on the things a server-less architecture gets for free: everything offline, data on the user's device, no account, AI with the user's own key, unlimited local history with a diff, and share links that store nothing on a server.

One rule applies throughout: **say only what is true**. Notion *does* have offline mode, version history, presentation mode and webhooks. The honest claim is about limits (browser, days, plan, payload), not about absence. Section 8 lists the claims the landing page may and may not make.

---

## 2. What each product group does

### 2.1 Notion today (3.0 to 3.7, September 2025 to September 2026)

**Editor.** About 40 block types, including H1 to H4 and toggle headings, callouts, synced blocks, columns, simple tables with merged cells (May 2026), TOC, breadcrumbs, buttons, code with Mermaid, TeX equations, media, 500+ embeds, inline databases, forms, charts, `/dash`, `/map`, `/tabs` (March 2026), AI Meeting Notes, agent-built interactive HTML blocks (3.6) and embeddable Custom Agents (3.7). Slash menu, Markdown autoformat, `@` mentions, `[[` links.

**Databases.** About 25 property types: Title, Text, Number with bar or ring display, Select, Multi-select, Status, Date, Person, Files, Checkbox, URL, Email, Phone, Formula 2.0, Relation, Rollup, created and edited metadata, Button, ID, and Place (3.1). Ten view types: Table, Board, List, Calendar, Gallery, Timeline, Chart, Form, Feed and Map, plus Dashboard on Business (2026-03-10). Nested AND/OR filters, conditional colour, row-level permissions on Business.

**Automations.** Paid plans only; Free gets Buttons plus Slack notifications. Triggers are page added, property edited, and recurring. Actions are edit property, add page, notify, send Gmail, send webhook (POST, properties only), and Slack. Automations cannot trigger other automations, and there is no run log. Custom Agents (3.3) run on schedules, but **have cost credits since 2026-05-04** ($10 per 1,000).

**Pages.** Icons, covers, three fonts, page history (7, 30, 90 days or unlimited, by plan), backlinks, comments and suggested edits, Archive (March 2026), and **Present mode (beta, Plus and up, 2026-03-02)**, where dividers become slides.

**Publishing.** Notion Sites: unlimited pages, 1 `notion.site` domain on Free and 5 on Plus and up. A custom domain costs $8 per month (annual) or $10 (monthly) per domain. There is no password protection, no draft or staging (edits go live immediately), and no static export you can own.

**AI.** Notion Agent with 20-minute multi-step tasks, Skills, plan mode, a model picker, Enterprise Search, AI Meeting Notes, Research mode, AI Autofill, an MCP server, and Workers (3.5). **Full AI is Business and Enterprise only**, and there is no BYOK or local model.

**Offline (2.53, August 2025).** Desktop and mobile only. Pages are downloaded one by one (paid plans auto-download Recents and Favorites), databases cache the first 50 rows of the first view, and embeds, AI, forms and buttons are unavailable offline.

**Import and export.** Import from many sources. Export to PDF, HTML, Markdown and CSV, which is lossy for databases. Whole-workspace PDF export is Enterprise-only.

### 2.2 Knowledge-tool competitors

| Product | What it does better than Notion | Lesson for One |
|---|---|---|
| **Obsidian** | Plain Markdown on disk, fully offline, command palette for every action, split and stacked panes, graph view with backlinks and unlinked mentions, Canvas, File Recovery snapshots. Core app is free. | Keyboard-first ⌘K, stacked panes, graph with filters, local snapshots. |
| **Anytype** | Local-first, end-to-end encrypted, P2P sync, typed objects, self-hostable. | "Your data, your device" is a selling point people understand. |
| **AFFiNE** | Open source, Yjs CRDT, Edgeless canvas where frames become slides. | Keep the data model CRDT-ready; presentation from structure. |
| **Logseq** | Journal-first outliner, block references, graph that handles 10k+ blocks. | Journal as the default place to capture things. |
| **Capacities / Tana** | Typed objects and supertags, daily notes, live searches as views. | Later: object types on top of databases. |
| **Heptabase** | Whiteboards of cards, PDF highlights become cards. | Out of scope for v1. |
| **Craft** | Free on-device AI (Apple Foundation Models), Daily Notes, publish with a custom domain on Plus. | AI without a paywall is something users expect now. |
| **Coda (Superhuman Docs since 2026-07-08)** | Formulas anywhere on the canvas; only Doc Makers pay. | Pricing model matters as much as features. |
| **Microsoft Loop** | Live components that stay in sync across Teams, Outlook and Word. | Synced blocks should travel (later). |

### 2.3 CMS platforms (WordPress, Ghost, Webflow, Framer, Contentful, Sanity, Strapi, Payload, Storyblok)

Every feature was tagged for how well it fits a no-backend app.

- **HIGH fit, worth taking:**
  - typed collections where each row is a page
  - a portable JSON document model (Lexical, Portable Text), which is the basis of a lossless export
  - a command palette everywhere (WordPress 6.9 and 7.0)
  - **visual revisions with diff and restore** (WordPress 7.0)
  - **TK markers that block publishing** (Ghost 6)
  - a pre-publish checklist (Strapi, Sanity)
  - a per-page SEO panel
  - outgoing webhooks on lifecycle events (Ghost, Strapi)
  - a local rule engine (When, If, Then)
  - BYOK AI (WordPress 7.0 AI Client)
  - schema-aware bulk AI with a review screen (Contentful AI Actions)
  - offline-first PWA
  - CSV import that creates typed databases
  - trash and archive
- **MED fit:**
  - branching, scheduled publish and unpublish (only possible as an embargo check at view time), i18n siblings
  - block-anchored notes
  - forms that post to a webhook
  - visitor-facing graph on exported sites
- **LOW fit (needs a server):** real-time co-editing (WordPress pulled it from 7.0 twelve days before launch), newsletters, members and payments, ActivityPub, native analytics, A/B tests, personalisation, hosting an MCP server.
- **Serverless references:**
  - **itty.bitty.site** packs a whole page into the URL fragment, compressed and base64-encoded. Browsers never send the fragment to the server.
  - **Excalidraw** keeps the AES-GCM key only in the fragment.

  These two techniques make share links and password-protected links possible with zero backend.

---

## 3. Feature matrix

"Best competitor" names the product that does it best today. The **One** column is the target for SimpleCMS One, and **P0/P1/P2** refers to the plan in section 7.

### Editing and navigation

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Block editor, slash menu, Markdown shortcuts | Yes, about 40 block types | Notion is the reference | **P0.** TipTap with about 25 types: text, H1 to H3, lists, to-do, toggle, quote, divider, callout, columns, table, code, Mermaid, math, image, file, bookmark, embed, TOC, page link, mention, database block |
| Command palette for every action | Partial: ⌘K/⌘P search and ⌘/ block actions are separate | Obsidian (every command, hotkeys) | **P0.** One ⌘K for navigate, create, actions and AI |
| Pages side by side | No native split view (side or center peek, or a second window) | Obsidian split and stacked panes | **P1.** Stacked panes |
| Page fonts and width | Default, Serif, Mono; small text; full width | n/a | **P0.** Sans, Serif, Mono; full width |
| Tabs block | Yes (2026-03) | n/a (WordPress cut it from 7.0) | P2 |
| Synced blocks | Yes, all-or-nothing | WordPress synced patterns with overrides | P2, with overrides per instance |
| "Unfinished" markers (TK) | No | Ghost 6 TK reminders | **P2.** Orange TK markers that block share and export |

### Databases

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Property types | About 25 incl. Place, Button, Verification | Notion | **P0.** 20: title, text, number (bar or ring), select, multi-select, status, date, person, checkbox, URL, email, phone, files, relation, rollup (17 functions), formula, created and edited time, unique ID, **rating** (Notion has no rating property) |
| Views | 10 plus Dashboard (Business) | Obsidian Bases: 4 | **P0.** 7: table, board, list, gallery, calendar, timeline, chart |
| Formulas | Formulas 2.0 | Coda (formulas anywhere) | **P0.** Notion-style expression engine |
| Filters, sorts, groups, calculations | Yes, nested to 3 levels | Notion | **P0** |
| Row templates | Yes, incl. recurring | Notion | **P0** |
| Forms | Yes (conditional logic on Business) | Payload form builder | P2: form view that writes local rows, and on a shared page posts to a webhook |
| Speed with 5k+ rows | Slow (3 to 10 s reported) | Logseq (10k+ blocks) | **P1.** Everything in memory, virtualised rows |

### Knowledge

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Backlinks | Yes | Obsidian (plus unlinked mentions) | **P0.** Backlinks; unlinked mentions in P2 |
| Graph view | No | Obsidian, Logseq, Capacities, Anytype | **P1.** Force graph with local and depth filter |
| Daily notes | No (templates and recurring templates only) | Logseq, Capacities | **P1.** Journal: one shortcut opens today's page |
| Typed objects / supertags | No (one database per type) | Tana, Capacities | Not in v1 |
| Canvas or whiteboard | No | AFFiNE Edgeless, Heptabase | Not in v1 |

### History and safety

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Version history | 7, 30 or 90 days, or unlimited on Enterprise; no diff | WordPress 7.0 Visual Revisions; Obsidian File Recovery | **P1.** On-device snapshots with no day limit (thinned to the newest 100 per page), block-level diff, one-click restore |
| Trash and archive | Yes (Archive since 2026-03) | Payload, WordPress | **P0.** Trash with restore |
| Draft vs published snapshot | No (Sites go live on every edit) | Payload, Sanity, Strapi | P2 |

### Sharing and publishing

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Public page | Notion Sites, hosted by Notion | Obsidian Publish ($8 per site per month) | **P1.** Serverless share link: the page is compressed into the URL fragment (`#/s/…`), opens read-only, and no server stores it |
| Password-protected page | No | Obsidian Publish (whole site only) | P2: AES-GCM with a PBKDF2 key in the browser, per page |
| Static site you own | No | None (gap) | P2: zip with pages, sitemap, RSS, `llms.txt`, `content.json` |
| Custom domain | $8 to $10 per domain per month | Craft (Plus) | Via the static export on the user's own GitHub Pages (P2) |

### AI

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Full AI on a small plan | Business and Enterprise only; Free and Plus get a limited trial | Craft (free on-device) | **P1.** On every workspace, using the user's own key |
| Bring your own key | No | WordPress 7.0 AI Client | **P1.** Anthropic key stored locally; requests go only to `api.anthropic.com` |
| Bulk AI on database rows, with review | AI Autofill (agent-powered) | Contentful AI Actions (bulk plus review screen) | P2: changes shown as a diff to accept or reject |

### Automation

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Database automations | Paid plans; Free gets Buttons and Slack only | Storyblok FlowMotion (n8n) | **P1.** Free: row created, row deleted, property changed → webhook, set property, notify |
| Webhook action | Paid; POST; at most 5 per automation; properties only; pauses on failure | Ghost and Strapi lifecycle webhooks | **P1.** POST or PUT; payload should carry properties *and* page text as Markdown; CORS-safe mode for Zapier and Make |
| Run log | No | n/a | **P1.** Last status per rule; full log in P2 |

### Data ownership

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Offline | Desktop and mobile apps only; 50 database rows; opt-in per page | Obsidian, Anytype, AFFiNE | **P0.** Everything, in the browser, always |
| Where data lives | Notion's cloud; no E2EE; no self-hosting | Obsidian (files), Anytype (E2EE) | **P0.** IndexedDB on the device; no account |
| Import | Many sources | n/a | **P0.** Notion export zip (Markdown and CSV), Markdown, CSV, JSON backup |
| Export | Lossy (views dropped; relations and formulas flattened) | Obsidian (plain Markdown) | **P0.** Lossless JSON backup, plus Markdown and HTML |

### Presenting, collaborating and accessibility

| Feature | Notion | Best competitor | One |
|---|---|---|---|
| Presentation mode | Beta since 2026-03, Plus and up; dividers become slides | AFFiNE (frames become slides) | **P1.** Any page; dividers become slides; keyboard driven |
| Real-time multiplayer | Yes | Notion, Webflow | **No.** Single user; syncs across open tabs. Stated honestly. |
| Comments and permissions | Yes, complex | WordPress Notes | Not needed for single user; block notes in P2 |
| UI languages | Many, incl. German | n/a | **P0.** EN and DE, auto-detected |
| Mobile | Slow for structured editing | n/a | **P0.** Responsive down to 390 px |

---

## 4. Notion pricing (as of 2026-10-02)

Primary source: <https://www.notion.com/pricing>, fetched 2026-10-02. The plan objects were parsed from the page's `__NEXT_DATA__`, and the visible text was cross-checked: Plus shows $10 and Business $20 per member per month on yearly billing.

### 4.1 Seat prices (USD)

| Plan | Billed monthly | Billed annually | AI | Key limits |
|---|---|---|---|---|
| **Free** | $0 | $0 | Limited trial | 7-day page history, 10 guests, 5 MB uploads, 1 chart, basic forms, Buttons and Slack automations only, 1 `notion.site` domain, **1,000-block cap once the workspace has 2+ owners** (people on Free can only join as owners, and deleting blocks does not free them) |
| **Plus** | **$12** per seat per month | **$10** per seat per month ($120 per year) | **Limited trial only** | Unlimited blocks, 30-day history, unlimited guests and charts, database automations, 5 `notion.site` domains, Present mode |
| **Business** | **$24** per seat per month | **$20** per seat per month ($240 per year) | **Included:** Notion Agent, AI Meeting Notes, Enterprise Search (beta), Research mode, AI usage allowance | SAML SSO, private teamspaces, row-level permissions, dashboards, conditional forms, 90-day history |
| **Enterprise** | Custom ("Contact Sales") | Custom | Included, with zero data retention at the LLM providers | Unlimited history, SCIM, audit log, DLP/SIEM. The page data holds list prices of $35 per month and $336 per year ($28 per month); these are not advertised. |

**Annual discount.** Notion advertises "save up to 20% with yearly". The real saving is $2 of $12, or $4 of $24, which is **16.7%**. Put the other way, monthly billing costs 20% more than annual.

### 4.2 Add-ons and usage

| Item | Price | Notes |
|---|---|---|
| Notion credits | **$10 per 1,000 credits per month** | Business and Enterprise only. Required for Custom Agents since 2026-05-04; Workers move to credits after the beta. No rollover, and agents pause when credits run out. |
| Sites custom domain | **$10 per domain per month** monthly, or **$8 per month** annually ($96 per year) | Also removes Notion branding. Up to 25 per workspace. |
| Legacy AI add-on | $10 monthly or $8 annually per seat | Existing holders only. Not sold to new customers since 2025-05-13. |
| Students and educators | Plus (1 member) free | With a school email address |

### 4.3 Other currencies

| Plan | EUR annual | EUR monthly | GBP | Status |
|---|---|---|---|---|
| Plus | €9.50 | €11.50 | £8.50 annual or £10 monthly | **Official**: Notion release notes, 2024-06-26 |
| Business | €19.50 *(3rd party, meetergo.com, 2026-09-17)* | not verified | not verified | **Unconfirmed.** Notion shows local prices at checkout. |
| German App Store | Plus €12.99 per month or €129.99 per year; Business €24.99 or €249.99 | | | Includes Apple's markup; do not use as the base price |

### 4.4 Price history (why users feel squeezed)

- **Plus:** $8 (annual) / $10 (monthly) → **$10 / $12** (2024).
- **Business:** $15 / $18 → **$20 / $24** (2025-05-13, when AI was bundled in).
- **Enterprise:** list prices raised in Q1 2026.
- **Custom Agents:** free → credit-based (2026-05-04).

### 4.5 Worked example: total cost for a team

10 seats on Business, annual billing: 10 × $240 = **$2,400**. Add 2,000 credits a month (12 × $20 = $240) and one custom domain ($96). The total is **$2,736 a year**. With monthly billing the seats alone cost $2,880.

SimpleCMS One costs $0 in licences. The only variable cost is the user's own Anthropic API usage, billed per token by Anthropic and only when AI is actually used. Do not put a fixed AI cost figure on the landing page.

### 4.6 Competitor prices (for context)

| Product | Price | Source type |
|---|---|---|
| Obsidian | App free; Sync $4 (annual) / $5 (monthly) per user per month; Publish $8 / $10 per site per month; commercial licence optional at $50 per user per year | Official |
| Craft | Plus $6.40 (annual) / $8 (monthly) per month; Free has 1,500 blocks and 1 GB | Official |
| Capacities | Pro $9.99 per month ($119.88 per year) | Official |
| Heptabase | Pro $8.99 per month or $89.90 per year; Premium $17.99 | Official |
| Tana | Free; Pro $20 early bird ($30 regular); Max $80 ($120) | Official |
| Coda / Superhuman Docs | Pro $12 (annual) / $15 (monthly) per Doc Maker; Business $33 / $40 | 3rd party |
| Anytype | Free (1 GB sync); Builder $99 per year | 3rd party |
| AFFiNE | Free; Pro $6.75 per month; Team $10 per seat | 3rd party (official page returned HTTP 402) |
| Microsoft Loop | Included in M365 Business Standard/Premium and E3/E5; Copilot extra | Official |

---

## 5. User pain points

The table is ranked by how often and how strongly each complaint appears in reviews (G2, Capterra, community threads, 2026 comparison articles) and in Notion's own release notes.

| # | Pain point | Evidence | What One does about it |
|---|---|---|---|
| 1 | **Slow at scale.** Databases with 5k to 10k rows take 3 to 10 s; the desktop app is slow to open simple pages. | G2 and Capterra reviews; Notion ships speed fixes in nearly every release (+15% in 3.1, +27% on Windows in 3.2, +28% first render in 3.4) | All data in memory from IndexedDB, no network round trips, virtualised rows. Set a performance budget (section 7.4). |
| 2 | **Offline is partial.** Not in the browser, 50 database rows, per device, no forms or buttons. | Notion help "Use pages offline"; community reports | The browser *is* the app, and every page and row is offline by default. |
| 3 | **AI paywall and unpredictable bills.** Full AI only on Business; agents cost credits; complaints of "AI bloat". | Pricing page; release 2025-05-13; help "Custom agent pricing" | BYOK Claude: no tier, no credits. AI stays out of the way until called (no sparkle buttons everywhere). |
| 4 | **Per-seat pricing keeps rising.** A 50-person Business team pays about $12k to $14k a year. | Price history (section 4.4) | No seats and no account. |
| 5 | **Lock-in through lossy export.** Views lost, relations and formulas flattened, 32-character UUID filenames, broken image paths. | unmarkdown.com; Notion help "Export your content" | Lossless JSON backup plus Markdown and HTML; Notion zip import to get out of Notion. |
| 6 | **Blank canvas and maintenance tax.** Relations and formulas take weeks to learn; systems decay within 9 to 20 months. | storyflow.so (2026-09-06) | Seeded demo workspace and templates that already work, with Notion-like behaviour so nothing has to be relearned. |
| 7 | **Missing knowledge-tool basics:** graph, daily notes, split panes, canvas. | X/@NotionHQ (second-window workaround); competitor reviews | Graph, journal and stacked panes ship in v1. |
| 8 | **History capped by plan, no diff.** | Pricing page (7, 30, 90 days) | Local snapshots with no day limit, block diff, restore. |
| 9 | **Privacy:** cloud-only, no E2EE, no self-hosting, 30-day AI retention below Enterprise. | Pricing page, security docs | Data never leaves the device unless the user shares it, sends a webhook, or calls AI. |
| 10 | **Free-plan traps:** 1,000 blocks with 2+ owners, deleted blocks still count, 5 MB uploads. | Help "Understanding block usage" | No quotas. The only limit is the browser's storage quota, shown in settings. |
| 11 | **Automation quirks:** no chaining, a 3 s window for multiple triggers, Gmail only, no run log, webhooks carry properties only and pause on failure. | Help "Database automations", "Webhook actions" | Rules with a visible status, payloads that carry content, and an honest notice that rules run only while a tab is open. |
| 12 | **Notion Sites limits:** no password, no drafts, basic SEO, paid custom domains. | Help "Notion Sites availability and pricing" | Serverless share links now; encrypted links and a static export next. |
| 13 | **Mobile is slow** for structured editing. | Reviews | Responsive at 390 px with large tap targets; databases fall back to list and cards on small screens. |
| 14 | **Limited visual customisation:** 3 fonts, no themes. | Reviews | Paper and Carbon themes in a distinct visual language (INSTRUMENT); 3 page fonts. |
| 15 | **Permissions are complex** and easy to misconfigure. | Reviews | Not applicable: single user, and share links are read-only snapshots. |

---

## 6. Positioning

> **Notion's interaction model with everything kept on the user's own device.**
> Same sidebar, slash menu, databases and ⌘K, but offline in the browser, no account, AI with your own key, history with a diff, and share links that live inside the URL.

The visual language (INSTRUMENT: warm paper, black ink, one signal orange, mono spec labels, keycaps, LED dots) is part of the pitch. It has to look like a precision tool, not like another gradient SaaS.

---

## 7. Prioritised plan

### 7.1 P0: parity must-haves (without these it is not "a Notion")

1. **Block editor** (TipTap) with slash menu, Markdown autoformat, drag handles, block menu (turn into, duplicate, delete, colour), bubble toolbar, `@` mentions for pages, dates and people, and `[[` page links. Blocks:
   - text, H1 to H3, bulleted, numbered, to-do, toggle, quote, divider, callout, columns, table
   - code with highlighting, Mermaid, block and inline math, image, file, bookmark, embed
   - TOC, page link, inline database
2. **Page tree sidebar**: nesting, drag to reorder, favourites, recents, trash with restore. Page icon (emoji, lucide or OpenArt asset), cover, font, full width.
3. **Databases**: 20 property types, formulas, relations and rollups, 7 views (table, board, list, gallery, calendar, timeline, chart), filters, sorts, grouping, calculations, row pages in peek or full page, row templates, inline and full-page databases.
4. **⌘K command palette**: fuzzy search over pages and rows, plus create, actions and settings.
5. **Backlinks** on every page.
6. **Import and export**: Notion export zip (Markdown and CSV), Markdown, CSV to a typed database, JSON workspace backup (lossless); export to Markdown, HTML and JSON.
7. **Persistence**: IndexedDB autosave, sync across open tabs, nothing lost on reload, storage usage shown in settings.
8. **EN and DE** UI, auto-detected and switchable; **Paper and Carbon** themes.
9. **Usability floor**: keyboard access everywhere, visible orange focus ring, 390 px layout, `prefers-reduced-motion` respected.

### 7.2 P1: steroids features (the differentiators the landing page sells)

Ordered by value to the user against build risk:

| # | Feature | Why it wins | Key implementation notes |
|---|---|---|---|
| S1 | **Offline in the browser, by default** | Notion: apps only, 50 rows | Already true by architecture. Make it visible: a status LED reading "LOCAL · 0 ms". PWA install is P2. |
| S2 | **BYOK Claude AI** | Notion: Business only, no BYOK | Anthropic SDK in the browser (`dangerouslyAllowBrowser`). Key stored only locally and never written into share links, exports or webhooks. Actions: continue, summarise, rewrite, translate EN↔DE, explain, fill properties, ask the workspace. Results are inserted as a reviewable block, never silently. Warn that keys sit in browser storage on shared computers. |
| S3 | **History with diff** | Notion: 7/30/90 days, no diff | Periodic snapshots per page. Block-level LCS diff (added and removed), one-click restore that is itself a snapshot. Thinning policy: keep the last hour, then sparser, newest 100 per page. |
| S4 | **Graph view** | Notion has none | d3-force, with a local graph (depth 1 to 3) and a whole-workspace graph. Filter by database. Click to open. Readable at 200+ nodes. |
| S5 | **Stacked panes** | Notion: no split view | Open a link with a modifier to push a pane to the right. Panes scroll horizontally and collapse to spines, as in Andy Matuschak's notes. On mobile they become a back stack. |
| S6 | **Serverless share links** | Notion Sites is hosted, with no password | `#/s/<deflate-raw + base64url>` holding a read-only rendering of the page JSON. Size budget: about 2 KB safe everywhere, about 4 KB fine in Slack/X, more in Chrome. Show the byte count as an instrument gauge. Strip or replace local images. Fall back to "download HTML" for large pages. |
| S7 | **Free webhook automations** | Notion: paid, properties only | Triggers: row created, deleted, property changed. Actions: webhook, set property, notify. Payload: properties plus page content as Markdown. **CORS:** Zapier and Make catch hooks send no CORS headers, so offer a "simple request" mode (`text/plain`, no custom headers, `mode: 'no-cors'`, opaque response logged as "sent, unconfirmed"). n8n allows CORS, so use JSON and read the response there. Put any HMAC in the body, not a header. State plainly in the UI that rules run only while a tab is open. |
| S8 | **Present any page** | Notion: beta, paid | Dividers and H1s become slides. Arrow keys, speaker timer and progress bar in the INSTRUMENT style; ESC exits. |
| S9 | **Journal** | Notion: templates only | One shortcut opens or creates today's page under "Journal", dated in the user's locale, with an optional daily template. |
| S10 | **Templates gallery** | Blank-canvas problem | 6 to 10 opinionated templates (project tracker, CRM, reading list, meeting notes, content calendar, OKRs), with a preview before insert. |

### 7.3 P2: next, after the challenge submission

- **Password-protected share links**: AES-GCM with a PBKDF2 key derived in the browser. The ciphertext lives in the fragment and the viewer asks for the passphrase. This beats both Notion Sites and Obsidian Publish.
- **TK markers and pre-flight checklist**: missing alt text, broken internal links, links to trashed pages, oversized images. Must pass before share or export, shown as an instrument panel.
- **Static site export**: a zip with index, pages, nav, `sitemap.xml`, RSS, `llms.txt` and `content.json` (a read-only, headless "API" on GitHub Pages).
- **Form view** that writes rows locally, and posts to a webhook when the page is shared.
- **Property tokens** (`{{price}}`) in page text, and synced blocks with overrides per instance.
- **Bulk AI on rows** with a diff review screen.
- Unlinked mentions, Tabs block, draft vs published snapshot, releases with a time-travel preview.
- PWA install; asset library in OPFS (SHA-256 dedupe, WebP conversion, "where is this used").

### 7.4 Performance budget (supports pain point 1)

| Metric | Target |
|---|---|
| Open any page | < 100 ms after boot |
| Filter or sort in a 5,000-row table | < 150 ms |
| Cold boot of a seeded workspace | < 1.5 s on a mid-range laptop |

### 7.5 Won't do (needs a server, so we say so instead of faking it)

- Real-time multiplayer. WordPress removed it from 7.0 for reliability reasons; One keeps a CRDT-ready model and cross-tab sync.
- Newsletters, members and payments, ActivityPub, native analytics, A/B tests, personalisation.
- A hosted MCP server. The export with `llms.txt` and Markdown is the agent-readable alternative.
- Background automations or scheduled publishing while no tab is open.

---

## 8. Claims guide for the landing page

**Safe to say:**
- Notion has no graph view.
- Notion's offline mode does not work in the browser.
- Full Notion AI requires the Business plan ($20 to $24 per seat per month).
- Notion has no bring-your-own-key AI.
- Notion's page history is 7, 30 or 90 days depending on plan.
- Notion has no native side-by-side pages.
- Notion automations need a paid plan.
- Notion Sites cannot password-protect pages.
- Notion's presentation mode is a beta on paid plans.

**Do not say:**
- "Notion has no offline mode / history / presentation mode / webhooks": it has all of them, with limits.
- "Unlimited history": snapshots are thinned to the newest 100 per page. "No day limit" is correct.
- "End-to-end encrypted" or "encrypted at rest": local data is not encrypted.
- "AI is free": AI uses the user's Anthropic account, which bills per token.
- "Real-time collaboration": One is single-user.
- Any Business EUR price as official.

---

## 9. Sources

### Notion: official

- Pricing (fetched 2026-10-02; plan objects from `__NEXT_DATA__`): https://www.notion.com/pricing
- Release notes index and RSS: https://www.notion.com/releases, https://www.notion.com/releases/rss.xml
- 3.7 (Skills, sub-agents, models): https://www.notion.com/releases/2026-09-15
- 3.6 (External Agents, HTML blocks): https://www.notion.com/releases/2026-07-01
- 3.5 (Developer Platform, Workers, CLI): https://www.notion.com/releases/2026-05-13
- Merge cells: https://www.notion.com/releases/2026-05-26
- Rollup formatting: https://www.notion.com/releases/2026-04-27
- 3.4 part 2 (Custom Agent credits from May 4): https://www.notion.com/releases/2026-04-14
- 3.4 part 1 (dashboards, sidebar, Present, Tabs, H4, Archive): https://www.notion.com/releases/2026-03-26
- Dashboard views: https://www.notion.com/releases/2026-03-10
- Present any page: https://www.notion.com/releases/2026-03-02
- 3.3 Custom Agents: https://www.notion.com/releases/2026-02-24
- 3.2: https://www.notion.com/releases/2026-01-20
- 3.1 (Map view, Place property): https://www.notion.com/releases/2025-11-17
- 3.0 (Agents, row permissions): https://www.notion.com/releases/2025-09-18
- 2.53 (Offline mode, MCP): https://www.notion.com/releases/2025-08-19
- 2.52 (Feed view): https://www.notion.com/releases/2025-07-10
- 2.51 (AI bundled into Business): https://www.notion.com/releases/2025-05-13
- Notion Mail: https://www.notion.com/releases/2025-04-15
- Plus price change incl. EUR and GBP: https://www.notion.com/releases/2024-06-26
- Help pages:
  - https://www.notion.com/help/database-properties
  - https://www.notion.com/help/views-filters-and-sorts
  - https://www.notion.com/help/dashboards
  - https://www.notion.com/help/forms
  - https://www.notion.com/help/maps
  - https://www.notion.com/help/formulas
  - https://www.notion.com/help/database-automations
  - https://www.notion.com/help/webhook-actions
  - https://www.notion.com/help/buttons
  - https://www.notion.com/help/keyboard-shortcuts
  - https://www.notion.com/help/use-pages-offline
  - https://www.notion.com/help/import-data-into-notion
  - https://www.notion.com/help/export-your-content
  - https://www.notion.com/help/understanding-block-usage (re-checked 2026-10-02: the 1,000-block cap applies to Free workspaces with 2+ owners)
  - https://www.notion.com/help/notion-ai-faqs
  - https://www.notion.com/help/custom-agent-pricing
  - https://www.notion.com/help/public-pages-and-web-publishing
  - https://www.notion.com/help/notion-sites-availability-and-pricing
- No native split view (second-window workaround): https://x.com/NotionHQ/status/1606004976194445312

### Notion: third party

- EUR Business price (€19.50 annual; unverified): https://meetergo.com/blog/notion-test
- German App Store in-app prices: https://apps.apple.com/DE/app/id1232780281
- https://www.usecarly.com/blog/notion-pricing/
- https://tinycommand.com/blogs/notion-pricing-explained
- https://www.fastlancer.org/en/fastlancer-blog/notion-review/
- https://chloeforbesk.com/blog/notion-q1-2026-updates
- https://techcrunch.com/2026/05/13/notion-just-turned-its-workspace-into-a-hub-for-ai-agents/
- https://sync2sheets.com/blog/notion-sites/
- https://notionbackups.com/guides/notion-offline-mode

### Pain points and reviews

- https://www.g2.com/products/notion/reviews
- https://www.capterra.com/p/186596/Notion/reviews/
- https://hackceleration.com/notion-review/
- https://storyflow.so/blog/notion-maintenance-tax-and-what-to-move-to-2026
- https://unmarkdown.com/blog/notion-export-broken
- https://clonepartner.com/blog/notion-alternatives-2026-pricing-migration-and-tco-compared
- https://unanswered.io/guide/notion-limitations-and-drawbacks
- https://unstar.app/blog/productivity-app-reviews-what-power-users-complain-about-2026
- https://www.androidpolice.com/tried-notion-obsidian-capacities-anytype-for-month/

### Knowledge-tool competitors

- Obsidian:
  - https://obsidian.md/pricing
  - https://obsidian.md/roadmap/
  - https://obsidian.md/changelog/2026-09-29-desktop-v1.14.3/
  - https://obsidian.md/changelog/2025-05-21-desktop-v1.9.0/
  - https://publish.obsidian.md/
- Craft:
  - https://www.craft.do/pricing
  - https://support.craft.do/en/share-and-publish/publish/domains
- https://heptabase.com/pricing
- https://tana.inc/pricing
- https://capacities.io/pricing
- AFFiNE:
  - https://affine.pro/pricing (HTTP 402; figures from third-party results)
  - https://github.com/toeverything/affine
  - https://affine.pro/whiteboard
  - https://affine.pro/blog/affine-vs-appflowy-vs-anytype
- Anytype:
  - https://toolradar.com/tools/anytype/pricing
  - https://developers.anytype.io/docs/reference/changelog/
- Logseq:
  - https://github.com/logseq/logseq
  - https://kompozy.io/news/logseq-2-0-db-version-beta
- Coda / Superhuman Docs:
  - https://help.superhuman.com/hc/en-us/articles/46210093285773-What-s-changing-Coda-becomes-Superhuman-Docs
  - https://www.breeze.pm/articles/coda-is-now-superhuman-docs
  - https://automationatlas.io/answers/coda-pricing-explained-2026/
- Microsoft Loop:
  - https://support.microsoft.com/en-us/microsoft-365-copilot/compare-microsoft-loop-copilot-pages-and-copilot-notebooks
  - https://www.epcgroup.net/microsoft-loop-enterprise-2026

### CMS platforms

- WordPress:
  - https://humanmade.com/wordpress-for-enterprise/wordpress-6-9-the-collaboration-release-that-changes-everything/
  - https://developer.wordpress.org/news/2026/04/whats-new-for-developers-april-2026/
  - https://www.dreamhost.com/blog/wordpress-7-0/
  - https://wpmet.com/wordpress-7-0/
  - https://www.inmotionhosting.com/support/edu/wordpress/wordpress-news/wordpress-7-0-release-date/
  - https://kinsta.com/blog/wordpress-block-bindings-api/
  - https://wordpress.com/blog/2025/12/03/wordpress-6-9-new-for-developers/
- Ghost:
  - https://ghost.org/changelog/6/
  - https://ghost.org/changelog/new-editor/
  - https://docs.ghost.org/webhooks/
  - https://www.dxpscorecard.com/platform/ghost
- Webflow:
  - https://webflow.com/blog/webflow-conf-2026-announcements
  - https://webflow.com/blog/2026-builder-keynote
  - https://www.unkoa.com/webflow-cms-2025-solo-creators-enterprise-scale/
  - https://www.thecssagency.com/blog/top-10-webflow-features
- Framer:
  - https://www.framer.com/cms/
  - https://www.framer.com/updates/localization-update-collection-groups
- Contentful:
  - https://www.contentful.com/developers/changelog/schedule-and-preview-future-releases-with-timeline/
  - https://www.contentful.com/blog/introducing-timeline/
  - https://www.contentful.com/products/ai-actions/
  - https://www.contentful.com/help/ai-automations/ai-actions/run-ai-actions-in-bulk/
- Sanity:
  - https://www.sanity.io/spring-release-2025
  - https://www.sanity.io/blog/introducing-content-releases
  - https://www.sanity.io/docs/content-lake/drafts-and-versions
  - https://dev.to/maniekm/sanity-vs-contentful-2026-which-headless-cms-wins-5dg8
- Strapi:
  - https://www.dxpscorecard.com/platform/strapi
  - https://docs.strapi.io/cms/features/releases
  - https://strapi.io/blog/draft-publish-content-history-strapi-5
- Payload:
  - https://www.dxpscorecard.com/platform/payload-cms
  - https://payloadcms.com/docs/versions/drafts
  - https://github.com/payloadcms/payload/discussions/12843
- Storyblok:
  - https://www.dxpscorecard.com/platform/storyblok
  - https://www.storyblok.com/mp/storyblok-introduces-flowmotion

### Serverless sharing and webhooks

- https://github.com/arfct/itty-bitty/wiki
- https://github.com/excalidraw/excalidraw/discussions/2787
- https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook
- https://community.latenode.com/t/client-side-ajax-calls-to-zapier-webhook-endpoints-failing-with-cors-errors/31171
