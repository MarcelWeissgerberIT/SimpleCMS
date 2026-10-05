---
id: 2026-10-05-ai-terminal
date: 2026-10-05
order: 15
title: Das KI-Terminal
summary: Gib Claude Aufgaben per Tastatur — es dockt unter der Seite an, arbeitet auch ausgeblendet weiter und wartet auf deine Prüfung.
image: assets/shots/changelog/ai-terminal.webp
alt: Das KI-Terminal unter einer Seite: die Aufgabe, Claudes Protokoll und ein neues Board mit Einträgen, die auf Prüfung warten
help: agent, ai-menu, mcp-servers
try: terminal
---
Drück <kbd>Mod+J</kbd> und schreib eine Aufgabe in deinen Worten — *„Mach ein Board aus den offenen Punkten dieser Seite“*. Das Terminal dockt unter der Seite an, die Seitenleiste bleibt. Claude liest deine Seiten und Datenbanken, zeigt jeden Schritt als Zeile im Protokoll und **schlägt** die Änderungen vor: Neue Seiten, Einträge, Datenbanken und Eigenschaften landen in einer Prüfliste. Geschrieben wird erst, wenn du übernimmst.

- **Prüfen per Tastatur:** <kbd>j</kbd> / <kbd>k</kbd> bewegen, <kbd>Leertaste</kbd> markiert, <kbd>Enter</kbd> übernimmt, <kbd>a</kbd> übernimmt alle, <kbd>d</kbd> verwirft. Ein **Rückgängig** nimmt einen ganzen Stapel zurück.
- **Arbeitet weiter:** Blende es mit <kbd>Esc</kbd> aus — die LED in der Statusleiste zeigt *KI · arbeitet*, eine Meldung sagt Bescheid, wenn es fertig ist.
- **Referenzen:** Text markieren, dann **Zum Terminal** oder <kbd>Mod+Shift+J</kbd>. Mit `@` nimmst du eine Seite oder Datenbank als Kontext dazu.
- **Befehle:** `/übernehmen`, `/stopp`, `/kosten`, `/hilfe` — englisch geht auch: `/apply`, `/help`.

> Tipp: <kbd>↑</kbd> in der ersten Zeile holt frühere Aufgaben zurück — die letzten 50, auf diesem Gerät.
