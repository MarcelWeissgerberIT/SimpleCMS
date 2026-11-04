---
id: 2026-11-04-skills-command
date: 2026-11-04
order: 121
title: /skills öffnet die Skill-Vorschau
summary: Skill-Bibliothek per Befehl im Terminal, im KI-Dialog und direkt auf der Seite öffnen.
---

`/skills` und Enter öffnet die Skill-Bibliothek im KI-Terminal. Schon bei `/ski` erscheint die Vervollständigung mit Beschreibung; Tab ergänzt den Befehl, ein Klick öffnet direkt die Bibliothek. `/skills name` öffnet sie mit einer passenden Suche. Auch `/skill`, `/fähigkeiten` und `/faehigkeiten` funktionieren.

Im KI-Seitendialog bietet `/skills` denselben lokalen Einstieg. Direkt in einer leeren Seitenzeile zeigt `/skills` einen Slashmenü-Eintrag samt Vorschau. Enter öffnet die Bibliothek und übernimmt nach Auswahl den Skill in den KI-Dialog. Der Slashtext wird dabei entfernt; vorhandener Seiteninhalt bleibt erhalten.

Beim Öffnen wird der erste passende gespeicherte Skill mit Version und Anleitung angezeigt. Bei einer leeren Bibliothek kannst du eine Anleitung erstellen oder importieren; bei einer erfolglosen Suche steht ein konkreter Hinweis. Erst **Zum Auftrag hinzufügen** wählt einen Skill für die nächste Anfrage. Das Öffnen funktioniert ohne Modellschlüssel, startet keine Inferenz und beantwortet keine wartende menschliche Rückfrage.
