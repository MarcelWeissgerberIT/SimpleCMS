---
id: 2026-10-20-minimax-coding
date: 2026-10-20
order: 6
title: MiniMax in der Coding-Pipeline
summary: MiniMax M3.1 Flash je Aufgabe oder Lieferrolle wählen und denselben One-/Atlas-Harness nutzen.
image: assets/shots/changelog/minimax-coding.webp
alt: Coding-Aufgabe mit ausgewählter MiniMax-API und Hinweis zur Cloud-Übertragung.
help: coding-pipeline, workorders
try: coding
---
**MiniMax · API** steht jetzt unter Typ und getrennt für BA, Coding und QA in den Prüfauftrag-Einstellungen zur Wahl. Es nutzt die gemeinsamen Dateiwerkzeuge, Aufgaben-MCP von One, ausgewählte externe MCP-Server, Gedächtnis, Schleifengrenzen und Prüfungen durch den Worker.

Worker **1.18.0** oder neuer verwenden. Auf seiner Einrichtungsseite deinen MiniMax-Key hinterlegen, Kontextbudget von 65.536 bis 1.000.000 Tokens und Denktiefe wählen. Standard: 131.072 Tokens / high. Speichern sendet keine API-Anfrage. Der Key bleibt in einer privaten Datei beim Worker und wird nicht in One synchronisiert.

Dies ist eine Cloud-API: Ausgewählter Code, Prompts und Werkzeugergebnisse gehen an MiniMax. Kosten werden anhand veröffentlichter Tokenpreise geschätzt; bei ungewissen Antworten bleibt eine konservative Reservierung bestehen. Aufgaben- und Tagesbudgets gelten weiter. Abgeschnittene oder ungültige Aufrufe führen keine Werkzeuge aus. Es gibt keinen stillen Wechsel zu einem anderen Anbieter.

Ein kleiner synthetischer Vergleich lässt sich gezielt mit `node one-worker.mjs benchmark --agent minimax --limit 3 --budget 1` starten (US-Dollar). Ein echter Qualitätsvergleich braucht deinen Key und reale Läufe; Testantworten prüfen nur die Anbindung.
