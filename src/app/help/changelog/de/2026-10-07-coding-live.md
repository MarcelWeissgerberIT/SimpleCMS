---
id: 2026-10-07-coding-live
date: 2026-10-07
order: 1
title: Coding-Aufgaben, denen man zusehen kann
summary: Während eine Coding-Aufgabe läuft, zeigt ihr Panel, was der Worker zuletzt getan hat und wann, den Schritt von der Grenze der Stufe, eine Kostenschätzung und die bisher geänderten Dateien — und der Browser meldet sich, wenn eine Aufgabe dich braucht.
image: assets/shots/changelog/coding-live.webp
alt: Eine Coding-Aufgabe in der Stufe Implement — die Jetzt-Zeile mit Claudes letzter Nachricht vor wenigen Sekunden, die Chips Step 6/30, ≈ +$0.07 und Files 1 +4 −1
help: coding-pipeline
try: coding
---
**Jetzt.** Während eine Stufe läuft, zeigt das Aufgaben-Panel die letzte Zeile des Workers und wie lange sie her ist — die Zeit läuft mit, eine stille Minute sieht man also als stille Minute. **#/coding** zeigt dieselbe Zeile unter jeder laufenden Aufgabe.

**Zähler.** **Schritt 6/30** ist der Schritt von Claude Code von der Grenze der Stufe (*Max. Schritte* in der Pipeline). **≈ +0,07 $** hat diese Stufe bisher gekostet, zusätzlich zu den Kosten der Aufgabe oben — geschätzt aus den Tokens; den genauen Betrag gibt es weiterhin am Ende der Stufe. **Dateien** zählt, was sich im Worktree der Aufgabe geändert hat, mit hinzugefügten und entfernten Zeilen — es läuft mit, während Claude Code arbeitet, und ein Klick öffnet den Diff.

**Benachrichtigungen.** In **Einstellungen → Coding-Worker** *Benachrichtigen, solange One im Hintergrund ist* einschalten: Wartet eine Aufgabe an einer Freigabe, hat eine Frage, schlägt fehl oder ist fertig, während der Tab im Hintergrund ist, meldet sich der Browser. Ein Klick holt One mit der Aufgabe nach vorn. Die Einstellung gilt auf diesem Gerät.

**Auf Deutsch.** Die eigenen Zeilen des Workers (Stufe, Branch, Abruf, Tests, Commit, Push) erscheinen jetzt auch auf Deutsch. Lade den Worker neu herunter (**Einstellungen → Coding-Worker**), um Zähler und Live-Diff zu bekommen.
