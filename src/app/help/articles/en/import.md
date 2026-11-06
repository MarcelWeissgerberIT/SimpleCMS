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

## External sources: URLs, PDFs and formatted text

Choose **Import → External source**. Enter a public HTTPS address under **URL**, then **Load preview**. ONE fetches this address through your team server without forwarding your browser login or cookies; this needs a signed-in team workspace. **Paste text** also works locally and covers protected or dynamic pages. Existing file imports remain available.

Review the title and original text, select an excerpt if needed, and add the intended purpose. Check **Preview reviewed**, then **Import source**. The resulting ONE page keeps the source address, time and content hash; common token parameters are removed from the saved link. Importing calls no AI and writes nothing to Atlas. Use the imported page as context for a later task; any Atlas handoff is a separate instruction after review. External references, confirmed requirements and AI proposals must remain distinct.

**PDF:** Choose the PDF source mode and a local file up to 20 MB / 200 pages. Select original pages and review their extracted text. The original file, file hash and original page numbers are retained. Image-only scans need OCR; ONE invents no missing text. Preview runs on this device until you import.

**Formatted clipboard:** Under **Paste text**, use Ctrl+V / ⌘V. Tables, lists, emphasis and links survive preview and import. Images, scripts and foreign page functions are removed. **Edit as plain text** explicitly discards formatting so you can select a smaller excerpt.

For a direct handoff, choose **Review Atlas handoff** after import, or the page’s **••• → Hand source to Atlas…**:

1. Select your personal Atlas connection and **Check access and projects**. A reachable personal worker or existing team-server MCP access is required.
2. Explicitly select a project from the actual Atlas response. Review title and excerpt (up to 18,000 characters; the complete tool payload, including metadata and escaping, must fit 20,000 characters).
3. **Check constraints and handoff** reads the Atlas constraints and shows the exact outgoing payload and hash. Nothing has been written yet.
4. Review and confirm **Create in Atlas now**. This creates a new dossier (`doc`) with a ONE source link and content hash. It does not overwrite existing records or create confirmed requirements or decisions.
5. The receipt names the actual returned Atlas ref and read-back verification result. Download it if needed. Inspect Atlas before retrying a lost response; ONE never retries writes automatically. A personal local receipt also blocks the same exact payload after closing or reloading the dialog. If a previous attempt is unresolved, inspect Atlas first; only explicitly acknowledge a missing record before preparing again. The local receipt stores hashes and returned refs, not the source text or token.

ONE does not generate new source content for the handoff and uses neither another person’s token nor additional permissions. Atlas may translate or normalize its stored version on the server. A different title or body remains a visible read-back difference; the original source in ONE is preserved. Existing outbound data rules, tool permissions and Atlas constraints still apply. Missing access or projects must be resolved in your personal connection.

URL imports extract static text up to 2 MB; tables become text on that route. Use the PDF mode for PDF files and the clipboard for login-required or dynamic pages. Reviewed source text is limited to 250,000 characters. **Undo import** removes the ONE import; an explicitly created Atlas reference remains in Atlas.

## PowerPoint decks
Choose the **PowerPoint** tile or drop a `.pptx`. It is read on this device — nothing is sent. A **preview** comes first: the slides with their titles, how many pictures, tables and notes, and what does not come over 1:1. Pick the page title and the layout, then **Import**.
- **One page** (default): a heading and a divider per slide. **Present** in the last step shows it slide by slide — each PowerPoint slide is one slide. A title slide becomes the page title and the line below it.
- **A page per slide**: every slide its own sub-page, under one page with the deck's title.
- **Carried over:** titles, text, bullet lists with their levels, bold / italic / underline / strike, links, tables, pictures (stored on this device), speaker notes as a closed toggle **Notes** below the slide.
- **Not 1:1:** a chart comes in as a table with its data, SmartArt as a list of its text; video, audio, embedded objects and pictures in EMF / WMF / TIFF are left out — the import report says so.
- **Undo import** in the last step removes the whole import in one step.
- Limits: at most 300 slides and 200 MB unpacked. Old `.ppt` files: save them as `.pptx` first.

A `.pptx` already on a page (dropped there, or a mail attachment): its file key **AI** → **Open as page** does the same here on the device; **Summarise** and **Ask about the file** send its text to Claude.


Atlas may translate or normalize content when saving it. ONE then explicitly reports a title/content mismatch, even if Atlas retains an original-language block. This is an accepted write with a differing read-back, not a reason to create the dossier again. Compare the linked record with the original source in ONE; the saved receipt retains this mismatch after reload.
