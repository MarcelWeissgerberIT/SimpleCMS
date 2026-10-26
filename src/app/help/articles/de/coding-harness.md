---
id: coding-harness
title: Coding-Harness, Kontext und Qualität
section: ai
order: 21
keywords: lokal, ollama, coding, harness, atlas, memory, skills, methoden, reparatur, qa, benchmark, evaluation, kontext, modellvergleich
related: coding-pipeline, workorders, custom-agents, mcp-bridge
summary: Wie One Coding-Aufträge vorbereitet, Kontext nachlädt, QA-Reparaturen begrenzt und lokale Modelle prüft.
---
One verwaltet den Auftrag, seine Teilaufgaben und die Abnahme. Das ausgewählte Modell bearbeitet jeweils ein Arbeitspaket. Ein Rollenprofil wie `atlas-flow` ändert Anweisungen, nicht die Modellgewichte. Ein Modellwechsel behält den Harness, die Werkzeuge und die Grenzen bei.

## Aufgabenpaket und Methoden
Der gemeinsame Harness für **Lokal · Ollama**, **MiniMax**, **Ollama Cloud** und **GitHub Copilot** stellt vor dem Lauf ein begrenztes Paket zusammen: Projektanweisungen, vorhandene Fachbegriffe aus `GLOSSARY.md`/`CONTEXT.md`, relevante Dateiverweise, Symbole, Imports und passende versionierte Arbeitsmethoden. Die Code-Karte ist eine begrenzte Text-/Symbolsuche, kein vollständiger Architekturgraph. Ein Auszug zählt nicht als Lesen für eine anschließende Änderung.

`code_map` lädt weitere Orientierung. `skill_list` und `skill_read` laden kleine Methoden für Implementierung, Fehleranalyse, Schnittstellenprüfung, Quellenarbeit, UI-Prüfung und Abnahme. Sie gewähren keine zusätzlichen Rechte und führen keine heruntergeladenen Skripte aus. UI-Methoden ersetzen keine Bildverarbeitung: Ein Textmodell kann Screenshots nicht visuell bewerten.

Im Laufprotokoll stehen Paketumfang, Methoden und ein **Harness receipt** mit Modell, Profil-Hash, Kontextgrenze, gemeldeten Modellfähigkeiten, Runden, Werkzeugfehlern, Komprimierungen und Prüfungen. Deklarierte Fähigkeiten sind noch kein bestandener Modelltest.

## Memory und Atlas
Werkzeugergebnisse und Modellnotizen sind unterscheidbar. Dateiauszüge tragen einen Inhalts-Hash; eine neu gelesene Revision verdrängt ältere Auszüge derselben Quelle aus der normalen Suche. Wiederhergestellte Einträge sind historisch. Ein alter Prüfbeleg beweist keinen aktuellen Testlauf. Beim Fortsetzen müssen Dateien neu gelesen und Checks erneut ausgeführt werden.

Lokales Task-Memory und Atlas-Shadow-Checkpoints bleiben begrenzt und auf den Auftrag bezogen. Atlas benötigt eine bestehende Verbindung und ausdrücklich erlaubten privaten Shadow-Zugriff. Fehler bei Atlas führen nicht zu einer Endlosschleife. `mcp_check_tools` prüft, welche exakten Werkzeuge in dieser Phase entdeckt und erlaubt sind; erst ein erfolgreicher echter Aufruf belegt die Ausführung und Kontoberechtigung.

## Automatische QA-Reparaturen
Öffne **Prüfaufträge → Einstellungen → Automatische QA-Reparaturen**. Standard ist **Aus**. Wähle optional **1** oder **2**. Die Auswahl und der Coding-Agent werden beim Bestätigen der Kette festgehalten; eine Änderung hebt eine bisherige automatische Startzustimmung auf.

Schlägt finale QA wegen eines Checks oder eines konkreten `needs_rework`-Befunds fehl, kann der Worker einen Reparatur-Unterlauf mit dem bestätigten Coding-Agenten starten. Er arbeitet auf dem bereits freigegebenen gemeinsamen Branch. Der Befund und die zugehörigen Coding-Seiten stehen im QA-Bericht. Es werden keine zusätzlichen Pipeline-Zeilen erzeugt. Frische QA folgt jeder erfolgreichen Reparatur.

