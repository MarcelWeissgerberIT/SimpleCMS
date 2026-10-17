---
id: 2026-10-17-mcp-boards
date: 2026-10-17
order: 1
title: Claude Desktop und Claude Code – Unterseiten, Boards und Zeilen in einem Zug
summary: Über MCP sind ein Baum aus Unterseiten, ein Board mit Spalten und Karten oder 50 geänderte Zeilen ein Aufruf und eine Freigabekarte – und Agenten lesen eine Seite vollständig, jeden Block mit seinen Daten.
image: assets/shots/changelog/mcp-boards.webp
alt: Links die Freigabekarte in One – „Agent · Claude Code“, Datenbank „Board“ in Project Nordlicht anlegen, Eigenschaften Name und Status, Ansichten Board nach Status und Tabelle, 5 Zeilen jeweils mit Status Todo, Ablehnen und Freigeben; rechts das Board nach dem Freigeben unter Project Nordlicht, die fünf Aufgaben in der Spalte Todo, Doing und Done leer.
help: mcp-bridge, public-api
try: settings-mcp
---
**Eine Anfrage, eine Karte.** Sag Claude Desktop oder Claude Code *„Lege unter Projekt Nordlicht eine Unterseite mit einem Board Todo / Doing / Done an und trage diese fünf Aufgaben ein“*: Es findet das Projekt und fragt einmal. Die Karte nennt das Board, seine Spalten und jede Aufgabe; **Freigeben**, und das Board ist da. **Rückgängig** im **Agenten-Protokoll** legt es mit seinen Karten in den Papierkorb.

- **Unterseiten** – bis zu 50 in einem Aufruf, als Baum, auch unter einer Datenbankzeile; dort, wo du sie haben willst, auf Wunsch im Text der übergeordneten Seite verlinkt.
- **Boards und Datenbanken** – Ansichten, Eigenschaften und Zeilen in einem Aufruf, als Unterseite oder im Text einer Seite.
- **Zeilen im Stapel** – bis zu 50 Zeilen auf einmal anlegen oder ändern, oder eine Datenbank über einen Schlüssel mit Einträgen von anderswo abgleichen: Es ändert sich nur, was abweicht. Ein Stapel ab 5 Zeilen, der bezahlte KI-Arbeit starten oder etwas aus One hinausschicken würde, wird immer erfragt – auch bei **Direkt anwenden**.
- **Vollständig lesen** – jeder Block mit seinen Daten (Datenbanken, Dateien, Tabellen, Diagramme, Besprechungsnotizen), lange Seiten in Teilen. Kommentare nur, wenn du sie einschaltest: **Einstellungen → Agenten · MCP → Kommentare**.

Die eigenen Datenbanken von One (Gedächtnis, Mails, die Pipelines) bleiben über MCP schreibgeschützt, Vorlagen bleiben unsichtbar, und ein wiederholter Aufruf legt nie etwas doppelt an. Das braucht Brücke **1.12.0**: `one.mcpb` neu herunterladen und One nach dem Update einmal neu laden.

Auf einem Team-Server gibt es dieselben Werkzeuge unter `/mcp`. Er ändert ohne Karte, deshalb listet **Letzte MCP-Schreibvorgänge** unter **Workspace-Einstellungen → Automatisierung → API** jeden MCP-Aufruf der letzten 14 Tage mit **Zurückholen**. Mehr unter [Claude Desktop & lokales MCP](help:mcp-bridge).
