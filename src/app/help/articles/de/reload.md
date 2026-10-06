---
id: reload
title: „Konnte nicht angezeigt werden“ & Updates
section: trouble
order: 1
keywords: fehler, konnte nicht angezeigt werden, störung, neu laden, kaputt, absturz, leer, aktualisiert, neue version, veraltet, error, reload
related: offline-app, export, anthropic-unreachable
summary: Ein Teil der Seite zeigt einen Fehler oder „One wurde aktualisiert …“ — fast immer hilft Neuladen.
---
## Was du sehen kannst
- **Datenbank konnte nicht angezeigt werden** — mit einem Knopf **Neu laden**, wo eine Datenbank stehen sollte.
- **Dieser Bereich hat einen Fehler.** — mit **Erneut versuchen** und **App neu laden**.
- **One wurde aktualisiert, während dieser Tab offen war. Lade neu, um Claude zu nutzen.**
- **Eine neue Version von One ist da.** — mit **Neu laden**.
- **Diagramm offline nicht verfügbar**.

## Warum
One lädt manche Teile erst, wenn du sie zum ersten Mal brauchst (Datenbankansichten, Diagramme, Claude). Geht eine neue Version online, während dein Tab offen bleibt — oder die App auf dem Home-Bildschirm nur fortgesetzt wird —, fragt der alte Tab womöglich nach einem Teil, den es auf dem Server nicht mehr gibt.

## Lösung
1. **Neu laden** klicken (oder den Tab neu laden). One sichert vorher deine Arbeit; nichts geht verloren.
2. Immer noch da? Schließ alle One-Tabs und öffne One neu.
3. Offline? Manche Teile brauchen nach einem Update einen Besuch mit Verbindung — verbinden und neu laden.

## Wenn ein Fehler bleibt
Probier **Erneut versuchen** am Bereich. Exportiere sicherheitshalber ein **Komplett-Backup** (**Workspace-Einstellungen → Daten → Workspace exportieren**) und melde das Problem mit dem Fehlertext auf [GitHub](https://github.com/MarcelWeissgerberIT/SimpleCMS/issues).