Bestehende Tests, Prüf-Einstiegspunkte und erkannte Prüf-/Abhängigkeitskonfigurationen werden vorab erfasst. Änderungen daran verhindern die Abnahme; neue Regressionstests sind möglich. Das ist eine Schutzprüfung, keine Betriebssystem-Sandbox. Schrittgrenze und bekannte Geldgrenzen gelten über die Unterläufe hinweg. Nicht messbare Cloud-Tarife bleiben nicht messbar. Gleiche wiederkehrende Befunde, fehlender Fortschritt, fehlende Berechtigungen oder erschöpfte Versuche stoppen den Lauf. Ein privates Journal verhindert, dass Retry die Versuchszahl zurücksetzt. Der Branch bleibt zur Prüfung erhalten.

## Lokal und Cloud bewusst wählen
**Lokal · Ollama** verwendet die Loopback-Inferenz. MiniMax und Ollama Cloud senden ausgewählten Kontext an den jeweiligen Anbieter. Die Rollenwahl für BA, Coding und QA ändert nicht automatisch die Modellroute des eigentlichen Planers: Er nutzt die KI-Einstellungen des Arbeitsbereichs. MCP-Verbindungen zu Atlas können auch bei lokaler Inferenz entfernte Dienste ansprechen. Es gibt keinen stillen Wechsel zu einem Cloud-Modell.

## Modelle vergleichen
Worker **1.20.0** enthält eine lokale Vergleichssuite mit 24 synthetischen CMS-/Repository-Fällen. Auf dem Rechner mit Ollama:

```
node one-worker.mjs evaluate --limit 3 --cases module-integration,source-conflict,resume-package
node one-worker.mjs evaluate --limit 24 --repeats 3
```

Wähle Modell und Kontext über `ONE_CODER_MODEL` und `ONE_CODER_CONTEXT` (32768, 65536 oder 131072) in der Umgebung dieses Aufrufs. Die Suite verändert keine eigenen Repositories, verbindet kein persönliches MCP und nutzt keine Cloud-Inferenz. Sie braucht Zeit und lokalen Arbeitsspeicher. Die Abnahmeprüfungen liegen außerhalb des Modell-Arbeitsordners; das ist keine OS-Isolation.

Die JSON-Ausgabe enthält Suite-Hash, Modell, Kontext, Erfolgsquote, falsche Erfolgsmeldungen, Dauer, Schritte und Laufbelege. Wiederhole denselben Satz mit denselben Bedingungen, bevor du Modelle oder Kontexte bewertest. Auch 24 grüne Fälle sind kein Nachweis allgemeiner Spitzenmodell-Qualität. Ein Fehler ist ein Ergebnis, kein Grund, die Abnahme zu lockern. Die ältere Zehn-Funktionen-Suite bleibt unter `benchmark` verfügbar.


## Der Harness als Türöffner und die Quellenprüfung
Der Harness erschließt erlaubte Quellen und Werkzeuge und organisiert kleine Arbeitspakete. Die Modelle suchen aktiv Widersprüche, Inkonsistenzen und Probleme, ordnen Zusammenhänge und Auswirkungen und begründen Empfehlungen. Die verbindliche fachliche Entscheidung und Abnahme bleiben beim Team. Ein begründet verworfener Vorschlag ist ein gültiges Ergebnis; Begeisterung für KI ist kein Erfolgskriterium.

Im KI-Terminal, bei Browser-/Server-Agenten und im gemeinsamen lokalen Coding-Adapter liefert `read_page` beziehungsweise `read_file` einen Quellenbeleg für den gelesenen Ausschnitt. `check_finding` vergleicht zwei genaue Zitate mit den Belegen dieses Laufs. Die nativen Coding-Clients erhalten ab Worker **1.28.0** dieselbe Prüfung über `one_task_source` und `one_task_check_finding`; `one_task_read` und Ergebnisse persönlich freigegebener MCP-Aufrufe liefern ebenfalls Quellenbelege. Das Feld `checkWith` nennt das passende Prüfwerkzeug.

