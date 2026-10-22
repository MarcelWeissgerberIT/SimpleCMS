---
id: coding-harness
title: Coding-Harness, Kontext und Qualität
section: ai
order: 21
keywords: lokal, ollama, coding, harness, atlas, memory, skills, methoden, reparatur, qa, benchmark, evaluation, kontext, modellvergleich
related: coding-pipeline, workorders, custom-agents, mcp-bridge
summary: Wie One Coding-Aufträge vorbereitet, Kontext nachlädt, QA-Reparaturen begrenzt und lokale Modelle prüft.
---
One verwaltet den Auftrag, seine Teilaufgaben und die Abnahme. Das ausgewählte Modell bearbeitet jeweils ein Arbeitspaket. Ein Rollenprofil wie `marcel-flow` ändert Anweisungen, nicht die Modellgewichte. Ein Modellwechsel behält den Harness, die Werkzeuge und die Grenzen bei.

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
