---
id: 2026-10-20-coding-harness
date: 2026-10-20
order: 2
title: Coding-Pakete, Modelltests und QA-Reparaturen
summary: Gezielter Kontext, versionierte Methoden und begrenzte Reparatur-Unterläufe im gemeinsamen Harness.
image: assets/shots/changelog/coding-harness.webp
alt: Die neue Hilfe erklärt Aufgabenpakete, Kontext und Qualität im Coding-Harness.
help: coding-harness, workorders, coding-pipeline
try: workorders
---
Worker **1.20.0** bereitet für den lokalen, MiniMax- und Ollama-Cloud-Harness kompakte Aufgabenpakete mit einer begrenzten Code-Karte und passenden Arbeitsmethoden vor. `code_map`, `skill_list` und `skill_read` laden Details nach. Fachbegriffe aus vorhandenen Glossar-/Kontextdateien gehen mit. Methoden ändern keine Rechte; ein Textmodell erhält dadurch keine Bildverarbeitung.

Memory unterscheidet Modellnotizen von Werkzeugbeobachtungen, führt Dateirevisionen und kennzeichnet wiederhergestellte Einträge als historisch. Eine neue gelesene Revision verdrängt ältere Auszüge derselben Quelle in der Suche. Gerade nachgeladene Ergebnisse bleiben bei einer Komprimierung als begrenzter Auszug sichtbar. MCP-Werkzeugprüfungen zeigen erlaubte entdeckte Werkzeuge; ein echter Aufruf bleibt der Ausführungsbeleg.

Unter **Prüfaufträge → Einstellungen → Automatische QA-Reparaturen** kannst du **1** oder **2** Reparatur-Unterläufe erlauben; Standard ist **Aus**. Sie verwenden den bestätigten Coding-Agenten auf dem gemeinsamen Branch und benötigen anschließend frische QA. Bestehende Prüfdateien und erkannte Prüfkonfigurationen bleiben geschützt. Gleiche Befunde, verbrauchte Versuche oder gemeinsame Grenzen stoppen den Lauf. Befund und zugehörige Coding-Seiten stehen im QA-Bericht. Dafür entstehen keine zusätzlichen Pipeline-Zeilen.

Die neue lokale Vergleichssuite unter `node one-worker.mjs evaluate` enthält **24 synthetische Fälle**, darunter mehrere Dateien, Quellenkonflikte und Fortsetzen. JSON-Berichte enthalten feste Suite-Hashes, Laufbelege, Dauer, Fehler und falsche Erfolgsmeldungen. Das ist eine Messgrundlage, kein Nachweis allgemeiner Spitzenmodell-Qualität. Die Hilfe beschreibt Bedienung, lokale/Cloud-Wege und Grenzen auf Deutsch und Englisch.