Die Prüfung liest keine beliebigen URLs, erweitert keine Berechtigungen und schreibt nichts. Sie bestätigt ausschließlich, dass das Zitat im beobachteten Ausschnitt vorkam. Fehlende, abgelaufene oder nach einer Änderung verworfene Belege erfordern erneutes Lesen. Ein engerer Ausschnitt hilft bei gekürzten Ergebnissen. Historisches Memory und Modellnotizen erzeugen keine neuen Quellenbelege.

**Zitate belegt bedeutet weder Widerspruch bewiesen noch fachlich freigegeben.** Geltungsbereich, Version, Aktualität und Bedeutung müssen weiter bewertet werden. Das Berichtsformat trennt Befund, Quellen, Kontext, Auswirkungen, Optionen und Empfehlung als Vorschlag; die Teamentscheidung bleibt offen. Eine Quellenprüfung ist kein Testlauf und keine automatische Abnahme. Der Einsatz des Prüfwerkzeugs wird angeordnet, aber freie Modellantworten sind dadurch nicht vollständig gegen falsche Aussagen abgesichert.

Für bestehende Coding-Installationen den Worker auf 1.28.0 aktualisieren und einen neuen Lauf starten. Laufende Prozesse und bereits gespeicherte Berichte werden dadurch nicht rückwirkend geändert.

## Wichtiges Wissen aktiv behalten
Die gemeinsame Begleitregel fordert vor neuer Arbeit passende Atlas-Entscheidungen und Randbedingungen anzusehen. Erkennt das Modell dauerhaft nützliches Wissen, soll es Quelle, Stand, Bedeutung und Anlass zum Wiederaufrufen ablegen. Eine bestätigte menschliche Entscheidung wird als Verweis auf ihren Beschluss gespeichert; Vorschläge und offene Fragen bleiben getrennt.

Im gemeinsamen Coding-Adapter – auch für MiniMax, Ollama Cloud und Copilot – prüft `memory_knowledge` zuerst ein tatsächliches Quellenzitat und speichert die Notiz lokal. Eine erlaubte private Atlas-Ablage wird sofort versucht, nicht erst am Laufende. Gleiche Notizen werden zusammengefasst; höchstens drei Atlas-Checkpoint-Schreibvorgänge pro Lauf. Fehler stoppen weitere automatische Versuche. Fehlende Rechte, Verbindung oder ein erreichtes Limit bleiben als **ATLAS PENDING** sichtbar. Die Ablage erweitert keine Berechtigungen und ersetzt keinen verbindlichen Team-Beschluss in Atlas.

Bei Browser-/Server-Agenten und nativen Coding-Clients wirkt dieselbe Wissensregel; sie verwenden ihre ausdrücklich freigegebenen Atlas-Werkzeuge. Die automatische private Checkpoint-Übertragung des gemeinsamen Adapters ist dort kein universeller Hintergrunddienst. Jede Person braucht eigene Zugänge und den richtigen Workspace-/Projektbezug; private Tokens und Memories werden nicht automatisch geteilt.

## Lokales Modell im Team teilen · ab Worker 1.29.0
Im gewünschten **Cloud-Workspace → Einstellungen → KI → Lokales Modell freigeben** dein installiertes Modell auswählen und **Für diesen Workspace freigeben** drücken. Der anbietende Cloud-Worker muss zu deinem Konto und genau diesem Workspace gehören. Es gibt keine Freigabe für alle Workspaces. Name, Modell, Online-Status und Warteschlange erscheinen dort; **Freigabe beenden** ist auch ohne laufenden Host möglich. Ein Neustart aktiviert eine vom Server beendete Freigabe nicht erneut.

Mitglieder wählen den Eintrag unter **Lokal · Ollama** in der Modellwahl einer Textaktion. Sie benötigen dafür keinen eigenen Worker. Eine Anfrage läuft gleichzeitig; maximal zwölf Aufträge einschließlich des laufenden und zwei pro Person sind zugelassen. Eigene laufende Worker-Aufträge haben Vorrang vor der nächsten Freigabe-Anfrage. Die Anzeige nennt den Warteschlangenplatz. Abbruch, Rollenverlust, Widerruf und Workspace-Wechsel beenden Anfragen. Wartezeit ist auf acht Minuten, Inferenz auf drei Minuten begrenzt. Fehler führen nicht zu automatischen Wiederholungen oder einem Cloud-Fallback.

