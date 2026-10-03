# Skool post — Ninja Armory submission

**Attach:** `public/media/simplecms-one.mp4` (60 s video, also online at
https://getonecms.com/media/simplecms-one.mp4) and the three images in `docs/media/post/`
(`01-ugly-1997.png`, `02-the-bill.png`, `03-spec-sheet.png`). Don't post a screenshot of the new landing
site: people should see it for themselves after 15 seconds.

---

**Title:** I rebuilt Notion, minus the $2,880 bill: SimpleCMS One (Ninja Armory)

Hey everyone 👋

Here's my Ninja Armory submission: **SimpleCMS One**, a rebuild of Notion that runs entirely in your browser. It's free, open source, and needs no account and no server.

👉 **Try it:** https://getonecms.com/

One request: when the page opens, **don't click, don't scroll, don't touch anything for 15 seconds.** Trust me. (It only happens on your first visit. If you've already been there, add `?intro` to the link.)

**🧾 The problem**
Notion is brilliant, and a 10-person team on the Business plan pays **$2,400–2,880 a year** for it. Full Notion AI is only on Business, and automations sit behind a paid plan. Most of that money buys pages, blocks and databases, which a modern browser can run on its own.

**🛠 What I built**
• **Block editor:** slash menu, drag handles, toggles, callouts, columns, tables, code, math and Mermaid diagrams
• **Databases:** 7 views (table, board, list, gallery, calendar, timeline, chart) and 20 property types, including relations, rollups and formulas
• **⌘K for everything**, pages side by side, and a live graph of how your pages connect
• **Claude built in, with your own key.** Each person adds their own Anthropic API key in Settings and pays Anthropic only for what they use. There's no AI plan and no markup, and the key only goes from your browser to Anthropic.
• **Automations:** every database fires webhooks into **n8n, Make or Zapier**, free (I think this community will like this part most)
• **Move in, move out:** import a Notion export in about a minute, and export Markdown, HTML, PDF or a full backup
• **Share by link:** the page lives inside the URL, so no server is involved
• Works offline, with version history that has no day limit, 11 templates, presentation mode, light and dark themes, and English and German

**🏁 How it fits the judging criteria**
• **Effective:** it does the daily Notion work, and you can bring your existing workspace with you.
• **Looks:** it has its own design language, "Instrument" (precision instruments, Braun, Teenage Engineering, one signal orange), not another purple-gradient SaaS look.
• **Creative:** the first-visit intro (you'll see 😉), and a share link that *is* the page.
• **Simple:** open the link and start typing. There's nothing to sign up for or install.
• **Value:** $0 instead of $2,880 a year for a team of ten, with AI at cost.

**⚙️ Under the hood**
It's built with React 19, TypeScript, TipTap (ProseMirror) and IndexedDB, plus Three.js for the intro and the official Anthropic SDK. It has 120 end-to-end tests. It's MIT-licensed, so you can fork it and self-host it on GitHub Pages in two minutes.
Code: https://github.com/MarcelWeissgerberIT/SimpleCMS

**Honest limits:** it's single-user, with no real-time multiplayer, though tabs stay in sync. Your data lives in your browser, so export a backup when you switch devices.

I'd love your feedback, especially on what you'd automate first with the webhooks. 🙏

*(The 60-second tour is in the video. The images show the "before", the bill and the spec sheet.)*
