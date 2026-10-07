---
id: legacy-modernisation
title: Altsoftware modernisieren
section: ai
order: 10
keywords: altsoftware, legacy, alter code, modernisieren, neu bauen, neubau, migration, zip, import, klonen, gitlab, github, glab, gh, code-analyse, architektur, design, testentwurf, charakterisierungstests, atlas, wissensbasis, mcp
related: coding-pipeline, mcp-servers, agent
summary: Von einer ZIP oder einem GitLab-Projekt zur neu gebauten Version — Analyse, Design und Testentwurf als Abschnitte einer Seite in One, Tests, die das heutige Verhalten festhalten, dann der Neubau.
---
One, der [Coding-Worker](help:coding-pipeline) und Claude Code nehmen alte Software auseinander und bauen sie neu. Jeder Schritt landet in der Seite der Aufgabe – dort liest du ihn, besprichst ihn und gibst ihn frei. Dein Code bleibt auf deinem Rechner.

## 1. Den Code zum Worker bringen
Öffne die Setup-Seite des Workers (**Einstellungen → Coding-Worker → Repositories ändern**):
- **ZIP importieren …** – eine ZIP mit dem Quellcode wird ein neues Repository in `~/one-repos`: ein Commit *Import <Datei>*. Die eigenen `.git`-Ordner der ZIP bleiben draußen; ein Pfad, der aus ihrem Ordner herausführt, lehnt die ganze ZIP ab. Direkt danach legt **Auch auf GitLab / GitHub anlegen** (mit angemeldetem `glab` oder `gh`) das Projekt an – der Name wird aus dem Code (package.json, pom.xml, README …) oder der ZIP vorgeschlagen –, setzt es als Remote und pusht, damit **Ausliefern** Merge Requests öffnen kann.
- **Von GitLab / GitHub klonen …** – die Klon-Adresse einfügen (HTTPS oder SSH) oder eines deiner Projekte wählen (wenn `glab` oder `gh` installiert und angemeldet ist). git meldet sich mit deinem SSH-Schlüssel oder Credential-Helper an; der Worker kann kein Passwort eintippen.

Hak das Repository an, trag seinen **Testbefehl** ein, falls es einen gibt, und **Speichern & starten**. `~/one-repos` wird nicht synchronisiert – halte Repositories aus iCloud Drive und Dropbox heraus, sonst wartet git auf Dateien aus der Cloud.

## 2. Die Pipeline
Unter **#/coding → Pipeline** die Vorlage **Altsoftware modernisieren** wählen und speichern:
1. **Analyse** (Plan-Modus – nichts wird geändert): Überblick, Architektur mit Diagramm, Datenmodell, Abhängigkeiten, Qualitäts-Brennpunkte, Risiken, das Verhalten, das bleiben muss.
2. **Design**: Zielarchitektur, UI und Design, Migration, was besser wird.
3. **Testentwurf**: Charakterisierungstests – eine Tabelle von Fällen, die das heutige Verhalten festhalten.
4. **Konzept freigeben**: die drei Abschnitte in der Seite lesen; bei Bedarf **Nacharbeit…** mit einer Notiz.
5. **Tests schreiben** gegen den alten Code, dann **Tests am Altcode** – sie müssen bestehen.
6. **Neubau**, **Test** (dieselben Tests am neuen Code), **Review**, **Ausliefern**.

Jede Plan-Stufe schreibt ihren eigenen Abschnitt in die Seite (*Analyse*, *Design*, *Testentwurf*) – so lesen die späteren Stufen, was die früheren gefunden haben. Schlagen Tests fehl, geht die Aufgabe einmal mit der Ausgabe zur Stufe davor zurück.

## 3. Die Aufgabe
**Neue Aufgabe**: das importierte Repository als **Repo**, das Ziel in ein paar Zeilen – z. B. *Verstehe das Abrechnungsmodul und baue es als typisierten Webdienst mit einer klaren Oberfläche neu. Die Rechnungsregeln bleiben.* **Freigaben**: *Plan und Review freigeben* hält nach dem Konzept an; *Nur Review* läuft bis zum Review durch.

## 4. Deine Wissensbasis (z. B. Atlas)
- **Claude Code auf dem Worker**: auf der Setup-Seite den Server unter *Eigene MCP-Server für Claude Code* eintragen (der Name aus `claude mcp list`, z. B. `atlas`). Die Stufen dürfen dann lesen, was über den Code bekannt ist, und Erkenntnisse und Entscheidungen festhalten.
- **In One**: das KI-Terminal (<kbd>Mod+J</kbd>) mit dem Codewort des Servers – z. B. `atlas: halte die Risiken dieser Analyse fest` – siehe [MCP-Server](help:mcp-servers).

## Tipps
- Großer Altcode: mit einem Modul anfangen – die Analyse bleibt lesbar.
- **Verwandeln in** macht aus einem Abschnitt der Analyse ein Diagramm oder eine Tabelle.
- Diff und Testausgabe jeder Stufe stehen im Aufgaben-Panel (**Diff**, **Tests**).
