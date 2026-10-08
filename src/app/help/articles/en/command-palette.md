---
id: command-palette
title: Search, filters & commands (⌘K)
section: start
order: 3
keywords: palette, search, find, command, cmd k, ctrl k, ask, quick, filter, status, property, recent, frequent, Suche, Befehle, Befehlspalette, eigenschaft, zuletzt, häufig
related: keyboard-shortcuts, ai-menu, sidebar
summary: One box for everything — find any page, filter by status or person, run any command, ask Claude.
---
Press <kbd>Mod+K</kbd> (or <kbd>Mod+P</kbd>, or **Search** in the sidebar). The palette has three modes:

- **Find** — type to search page titles and page content. Results show the path of each page; matches are highlighted. Help articles appear too, in the **Help** group. Filters (below) narrow it down.
- **Commands** — start with `>` to list only commands: new page, new database, templates, import, export, theme, focus mode, settings …
- **Ask** — start with `?` to ask Claude about the page that is open (needs your Claude key).

## Filters
Type a filter and a space: it becomes a chip in the field, and the results follow every chip.

- `status:done` — any property by its name, in every database that has it. A status also matches its group: `done`, `in-progress`, `todo` (so `status:done` finds “Done”, “Finished” and “Published” alike).
- `tags:web`, `owner:alex`, `owner:me`, `budget:>5000`, `progress:>50%`, `"publish date":7d` — a name with spaces in quotes, or with dashes: `publish-date:7d`. Numbers take `>`, `<`, `>=`, `<=`.
- `@alex` / `@me` — someone in a person property (Owner, Assignee …).
- `by:sam` — pages Sam created or last edited (team workspaces; `by:<agent>` finds a custom agent's changes). A database property named “By” keeps `by:` for itself.
- `in:projects` — the entries of a database, or the pages below a page.
- `is:favorite`, `is:page`, `is:database`, `is:row` — and `is:private` in team workspaces.
- `edited:7d`, `created:today`, `edited:>30d` (not touched for 30 days), `edited:2026-09`, `created:>2026-09-01`, `edited:week`.
- `has:owner` — the property is filled.
- `-` in front negates: `-status:done`. The same filter twice means either: `status:review status:done`.
- German spellings work too: `ist:favorit`, `hat:verantwortlich`, `geändert:7t`, `erstellt:heute`, `von:sam`, `status:erledigt`.

Words and filters combine: `brand status:done` searches “brand” among the done entries. A property named like a keyword is reached with quotes: `"Created":2026`. Text that only looks like a filter (`Re: budget`, `10:30`, a link) stays text.

While you type a filter, suggestions show what fits — the options of a property with their number of entries, people, pages, dates. A hint says what a value can be, or why it matches nothing.

## Keys
- <kbd>↑</kbd> <kbd>↓</kbd> move, <kbd>Enter</kbd> opens.
- <kbd>Tab</kbd> or <kbd>Enter</kbd> on a suggestion takes it; <kbd>Backspace</kbd> in the empty field removes the last filter. A focused chip goes with <kbd>Enter</kbd>, <kbd>Delete</kbd> or a click.
- <kbd>Alt+Enter</kbd> opens a page in a side pane instead.
- <kbd>Esc</kbd> closes the palette.

## The empty field
Without a query the palette shows **Recent** (the pages you opened last) and **Frequent** (the pages this device opens most), then the commands. Both lists stay on this device — see [Sidebar & page tree](help:sidebar).

If nothing matches, the last row creates a page with what you typed.
