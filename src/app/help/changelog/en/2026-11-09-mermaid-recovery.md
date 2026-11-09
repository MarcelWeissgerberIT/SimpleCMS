---
id: 2026-11-09-mermaid-recovery
date: 2026-11-09
order: 1
title: Diagrams recover independently
summary: A syntax error stays local to its diagram.
image: assets/shots/changelog/mermaid-recovery.webp
alt: A valid diagram above a readable Mermaid syntax warning.
help: editor
---

One renders each diagram in its own temporary area. A malformed diagram no longer removes another diagram’s drawing.

A syntax warning keeps the original code and provides **Check diagram code** plus expandable error details. Correcting or clearing the code clears the warning; edits are recorded as your changes.
