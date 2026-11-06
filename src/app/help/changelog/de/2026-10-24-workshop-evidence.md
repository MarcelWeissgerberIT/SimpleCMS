---
id: 2026-10-24-workshop-evidence
date: 2026-10-24
title: Workshop-Nachweise gemeinsam halten
order: 1
summary: Begrenzte Copilot-Formatkorrektur, aktuelle Worker-Verbindung und bestätigte Atlas-Ablage.
image: assets/shots/changelog/workshop-evidence.png
alt: Aufgabenbegleitung mit Nachweispaket und gezielter Ablage im Workspace; simuliertes Beispiel.
help: workorders
---
Worker **1.30.0** korrigiert eine formal ungültige Copilot-Antwort höchstens einmal im selben Dialog und Zeitlimit. Verbrauch und Korrekturanzahl bleiben im Nachweis sichtbar. Nicht erlaubte Werkzeuge oder Anmelde-/Transportfehler führen weiter zum Stop.

Die Startampel trennt gespeicherte Einrichtungsprüfungen von der aktuellen Worker-Verbindung. Sie zeigt gemeldete Versionen; veraltete Verbindungsbeobachtungen werden nach 90 Sekunden als erneut zu prüfen gekennzeichnet.

Der Abschluss bietet einen JSON-Download und eine bewusst gewählte gemeinsame Zielseite. Tatsächlich gestartete Tests liefern Befehl, Commit soweit bekannt, Git-Zustand, Plattform und Zeitpunkt. Alte Nachweise werden nicht nachträglich ergänzt oder als neu geprüft dargestellt.

Die Atlas-Übergabe bleibt zunächst ein Entwurf. Nach freigegebener Ablage bestätigt ein lesender Zugriff den tatsächlichen Record, das Projekt und die genaue ONE-EVIDENCE-Kennung. Das Team entscheidet weiterhin fachlich. Bereits geteilte Nachweise bekommen einen sichtbaren Atlas-Nachtrag.
