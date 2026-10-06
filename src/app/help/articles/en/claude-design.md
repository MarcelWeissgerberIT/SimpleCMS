---
id: claude-design
title: From Claude Design to One
section: share
order: 5
keywords: claude design, design, design tokens, style, style guide, palette, colours, colors, fonts, type scale, radius, spacing, html export, pptx export, screenshot, mockup, prototype, handoff, #design, Stil, Farben, Schriften, Übergabe
related: import, memory, media-embeds, ai-menu
summary: Bring a design from Claude Design into One — its HTML or PPTX export and screenshots — with the colours, fonts and sizes kept as a note and, if you like, in One memory.
---
Claude Design has **no direct connection** to One: there is no API to log into. What it gives you are exports — an **HTML** file (one file, styles inline), a **PowerPoint** deck — and screenshots. One takes all three in one step: **Import** → **Claude Design**.

## The three exports
Add them to the slots, or drop them anywhere on the step — each file goes to its slot.
- **HTML export** (`.html`, or a `.zip` with its files): the content comes in like any web page — headings, text, lists, tables, pictures (pictures inside the file are stored on this device). Scripts and forms stay out; inline SVG graphics are left out and listed in the import report.
- **PPTX export** (`.pptx`): the deck becomes its own page under the design page, ready for **Present** — see [Import](help:import) for what a deck carries over.
- **Screenshots** (PNG, JPEG, WebP — several at once): they come in as pictures under a heading **Screenshots**.

## The style note
From the HTML's CSS (custom properties, inline styles, Google Fonts) and the deck's theme, One reads the design's **tokens** and shows them before you import: the palette with a role for each colour (background, text, primary, accent …), the fonts for headings, body and code, the type scale, the radii and the spacing grid.
On the page they sit on top as a closed toggle **Design tokens**: a table with a swatch, the hex code, the role and the token name per colour, then fonts, sizes, radii and spacing. The swatch shows the nearest of One's colours — the hex code is the real one.

## Describe the screenshots with Claude
Tick **Describe the screenshots with Claude** (it needs your [Claude key](help:claude-key)) and One asks first: a second press on **Send & import** sends each screenshot to Anthropic. Claude writes the alt text and a caption and reads out the text in the picture — it lands in a toggle **Text in the screenshot** below it. Without the tick nothing is sent.

## Keep the style in One memory
Tick **Save the style to One memory** and give it a tag (the default is `design-` + the name). The style is saved as an **Example** in your [One memory](help:memory): the style note as its pattern, the first lines of the content as its example. Later, name it in a request — *“write the launch mail in #design-acme”* — in the AI terminal or the AI menu, and Claude writes and formats in that style. A tag that exists is replaced.

## Links to a design
A shared Claude Design link pasted on an empty line offers **Bookmark** first: the site cannot be embedded, so it becomes a card that opens the design in Claude.

> **Undo import** in the last step removes the page, its sub-page and the memory entry in one step.
