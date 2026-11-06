---
id: 2026-10-23-shared-local-model
order: 1
help: coding-harness
date: 2026-10-23
title: Ein lokales Modell für deinen Workspace
summary: Gezielte Freigabe, verschlüsselte Textanfragen und eine begrenzte Warteschlange.
---
Worker **1.29.0** kann ein lokales Modell für Mitglieder eines einzelnen Cloud-Workspaces anbieten. **Einstellungen → KI → Lokales Modell freigeben** zeigt Auswahl, Online-Status und Warteschlange. Die Freigabe lässt sich dort beenden; ein Neustart schaltet sie nicht wieder ein.

Teilnehmer wählen den Eintrag unter **Lokal · Ollama** für Textaktionen. Eine Anfrage läuft gleichzeitig; Gäste bleiben ausgeschlossen. Repository-Zugriff, Werkzeuge und persönliche Atlas-Tokens werden nicht geteilt. Der Kanal ist zunächst für Reviews und Codevorschläge gedacht. Der neue CLI-Befehl `compare-demo` vergleicht zwei kleine synthetische C++-/TypeScript-Aufgaben mit Copilot anhand identischer Eingaben und unveränderter Tests.
