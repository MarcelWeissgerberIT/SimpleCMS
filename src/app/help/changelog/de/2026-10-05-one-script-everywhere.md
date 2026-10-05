---
id: 2026-10-05-one-script-everywhere
date: 2026-10-05
order: 1
title: One Script überall — Befehle, Schaltflächen, Gmail, Claude
summary: Führe deine Skripte über die Befehle einer Datenbank, eine Schaltfläche, eine Automatisierung oder ⌘K aus; sende Mails über Gmail; lass Claude Abfragen und Skripte für dich schreiben.
image: assets/shots/changelog/one-script-everywhere.webp
alt: Eine Abfrage im Skript-Editor, rechts „Claude fragen“ mit einer Bitte und Claudes geprüftem Entwurf — jetzt drei Zeilen, Übernehmen
help: one-script, database-commands, buttons, mcp-bridge
---
Deine Skripte laufen jetzt dort, wo du arbeitest:

- **Datenbankbefehle** — *Befehle bearbeiten… → Befehl hinzufügen → Skript ausführen*. Mit ausgewählten Zeilen auf der Datenbankseite läuft es einmal pro Zeile (`page.current` ist die Zeile).
- **Schaltflächen** — die Aktion *Skript ausführen*, oder tippe `/script` für eine Schaltfläche, die eines ausführt. **Automatisierungen** — *Skript ausführen* für die Zeile, die sich geändert hat. **⌘K** — *Skript ausführen: <Name>* für die geöffnete Seite.
- **Gmail** — ist es verbunden, sendet `mail.send` von deinem Konto (die Liste vor dem Lauf sagt *über Gmail*); Google fragt einmal nach der Erlaubnis zu senden.

**Claude fragen** steht über dem Abfrage-Baukasten und der Referenz: beschreibe, was du willst, Claude entwirft den Code, One prüft ihn, bevor du ihn siehst — **Übernehmen** setzt ihn ein. Im KI-Terminal beantwortet Claude Fragen über Datenbanken hinweg mit einer lesenden Abfrage und entwirft Skripte zur Prüfung; mit dem One MCP können Claude Desktop oder Code eine Abfrage oder eines deiner gespeicherten Skripte ausführen — immer erst, nachdem du den Probelauf freigegeben hast. Siehe [One Script](help:one-script).
