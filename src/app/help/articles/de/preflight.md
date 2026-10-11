---
id: preflight
title: Vorflug-Check
section: start
order: 2
keywords: Vorflug, Vorflug-Check, Lampen, Lampentafel, Master Caution, Warteschlange, quittieren, von Hand, angestaubt, ersetzt, Bordbuch, Start, morgens, preflight, lamps, queue, acknowledge, by hand, stale
related: custom-agents, agent-trust, coding-pipeline, outbox, integrations, mcp-servers, sync
summary: Eine Lampentafel auf Start zeigt, was auf dich wartet — Vorschläge, Gates, Rückfragen, abgelehnte Token, Zettel — gezählt für 0 Token; ihre Warteschlange arbeitet es per Tastatur ab.
---
Bevor ein Pilot startet, wird jede Warnlampe einmal geprüft. Der **Vorflug-Check** (Preflight) macht das für deinen Workspace: Auf **Start** zeigt eine Lampentafel, was auf dich wartet — und nur das. Jede Lampe zählt eine Art von Dingen, in deinem Browser, ohne Claude zu fragen: **Zählen kostet 0 Token**.

## Die Lampen
Eine Lampe steht nur auf der Tafel, wenn sie hier etwas zu beobachten hat (eine Coding-Lampe nur mit einer Pipeline, Mail nur mit dem Gmail-Abgleich, Worker nur mit einem Coding-Worker):

- **Vorschläge** — offene Vorschläge aus [Agenten](help:custom-agents)-Läufen, dem [AI-Terminal](help:agent), dem Gedächtnis, AI-Menü-Ergebnissen und Autofill-Prüfungen. Terminal- und Autofill-Vorschläge zählen nur in ihrem Tab.
- **Gate · Plan**, **Rückfrage Coding**, **Task gescheitert** — deine [Pipeline](help:coding-pipeline)-Aufgaben am Gate, mit Rückfrage, gescheitert oder angehalten; Versionen, die dieses Gerät bestätigen muss.
- **Eingang** — ungelesene Erinnerungen, Erwähnungen, Antworten und Agentennotizen dieses Geräts.
- **Token abgelehnt** — [MCP-Server](help:mcp-servers), deren Token abgelehnt wurde oder deren Anmeldung abgelaufen ist.
- **Ausgang** — [Zettel](help:outbox), die darauf warten, von Hand gesendet zu werden.
- **Worker offline**, **Spiegel veraltet**, **Agent verpasst**, **Sync**, **Mail**, **Cloud** — was für dich läuft und stehen geblieben ist.

## Vier Zustände
- **Dunkel** — nichts wartet. **Gelb** — etwas wartet. **Rot** (mit Kerbe ▲, auch für Farbenblinde) — etwas ist kaputt oder dringend.
- **Grau, schraffiert** — die Lampe kann gerade nicht prüfen (kein Ordnerzugriff in diesem Tab, offline). Grau heißt nie „alles in Ordnung“.
- Eine Lampe, die seit deinem letzten Blick angegangen ist, **blinkt** und trägt **neu**. ↵ auf ihr oder **MASTER CAUTION** quittiert sie: Ab dann leuchtet sie ruhig. Quittiert wird pro Gerät und Mitglied — dein Laptop quittiert nicht für dein Telefon.

## Tasten auf der Tafel
Nur mit Fokus in der Tafel: Pfeile wandern zwischen den Lampen, **Leertaste** springt zur nächsten blinkenden, **↵** öffnet ihre Warteschlange. **MASTER CAUTION** (auch oben in der Leiste) quittiert alle neuen Lampen auf einmal — ist nichts neu, klappt es die Tafel auf.

Morgens, beim ersten Öffnen an einem neuen Tag, bleibt One auf Start, wenn zuletzt Lampen leuchteten — mit der vollen Tafel und einem kurzen Lampentest. Später am Tag klappt die Tafel zu einer **Leiste** aus Punkten zusammen; sie klappt von selbst auf, wenn eine Lampe neu angeht. **Einstellungen → Darstellung → Preflight**: aus, morgens zuerst die Tafel, wann ein neuer Tag beginnt, der Lampentest.

