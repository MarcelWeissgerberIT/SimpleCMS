---
id: copilot-coding
title: GitHub Copilot im Coding-Worker
section: ai
order: 22
keywords: copilot, github, enterprise, internes git, windows, c++, angular, abonnement, atlas, modell
related: coding-pipeline, coding-harness, personal-secrets, mcp-servers
summary: Die lokale Copilot-CLI-Anmeldung als Modellzugang für Ones Coding-Harness nutzen.
---
Unter **Coding-Agent** einer Aufgabe **GitHub Copilot** wählen oder für eine Prüfauftragsrolle festlegen. Dafür wird Worker **1.24.0** oder neuer benötigt; ältere Worker können nicht stillschweigend Claude einsetzen. Die Anbindung gilt für Coding-, Planungs- und Dokumentstufen im Worker. Browser-Agenten und KI-Terminal behalten ihre eigenen Anbietereinstellungen; eine Copilot-Lizenz richtet diese nicht automatisch ein.

## Auf dem Teilnehmerrechner einrichten
GitHub Copilot CLI **ab 1.0.102** auf demselben Rechner wie den One-Worker installieren und mit `copilot auth login` lokal anmelden. Das Konto benötigt einen passenden Copilot-Zugang und die Unternehmensfreigabe für CLI und gewähltes Modell. Ein IDE-Abo beweist diese Voraussetzungen noch nicht. `COPILOT_BIN` kann auch unter Windows auf eine CLI außerhalb von PATH zeigen.

**Copilot einrichten** an der Coding-Aufgabe oder die lokale Worker-Einrichtungsseite öffnen. **CLI und Anmeldung prüfen (keine Modellanfrage)** prüft installierte CLI, Anmeldung und verfügbaren Modellkatalog. Dabei startet kein Coding-Auftrag und es wird kein Seiten- oder Repository-Prompt gesendet. Eine verfügbare exakte Modell-ID wählen oder `auto` für den Copilot-Kontostandard belassen. **Copilot-Modell speichern** speichert ausschließlich diese Vorgabe in der privaten `copilot.json` des Workers. `ONE_COPILOT_MODEL` hat Vorrang. Ein fest gewähltes, für das Konto nicht verfügbares Modell wird abgewiesen; One wechselt nicht stillschweigend.

Zugangsdaten bleiben in der eigenen Copilot-CLI-Anmeldung oder unterstützten Umgebungsvariablen wie `COPILOT_GITHUB_TOKEN`. Tokens nicht in Aufgabentext oder Modellfeld einfügen. One exportiert diese Zugangsdaten nicht und speichert sie nicht im Workspace.

## Internes Git, Atlas und Ausführung
Der vorhandene lokale Checkout darf auf internes Git zeigen. Er muss nicht in externes Git kopiert werden: Der Worker legt einen Aufgaben-Worktree an und verwendet den vorhandenen Repository-Zugang dieses Rechners. Lokaler Build und Simulation müssen dort funktionieren; den tatsächlichen Analyse-/Testbefehl des Projekts konfigurieren. Ausgewählte Quelltextausschnitte und Werkzeugergebnisse gehen weiterhin unter den Unternehmensregeln an den Copilot-Dienst. Ein internes Repository hält den Modellkontext nicht automatisch auf dem Laptop.

One führt den Ablauf: begrenzter Aufgabenkontext, Gedächtnis, Quellenlesen, abgesicherte Änderungen, konfigurierte Prüfungen und Abschlussnachweise. Copilot liefert über sein lokales SDK-Protokoll den nächsten strukturierten Harness-Schritt. Native Copilot-Werkzeuge, Repository-Konfigurationssuche, Datei-Hooks, Skills, sitzungsübergreifender Speicher und Remote-Sitzungsexport sind ausgeschaltet. Durch eine Modellanforderung entsteht kein Shell-Zugang. Planungs-/Dokumentstufen erhalten nur lesende Werkzeuge; Umsetzung kann Quelltext ändern und ausschließlich konfigurierte Prüfungen starten. Git-Commit, Push und Integration bleiben ausdrückliche Pipeline-Stufen.

Für einen persönlichen Atlas-Agenten dessen eigene Verbindung und die benötigten Werkzeuge über **Meine Secrets** an der Aufgabe auswählen. Der auf diesen Lauf begrenzte MCP-Proxy des Workers übernimmt die Verbindung; Copilot erhält Werkzeugschemata und bereinigte Ergebnisse, niemals das Atlas-Token. Lesende Stufen erhalten nur lesende Atlas-Werkzeuge. Dieser Weg benötigt keine Claude-Installation. Rollenprofil, gewählter Tenant und Atlas-Rechte auf dem Server bleiben getrennt zu prüfen.

## Grenzen und Workshop-Test
Copilot-Abonutzung ist **kein USD-Kostennachweis**. One weist sie nicht als kostenlos aus und kann Dollargrenzen gegen diesen Tarif nicht durchsetzen. Schritt-/Zeitgrenzen der Stufe, Wiederholungserkennung und konfigurierte Prüfungen bleiben aktiv. Das anfängliche Kontextbudget des Harness beträgt 32.768 Tokens; gezieltes Nachladen und Aufgabengedächtnis gelten weiter. Das ist eine vorsichtige Harness-Grenze, keine Angabe zum maximalen Modellkontext.

Für die Live-Übung einen kleinen realen Auftrag mit eigener Teilnehmeranmeldung im freigegebenen Netz ausführen: vorgesehenen Atlas-Record lesen, Änderung planen, im Branch umsetzen, Simulation/Tests ausführen und tatsächliche Nachweise verlinken. Verfügbares Modell und Unternehmensbeschränkungen auf genau diesem Rechner prüfen. Bestandene lokale One-Tests bestätigen weder den Zugang im Kundennetz noch garantieren sie die Qualität erzeugten Codes.
