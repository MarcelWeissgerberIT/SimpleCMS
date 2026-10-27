---
id: copilot-coding
title: GitHub Copilot in One
section: ai
order: 22
keywords: copilot, github, enterprise, internes git, windows, c++, angular, abonnement, atlas, modell
related: coding-pipeline, coding-harness, personal-secrets, mcp-servers
summary: Die lokale Copilot-CLI-Anmeldung für Ones KI-Aktionen, Browser-Agenten und Coding-Harness nutzen.
---
Unter **Coding-Agent** einer Aufgabe **GitHub Copilot** wählen oder für eine Prüfauftragsrolle festlegen. Dafür wird Worker **1.27.0** oder neuer benötigt; ältere Worker können nicht stillschweigend Claude einsetzen. Der Worker bietet Copilot auch als KI-Anbieter für One an. Coding-Aufgaben behalten ihre eigene Engine-Auswahl; Workspace-Funktionen nutzen die gemeinsame Anbieter-/Modellauswahl und KI-Regeln. Die Anmeldung ändert keine Standards und erteilt keine Datenfreigaben.

## Auf dem Teilnehmerrechner einrichten
GitHub Copilot CLI **ab 1.0.102** auf demselben Rechner wie den One-Worker installieren und mit `copilot login` lokal anmelden. Das Konto benötigt einen passenden Copilot-Zugang und die Unternehmensfreigabe für CLI und gewähltes Modell. Ein IDE-Abo beweist diese Voraussetzungen noch nicht. `COPILOT_BIN` kann auch unter Windows auf eine CLI außerhalb von PATH zeigen.

**Copilot einrichten** an der Coding-Aufgabe oder die lokale Worker-Einrichtungsseite öffnen. **CLI und Anmeldung prüfen (keine Modellanfrage)** prüft installierte CLI, Anmeldung und verfügbaren Modellkatalog. Dabei startet kein Coding-Auftrag und es wird kein Seiten- oder Repository-Prompt gesendet. Eine verfügbare exakte Modell-ID wählen oder `auto` belassen, wenn das Konto es anbietet. Auch Copilot Free kann damit für einen kleinen Texttest genutzt werden; die Desktop-App kann eine andere Aboberechtigung verlangen. Maßgeblich sind die CLI-Prüfung und dein Konto, nicht die Anmeldung in der App allein. **Copilot-Modell speichern** speichert ausschließlich diese Vorgabe in der privaten `copilot.json` des Workers. `ONE_COPILOT_MODEL` hat Vorrang vor dieser gespeicherten Worker-Vorgabe; eine ausdrückliche Aufgaben- oder Rollenauswahl geht beiden vor. Ein fest gewähltes, für das Konto nicht verfügbares Modell wird abgewiesen; One wechselt nicht stillschweigend.

Zugangsdaten bleiben in der eigenen Copilot-CLI-Anmeldung oder unterstützten Umgebungsvariablen wie `COPILOT_GITHUB_TOKEN`. Tokens nicht in Aufgabentext oder Modellfeld einfügen. One exportiert diese Zugangsdaten nicht und speichert sie nicht im Workspace.

Windows: GitHub setzt **PowerShell 6 oder neuer** voraus. CLI bei Bedarf mit `winget install GitHub.Copilot` oder `npm install -g @github/copilot` installieren, soweit vom Unternehmen freigegeben. Node 24 erfüllt die Node-Voraussetzung. [Offizielle Installation](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli). Für den Workshop den aktuellen Worker **1.34.1 oder neuer** verwenden; Claude ist optional.

## Modell pro Aufgabe und Rolle
Ab Worker **1.27.0** bietet die Aufgabe unter **GitHub Copilot** eine eigene Modellwahl, Denkaufwand und Kontextbudget. **Kontomodelle aktualisieren** fragt den Katalog des angemeldeten Workers ab, ohne Modellprompt. Nur dort gemeldete Modelle werden angeboten; eine gespeicherte, gerade nicht prüfbare Wahl bleibt sichtbar. Ein nicht verfügbares festes Modell wird vor dem Prompt abgewiesen, ohne Ersatzmodell.

In **Prüfaufträge → Einstellungen → Pipelines** zunächst für **BA, Coding oder QA** den Agenten **GitHub Copilot** wählen und darunter dessen Modell festlegen. Das betrifft die ausführende Rolle; der übergeordnete Auftragsplaner behält seine eigene KI-Auswahl. Die Planübersicht nennt die Rollenauswahl. Bestätigung und Wiederaufnahme prüfen diese Vorgaben mit dem Plan-Fingerabdruck.

Die Reihenfolge lautet: **Aufgabenwahl → bei Anlage bestätigte Rollenvorgabe → privater Worker-Standard**. Eine Aufgabenwahl gilt für die Modellphasen dieser Aufgabe auf diesem Gerät. **Wieder Rollen- / Worker-Vorgabe verwenden** entfernt die Aufgabenwahl. Rollenwerte werden bei Anlage in den lokalen Aufgabenstand übernommen; spätere Rollenänderungen ändern bestehende Aufgaben nicht. Rollenwerte gehören zum Workspace, persönliche Aufgabenwahl und Laufnachweise zum ausführenden Gerät. Abgeschlossene Aufgaben behalten ihre Nachweise. Bei automatischer QA-Reparatur gilt ausdrücklich die bestätigte **Coding**-Rollenvorgabe; die erneute Prüfung nutzt wieder die **QA**-Vorgabe.

