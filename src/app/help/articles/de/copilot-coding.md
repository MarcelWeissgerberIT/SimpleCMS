---
id: copilot-coding
title: GitHub Copilot in One
section: ai
order: 22
keywords: copilot, github, enterprise, internes git, windows, c++, angular, abonnement, atlas, modell
related: coding-pipeline, coding-harness, personal-secrets, mcp-servers
summary: Die lokale Copilot-CLI-Anmeldung für Ones KI-Aktionen, Browser-Agenten und Coding-Harness nutzen.
---
Unter **Coding-Agent** einer Aufgabe **GitHub Copilot** wählen oder für eine Prüfauftragsrolle festlegen. Dafür wird Worker **1.25.0** oder neuer benötigt; ältere Worker können nicht stillschweigend Claude einsetzen. Der Worker bietet Copilot auch als KI-Anbieter für One an. Coding-Aufgaben behalten ihre eigene Engine-Auswahl; Workspace-Funktionen nutzen die gemeinsame Anbieter-/Modellauswahl und KI-Regeln. Die Anmeldung ändert keine Standards und erteilt keine Datenfreigaben.

## Auf dem Teilnehmerrechner einrichten
GitHub Copilot CLI **ab 1.0.102** auf demselben Rechner wie den One-Worker installieren und mit `copilot login` lokal anmelden. Das Konto benötigt einen passenden Copilot-Zugang und die Unternehmensfreigabe für CLI und gewähltes Modell. Ein IDE-Abo beweist diese Voraussetzungen noch nicht. `COPILOT_BIN` kann auch unter Windows auf eine CLI außerhalb von PATH zeigen.

**Copilot einrichten** an der Coding-Aufgabe oder die lokale Worker-Einrichtungsseite öffnen. **CLI und Anmeldung prüfen (keine Modellanfrage)** prüft installierte CLI, Anmeldung und verfügbaren Modellkatalog. Dabei startet kein Coding-Auftrag und es wird kein Seiten- oder Repository-Prompt gesendet. Eine verfügbare exakte Modell-ID wählen oder `auto` belassen, wenn das Konto es anbietet. Auch Copilot Free kann damit für einen kleinen Texttest genutzt werden; die Desktop-App kann eine andere Aboberechtigung verlangen. Maßgeblich sind die CLI-Prüfung und dein Konto, nicht die Anmeldung in der App allein. **Copilot-Modell speichern** speichert ausschließlich diese Vorgabe in der privaten `copilot.json` des Workers. `ONE_COPILOT_MODEL` hat Vorrang. Ein fest gewähltes, für das Konto nicht verfügbares Modell wird abgewiesen; One wechselt nicht stillschweigend.

Zugangsdaten bleiben in der eigenen Copilot-CLI-Anmeldung oder unterstützten Umgebungsvariablen wie `COPILOT_GITHUB_TOKEN`. Tokens nicht in Aufgabentext oder Modellfeld einfügen. One exportiert diese Zugangsdaten nicht und speichert sie nicht im Workspace.

## Internes Git, Atlas und Ausführung
Der vorhandene lokale Checkout darf auf internes Git zeigen. Er muss nicht in externes Git kopiert werden: Der Worker legt einen Aufgaben-Worktree an und verwendet den vorhandenen Repository-Zugang dieses Rechners. Lokaler Build und Simulation müssen dort funktionieren; den tatsächlichen Analyse-/Testbefehl des Projekts konfigurieren. Ausgewählte Quelltextausschnitte und Werkzeugergebnisse gehen weiterhin unter den Unternehmensregeln an den Copilot-Dienst. Ein internes Repository hält den Modellkontext nicht automatisch auf dem Laptop.

One führt den Ablauf: begrenzter Aufgabenkontext, Gedächtnis, Quellenlesen, abgesicherte Änderungen, konfigurierte Prüfungen und Abschlussnachweise. Copilot liefert über sein lokales SDK-Protokoll den nächsten strukturierten Harness-Schritt. Native Copilot-Werkzeuge, Repository-Konfigurationssuche, Datei-Hooks, Skills, sitzungsübergreifender Speicher und Remote-Sitzungsexport sind ausgeschaltet. Durch eine Modellanforderung entsteht kein Shell-Zugang. Planungs-/Dokumentstufen erhalten nur lesende Werkzeuge; Umsetzung kann Quelltext ändern und ausschließlich konfigurierte Prüfungen starten. Git-Commit, Push und Integration bleiben ausdrückliche Pipeline-Stufen.

Für einen persönlichen Atlas-Agenten dessen eigene Verbindung und die benötigten Werkzeuge über **Meine Secrets** an der Aufgabe auswählen. Der auf diesen Lauf begrenzte MCP-Proxy des Workers übernimmt die Verbindung; Copilot erhält Werkzeugschemata und bereinigte Ergebnisse, niemals das Atlas-Token. Lesende Stufen erhalten nur lesende Atlas-Werkzeuge. Dieser Weg benötigt keine Claude-Installation. Rollenprofil, gewählter Tenant und Atlas-Rechte auf dem Server bleiben getrennt zu prüfen.

## Grenzen und Workshop-Test
Copilot-Abonutzung ist **kein USD-Kostennachweis**. One weist sie nicht als kostenlos aus und kann Dollargrenzen gegen diesen Tarif nicht durchsetzen. Schritt-/Zeitgrenzen der Stufe, Wiederholungserkennung und konfigurierte Prüfungen bleiben aktiv. Das anfängliche Kontextbudget des Harness beträgt 32.768 Tokens; gezieltes Nachladen und Aufgabengedächtnis gelten weiter. Das ist eine vorsichtige Harness-Grenze, keine Angabe zum maximalen Modellkontext.

