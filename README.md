<div align="center">

<img src="public/assets/icons/app-icon.webp" width="96" alt="" />

# SimpleCMS One

**Notion, rebuilt. Minus the bill.**

A local-first workspace that does what Notion does — block editor, databases with seven views,
Claude AI with your own key, webhook automations, Notion import — for **$0**, with **no account**
and **no server**. Everything lives in your browser.

**[Live demo → marcelweissgerberit.github.io/SimpleCMS](https://marcelweissgerberit.github.io/SimpleCMS/)** ·
[Open the workspace](https://marcelweissgerberit.github.io/SimpleCMS/app/) ·
[Deutsch ↓](#auf-deutsch)

<img src="docs/media/intro.gif" width="860" alt="First visit: a 1997 spreadsheet homepage gets smashed by a 3D sledgehammer and the new site appears underneath" />

<sub>First visit only: sit still for 15 seconds on the 1997 spreadsheet homepage. Replay any time with <code>?intro</code>.</sub>

</div>

---

## Why

Notion is excellent — and it costs **$10–12 per seat per month on Plus**, and **$20–24 on Business**, the cheapest plan
with full Notion AI (notion.com/pricing, October 2026). A ten-person team on Business pays **$2,400 a year**, before
add-ons. Most of that money buys pages, blocks and databases that a modern browser can run on its own.

**One** is a faithful, keyboard-first rebuild of the parts people actually use, plus the things they keep asking
Notion for: a real offline mode, a graph, version history with no day limit, free webhooks for n8n / Make / Zapier,
AI on every workspace with your own Claude key, and an honest export.

| | Notion | **One** |
|---|---|---|
| Price | Free (limited) · Plus $10–12 · Business $20–24 per seat/month | **Free. No seats.** AI billed by Anthropic per use |
| Works fully offline, in the browser | partial (apps only, pages one by one) | **yes** — every page and row |
| Data stays on your device | no | **yes** — IndexedDB, no server |
| Use without an account | no | **yes** |
| Full AI on every plan | Business only | **yes** — bring your own Claude key |
| Webhook automations | paid plans | **free** on every database |
| Graph view of linked pages | no | **yes** |
| Version history | 7 / 30 / 90 days by plan | **no limit**, block-level diff |
| Share without a server | no | **yes** — the page travels inside the link |
| Pages side by side | peek / second window | **stacked panes** |
| Real-time multiplayer | **yes** | no — single user, live sync across tabs |

<sub>Full research with sources: [docs/RESEARCH.md](docs/RESEARCH.md).</sub>

## What's inside

<table>
<tr>
<td width="50%"><img src="public/assets/shots/database.webp" alt="Projects database as a board with a row open in the side peek" /></td>
<td width="50%"><img src="public/assets/shots/ai.webp" alt="Claude rewriting a selection inside a page" /></td>
</tr>
<tr>
<td><img src="public/assets/shots/graph.webp" alt="Graph view of all pages and their links" /></td>
<td><img src="public/assets/shots/automations.webp" alt="Automation sending new database rows to an n8n webhook" /></td>
</tr>
</table>

**Block editor** — slash menu (with the Markdown shortcut shown next to every command), drag handles, turn-into,
toggles, callouts, columns, tables, to-dos, code with highlighting, KaTeX math, Mermaid diagrams, images & files,
embeds, bookmarks, table of contents, @-mentions of pages / dates / people, emoji shortcodes, Markdown paste,
block links.

**Databases** — table, board, list, gallery, calendar, timeline and chart views over the same rows; 20 property types
including relations, rollups, formulas (safe parser, no `eval`), status, unique IDs and ratings; filters with AND/OR
groups, multi-sort, grouping, footer calculations, row templates, inline databases inside pages, side/centre peek.

**Workspace** — page tree with drag & drop, favourites, trash, breadcrumbs, `⌘K` palette for search *and* commands,
home dashboard, today's journal, stacked panes (`Alt`-click any link), focus mode, presentation mode (any page becomes
slides), 11 templates (meeting notes, project tracker, roadmap, content calendar, reading list, CRM, bug tracker,
OKRs, weekly planner, wiki, habits), light "Paper" and dark "Carbon" themes, English and German.

**AI, your key** — select text and ask Claude to improve, shorten, extend, fix, translate, explain, summarise or pull
out action items; press `Space` on an empty line to write, or ask questions about your whole workspace with cited
pages. Requests go straight from your browser to `api.anthropic.com` with your key (default model Claude Opus 5.5;
Sonnet 5.5 and Haiku 4.5 selectable). The key never leaves this browser in any other way.

**Automations for automators** — every database can fire webhooks when rows are created, changed or deleted, set
properties, or show notifications. Ready-made recipes for n8n / Make / Zapier. Payload:

```json
{
  "event": "row_created",
  "automation": { "id": "…", "name": "New row → Webhook" },
  "database": { "id": "…", "title": "Projects" },
  "row": {
    "id": "…",
    "title": "Website relaunch",
    "url": "https://marcelweissgerberit.github.io/SimpleCMS/app/#/p/…",
    "properties": { "Status": "In progress", "Owner": "Alex" }
  },
  "changes": [{ "property": "Status", "from": "Backlog", "to": "In progress" }],
  "timestamp": "2026-10-03T09:41:07.000Z",
  "source": "simplecms-one"
}
```

**Move in, move out** — import a Notion export (Markdown & CSV zip, nested pages, databases with typed columns,
images), Markdown files, CSV or a One backup. Export pages or the whole workspace as Markdown (zip), HTML, PDF or a
lossless JSON backup. Share read-only pages as links that *contain* the page (compressed into the URL) — no server
involved.

**Private by construction** — no analytics, no cookies, no backend. A service worker keeps the app working offline
after the first visit. Several tabs stay in sync.

## The intro

The first time you open the site you get the homepage of 1997: a spreadsheet with WordArt, a visitor counter, an
"under construction" sign and a default-colour 3D chart. Do nothing for 15 seconds and the window freezes
("Not Responding"), rumbles — and a procedurally modelled sledgehammer (Three.js, PBR steel, hickory handle) hits the
screen three times. The page is captured to a texture, fractured into Voronoi shards with real thickness, and falls
away while the new site assembles behind it. It plays once (`localStorage` key `one.introSeen`); `?intro` replays it,
`?skip` skips it, and reduced-motion / no-WebGL visitors get a graceful fallback.

## Run it

**Use it:** open the [live workspace](https://marcelweissgerberit.github.io/SimpleCMS/app/). That's it.

**Self-host in two minutes:** fork this repository → *Settings → Pages → Source: GitHub Actions* → push to `main`.
The workflow in `.github/workflows/pages.yml` type-checks, builds and deploys. (Keep the repository name `SimpleCMS`,
or change `build:pages` in `package.json` to your repository name.)

**Develop:**

```bash
npm install
npm run dev          # landing at http://localhost:5173/ , app at /app/
npm run typecheck
npm run build:pages  # production build with base /SimpleCMS/
npm run test:e2e     # Playwright end-to-end suite (builds + previews automatically)
```

`node scripts/capture-shots.mjs` regenerates the landing-page screenshots from the real app.

## How it's built

- **Stack:** Vite, React 19, TypeScript, TipTap v3 (ProseMirror), Zustand + Immer, IndexedDB (`idb-keyval`), Three.js,
  GSAP, d3-force / d3-delaunay, KaTeX, Mermaid, fflate, the official Anthropic TypeScript SDK.
- **Structure:** `src/landing` (intro + site), `src/app/{store,shell,editor,database,features,ui}` — areas talk only
  through their public `index.ts`, the workspace store and a small UI store. See [CLAUDE.md](CLAUDE.md).
- **Design language "INSTRUMENT":** precision instruments, Braun, Teenage Engineering, Swiss manuals — warm paper,
  black ink and exactly one signal orange; Archivo with its width axis, JetBrains Mono labels, hairlines, keycaps and
  LEDs. No gradients, no glass, no glow.
- **Art:** the 3D icon set and page covers were generated with OpenArt (GPT Image 2.5 Sunburst for icons,
  Nano Banana Pro for covers), then art-directed, retouched and cut to transparent WebP — prompts and tooling in
  [docs/art](docs/art/PROMPTS.md). Fonts: Archivo, JetBrains Mono, Newsreader (SIL OFL).

Built for the **Ninja Armory** challenge of the AI Automations community.

---

## Auf Deutsch

**SimpleCMS One** ist ein Workspace wie Notion, nur lokal, kostenlos und ohne Konto. Er bietet:

- einen Block-Editor mit Slash-Menü
- Datenbanken mit sieben Ansichten
- Claude-KI mit deinem eigenen API-Key
- Webhook-Automationen für n8n, Make und Zapier
- Notion-Import, Teilen-Links ohne Server, Graph-Ansicht und Versionsverlauf ohne Zeitlimit
- Präsentationsmodus und Offline-Betrieb

Alles läuft im Browser, deine Daten verlassen dein Gerät nicht. Die Oberfläche gibt es auf Deutsch und Englisch und
erkennt die Sprache automatisch.

Beim ersten Besuch erscheint die Startseite von 1997 als hässliche Tabellenkalkulation. Wer 15 Sekunden nichts tut,
erlebt, wie ein 3D-Vorschlaghammer sie zertrümmert und die neue Seite darunter freilegt. Das passiert nur einmal;
mit `?intro` lässt es sich wiederholen.

**Loslegen:** [Workspace öffnen](https://marcelweissgerberit.github.io/SimpleCMS/app/). Zum Selbst-Hosten: Repository
forken, *Settings → Pages → Source: GitHub Actions* einstellen und nach `main` pushen.
