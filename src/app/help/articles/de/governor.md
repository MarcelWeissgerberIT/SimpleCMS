---
id: governor
title: Regler: Budget und Rotlinie
section: ai
order: 18
keywords: regler, budget, tagesbudget, monatsbudget, rotlinie, grenze, limit, ausgabenlimit, meine grenze, geräte-limit, bremse, vorab-bremse, pause, einmal erlauben, günstigeres modell, angehalten, verbrauch, verbraucher, belege, harte grenze, governor, day budget, month budget, red line, spend limit, held, usage
related: ai-costs, ai-providers, agent, custom-agents, ai-autofill, preflight, members-roles
summary: Ein Tages- und Monatsbudget für alle KI in One, auf jedem Gerät gemessen, und deine eigene Grenze für diesen Browser. An der Rotlinie fragt One, bevor es sendet — Hintergrundarbeit pausiert.
---
Der **Regler** hält Ones KI-Ausgaben unter einer Rotlinie, die du setzt. Er zählt, was jede Anfrage auf diesem Gerät kostet — dieselben Zahlen wie die [Belege](help:ai-costs) — und bremst, **bevor** eine Anfrage hinausgeht, nie danach.

Ohne Budget ändert sich nichts: Keine Anfrage wird gebremst, gekürzt oder angehalten, der Regler zeigt nur, was verbraucht wurde.

## Ein Budget setzen
- **Workspace-Einstellungen → KI → § 06 Budget & Regler** — ein **Tagesbudget** und ein **Monatsbudget** für diesen Arbeitsbereich (Beträge in US-Dollar, etwa `6` oder `1,5`). Jedes Gerät misst für sich: Bei 6 $ am Tag dürfen Laptop und Telefon je 6 $ ausgeben. Im Team ändern es nur Eigentümer und Admins; alle anderen sehen es mit einem Schloss.
- **Einstellungen → KI → Meine Grenze in diesem Browser** — deine eigene Tages- / Monatsgrenze für diesen Browser. Sie zählt **alle Arbeitsbereiche und Konten**, die hier angemeldet sind, und wird nie synchronisiert oder gesichert. Hat der Arbeitsbereich auch ein Budget, gilt die niedrigere Rotlinie.
- **Rückgängig** stellt zurück, was das letzte Speichern geändert hat. Entfernst du ein Budget, wird nichts mehr gebremst.

## Den Verbrauch lesen
Öffne den Regler über **⌘K → Regler**, die Zelle **REGLER** in der Statusleiste (sichtbar, solange ein Budget gesetzt ist) oder die Lampe **VERBRAUCH** im Vorflug-Check. Die Seite `#/regler` zeigt:
- heute, diesen Monat und die Zahl der Läufe, mit der Skala gegen das Tagesbudget und der Marke von gestern; den Monatsbalken; die Linie deines Browsers, wenn du eine gesetzt hast;
- **Verbraucher** — wer heute was verbraucht hat: das KI-Terminal, das KI-Menü, jeder Agent, Autofill, Mail, ⌘K, die Hilfe, der Ausgang … mit ihrem Anteil, dazu Agenten, die der Regler angehalten hat;
- die **Belegrolle** — ein Abriss pro Lauf; aufgeklappt der Beleg mit Token und Modellen. **Alle** zeigt die letzten 30 Tage.

Gelesen wird erst, wenn du die Seite öffnest — ohne Budget öffnet One die Aufzeichnung beim Start nie.

## An der Rotlinie
Vor jeder Anfrage schätzt One ein Band (das Wenigste und das Meiste, was sie kosten kann) und vergleicht sein oberes Ende mit dem Rest. Was dann passiert, hängt von der Arbeit ab:

- **Deine eigene Anfrage** (KI-Menü, Umwandeln, ⌘K „?“, Hilfe fragen, ein Ausgang-Entwurf, eine Datei oder ein Bild): Eine kurze Textantwort darf mit kleinerem Antwortbudget hinausgehen — ihr Beleg sagt es. Sonst wird die Anfrage **nicht gesendet** und ein Hinweis sagt warum, mit **+1 $ einmal erlauben** (E, wenn das reicht), dem **günstigeren Modell** desselben Anbieters (wenn es passt) und Abbrechen.
- **Das [KI-Terminal](help:agent)** hält **zwischen zwei Schritten** mit einer Haltekarte: **E** erlaubt 1 $ mehr für diese Aufgabe und heute, **H** stellt mit einem günstigeren Modell desselben Anbieters fertig, wenn es das Gespräch tragen kann (sein Band enthält das erneute Schreiben des Caches), **⌘. / Strg+.** stoppt — vorgemerkte Änderungen bleiben. Solange die Karte wartet, wird nichts gesendet und nichts reserviert.
- **[Agenten](help:custom-agents)** warten nie mitten im Lauf. Ein geplanter oder ausgelöster Lauf an der Rotlinie startet nicht — ein Eintrag *vom Regler angehalten* pro Tag mit seiner Zahl, eine Notiz im Eingang, keine rote Lampe. Ein Lauf, der die Linie überquert, endet nach seinem aktuellen Schritt; seine Vorschläge bleiben, sein Stand wird nicht gespeichert. **Jetzt ausführen** fragt vor dem Start (↵ = +1 $ für diesen Lauf).
- **[Autofill](help:ai-autofill)**: Beobachtete Zeilen pausieren an der Rotlinie und bleiben über ein Neuladen pausiert; sie laufen weiter, wenn das Budget steigt, ein neuer Tag beginnt oder mit **E** im Panel. Ein Lauf, den du startest, zeigt vorher seine Schätzung gegen den Rest und wartet an der Rotlinie an einer Zeilengrenze.
- **Mails ordnen** pausiert — die Mails bleiben ungeordnet, bis du das Budget erhöhst und sie ordnest. `claude()` in einem **Skript** stoppt den Lauf („Lauf rückgängig“ wird angeboten); aus einer Automation entfällt nur dieser KI-Schritt. Ein Gedächtnis-Vorschlag nach einer Antwort wird ausgelassen.

Ein Modell ohne Preis lässt sich in keinem Budget halten: Solange ein Budget gesetzt ist, werden seine Anfragen abgelehnt.

## Vorab-Bremse, keine harte Grenze
Der Regler ist eine **Vorab-Bremse in One**: Er kann um einen Schritt überschießen (eine lange Antwort, eine Anfrage auf einem anderen Gerät). Die harte Grenze setzt du beim Anbieter:
- **Claude** — das Ausgabenlimit in der Claude Console (**console.anthropic.com → Settings → Limits**).
- **OpenRouter** — das Limit des Schlüssels (**openrouter.ai → Settings → Keys**); One zeigt den Rest live.
- **OpenAI** — das Projektlimit im OpenAI-Dashboard.

Im Team laufen Server-Agenten mit dem Schlüssel des Arbeitsbereichs und zählen hier nicht. Claude Code in einem Coding-Worker zählt ebenfalls nicht zum Tagesbudget.

## Was gespeichert wird
Das Budget gehört zum Arbeitsbereich (Team: geteilt, nur Eigentümer und Admins). Die Grenze deines Browsers und die Tagessummen des Reglers bleiben in diesem Browser — nie synchronisiert, exportiert oder gesichert — und gehen mit der Gerätekopie. Ältere Versionen von One, die ein Budget nicht halten können, bitten vor KI-Anfragen um ein Neuladen.
