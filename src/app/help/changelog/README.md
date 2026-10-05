# What's new — how to add an entry

Every user-visible release adds one entry in English **and** German, with a real screenshot. The entries
show in the Help panel (**? → What's new**, ⌘K "What's new"), on the public pages `/help/changelog/` and
`/help/de/changelog/`, and in the Atom feed `/help/changelog.xml`.

## 1. Write the twins

`en/<yyyy-mm-dd>-<slug>.md` and `de/<yyyy-mm-dd>-<slug>.md` — same file name, same `id`, `date`, `order`,
`image`:

```md
---
id: 2026-10-05-ai-terminal
date: 2026-10-05
order: 1
title: The AI terminal
summary: One line — what it is, for whom.
image: assets/shots/changelog/ai-terminal.webp
alt: What the screenshot shows, in one sentence.
help: agent, ai-menu
try: terminal
---
2–6 short paragraphs or bullets: what it is, how to use it (keys as <kbd>Mod+J</kbd>), one tip.
```

- `order`: the rank within its day, `1` = newest. The list is newest first.
- `help`: related article ids (`src/app/help/articles/en/<id>.md`); `[text](help:<id>)` links work in the body.
- `try` (optional): one of `terminal`, `settings-ai`, `settings-mcp`, `settings-mail`, `agents`, `ask` — the
  "Try it" key. New actions go into the allow-list in `entries.ts` (`CHANGELOG_TRIES`), `try.ts` and the
  `help.news.try.<id>` strings; never code in Markdown.
- Body: the help articles' Markdown subset (`../markdown.ts`). German natural, English plain; no prices,
  no marketing words.

## 2. Make the screenshot

Add a shot to `scripts/changelog-shots.mjs` (same name as the image), then:

```sh
npm run build && npx vite preview --port 5315 --strictPort &   # base "/"
node scripts/changelog-shots.mjs http://127.0.0.1:5315 <name>
```

It writes `public/assets/shots/changelog/<name>.webp` (light theme, 1440 wide, ≤ 150 KB) and its size into
`sizes.json`. Look at the picture before you commit it: crisp, relevant, no debug UI. The Claude API is
mocked in the script — it never sends a real request.

## 3. Check

`npm run build` fails when an entry has no twin in the other language or its image is missing from
`public/assets/shots/changelog/`. The newest entry lights the LED on **? Help** once per device
(localStorage `one.help.seen-changelog`); opening the list clears it.
