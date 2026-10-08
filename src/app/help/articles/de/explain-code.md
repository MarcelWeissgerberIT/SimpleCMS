---
id: explain-code
title: Altsoftware in One-Dokumenten erklären
section: ai
order: 12
keywords: code erklären, altsoftware, legacy, alter code, dokumentation, doku, verstehen, einarbeitung, komponente, modul, architektur, seitenbaum, statische analyse, lint, linter, eslint, dotnet build, go vet, clippy, ruff, doku-check, wissensbasis, explain code, documentation check
related: legacy-modernisation, coding-pipeline, pipelines, review-merge
summary: Aus einer Codebasis, die keiner mehr versteht, werden One-Seiten – ein Überblick, die statische Analyse, eine Seite je Komponente und ein Check der vorhandenen Doku. Im Repository ändert sich nichts.
---
Mit der Vorlage **Code erklären** liest Claude Code auf deinem Rechner alten Code und schreibt, was es findet, als **One-Dokumente**: eine Seite je Komponente, miteinander verlinkt, durchsuchbar, mit Diagrammen – für neue Kolleginnen und Kollegen, für ein Audit oder vor einem Neubau. Das Repository wird nur gelesen.

## Einrichten
1. Den [Coding-Worker](help:coding-pipeline) verbinden und das Repository anhaken – oder den Code in der Aufgabe selbst bringen: Die Vorlage beginnt mit einer Stufe **Import** (ZIP ablegen oder GitLab-/GitHub-Adresse einfügen, siehe [Altsoftware modernisieren](help:legacy-modernisation)).
2. Auf einem leeren **#/coding**: **Zum Code-Erklären anlegen** – oder in einer bestehenden Pipeline **Pipeline → Code erklären → Speichern**. Lieber neben deinen anderen Aufgaben? **Neues Projekt** mit dieser Vorlage (siehe [Projekte](help:pipelines)).
3. **Neue Aufgabe**: das Repository, und im Ziel, was du wissen willst – z. B. *Wie funktioniert die Rechnungsstellung, und wo wird gerundet?*

## Die Stufen
1. **Überblick** – Zweck, wie man es startet, die Architektur mit Diagramm, die Hauptabläufe mit den beteiligten Dateien, das Datenmodell, Fremdsysteme, ein Glossar.
2. **Statische Analyse** – der Analyse-Befehl des Repositorys (unten); seine Befunde werden ein Abschnitt der Seite.
3. **Komponenten** – ein Abschnitt je Komponente; One macht aus jedem Abschnitt **eine eigene Seite** unter einer Doku-Seite (*<Aufgabe> · Komponenten*), oben in der Seitenleiste. Die Aufgabenseite führt sie als Erwähnungen auf – so liest die nächste Stufe sie mit.
4. **Doku-Check** – was README, Doku und Kommentare sagen gegenüber dem, was der Code tut: eine Tabelle, was fehlt, veraltet oder falsch ist, mit Beleg im Code und Korrektur.
5. **Doku freigeben** – lesen; **Nacharbeit…** mit einer Notiz schickt es zurück.

Später noch einmal laufen lassen (**Nacharbeit…** oder eine neue Aufgabe): Seiten gleichen Namens werden aktualisiert (von jeder bleibt eine Version im Verlauf), neue Komponenten bekommen neue Seiten, Seiten, in die du geschrieben hast, bleiben.

## Statische Analyse
Auf der Einrichtungsseite des Workers hat jedes Repository ein Feld **Statische Analyse** – vorbelegt aus dem Repository: sein `lint`-Skript, ESLint, `dotnet build` (seine Analyzer), `go vet`, `cargo clippy`, `ruff`, `flake8`. Dort änderst du ihn, z. B. `npx eslint . --max-warnings 0`. Die Stufe führt ihn im Worktree der Aufgabe aus (oder im Haupt-Checkout, wenn die Aufgabe keinen hat – sie legt keinen Branch an); ein Exit-Code ungleich 0 ist ein Befund, kein Fehler. Ohne Befehl läuft die Stufe mit einem Hinweis durch.

Jede Pipeline kann sie haben: unter **Pipeline** eine Stufe der Art **Statische Analyse** hinzufügen – z. B. vor einem Plan oder einem Review.

## Deine Wissensbasis
Mit eigenen MCP-Servern für Claude Code (Einrichtungsseite → *Eigene MCP-Server für Claude Code*, z. B. `kb`) liest jede Stufe zuerst, was über den Code schon bekannt ist, und kann festhalten, was sie gefunden hat.

> Tipp: Großer Code – fang im Ziel mit einem Modul an. **Umwandeln in** macht aus einem Abschnitt ein Diagramm oder eine Tabelle; **Für KI-Kontext kopieren** gibt eine Seite an jede andere KI.
