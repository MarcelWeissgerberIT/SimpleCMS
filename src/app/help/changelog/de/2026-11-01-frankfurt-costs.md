---
id: 2026-11-01-frankfurt-costs
date: 2026-11-01
order: 1
title: Frankfurter Betriebskosten Aufgaben zuordnen
summary: Eine private Host-Schätzung trennt Modellbelegung, Speicher und nicht zugeordnete Rechenkosten.
image: assets/shots/changelog/frankfurt-costs.webp
alt: Frankfurter Betriebskostenübersicht mit Host-Summen und der Zuordnung zu einem Workspace.
help: ai-costs
try: settings-ai
---
Als eingetragener Testverantwortlicher öffnest du **Einstellungen → KI → Atlas Flow · Frankfurt → Mein vollständiges Testprotokoll → Betriebskosten**. Die Übersicht schätzt VM-, GPU- und Speicherkosten seit dem aktuellen VM-Start anhand eines datierten Kostensatzes am Host.

Abgeschlossene Modellrunden inklusive fehlgeschlagener Versuche werden je Aufgabe und Workspace zusammengefasst. Warte- und Werkzeugzeit zählen nicht mit. Nicht zugeordnete Rechenkosten enthalten Leerlauf und fehlende Protokolle; sie werden nicht als reiner Leerlauf bezeichnet. Speicher bleibt Host-Kosten.

Ein JSON-Download sichert den vollständigen Stand mit Zeitraum und Berechnungsgrundlage. Die Anzeige ist eine Schätzung, keine Cloud-Rechnung oder Nutzerbelastung. IPv4, Snapshots, Datenverkehr und Steuern fehlen darin. KI-Tokenbudgets bleiben getrennt.
