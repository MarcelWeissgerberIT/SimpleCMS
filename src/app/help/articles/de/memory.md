---
id: memory
title: One-Gedächtnis
section: ai
order: 8
keywords: memory, one memory, remember, /remember, merk dir, preferences, facts, decisions, procedures, template, example, examples, #tag, pattern, usage log, memory log, recall, /no-memory, /example, Gedächtnis, One-Gedächtnis, merken, Vorlage, Beispiel, Verlauf
related: agent, ai-menu, custom-agents, claude-key, templates
summary: Claude merkt sich, was du bestätigst — Fakten, Vorlieben, Entscheidungen, Vorgehensweisen und ganze Seiten als Beispiel — und nutzt es als Vorlage für neue Aufgaben.
---
Das One-Gedächtnis ist eine Datenbank in deinem Workspace: **One-Gedächtnis**, eine Zeile je Erinnerung — ein schlichter Satz, eine **Art** (Fakt, Vorliebe, Entscheidung, Vorgehen, Beispiel), **Themen**, eine **Quelle** und **Aktiv**. Die Seite eines Vorgehens enthält seine Vorlage (Schritte, Spalten, Formulierungen). Es ist eine ganz normale Datenbank: Zeilen bearbeiten, ergänzen, **Aktiv** abhaken oder löschen — One liest, was drinsteht. In einem Team-Workspace ist sie privat: Nur du siehst sie.

## Merken — immer mit deinem OK
- **Nach einer Aufgabe im KI-Terminal** schlägt Claude 0–3 Erinnerungen vor: eine Karte **MERKEN? · 2** am Ende der Aufgabe. Auf einem Eintrag: <kbd>y</kbd> oder <kbd>Enter</kbd> merkt, <kbd>e</kbd> bearbeitet (Art, Satz, Themen, Vorlage), <kbd>n</kbd> verwirft, <kbd>a</kbd> merkt alle, <kbd>u</kbd> macht rückgängig. <kbd>Tab</kbd> in der leeren Eingabe springt zur Karte. Ohne dein OK wird nichts gespeichert.
- **Selbst:** `/merken <Satz>` (`/remember`) im Terminal; im KI-Menü eine Anfrage, die mit *merk dir …* oder *remember …* beginnt; oder Text markieren → **KI fragen → Ins Gedächtnis …** — Claude verdichtet ihn zu einem Vorschlag, den du merkst, bearbeitest oder verwirfst.
- Im Terminal kann Claude auch selbst eine Erinnerung vorschlagen (`remember`); sie steht wie jede Änderung in der Prüfliste.
- **Fast gleich** wie eine aktive Erinnerung? Der Vorschlag sagt es und bietet **Bestehende aktualisieren** statt eines zweiten Eintrags (**Als neu merken** geht trotzdem).

## Als Vorlage für neue Aufgaben
Vor jeder freien Anfrage — Aufgabe im Terminal, eigene Anfrage im KI-Menü, ⌘K `?` und eigene Agenten — wählt One Erinnerungen aus: jede aktive Vorliebe und dazu die passendsten Fakten, Entscheidungen und Vorgehensweisen (höchstens 12, etwa 3.000 Zeichen). Claude soll einem passenden Vorgehen als Vorlage folgen, **[M3]** sagen, wenn es eine Erinnerung nutzt, und es aussprechen, wenn deine Anfrage einer Erinnerung widerspricht.
- Das KI-Menü zeigt **GEDÄCHTNIS · 3** unter *Liest*; das Terminal in seinem Kopf. Ein Klick zeigt, welche Erinnerungen mitgingen (jede öffnet ihren Eintrag), den **Verlauf**, die Datenbank und den Verlauf.
- Ohne Gedächtnis für eine Anfrage: `/ohne-gedächtnis` (`/no-memory`) vor der nächsten Aufgabe, `/ohne-gedächtnis <Aufgabe>` für diese, oder **Gedächtnis für diese Anfrage verwenden** in der Liste des KI-Menüs.
- Im Terminal und in eigenen Agenten kann Claude das Gedächtnis selbst durchsuchen (`recall`).

## Seiten als Beispiel
Behalte eine Seite als **Beispiel** und lass Claude Neues danach bauen: *„nimm #wochenbericht als Vorlage und schreib den Bericht für KW 41“*.
- **Speichern:** im **⋯**-Menü der Seite → **Als Beispiel ins Gedächtnis**, `/beispiel <Tag>` (`/example`) im Terminal, oder Blöcke markieren → **KI fragen → Als Beispiel merken …**. Gib ihm einen **Tag** (a–z, 0–9, -), optional wofür es ist und Themen. Hast du auf der Seite Blöcke für Claude markiert, werden nur diese zum Beispiel.
- Claude beschreibt das **Muster** (Abschnitte, Spalten, Ton, Länge); der Eintrag behält es und darunter eine Kopie des **Beispiels** — eingebettete Datenbanken als ihre Spalten und bis zu 5 Zeilen. Beides kannst du bearbeiten.
- **Nutzen:** nenne es in einer Anfrage — `#wochenbericht` oder den Tag als Wort. Das ganze Beispiel geht mit (bis zu 10.000 Zeichen), mit *gleiche Struktur, neue Fakten*. Tippe `#` im Terminal oder im KI-Menü, um einen Tag zu wählen; ein unbekannter `#tag` wird angezeigt, die Anfrage läuft ohne.
- Ein vergebener Tag bietet an, das bestehende Beispiel zu **ersetzen**.
- **Vorlage oder Beispiel?** Eine [Vorlage](help:templates) kopiert eine Seite 1:1. Ein Beispiel ist ein Muster, dem Claude mit neuem Inhalt folgt.

## Verlauf: was wann verwendet wurde
Neben dem Gedächtnis gibt es eine zweite Datenbank, **Gedächtnis-Verlauf**: eine Zeile je Anfrage, die Erinnerungen mitnahm — wann, wo (KI-Terminal, KI-Menü, ⌘K, *Agent · Name*), die Anfrage, wie du sie getippt hast, die Seite, **Erinnerungen** (alle, die mitgingen) und **Zitiert** (die Claude zitiert hat). Öffne eine Erinnerung und du siehst **Verwendet in** und **Zitiert in** mit jeder Anfrage; **Verwendungen** und **Zuletzt verwendet** zählen die Zitate.
- Der Verlauf behält die neuesten 500 Zeilen; ältere wandern in den **Papierkorb** (nie endgültig gelöscht).
- Er speichert, was du getippt hast, und Links — nie Seiteninhalt oder Claudes Antwort.

## Einstellungen
**Einstellungen → Claude AI → One-Gedächtnis** (je Gerät): **Gedächtnis verwenden**, **Nach Aufgaben im KI-Terminal Erinnerungen vorschlagen** (standardmäßig an, sobald das Gedächtnis eingerichtet ist — eine kleine zusätzliche Anfrage je Aufgabe), **Verlauf führen** (aus: keine neuen Zeilen; vorhandene bleiben), **Gedächtnis einrichten** und Links zu beiden Datenbanken.

> Erinnerungen gehen mit den Anfragen an Anthropic, für die sie ausgewählt werden — wie der Seitentext, den du mitschickst. Halte Geheimnisse aus dem Gedächtnis heraus.
