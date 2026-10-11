---
id: 2026-10-11-flight-recorder-eject
date: 2026-10-11
order: 1
title: Auswerfen — einen Lauf zurücknehmen, was seitdem geändert wurde, bleibt
summary: Der Flugschreiber nimmt zurück, was in einem Fenster geschrieben wurde — einen Agentenlauf, eine Terminal-Aufgabe, eine MCP-Sitzung, ein Skript — in einem Schritt, nach einem Dialog, der zeigt, was zurückgeht und was gehalten wird. Vorher eine Version, ein Rückgängig.
image: assets/shots/changelog/flight-recorder-eject.webp
alt: Das Board „Nordlicht Handoff“ nach dem Auswurf — die Spalte „Ready“ wieder da (ZURÜCK · 08:05), NL-1408 als Gehalten · Du 07:44 markiert, die Meldung „35 Stellen von Agent · Nordlicht-Spiegel zurück · 2 gehalten“ mit Rückgängig, und das Schild des Decks „Ausgeworfen 08:05“ mit Stellen, was zurückging, Papierkorb, gehalten und der Version.
help: flight-recorder, history, custom-agents
try: recorder
---
**Auswerfen.** Klammer einen Lauf auf dem Band ein, öffne den schraffierten Deckel auf dem Schild und drück **Auswerfen · 35 / 37**. Der Dialog zeigt den Plan: Schema-Teile mit Namen (*Option „Ready“ kommt zurück — Board bekommt seine Spalte wieder.*), Seiten Block für Block, Zeilen ganz, neue Zeilen in den Papierkorb.

**Gehalten, mit Grund.** Eine Stelle, die nach dem Lauf jemand geändert hat, bleibt, wie sie ist: *Status ist nicht mehr, was Nordlicht-Spiegel hinterließ: Du hast „In Arbeit“ gesetzt.* Danach trägt ihre Karte die Marke **Gehalten**.

**Sicher gebaut.** One sichert jede Seite, die sich ändert, als Version **Vor dem Auswurf**, prüft den Plan direkt vor dem Schreiben noch einmal (etwas geändert → der neue Plan wird gezeigt) und schreibt ihn dann in einem Schritt. Die Prüfung des Laufs zeigt *Ausgeworfen*, seine wartenden Vorschläge werden verworfen, und Automationen springen nicht an.

**Ein Rückgängig.** Die Meldung hat **Rückgängig** — <kbd>Mod+Z</kbd>, solange sie zu sehen ist — und das Schild behält **Auswurf zurücknehmen**, auch nach einem Neuladen. Vorerst in lokalen Arbeitsbereichen. Mehr unter [Flugschreiber](help:flight-recorder).
