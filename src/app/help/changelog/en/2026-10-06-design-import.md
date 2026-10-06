---
id: 2026-10-06-design-import
date: 2026-10-06
order: 2
title: PowerPoint import and “Take over from Claude Design”
summary: Bring a .pptx deck in as a page you can present, and a Claude Design export with its colours, fonts and sizes kept as a note — and in One memory.
image: assets/shots/changelog/design-import.webp
alt: The Import dialog's Claude Design step with an HTML export, a PowerPoint deck and a screenshot added, the design tokens read from them as swatches with hex codes and roles, and the options to describe the screenshots and save the style to One memory
help: claude-design, import, memory
---
**Import** has two new sources:

- **PowerPoint** — drop a `.pptx`: a preview of the slides, pictures, tables and notes comes first, then one page with a heading per slide (or a page per slide). Speaker notes become a **Notes** toggle, charts a table of their data. **Present** shows it slide by slide. Read on your device; **Undo import** takes it all back in one step.
- **Claude Design** — it has no direct connection, so One takes what it exports: the **HTML** file, the **PPTX** deck and screenshots. The content comes in, and the design's palette, fonts, type scale, radii and spacing land on top as a **Design tokens** note.

Tick **Describe the screenshots with Claude** for alt text, a caption and the text in each picture (One asks before anything is sent). Tick **Save the style to One memory** and later *“#design-acme”* in a request makes Claude write in that style.

> Tip: a `.pptx` already on a page — its **AI** key → **Open as page**. A pasted Claude Design link becomes a bookmark card.