Dieser erste Freigabekanal verarbeitet **Text, Reviews und Codevorschläge**: höchstens 22 KB Eingabe und 4.096 Ausgabetokens. Er startet keine Coding-Pipeline, führt keine Werkzeuge aus und teilt weder Repositories noch Atlas-Tokens. Gäste und andere Workspaces haben keinen Zugriff. Der ausgewählte Kontext erreicht den Rechner des Hosts. Browser und Worker verschlüsseln Inhalte mit einem zufälligen Schlüssel je Anfrage; der Teamserver vermittelt verschlüsselte Inhalte und sieht Metadaten. Der Host entschlüsselt zur Inferenz. Der Host-Schlüssel wird bei Neustart gewechselt; er ist keine unabhängig verifizierte Identitätsbescheinigung. Eine kompromittierte ONE-Webanwendung bzw. ein kompromittierter Host liegt außerhalb dieser Transportabsicherung. Der Relay speichert keine Prompts oder Antworten in der Datenbank; kurzlebige Warteschlangen und Ergebnisse liegen im Arbeitsspeicher. Lokale Berechnung über den Frankfurter Teamserver ist kein vollständig lokaler LAN-Betrieb.

### Verfügbarkeit mit einer echten Antwort testen

Unter **Einstellungen → KI → Lokales Modell freigeben** zeigt jede Freigabe getrennt **Host verbunden**, **Modell verfügbar** und **Antwort bestätigt**. Die ersten beiden Anzeigen beruhen auf regelmäßigen Meldungen des Modellhosts; eine bestehende Freigabe allein bestätigt noch keine Inferenz. **Verfügbarkeit testen** schickt genau eine feste kurze Testnachricht über dieselbe verschlüsselte Warteschlange wie eine normale Textanfrage. Es werden keine Seiteninhalte, Dateien, Zugangsdaten oder Atlas-Aufrufe angehängt.

Der Test kann das lokale Modell erst laden und wartet hinter vorhandener Arbeit. Nach höchstens 90 Sekunden einschließlich Wartezeit endet er; **Test abbrechen** beendet die Anfrage auch früher. Eine erfolgreiche Antwort zeigt Zeitpunkt und Gesamtdauer einschließlich Warteschlange. Nach einer Minute, einem Neustart des Hosts oder bei Offline-Status gilt die Bestätigung nicht mehr als aktuell. Der Test verändert keine Freigaben und weicht auf keinen Cloud-Anbieter aus. Er prüft den Textkanal, keine Coding-Werkzeuge, Modellqualität oder Atlas-Verbindung.

### Kleiner Vergleich mit Copilot am Demo-Repo
Die synthetische Teilnehmer-Demo enthält absichtlich fehlerhafte C++- und TypeScript-Validierung. Ein reproduzierbarer Text-zu-Code-Vergleich verwendet für beide Anbieter dieselben Eingaben, maximal 4.096 Ausgabetokens und unveränderte Tests. Im entpackten Demo-Repository:

```sh
node /pfad/one-worker.mjs compare-demo --repo /pfad/ONE-Demo --output /pfad/vergleich/report.json --model atlas-flow:latest --copilot-model auto
```

Dieser CLI-Befehl nutzt den lokalen Ollama und die persönlich angemeldete Copilot-CLI direkt. Er benötigt keine Kundendaten und gibt den Modellen keinen Shell-Zugriff. Der Bericht enthält Kontext-/Test-Prüfsummen, tatsächliches Modell soweit gemeldet, Laufzeit, Verbrauch und Prüfresultate. `auto` ist kein festes Modell; für wiederholbare Vergleiche ein freigeschaltetes Copilot-Modell explizit wählen. Ein Test des Freigabekanals muss zusätzlich durch die Workspace-Warteschlange laufen. Zwei kleine Aufgaben beweisen weder einen vollständigen schwierigen Merge noch allgemeine Modellqualität, Angular-Build, Browser-Verhalten oder Kundennetz-Zugriff. Subscription-Kontingent und Strom werden nicht als kostenlos ausgewiesen.