Für die Live-Übung einen kleinen realen Auftrag mit eigener Teilnehmeranmeldung im freigegebenen Netz ausführen: vorgesehenen Atlas-Record lesen, Änderung planen, im Branch umsetzen, Simulation/Tests ausführen und tatsächliche Nachweise verlinken. Verfügbares Modell und Unternehmensbeschränkungen auf genau diesem Rechner prüfen. Bestandene lokale One-Tests bestätigen weder den Zugang im Kundennetz noch garantieren sie die Qualität erzeugten Codes.

## Copilot in One verwenden
**Einstellungen → KI → Modelle beim Worker** öffnen, die Liste aktualisieren und prüfen, ob deine angemeldeten Copilot-Modelle erscheinen. Für **GitHub Copilot** nur die gewünschten Datenklassen freigeben; persönliche Daten und MCP benötigen eigene Freigaben auf diesem Gerät. In One wird kein Copilot-API-Key hinterlegt. Über den Anbieter vor dem Modell kannst du Copilot für eine einzelne Anfrage wählen oder als Standard dieses Workspace/Geräts speichern. Ein eigener Browser-Agent kann ein eigenes Copilot-Modell fest hinterlegen.

| Bereich | Unterstützter Weg |
| --- | --- |
| Schreiben, Fragen, Workspace-Suche und Hilfe | Gemeinsame Anbieter-/Modellauswahl |
| Datenbank-Umwandlung, Autofill, Übersetzungen, Besprechungszusammenfassung, Gedächtnisvorschläge, Skriptentwürfe und Auftragsplanung | Text oder anhand des Schemas geprüftes JSON; fehlerhafte Ausgaben werden vor Änderungen abgewiesen |
| KI-Terminal und Browser-Agenten | One führt die vorhandenen Werkzeuge im erlaubten Bereich aus und nutzt den bestehenden Prüf-/Übernahmeablauf |
| Atlas und andere ausgewählte Remote-MCP-Server | Ones Worker verbindet sich mit den ausgewählten Zugangsdaten; Copilot erhält Schemata und bereinigte Ergebnisse, keine Tokens |
| Coding-Pipeline | Gemeinsamer Coding-Harness, konfigurierte Tests, ausdrückliche Git-Stufen |
| Bilder | Ab Worker 1.26.0 bei vom Konto gemeldeter Bildfähigkeit; ausgewählte Bilder als Speicher-Anhänge, höchstens vier / zusammen 3 MiB und innerhalb der Modellgrenzen |
| PDFs | Ab Worker 1.26.0 lokal ausgelesener Text, höchstens 100 Seiten / 120.000 Zeichen; keine Bilder, Diagramme, Seitenlayout oder OCR; Scans und gekürzte Dokumente werden vor der Anfrage abgewiesen |
| Native PDF-Bildprüfung, Bilderzeugung und Jev-Entscheidungen | Über diesen Copilot-Weg nicht unterstützt; ausdrücklich einen passenden Anbieter wählen |
| Unbeaufsichtigte Teamserver-Agenten bei geschlossenem Browser/Worker | Durch die persönliche Copilot-Verbindung nicht bereitgestellt |

Für Browser-MCP gelten die unter **Einstellungen → KI / Agenten · MCP** gewählten Server und die genaue Werkzeugfreigabe des Agenten. OUT-/Sendewerkzeuge der Integrationen bleiben aus. Der Worker akzeptiert nur ausgewählte öffentliche HTTPS-Verbindungen, keine Startbefehle oder zusätzlichen Header. Stoppen, Verbindungsende und Workspace-Wechsel brechen laufende Worker-Anfragen ab. Textanfragen lesen keine Repository-Dateien; Workspace-Werkzeuge lesen ausschließlich den erlaubten One-Inhalt. Ein Anbieterwechsel im Terminal startet die nächste Aufgabe mit frischem Modellkontext; bisherige Vorschläge bleiben zur Prüfung erhalten. Folgeaufgaben beim gleichen Anbieter behalten ihr Gespräch. Einen begrenzten Lauf beim bisherigen Anbieter fortsetzen oder nach dem Wechsel eine neue Aufgabe senden. Bilder werden nur bei tatsächlich gemeldeter Bildfähigkeit angeboten. PDF-Antworten beziehen sich ausschließlich auf den lokal ausgelesenen Text; der Dialog weist auf fehlende Abbildungen und fehlendes Layout hin. Ein Free-Katalog mit nur `auto` bedeutet keine zusätzliche Bildfreigabe.

Browser-Anfragen nutzen höchstens 65.536 Kontext-Tokens bei ausreichender gemeldeter CLI-Kapazität, sonst ein vorsichtiges Budget von 32.768 Tokens; Werkzeugbeschreibungen werden gekürzt und MCP-Schemata gezielt gesucht. Werkzeug-/Rundengrenzen, wiederholte Aufrufe, Abbruch und fehlender Kontext beenden einen Lauf. Vorhandener Tokenverbrauch wird pro Antwort erfasst; Geldkosten bleiben unbekannt statt als null verbucht zu werden. Dollarbudgets können ein Copilot-Abo nicht messen. Ein echter Konto-/Modell-/Netzwerktest bleibt auf jedem Workshop-Laptop erforderlich.

## Dienstag arbeitsfähig starten
Der [Workshop-Startcheck](help:workshop-startcheck) führt durch Konto, Worker, internes Git, Modelltest, Atlas-Verbindung und Testnachweise. Jede Person verwendet ihre eigenen Zugänge. Ein Test am Organisatorrechner ersetzt den Test auf dem Teilnehmerlaptop nicht.
