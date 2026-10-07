---
id: review-merge
title: KI-Review und Merge Requests aus One
section: ai
order: 13
keywords: review, code review, ki-review, merge request, mr, pull request, pr, mergen, kommentar, gitlab, github, glab, gh, freigeben, browser, playwright, ui-check, screenshot, statische analyse, ai review, merge
related: coding-pipeline, explain-code, pipelines, mcp-servers
summary: Claude prüft den Diff des Merge Requests, du liest das Review in One, dann postet One es am Merge Request und mergt ihn – mit deinem eigenen glab / gh.
---
Die Vorlage **Review & Merge** bringt eine Coding-Aufgabe bis zum Ende: Nach **Ausliefern** (der Merge / Pull Request ist offen) prüft Claude Code, was der Branch ändert, du entscheidest – und der Worker postet das Review und mergt.

## Die Stufen nach „Ausliefern“
1. **KI-Review** – eine Dokument-Stufe mit dem Ergebnis *Review*. Sie läuft im Worktree der Aufgabe und bekommt den ganzen Diff des Branches gegenüber der Basis: Korrektheit, Sicherheit, Fehlerbehandlung, Tests, Lesbarkeit. Das Review ist ein Abschnitt der Seite: **Freigeben** oder **Änderungen nötig**, dann Befunde mit Datei:Zeile, Schwere und Korrektur.
2. **Review & Merge freigeben** – das Tor. Noch ist nichts gepostet oder gemergt. Nicht zufrieden? **Nacharbeit…** schickt eine Notiz an das Review; um den Code zu ändern, schieb die Aufgabe zurück nach **Umsetzen**.
3. **Review posten** – das Review wird ein Kommentar am Merge Request (`glab mr note` / `gh pr comment`), unter deinem Namen.
4. **Mergen** – `glab mr merge` / `gh pr merge` (Merge-Commit; Squash oder Rebase, wenn das Repository nur das erlaubt). Was nicht gepusht ist, wird nicht gemergt: Ungespeicherte oder ungepushte Arbeit hält die Stufe an. Der Branch bleibt – **Aufräumen** entfernt ihn danach.

## Von Hand
Im Tab **Git** der Aufgabe: **Review posten** (das neueste Review der Aufgabe) und **Mergen** – beide fragen vorher. Sie funktionieren in jeder Coding-Pipeline mit einer Review-Stufe.

## Voraussetzungen
- `glab` (GitLab) oder `gh` (GitHub) auf dem Rechner des Workers installiert und angemeldet (`glab auth login` / `gh auth login`), und für das Repository *Pull Requests: mit glab / gh* auf der Einrichtungsseite.
- Jede Pipeline kann es nutzen: unter **Pipeline** die Aktion einer **Git**-Stufe *Review an den Merge Request posten* / *Merge Request mergen*, und das Ergebnis *Review* einer Dokument-Stufe.

## Die Oberfläche im Browser prüfen
Gib Claude Code einen Browser: Füge auf dem Rechner des Workers den Playwright-MCP-Server für Claude Code hinzu (`claude mcp add playwright npx @playwright/mcp@latest`) und trage auf der Einrichtungsseite unter *Eigene MCP-Server für Claude Code* `playwright` ein. Nenne in der Aufgabe die Adresse, unter der die Änderung läuft (z. B. ein Vorschau-Link) – das Review öffnet sie dann und prüft auch die geänderten Ansichten. One liest nie deine eigenen Browser-Tabs.

## Vorher statische Analyse
Stell eine Stufe **Statische Analyse** vor das Review: Ihre Befunde stehen in der Seite, und das Review liest sie – siehe [Altsoftware erklären](help:explain-code).
