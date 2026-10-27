---
id: workshop-startcheck
title: Workshop · Startcheck auf dem Teilnehmerrechner
section: ai
order: 23
keywords: workshop, copilot, windows, atlas, internes git, simulation, c++, angular, teilnehmer, test, evidenz
related: workshop-startampel, copilot-coding, coding-harness, personal-secrets, custom-agents, team-cloud
summary: Konto, Worker, internes Repository und Atlas vor der ersten echten Aufgabe prüfen.
---
Der Test muss auf dem Rechner stattfinden, der das interne Repository erreicht. Ein bestandener Organisatortest belegt weder den Zugang im Unternehmensnetz noch die fachliche Qualität der späteren Lösung. Zugangsdaten jeder Person bleiben persönlich; ein Workspace-Paket enthält keine persönlichen Verbindungen.

## 1 · Arbeitsbereich und Zugänge
Den vorgesehenen Team-Workspace öffnen, Namen und eigene Rolle kontrollieren. Im Workshop lesen Gäste die freigegebenen gemeinsamen Seiten mit; Bearbeiten, Einladen und Agenten-/Coding-Start bleiben gesperrt. Ein Anmeldelink allein bestätigt weder Atlas-Rechte noch den Zugriff auf interne Repositories. Atlas-Tenant, tatsächliches Projekt und eigenen Agenten separat prüfen. Keine gemeinsamen Tokens in Seiten oder Chat einfügen; persönliche Atlas-Verbindungen gehören in **Meine Secrets**.

## 2 · Worker und Modell
Vereinbarter Startstand: **Windows → Copilot zuerst, Atlas Flow optional**. Node **24** und Git sind vorhanden; zusätzlich `node --version`, `git --version`, `copilot --version` und `$PSVersionTable.PSVersion` prüfen. Die **Copilot CLI** ist erforderlich, die VS-Code-Erweiterung allein reicht nicht. GitHub nennt **PowerShell 6 oder neuer** als Windows-Voraussetzung. Die Angular-Demo benötigt Node **24.15 oder neuer**; C++ benötigt zusätzlich einen C++17-Compiler.

CLI nur falls nötig und nach Unternehmensfreigabe installieren: `winget install GitHub.Copilot` oder `npm install -g @github/copilot`. Danach `copilot login` mit dem eigenen Konto; gegebenenfalls muss die Organisation die CLI freigeben. Offizielle [Windows-Voraussetzungen und Installation](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli). Kein Umgehen von Unternehmensrichtlinien oder PowerShell-Schutz.

Unter **Einstellungen → Coding-Worker → Cloud** den **persönlich gekoppelten** aktuellen Worker **1.34.1 oder neuer** einmal herunterladen. Die Erstinstallation zeigt zwei Befehle: **installieren**, dann **festen Starter starten**. Anschließend immer den Starter nutzen; „Erneut verbinden“ lädt keine weitere Datei. Bei „(1)“ im Dateinamen die bereits heruntergeladene Datei im Installationsabschnitt auswählen, damit ONE den passenden Befehl zeigt. Nur das gewollte lokale Repository freigeben. Claude und ein eigener Modell-API-Key sind für Copilot nicht erforderlich.

Auf der lokalen Einrichtungsseite **CLI und Anmeldung prüfen (keine Modellanfrage)** drücken. Unter **Einstellungen → KI** Worker-Modelle aktualisieren und unter **Dieses Gerät → Standard für alles** GitHub Copilot mit einem tatsächlich angebotenen Modell wählen (`auto`, falls angeboten). Die Wahl bleibt auf diesem Gerät gespeichert. Aufgaben und BA-/Coding-/QA-Rollen haben unabhängige Vorgaben. Zugangsdaten bleiben in der CLI, nicht im Workspace.

