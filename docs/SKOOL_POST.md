# Skool post — Ninja Armory submission

**Attach:** `public/media/simplecms-one.mp4` (60 s video, also online at
https://getonecms.com/media/simplecms-one.mp4) and the three images in `docs/media/post/`
(`01-ugly-1997.png`, `02-the-bill.png`, `03-spec-sheet.png`). Don't post a screenshot of the new landing
site: people should see it for themselves after 15 seconds.

---

**Title:** I rebuilt Notion, minus the $2,880 bill: SimpleCMS One (Ninja Armory)

Hey everyone 👋

Here's my Ninja Armory submission: **SimpleCMS One**, a rebuild of Notion that runs entirely in your browser — and, when your team wants in, on a small server you run yourself. It's free and open source, and you don't need an account to start.

👉 **Try it:** https://getonecms.com/

One request: when the page opens, **don't click, don't scroll, don't touch anything for 15 seconds.** Trust me. (It only happens on your first visit. If you've already been there, add `?intro` to the link.)

**🧾 The problem**
Notion is brilliant, and a 10-person team on the Business plan pays **$2,400–2,880 a year** for it. Full Notion AI is only on Business, and automations sit behind a paid plan. Most of that money buys pages, blocks and databases, which a modern browser can run on its own.

**🛠 What I built**
• **Block editor:** slash menu, drag handles, toggles, callouts, columns, tables, tabs, code, math and Mermaid diagrams, synced blocks, and buttons that run actions
• **Databases:** 8 views (table, board, list, gallery, calendar, timeline, chart, form) and 22 property types, including relations, rollups and formulas. Missing properties are created on the fly, and **forms** have conditional questions and several pages
• **Spreadsheets inside your pages:** several sheets, 75+ functions, coloured datasets, and **your own functions, built by clicking** (no code), which work in sheets and database formulas
• **Charts in three clicks** from a sheet, a database or your workspace's own numbers, and they update as the data changes
• **Claude built in, with your own key.** Each person adds their own Anthropic API key in Settings and pays Anthropic only for what they use. There's no AI plan and no markup, and the key only goes from your browser to Anthropic. It also writes your **meeting notes**: live transcript in, summary, decisions and action items out
• **Claude Desktop in one click (MCP):** install the extension, switch it on, and Claude Desktop (or Claude Code) can search, read and write your workspace. Every change waits for your OK on a card
• **Teams:** live co-editing with cursors, **private pages**, a personal space for every account, and every workspace **encrypted at rest with its own key**. It runs on a small server you host yourself (one Docker image, about 30 minutes to set up)
• **Automations:** every database fires webhooks into **n8n, Make or Zapier**, free (I think this community will like this part most). The team server adds a REST API and an incoming webhook per database, so n8n can write rows back
• **Move in, sync out:** import from Notion, Obsidian, Evernote or Trello; keep a Markdown copy in a folder or **your own GitHub repo**; export Markdown, HTML, PDF or a full backup, or publish pages as a website
• **Share by link:** the page lives inside the URL, so no server is involved
• An Inbox with reminders, an Agenda, ⌘K for everything, pages side by side, a live graph, version history with no day limit, your own templates, presentation mode, offline mode, light and dark themes, and English and German

**🏁 How it fits the judging criteria**
• **Effective:** it does the daily Notion work, solo or as a team, and you can bring your existing workspace with you.
• **Looks:** it has its own design language, "Instrument" (precision instruments, Braun, Teenage Engineering, one signal orange), not another purple-gradient SaaS look.
• **Creative:** the first-visit intro (you'll see 😉), a share link that *is* the page, and functions you build by clicking instead of typing.
• **Simple:** open the link and start typing. There's nothing to sign up for or install.
• **Value:** $0 instead of $2,880 a year for a team of ten, with AI at cost. The team server costs whatever your small server costs.

**⚙️ Under the hood**
It's built with React 19, TypeScript, TipTap (ProseMirror) and IndexedDB, plus Three.js for the intro and the official Anthropic SDK. The team server is Node with Yjs (Hocuspocus) and SQLite. It has over 400 end-to-end tests. The app is MIT-licensed, so you can fork it and self-host it on GitHub Pages in two minutes; the team server is AGPL.
Code: https://github.com/MarcelWeissgerberIT/SimpleCMS

**Honest limits:** the team cloud is self-hosted for now: there's no sign-up-and-go version yet, so live multiplayer means running the server (Docker + Caddy). Without it, One is single-user, though tabs stay in sync, and your data lives in your browser, so turn on folder or GitHub sync, or export a backup, when you switch devices. Encryption at rest protects the server's disk; it isn't end-to-end encryption.

I'd love your feedback, especially on what you'd automate first with the webhooks. 🙏

*(The 60-second tour is in the video. The images show the "before", the bill and the spec sheet.)*
