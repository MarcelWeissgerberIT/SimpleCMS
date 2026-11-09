---
id: 2026-11-09-connection-recovery
date: 2026-11-09
order: 2
title: Kurze Serverunterbrechungen auffangen
summary: Laufnachweise versuchen das Speichern erneut; KI-Aufrufe bleiben angehalten.
image: assets/shots/changelog/connection-recovery.webp
alt: Ein angehaltener Terminalauftrag mit gespeichertem Nachweis und Verbindungshinweis.
help: agent
try: terminal
---
Bei einem vorübergehenden Gateway-Fehler erklärt das Terminal die Unterbrechung. Der KI-Aufruf wird nicht automatisch wiederholt.

Das Speichern desselben privaten Laufnachweises wird bei HTTP 502, 503 oder 504 zweimal nach kurzer Pause erneut versucht. Dabei wird nur der vorhandene Nachweis gespeichert; Werkzeuge und Inferenz laufen nicht erneut. Scheitert das Speichern weiterhin, lass den Tab offen und nutze **Nachweis erneut speichern**.

Bei Dokument-Analysen wird das Seitenende ausdrücklich gemeldet. Ein Leseversuch hinter dem Seitenende erklärt jetzt die ungültige Position, ohne bereits gelesene Quellen zu verwerfen. Werkzeugfehler erscheinen mit ihrer Ursache im Log; der Laufstatus benennt bei One-Ausführung das gewählte Modell statt eines lokalen Workers.