Für Atlas unter **Einstellungen → KI → MCP-Server → ATLAS → Erweitert** den eigenen Zugang einrichten. Direkt bei **Verbindung prüfen** stehen jetzt Modellwahl und ein getrennter persönlicher MCP-Freigabeschalter. Copilot oder Atlas Flow auswählen und MCP bewusst erlauben; die Modellwahl allein erteilt keine Freigabe. Der Prüfschritt liest den Werkzeugkatalog; danach einen freigegebenen Record im Tenant `one` lesen. Ein persönlicher Atlas-Anmeldelink ist nicht automatisch ein Agenten-MCP-Token.

**Atlas Flow optional:** Das geteilte Workshop-Modell wählen; kein Ollama und kein eigener Modell-Key auf dem Teilnehmerrechner. Für persönliche Atlas-MCP-Aufrufe wird der eigene Worker samt eigenem Atlas-Zugang benötigt. Atlas Flow kann Text-/Codevorschläge, freigegebene ONE-Werkzeuge und MCP nutzen. Die Freigabe ist kein entfernter Coding-Worker: Repository-Pipelines laufen auf dem eigenen Laptop mit der dort gewählten Engine. Beim Gruppenvergleich Vorschläge ins Demo-Repo übernehmen und dort tatsächlich testen.

## 3 · Interner Checkout und Simulation
Den vorhandenen lokalen Checkout im Worker registrieren. Er darf auf internes Git zeigen; eine Kopie in ein externes Repository ist nicht erforderlich. Mit dem Team den genauen Arbeitsbranch, Buildbefehl, Testbefehl und die nötige Simulation vereinbaren. Diese Befehle zunächst von Hand erfolgreich ausführen. Eine leere oder nur beispielhaft eingetragene Prüfung gilt nicht als Projektnachweis.

Ein Cloud-Modell erhält freigegebene Quelltextauszüge und Werkzeugergebnisse auch dann, wenn Git intern bleibt. Den dafür geltenden Unternehmenszugang vor dem ersten echten Auftrag bestätigen. Ein rein synthetischer Texttest lässt sich unabhängig vom Kunden-Repository durchführen.

## 4 · Drei kleine Verbindungstests
1. **Text:** Einen synthetischen Funktionsfehler erklären lassen. Anbieter, Modell, Antwort und gemeldete Tokens festhalten; Copilot-Abokosten bleiben One unbekannt.
2. **Atlas:** Mit der persönlichen Verbindung genau einen freigegebenen Record im vorgesehenen Tenant/Projekt lesen. Identität, Record und Zeitpunkt festhalten. Kein unbeauftragter Schreibtest und kein automatisch ausgeführtes Sendewerkzeug.
3. **Coding:** Eine kleine freigegebene Aufgabe mit überprüfbarem Kriterium im Aufgabenbranch bearbeiten lassen. Diff prüfen und den vereinbarten echten Test ausführen. Nur tatsächliche Ergebnisse dokumentieren.

Bilder benötigen vom Konto gemeldete Bildfähigkeit. PDFs werden über Copilot als lokal ausgelesener Text verarbeitet, ohne Diagramme oder Layout; Scans benötigen einen anderen ausdrücklich gewählten Weg. Ein Texttest belegt keine Bildfähigkeit.

## 5 · Ergebnis und Rückweg
In One Briefing, Quellen, Bericht, Diff und Testbefehl sammeln. In Atlas Requirement, fachliche Entscheidung, offene Risiken und Testnachweis verknüpfen. Der Nachweis nennt Datum, ausführende Person, Commit/Branch, Umgebung, Befehl, erwartetes und tatsächliches Ergebnis. **Nicht ausgeführt** bleibt ein sichtbares Ergebnis; **bestanden** setzt einen echten Lauf voraus.

Bei fehlendem Netz, Modellzugang, Repository oder Atlas-Recht: den Lauf stoppen, Ursache und nächste zuständige Person erfassen. Mit einer ausdrücklich als synthetisch bezeichneten Übung den Ablauf trainieren; daraus keine Abnahme des realen Produkts ableiten. Die menschliche Prüfung und Integration bleiben beim Team.

Den persönlichen Stand in der [Startampel](../workshop-startampel/) festhalten: erst nach tatsächlicher Prüfung grün setzen. Ein gespeicherter Zugangslink reicht nicht.