## Die Warteschlange
↵ auf einer leuchtenden Lampe öffnet ihre **Warteschlange** unter der Tafel: eine Karte nach der anderen, die dringendste zuerst, mit genau dem, worauf die Taste wirkt — die Zeilenänderung, der Plan, die Version einer Aufgabe, der Zettel. Tasten (Fokus in der Schlange, nie in einem Textfeld):

- **A** übernehmen · **D** verwerfen · **E** mehr, wo eine Karte mehr hat (der Bericht des Laufs, das Protokoll des Workers) · **O** dort öffnen, wo es liegt
- **J / K** nächste · vorige · **Z** das Letzte hier Erledigte rückgängig · **Esc** zurück zur Tafel
- **⇧A** übernimmt alle sauberen Karten der Lampe — aber nur Karten, die in diesem Tab **ganz gezeigt** wurden, so wie sie jetzt sind. Noch nicht gesehene (oder seitdem geänderte) listet zuerst ein Blatt; ↵ dort übernimmt, was es zeigte — was inzwischen dazukommt, wartet auf das nächste ⇧A. Nie auf **Alle**.
- **X** verwirft die angestaubten (siehe unten).
- Auf dem Vorschlag eines Agenten verwerfen **1–4** mit Grund — **1** (oder **F**) heißt falsch und zählt gegen sein [Vertrauen pro Feld](help:agent-trust); **2** nicht jetzt, **3** doppelt, **4** schon erledigt zählen nicht. Ein einzelnes **A**, **D** oder ein Grund ist nur bei einer ganz gezeigten Karte ein Urteil: eine, deren Inhalt noch lud, ⇧A und X zählen nie.
- Auf dem Telefon: Karte wischen → übernehmen, ← verwerfen.

**VON HAND** markiert eine Karte, die den Coding-Worker startet, Text an Claude Code gibt, etwas hinausschickt, eine Version bestätigt, eine Anmeldung, Text von dir oder einen Blick in den Editor braucht oder Token kostet. **A** öffnet dann eine Bestätigungszeile; nur **↵** oder ein Klick auf ihre Taste bestätigt — ein zweites A nie, und solche Karten sind nie Teil von ⇧A oder einem Wischen.

## Angestaubt und ersetzt
Ein Vorschlag, den 7 Tage niemand geöffnet hat, ist **ANGESTAUBT**: Die Schlange sammelt solche am Ende mit **Alle verwerfen** (X), jeder mit Rückgängig.

Läuft ein Spiegel-Agent erneut, **ersetzt** sein neuerer Vorschlag für dieselbe Zeile und dieselben Felder die älteren, die du nie geöffnet hast: Die Karte sagt „ersetzt 2 ältere“, die alten zählen nirgends mehr. Eine Karte, die du geöffnet hast, wird nie ersetzt.

## Rückgängig
Z nimmt das Neueste zurück, das heute in diesem Tab erledigt wurde, einen ⇧A-Stapel auf einmal — über das eigene Rückgängig der Quelle (der Zeilenwert zurück, die Terminal-Änderung wieder offen, die Erinnerung entfernt, der Eingangseintrag wieder ungelesen). Manche Schritte haben keins, und Z sagt das, statt sie zu überspringen: ein freigegebenes Gate oder ein gestarteter Task (der Worker übernimmt), eine bestätigte Version, ein von Hand gesendeter Zettel, eine Anmeldung. Eine Änderung, die seitdem jemand bearbeitet hat, bleibt, wie sie jetzt ist (nur Unberührtes geht zurück), und auch das sagt Z.

## Das Bordbuch
Unter der Regelkarte listet das **Bordbuch** den heutigen Tag: Lampentest, Quittierungen, erledigte Karten, Rückgängig. Es bleibt 30 Tage auf diesem Gerät — nur Kennungen und Ergebnisse, nie Text — und geht mit der Gerätekopie oder einem Zurücksetzen. Die Anzeige nimmt daraus das Tempo („≈ 2 min“).

## Was keine Lampe ist
Änderungen, die auf den Team-Server warten, Freigaben der [MCP-Brücke](help:mcp-bridge) in Claude Desktop und offline sein zeigt One dort, wo es passiert, nicht auf der Tafel. Im Team zählen Vorschläge und Fehler eines Server-Agenten nur für das Mitglied, das ihn angelegt hat; deine privaten Pipelines nur für dich.
