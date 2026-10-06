---
id: import
title: Import
section: share
order: 4
keywords: import, notion, obsidian, evernote, trello, markdown, csv, html, confluence, google docs, powerpoint, pptx, slides, deck, keynote, claude design, move, migrate, Importieren, umziehen, Präsentation, Folien
related: export, databases, first-steps, claude-design
summary: Move in from Notion, Obsidian, Evernote, Trello, Markdown, CSV, web pages or PowerPoint.
---
**Import** in the sidebar (or ⌘K → *Import*). Drop files, folders or ZIPs — the format is detected.

- **Notion** — *Settings → Export → “Markdown & CSV”* with subpages; drop the ZIP as it is. Databases arrive as real databases with properties.
- **Obsidian vault** — choose the vault folder or drop a ZIP. Links, embeds and callouts carry over.
- **Evernote** — notebooks exported as `.enex`; each file becomes a page with its notes.
- **Trello board** — board menu → *Print, export and share → Export as JSON*.
- **Web pages** — HTML files or a ZIP: Google Docs (web page), Confluence, Dropbox Paper.
- **Markdown & text** — single files or whole folders; front matter becomes a properties line.
- **Spreadsheet** — CSV or TSV: the first column is the title, column types are detected.
- **PowerPoint** — a `.pptx` deck (see below).
- **Claude Design** — its HTML or PPTX export and screenshots: [From Claude Design to One](help:claude-design).
- **One backup** — a `.json` backup: merge it or replace the workspace.

Every import lands under one page: move it anywhere — or move it to the trash to undo the import. An **Import report** lists anything that could not be carried over.

> CSV into an existing database: database **•••** → **Import CSV into this database…**

## PowerPoint decks
Choose the **PowerPoint** tile or drop a `.pptx`. It is read on this device — nothing is sent. A **preview** comes first: the slides with their titles, how many pictures, tables and notes, and what does not come over 1:1. Pick the page title and the layout, then **Import**.
- **One page** (default): a heading and a divider per slide. **Present** in the last step shows it slide by slide — each PowerPoint slide is one slide. A title slide becomes the page title and the line below it.
- **A page per slide**: every slide its own sub-page, under one page with the deck's title.
- **Carried over:** titles, text, bullet lists with their levels, bold / italic / underline / strike, links, tables, pictures (stored on this device), speaker notes as a closed toggle **Notes** below the slide.
- **Not 1:1:** a chart comes in as a table with its data, SmartArt as a list of its text; video, audio, embedded objects and pictures in EMF / WMF / TIFF are left out — the import report says so.
- **Undo import** in the last step removes the whole import in one step.
- Limits: at most 300 slides and 200 MB unpacked. Old `.ppt` files: save them as `.pptx` first.

A `.pptx` already on a page (dropped there, or a mail attachment): its file key **AI** → **Open as page** does the same here on the device; **Summarise** and **Ask about the file** send its text to Claude.
