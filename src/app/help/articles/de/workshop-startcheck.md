---
id: workshop-startcheck
title: Workshop · Startcheck auf dem Teilnehmerrechner
section: ai
order: 23
keywords: workshop, copilot, windows, atlas, internes git, simulation, c++, angular, teilnehmer, test, evidenz
related: copilot-coding, coding-harness, personal-secrets, custom-agents, team-cloud
summary: Konto, Worker, internes Repository und Atlas vor der ersten echten Aufgabe prüfen.
---
Der Test muss auf dem Rechner stattfinden, der das interne Repository erreicht. Ein bestandener Organisatortest belegt weder den Zugang im Unternehmensnetz noch die fachliche Qualität der späteren Lösung. Zugangsdaten jeder Person bleiben persönlich; ein Workspace-Paket enthält keine persönlichen Verbindungen.

## 1 · Arbeitsbereich und Zugänge
Den vorgesehenen Team-Workspace öffnen, Namen und eigene Rolle kontrollieren. Gäste erhalten nur den bestätigten Gastbereich. Ein Anmeldelink allein bestätigt weder Atlas-Rechte noch den Zugriff auf interne Repositories. Atlas-Tenant, tatsächliches Projekt und eigenen Agenten separat prüfen. Keine gemeinsamen Tokens in Seiten oder Chat einfügen; persönliche Atlas-Verbindungen gehören in **Meine Secrets**.

## 2 · Worker und Modell
Den aktuellen Worker herunterladen und auf demselben Laptop starten. Worker **1.26.0** enthält Copilot-Text, Werkzeuge und die bedingte Medien-Unterstützung. Unter **Einstellungen → Coding-Worker** verbinden; bei mehreren Workspaces die bewusste Freigabe dieses Arbeitsbereichs prüfen. Auf Windows die dort angebotenen Downloads und Tastenkürzel verwenden.

Für GitHub Copilot CLI ab **1.0.102** installieren, `copilot login` ausführen und die Anmeldung selbst bestätigen. In der lokalen Einrichtung **CLI und Anmeldung prüfen (keine Modellanfrage)** drücken. Nur tatsächlich angebotene Modelle verwenden; ein Free-Konto kann ausschließlich `auto` anzeigen. Die Desktop-App und die CLI können unterschiedliche Zugangsbedingungen haben. Der Prüfschritt kauft kein Abo und sendet keinen Projektprompt.

Unter **Einstellungen → KI** die Worker-Modelle aktualisieren. Anbieter und Modell für die einzelne Anfrage wählen; Freigaben für Seite, Datei und MCP separat setzen. Die Coding-Agent-Auswahl einer Pipeline-Aufgabe ist unabhängig vom Standard für Browser-Agenten und Textaktionen.

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
