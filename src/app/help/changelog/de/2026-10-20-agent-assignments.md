---
id: 2026-10-20-agent-assignments
date: 2026-10-20
order: 6
title: Einmalaufträge für deine Agenten
summary: Pro Lauf eine Zielseite wählen, den Weg im Schaltplan verfolgen und Berichte passend ablegen.
image: assets/shots/changelog/agent-assignments.webp
alt: Dialog für einen Agentenlauf mit gewählter Zielseite und einem einmaligen Analyseauftrag.
help: custom-agents, patchbay
try: agents
---
Öffne **Agent auf dieser Seite ausführen …** in den Seitenoptionen oder **Auftrag & Ziel …** neben dem Schnellstart des Agenten. Wähle Agent, Zielseite und optional einen Einmalauftrag. Er gilt nur für diesen Lauf; gespeicherte Anweisungen, Werkzeuge, Bereich, Schreibmodus, Budget und Freigaben bleiben wirksam. Ein nicht zugängliches Ziel verhindert den Start.

Einmalläufe behalten Auftrag und Zielseite in der Laufhistorie. Sie verändern keinen Cursor des wiederkehrenden Auftrags, ersetzen keine älteren Vorschläge und schreiben nicht automatisch auf dessen Standard-Berichtsseite. Der nächste Schnell- oder Zeitplanstart verwendet wieder den gespeicherten Auftrag. Server-Agenten brauchen einen Server mit `agent-invocation`; bei älteren Servern wird vor dem Start abgebrochen.

**Schaltplan → Manuelle Agentenaufträge** zeigt Zielseite → Agent → Ergebnis, Status und letzte Werkzeugaufrufe. Der Ergebnislink öffnet den konkreten Lauf. Nach dem Ablegen des Berichts führt er stattdessen zum Ablageziel.

Wähle bei einem fertigen Bericht **Bericht ablegen …**: neue Seite erstellen, an eine bestehende Seite anhängen oder einen Eintrag in einer gewöhnlichen Datenbank anlegen. Vorhandener Text bleibt erhalten. Verweise führen zum Lauf und zur Quellseite zurück. Gesperrte Seiten, Vorlagen und System-/Pipeline-Datenbanken sind ausgeschlossen. Der Ablagelink wird auf diesem Gerät gemerkt; die Seite oder der Eintrag selbst gehört zum Arbeitsbereich.
