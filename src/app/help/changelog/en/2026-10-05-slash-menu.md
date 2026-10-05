---
id: 2026-10-05-slash-menu
date: 2026-10-05
order: 17
title: The “/” menu opens only when you type it
summary: References like /r/24772 stay plain text — moving the caret into them no longer opens a menu.
image: assets/shots/changelog/slash-menu.webp
alt: A page with the reference /r/24772 as plain text and, one line below, the “/” menu opened by typing
help: blocks, keyboard-shortcuts
---
The `/` menu — and the `@` and `:` menus — now open only where you have just typed the character. Clicking or arrowing into existing text such as `/r/24772`, `@home` or a pasted path leaves it alone; before, that opened an empty menu with *No results*.

- Type `/` on an empty line or after a space: the menu opens as before. The **+** next to a block opens it too.
- A second `/` in the query closes the menu, so paths like `/r/24772` can be typed straight through. <kbd>Esc</kbd> closes it, and the text stays.
- Undo and redo: <kbd>Mod+Z</kbd> takes a step back, <kbd>Mod+Shift+Z</kbd> redoes it.

> Tip: references pasted from a ticket system stay exactly as pasted — select them and **Ask AI → Turn into database** if you want them as rows.
