---
id: workshop-startampel
title: Startampel für den Workshop
section: ai
order: 24
keywords: workshop, startampel, teilnehmer, worker, copilot, atlas, gast, einrichtung
related: workshop-startcheck, copilot-coding, personal-secrets, team-cloud
summary: Den persönlichen Einrichtungsstand gemeinsam prüfen und Blocker sichtbar festhalten.
---
Die Startampel liegt im gemeinsamen Workshop unter **Startampel · Workshop readiness**. Bei eingerichteter Automatik ordnet ONE die Einträge über das persönliche Konto und die private Teilnehmerliste zu; Anzeigenamen allein reichen nicht. Jede Person hat eine aufklappbare Platte mit fünf Leuchten: ONE-Zugang, Atlas lesen, Worker, Copilot und Repo/Testweg. Die Galerie zeigt Platten; die Tabellenansicht zeigt dieselben Daten als Liste.

ONE übernimmt erfolgreiche Ereignisse automatisch: Anmeldung im richtigen ONE-Workspace und die serverseitig registrierte Worker-Verbindung; ein erkannter `atlas_get`-Lesezugriff auf ein konfiguriertes Workshop-Projekt aus der persönlichen ONE-Sitzung; ein erfolgreicher Copilot-Modellaufruf beziehungsweise Coding-Schritt; ein tatsächlich erfolgreicher Repo-Test mit Exitcode 0. Atlas-, Modell- und Testnachweise werden vom ausführenden Gerät gemeldet, keine unabhängige Server-Zertifizierung.

Ein Atlas-Login in einem anderen Tab, ein gespeicherter Token, Discovery oder eine installierte App zählen nicht als MCP-Lese- oder Modellnachweis. Nach erkanntem Atlas-Lesen aktualisiert ONE die Ampel und entfernt den persönlichen Willkommenshinweis.

**Offen** heißt noch nicht geprüft. **Startbereit** erst nach dem tatsächlichen persönlichen Prüfschritt wählen. **Blockiert** zeigt ein konkretes Hindernis. Der Gesamtstatus entsteht aus den benötigten Schritten: Ein Blocker hat Vorrang; erst alle benötigten Schritte auf Startbereit ergeben Startbereit. Entfällt ersetzt keinen erforderlichen Nachweis.

Für Gäste werden nur ONE- und Atlas-Lesezugriff benötigt. Worker, Coding und Repo sind für die Gastteilnahme nicht erforderlich. Spätere Nutzer zählen nicht in den Bereitschaftsnenner des Workshops. Diese Planungsrolle ändert keine Mitgliedschaft und keine Zugriffsrechte.

Die Automatik zeigt Quelle und Zeitpunkt pro Schritt. Sie ist kein dauerhafter Online-Monitor: „Worker zuletzt verbunden“ ist ein erfolgreicher Verbindungsnachweis mit Zeitpunkt. Manuelle Blocker bleiben als bewusster Halt bestehen. Manuell gesetzte Werte sind weiter möglich und entsprechend gekennzeichnet.

Auf der aufgeklappten Platte lassen sich Ursache, nächster Schritt, verantwortliche Person und eine datensparsame Notiz eintragen. Zeitpunkt und Name der letzten manuellen Änderung werden festgehalten. Keine Tokens, persönlichen Zugangslinks oder internen Rohlogs eintragen. Persönliche Secrets gehören in **Meine Secrets**.

Die Ampel stellt keine Atlas-Verbindung her, führt keine zusätzlichen Verbindungs- oder Modelltests aus und versendet keine Einladung. Sie übernimmt nur beobachtete erfolgreiche Schritte; Anmeldung am ONE-Server wird der tatsächlich authentifizierten Sitzung zugeordnet. Ein gespeicherter Atlas-Link oder eine installierte Copilot-App ist noch kein erfolgreicher Lese- beziehungsweise CLI-Lauf. Der vereinbarte End-to-End-Test ist ein eigener Nachweis.

Teammitglieder bearbeiten im Rahmen ihrer bestehenden Workspace-Rechte; Gäste sehen die Ampel nur lesend. Die Daten sind gewöhnliche Datenbankzeilen und bleiben in Workspace-Exporten enthalten. Ältere ONE-Versionen können sie als normale Galerie/Tabelle darstellen.

## Einrichtung und aktuelle Verbindung
Die fünf Einrichtungsprüfungen bleiben mit Quelle und Zeitpunkt erhalten. Worker-Versionen werden zusätzlich erfasst, wenn das Gerät sie meldet. Eine getrennte Anzeige nennt „jetzt verbunden“, „jetzt getrennt“ oder „erneut prüfen“. Sie basiert auf angemeldeten Teilnehmerereignissen und der Cloud-Relay-Beobachtung, wird bei sichtbarem ONE-Fenster etwa alle 30 Sekunden aktualisiert und gilt nach 90 Sekunden ohne Beobachtung als veraltet. Geschlossene Tabs und fehlendes Netz sind deshalb kein dauerhafter grüner Online-Nachweis. Eine manuelle Sperre wird nicht automatisch aufgehoben. Die Anzeige prüft keine fremden Konten und startet kein Modell.


Gäste mit aktiver, befristeter Mitmachfreigabe benötigen ebenfalls alle fünf Prüfungen: ONE, Atlas, Worker, Copilot und Repository. Die Ampel liest dafür die tatsächliche Freigabe vom Teamserver; die Planungsrolle bleibt „Gast“. Nach Ablauf entfallen die technischen Prüfungen wieder, vorhandene Nachweise bleiben erhalten. Bei unbekanntem Freigabestand werden sie nicht voreilig als „entfällt“ gewertet.