**Denkaufwand** zeigt nur die vom Kontomodell gemeldeten Stufen. `auto` verwendet den Modellstandard, weil vor dem Lauf kein konkretes Modell feststeht. Nicht mehr unterstützter Denkaufwand führt zu einer verständlichen Ablehnung vor dem Prompt. Eine Modelländerung setzt eine vorherige Denkaufwandwahl zurück.

Das **Kontextbudget im Harness** lässt sich automatisch oder mit 16/32/64/128/256 Ki-Tokens begrenzen. Automatisch nutzt One die gemeldete Modellgrenze bis höchstens **262.144 Tokens**, abzüglich Antwortreserve. Eine kleinere Modellgrenze senkt die Auswahl; ohne gemeldete Grenze und bei `auto` gelten vorsichtig **32.768 Tokens**. Das ist Ones Arbeitsbudget, keine Freischaltung eines höheren Copilot-Tarifs oder einer speziellen Langkontext-Variante. Aufgabengedächtnis, Atlas und gezieltes Nachladen bleiben aktiv.

## Laufnachweise lesen
Unter der Aufgabe **Laufnachweise** öffnen. Jeder gespeicherte Copilot-Lauf zeigt Anbieter, Phase, Zeitpunkt, Dauer, Ergebnis, angefordertes Modell und Herkunft der Wahl, tatsächlich von der CLI gemeldete Modelle, Denkaufwand, Harness-Kontext, Tokens und gegebenenfalls Branch und Host-Testnachweis. Auch fehlgeschlagene und gestoppte Modellläufe bleiben erhalten. Bis zu 40 Einträge bleiben im lokalen Aufgabenstand; nach einem Geräte-Reset oder auf einem anderen Gerät sind diese nicht automatisch vorhanden.

Bei `auto` können mehrere tatsächliche Modelle über die Runden erscheinen. Fehlende Modell-, Token- oder Verbrauchsangaben sind **Unbekannt**, niemals erfundene Werte oder null Kosten. Summen bleiben unbekannt, wenn ein Teil des Laufs ohne vollständige Nutzungsangaben blieb. Copilot-AIU und Restkontingent werden nur aus CLI-Nutzungsereignissen übernommen. Kontingente sind datierte Momentaufnahmen; One fragt nicht ständig nach und rechnet diese Angaben nicht in Euro oder Dollar um. Ein Modellmultiplikator ist kein Geldbetrag. Separate Teststufen behalten ihren eigenen Testnachweis; ein erfolgreicher Modelllauf beweist allein keinen bestandenen Test.

Der geführte Abnahmebericht übernimmt die begrenzte Modell-/Token-Zusammenfassung, sodass sie auch im vorbereiteten Atlas-Übergabeentwurf steht. Die Rohdaten der CLI und Zugangsdaten werden nicht gespeichert. Erneutes Übermitteln desselben Abschlusses erzeugt keinen zweiten Nachweis.

## Internes Git, Atlas und Ausführung
Der vorhandene lokale Checkout darf auf internes Git zeigen. Er muss nicht in externes Git kopiert werden: Der Worker legt einen Aufgaben-Worktree an und verwendet den vorhandenen Repository-Zugang dieses Rechners. Lokaler Build und Simulation müssen dort funktionieren; den tatsächlichen Analyse-/Testbefehl des Projekts konfigurieren. Ausgewählte Quelltextausschnitte und Werkzeugergebnisse gehen weiterhin unter den Unternehmensregeln an den Copilot-Dienst. Ein internes Repository hält den Modellkontext nicht automatisch auf dem Laptop.

One führt den Ablauf: begrenzter Aufgabenkontext, Gedächtnis, Quellenlesen, abgesicherte Änderungen, konfigurierte Prüfungen und Abschlussnachweise. Copilot liefert über sein lokales SDK-Protokoll den nächsten strukturierten Harness-Schritt. Native Copilot-Werkzeuge, Repository-Konfigurationssuche, Datei-Hooks, Skills, sitzungsübergreifender Speicher und Remote-Sitzungsexport sind ausgeschaltet. Durch eine Modellanforderung entsteht kein Shell-Zugang. Planungs-/Dokumentstufen erhalten nur lesende Werkzeuge; Umsetzung kann Quelltext ändern und ausschließlich konfigurierte Prüfungen starten. Git-Commit, Push und Integration bleiben ausdrückliche Pipeline-Stufen.

Für einen persönlichen Atlas-Agenten dessen eigene Verbindung und die benötigten Werkzeuge über **Meine Secrets** an der Aufgabe auswählen. Der auf diesen Lauf begrenzte MCP-Proxy des Workers übernimmt die Verbindung; Copilot erhält Werkzeugschemata und bereinigte Ergebnisse, niemals das Atlas-Token. Lesende Stufen erhalten nur lesende Atlas-Werkzeuge. Dieser Weg benötigt keine Claude-Installation. Rollenprofil, gewählter Tenant und Atlas-Rechte auf dem Server bleiben getrennt zu prüfen.

