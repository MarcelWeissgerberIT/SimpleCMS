---
id: legacy-modernisation
title: Altsoftware modernisieren
section: ai
order: 10
keywords: altsoftware, legacy, alter code, modernisieren, neu bauen, neubau, migration, zip, import, klonen, gitlab, github, glab, gh, code-analyse, architektur, design, testentwurf, charakterisierungstests, wissensbasis, mcp
related: explain-code, coding-pipeline, pipelines, review-merge, mcp-servers, agent
summary: Von einer ZIP oder einem GitLab-Projekt zur neu gebauten Version — Analyse, Design und Testentwurf als Abschnitte einer Seite in One, Tests, die das heutige Verhalten festhalten, dann der Neubau.
---
One, der [Coding-Worker](help:coding-pipeline) und Claude Code nehmen alte Software auseinander und bauen sie neu. Jeder Schritt landet in der Seite der Aufgabe – dort liest du ihn, besprichst ihn und gibst ihn frei. Dein Code bleibt auf deinem Rechner.

## 1. Den Code zum Worker bringen
Am schnellsten **in der Aufgabe selbst**: Die Vorlage *Altsoftware modernisieren* (oder **Für Altsoftware anlegen** auf einer leeren #/coding-Seite) beginnt mit der Stufe **Import**. Eine neue Aufgabe ohne Repo wartet dort, und ihr Panel zeigt ein Feld: **ZIP** ablegen oder wählen, eine **GitLab-/GitHub-Adresse** zum Klonen einfügen oder ein Repo des Workers nehmen. Der Worker legt das neue Repository in `~/one-repos` an, die Aufgabe übernimmt es als **Repo** und geht zur Analyse weiter.

Oder auf der Setup-Seite des Workers (**Einstellungen → Coding-Worker → Repositories ändern**):
- **ZIP importieren …** – eine ZIP mit dem Quellcode wird ein neues Repository in `~/one-repos`: ein Commit *Import <Datei>*. Die eigenen `.git`-Ordner der ZIP bleiben draußen, in jeder Schreibweise, die eine Festplatte als `.git` lesen könnte (`.GIT`, `.Git`, `GIT~1` …), und beim Import läuft nichts aus der ZIP; ein Pfad, der aus ihrem Ordner herausführt, ein Name mit einem Steuerzeichen, ein in einem Ordner verstecktes git-Repository (`HEAD`, `objects`, `refs` – auch als Test-Fixture) und unter Windows ein Name mit `:` oder ein Gerätename wie `aux.c` oder `nul.txt` lehnen die ganze ZIP ab (entfernen oder umbenennen und neu zippen). Eine ZIP, die selbst ein git-Repository ist (ein „bare“ Repository), wird ebenfalls abgelehnt: klone es stattdessen oder zippe seinen Checkout. In einem importierten Repository läuft nie ein git-Filter-, Diff- oder Merge-Treiber – auch deine eigenen nicht (nbstripout, Git LFS …), weder beim Import noch später in einer Aufgabe: Seine Dateien bleiben so, wie die ZIP sie hatte, Git-LFS-Dateien als normale Dateien (das sagt die letzte Zeile seiner `.git/info/attributes`; entferne diese Zeile, um deine Treiber dort zu nutzen). Direkt danach legt **Auch auf GitLab / GitHub anlegen** (mit angemeldetem `glab` oder `gh`) das Projekt an – der Name wird aus dem Code (package.json, pom.xml, README …) oder der ZIP vorgeschlagen –, setzt es als Remote und pusht, damit **Ausliefern** Merge Requests öffnen kann.
- **Von GitLab / GitHub klonen …** – die Klon-Adresse einfügen (HTTPS oder SSH) oder eines deiner Projekte wählen (wenn `glab` oder `gh` installiert und angemeldet ist). git meldet sich mit deinem SSH-Schlüssel oder Credential-Helper an; der Worker kann kein Passwort eintippen.

Bei einem Repository, das der Worker importiert oder geklont hat, lässt Claude Code die eigenen Claude-Code-Einstellungen des Repositorys weg (`.claude/`, `.mcp.json`, `CLAUDE.md`): Ihre Hooks könnten Befehle ausführen, sobald Claude Code startet. Die Setup-Seite nennt den Grund neben dem Schalter **Eigene Claude-Code-Einstellungen dieses Repos nutzen** (*vom Worker geklont*, *im Klon-Ordner* …); schalte ihn nur für Code ein, dem du vertraust – dessen Hooks und Hilfsbefehle laufen dann auf deinem Rechner, wenn eine Aufgabe startet (er schreibt `"claude": { "projectSettings": true }` in `worker.json`). Deine eigenen MCP-Server erreichen ein solches Repository nur, wenn sie im Bereich user hinzugefügt wurden (`claude mcp add -s user …`). Beim Update von einem älteren Worker markiert er einmal, was ein älterer Worker importiert (egal wo) oder nach `~/one-repos` geklont hat, und die Setup-Seite nennt diese Repositories, bis du **Verstanden** drückst; ein Klon-Ordner deiner Wahl (etwa `~/code`) wird nie markiert – deine eigenen Repositories dort zeigen *im Klon-Ordner*, solange er der Klon-Ordner ist, mit dem Schalter, um sie einzuschalten.

Hak das Repository an, trag seinen **Testbefehl** ein, falls es einen gibt, und **Speichern & starten**. `~/one-repos` wird nicht synchronisiert – halte Repositories aus iCloud Drive und Dropbox heraus, sonst wartet git auf Dateien aus der Cloud.

## 2. Die Pipeline
Unter **#/coding → Pipeline** die Vorlage **Altsoftware modernisieren** wählen und speichern:
0. **Import**: der Code der Aufgabe – ZIP, Klon-Adresse oder ein vorhandenes Repo (siehe oben).
1. **Statische Analyse**: Linter / Compiler des Repositorys (das Feld *Statische Analyse* der Einrichtungsseite) – die Befunde landen in der Seite, und die Analyse liest sie.
2. **Analyse** (Plan-Modus – nichts wird geändert): Überblick, Architektur mit Diagramm, Datenmodell, Abhängigkeiten, Qualitäts-Brennpunkte, Risiken, das Verhalten, das bleiben muss.
3. **Design**: Zielarchitektur, UI und Design, Migration, was besser wird.
4. **Testentwurf**: Charakterisierungstests – eine Tabelle von Fällen, die das heutige Verhalten festhalten.
5. **Konzept freigeben**: die drei Abschnitte in der Seite lesen; bei Bedarf **Nacharbeit…** mit einer Notiz.
6. **Tests schreiben** gegen den alten Code, dann **Tests am Altcode** – sie müssen bestehen.
7. **Neubau**, **Test** (dieselben Tests am neuen Code), **Review**, **Ausliefern**.

Jede Plan-Stufe schreibt ihren eigenen Abschnitt in die Seite (*Analyse*, *Design*, *Testentwurf*) – so lesen die späteren Stufen, was die früheren gefunden haben. Schlagen Tests fehl, geht die Aufgabe einmal mit der Ausgabe zur Stufe davor zurück.

## 3. Die Aufgabe
**Neue Aufgabe**: das importierte Repository als **Repo**, das Ziel in ein paar Zeilen – z. B. *Verstehe das Abrechnungsmodul und baue es als typisierten Webdienst mit einer klaren Oberfläche neu. Die Rechnungsregeln bleiben.* **Freigaben**: *Plan und Review freigeben* hält nach dem Konzept an; *Nur Review* läuft bis zum Review durch.

## 4. Deine Wissensbasis
- **Claude Code auf dem Worker**: auf der Setup-Seite den Server unter *Eigene MCP-Server für Claude Code* eintragen (der Name aus `claude mcp list`, z. B. `kb`). Die Stufen dürfen dann lesen, was über den Code bekannt ist, und Erkenntnisse und Entscheidungen festhalten.
- **In One**: das KI-Terminal (<kbd>Mod+J</kbd>) mit dem Codewort des Servers – z. B. `kb: halte die Risiken dieser Analyse fest` – siehe [MCP-Server](help:mcp-servers).

## Nur verstehen?
Um den Code zu erklären, ohne ihn neu zu bauen – eine One-Seite je Komponente, ein Doku-Check – nimm die Vorlage **Code erklären**: [Altsoftware in One-Dokumenten erklären](help:explain-code).

## Tipps
- Großer Altcode: mit einem Modul anfangen – die Analyse bleibt lesbar.
- **Verwandeln in** macht aus einem Abschnitt der Analyse ein Diagramm oder eine Tabelle.
- Diff und Testausgabe jeder Stufe stehen im Aufgaben-Panel (**Diff**, **Tests**).