## Grenzen und Workshop-Test
Copilot-Abonutzung ist **kein USD-Kostennachweis**. One weist sie nicht als kostenlos aus und kann Dollargrenzen gegen diesen Tarif nicht durchsetzen. Schritt-/Zeitgrenzen der Stufe, Wiederholungserkennung und konfigurierte Prüfungen bleiben aktiv. Das Kontextbudget folgt den unten beschriebenen Modellgrenzen; gezieltes Nachladen und Aufgabengedächtnis gelten weiter.

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

Browser-Anfragen nutzen höchstens 262.144 Kontext-Tokens bei ausreichender gemeldeter CLI-Kapazität, sonst ein vorsichtiges Budget von 32.768 Tokens; Werkzeugbeschreibungen werden gekürzt und MCP-Schemata gezielt gesucht. Werkzeug-/Rundengrenzen, wiederholte Aufrufe, Abbruch und fehlender Kontext beenden einen Lauf. Vorhandener Tokenverbrauch wird pro Antwort erfasst; Geldkosten bleiben unbekannt statt als null verbucht zu werden. Dollarbudgets können ein Copilot-Abo nicht messen. Ein echter Konto-/Modell-/Netzwerktest bleibt auf jedem Workshop-Laptop erforderlich.

## Dienstag arbeitsfähig starten
Der [Workshop-Startcheck](help:workshop-startcheck) führt durch Konto, Worker, internes Git, Modelltest, Atlas-Verbindung und Testnachweise. Jede Person verwendet ihre eigenen Zugänge. Ein Test am Organisatorrechner ersetzt den Test auf dem Teilnehmerlaptop nicht.

## Workshop-Stand · Worker 1.30.0
Bei einer formal ungültigen Harness-Antwort versucht ONE genau eine Formatkorrektur im selben isolierten Copilot-Dialog, mit derselben Modellwahl und innerhalb des bestehenden Drei-Minuten-Limits. Beide Modellantworten zählen zum gemeldeten Verbrauch. Unzulässige Werkzeuge, Transport-/Anmeldefehler, Abbruch und Zeitüberschreitung werden nicht auf diese Weise wiederholt. Scheitert auch die Korrektur, stoppt der Lauf mit einer verständlichen Meldung. Die Laufnachweise nennen die Zahl der Formatkorrekturen; es gibt keinen stillen Anbieterwechsel.

Tatsächlich gestartete konfigurierte Tests enthalten zusätzlich den bereinigten Befehl als Argumentliste, Commit soweit ermittelbar, Hinweise auf uncommittete beziehungsweise während des Tests geänderte Git-Zustände, Plattform und Zeit. Bei alten Workern oder nicht gestarteten Prüfungen bleiben diese Angaben unbekannt. Ein Commit mit uncommitteten Änderungen bezeichnet nicht den vollständigen geprüften Inhalt.

## Mit Atlas vom KI-Terminal zur Coding-Aufgabe

Im bebilderten Workshop-Erststart zuerst den eigenen Worker verbinden, dann **Atlas-Zugang einrichten → Atlas mit Copilot verbinden**. Dieser bewusste Klick aktiviert die persönliche MCP-Erlaubnis auch dann, wenn eine ältere Geräteeinstellung MCP noch gesperrt hatte. Andere Datenregeln bleiben bestehen. Nach erfolgreicher Identitätsprüfung wird eine alte Ablehnungsmarkierung dieser Verbindung gelöscht. Im Erststart lässt sich der Zugang auch nach Abschluss des Willkommenshinweises wieder öffnen.

Im KI-Terminal die Atlas-Quelle tatsächlich lesen, dann eine kleine Coding-Aufgabe mit Quelle, Ziel und überprüfbaren Kriterien vorschlagen lassen. Vorschlag prüfen und übernehmen. In der Aufgabe Repository und **GitHub Copilot** wählen, das gewünschte Modell prüfen und unter **Meine Secrets** den eigenen eingerichteten Atlas für diese Aufgabe freigeben. Erst dann den gewünschten Schritt starten. Der Plan, die Umsetzung und Tests bleiben getrennte Schritte mit Laufnachweisen. Eine Übergabe an QA oder eine andere Person übernimmt keine Zugangsdaten; die nächste Person nutzt ihren eigenen Worker und Atlas-Zugang.

Bei einer ausdrücklich verlangten MCP-Quelle ohne persönliche Erlaubnis startet keine Modellanfrage. Umfangreiche Werkzeugantworten werden für den Copilot-Kontext als gekennzeichnete Auszüge aufbereitet; Auftrag, Werkzeugargumente und sichtbarer Verlauf bleiben erhalten. Ausgelassene Inhalte dürfen nicht als gelesen behauptet werden. Ein unpassender oder weiterhin zu großer Auftrag stoppt vor der nächsten Modellanfrage.
