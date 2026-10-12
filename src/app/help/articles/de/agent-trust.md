---
id: agent-trust
title: Vertrauen pro Feld
section: ai
order: 16
keywords: vertrauen, vertrauen pro feld, direkt, urteil, urteile, grund, gründe, falsch, nicht jetzt, doppelt, schon erledigt, stichprobe, lektion, messleiste, prüftasten, verwerfen mit grund, trust, direct, verdict, reason, wrong, spot check, lesson
related: custom-agents, preflight, history, flight-recorder, memory, integrations
summary: Jeder Vorschlag, über den du einzeln entscheidest, ist ein Urteil über dieses Feld. One zeigt pro Feld, ob ein Agent sich dein Vertrauen verdient hat — und du sagst, warum du verwirfst.
---
Ein Agent, der Änderungen zur Prüfung vorschlägt, lernt aus einem bloßen „Verwerfen“ nichts. **Vertrauen pro Feld** hält auf diesem Gerät fest, wie du über jede Art von Änderung eines Agenten entschieden hast — pro Feld einer Datenbank (*Klarheit*, *Warum* …), pro neuer Zeile, pro Seite, in die er schreibt — und zeigt es auf der Seite des Agenten als Messleiste der letzten 20 Urteile.

## Verwerfen mit Grund
In der Prüfung eines Laufs (Seite des Agenten, **Läufe**) und in der Warteschlange von [Preflight](help:preflight) wirken diese Tasten auf den Vorschlag mit dem Fokus:

- **A** — übernehmen. **D** — ohne Grund verwerfen.
- **1** — als **falsch** verwerfen; auf Deutsch auch **F**, auf Englisch auch **W**. Nur das zählt gegen den Agenten (nicht bei einer Änderung an den Feldern einer Aufgabe — siehe *Was zählt*).
- **2** nicht jetzt · **3** doppelt · **4** schon erledigt — verworfen, aber am Vorschlag war nichts falsch: kein Minus für den Agenten.

In der Prüfung eines Laufs außerdem:
- **↵** (auf der Zeile selbst) — übernehmen. **Entf** (⌫ am Mac) — ohne Grund verwerfen.
- **J** / **N** / **↓** nächster · **K** / **↑** voriger · **Z** die Entscheidung in ihrer Zeile zurücknehmen. Andere Buchstaben (E, H …) tun dort nichts.

Preflight behält für die übrigen Tasten seine eigene Bedeutung — **E** zeigt mehr (den Bericht des Laufs), **Z** nimmt das zuletzt in der Warteschlange Erledigte zurück (siehe [Preflight](help:preflight)).

Nur der Vorschlag mit dem Fokus zeigt seine Tastenkappen, das orange **Übernehmen** und die Zeile **Verwerfen mit Grund**. Eine Entscheidung behält ihr **Rückgängig** in ihrer Zeile („Verworfen · falsch · Rückgängig“); der Fokus geht zum nächsten offenen Vorschlag, nie auf das Rückgängig. Tasten wirken nie, während du tippst, und nie dort, wo die Knöpfe es nicht täten: ein Workspace nur zum Lesen, ein Lauf, der noch läuft, ein Vorschlag, der erst einen anderen braucht — eine kurze Meldung sagt warum.

Auf einem Touchscreen gibt es keine Tastenkappen: **Verwerfen ▾** öffnet die Gründe — **Falsch**, **Nicht jetzt**, **Doppelt**, **Schon erledigt** — und **Ohne Grund**.

Vorschläge eines Felds mit demselben Wert, die du früher als falsch verworfen hast, stehen zusammen in einer ruhigen Zeile, etwa „Falsch × 3 · NL-216 NL-217 NL-218 · Klarheit → Blockiert“.

## Was zählt
Ein Urteil entsteht nur, wenn **du** über **einen** Vorschlag entscheidest, den du ganz gesehen hast — ein Text, der länger ist als seine Vorschau, zählt, sobald du ihn in der Prüfung des Laufs mit **… weitere Zeilen zeigen** geöffnet hast:
- **Übernommen** — das Feld zählt als richtig. Änderst du diesen Wert innerhalb von 10 Minuten selbst, zählt er stattdessen als **bearbeitet** (ändert ihn eine Automation, ein Abgleich, ein anderer Agent, ein Knopf oder „Als gesendet markieren“ im Ausgang, nicht).
- **Als falsch verworfen** — ein Minus für den Agenten.
- **Nicht jetzt**, **doppelt**, **schon erledigt** — kein Minus, und die Folge guter Urteile läuft weiter.
- **Ohne Grund verworfen** — auch kein Minus; aber mehr als zwei davon in Folge lassen das Feld warten: sag mit **1**, ob es falsch war.

Eine Änderung an den Feldern einer [Aufgabe](help:tasks) — Status, Termin, Verantwortliche oder worauf sie wartet — ergibt in dieser Version **kein Urteil**, wie auch immer du entscheidest: Die Tasten wirken darauf wie auf jeden Vorschlag, die Messleiste bleibt, wie sie ist. Text, der Aufgaben anlegt (an eine Seite angehängt, eine neue Seite oder Zeile), zählt wie jeder andere Text.

**Alle übernehmen**, **Alle verwerfen**, **⇧A** und **X** in Preflight, Agenten, die direkt anwenden, das KI-Terminal, eine Preflight-Karte, deren Inhalt noch lud, und eine Entscheidung, die der Team-Server nicht angenommen hat, schreiben **nichts**. **Rückgängig** deiner Entscheidung nimmt ihr Urteil zurück — ein Rückgängig, das ein inzwischen von dir bearbeitetes Feld stehen lässt, nimmt die Urteile der Felder zurück, die es zurückgesetzt hat.

**Auswerfen** im [Flugschreiber](help:flight-recorder) ist keine Entscheidung über einen Vorschlag: Es schreibt, löscht und ändert kein Urteil — was du vorher entschieden hast, bleibt, wie es war, und ein Vorschlag, den es zurückgenommen hat, wird nicht mehr auf deine eigene Änderung beobachtet. Seine Vorschläge heißen **Ausgeworfen** und haben keine Tasten mehr; **Auswurf zurücknehmen** bringt sie zurück, ebenfalls ohne Urteil.

## Die Messleiste
Die Platte **Vertrauen pro Feld** neben den Läufen (auf dem Telefon darunter) zeigt pro Feld die letzten 20 Urteile, das älteste links — jedes Detail ist eine Form, nicht nur eine Farbe:
- ein volles grünes Segment — unverändert übernommen · grün mit abgesetztem Fuß — Stichprobe stimmt
- ein hohles — von dir bearbeitet · ein oranges, erhöhtes mit Schlitz — falsch
- ein orange schraffiertes — rückgängig · ein niedriger Strich — noch kein Urteil

Daneben zählt „15/20“ die grünen, und eine Zeile sagt, wie weit das Feld ist — „20 in Folge“, „3 × falsch · 1 × bearbeitet“, „Oft von dir umformuliert“, „2 Urteile · zu selten“. **Freigebbar** ist ein Feld nach 20 unveränderten Übernahmen in Folge, ohne Rückgängig in den letzten 14 Tagen. Felder, die ein Agent nie direkt schreiben darf, stehen unter **Nie direkt** (*nur von Hand* im Profil der [Integration](help:integrations), der Schlüssel der Datenbank); Seitentext, neue Seiten, neue Datenbanken oder Eigenschaften, neue Optionen, der Papierkorb, Senden nach außen, Coding-Start und das Gedächtnis warten immer auf Prüfung.

In dieser Version liest die Platte nur: Jedes Feld wartet weiter auf deine Prüfung. Ein freigebbares Feld direkt schreiben zu lassen, kommt als Nächstes.

## Dieses Gerät
Urteile bleiben in diesem Browser (in einem Team-Workspace: deine, pro Mitglied). Sie werden nie abgeglichen, exportiert, gesichert oder an Claude geschickt. Entfernst du die Kopie eines Team-Workspace aus diesem Browser oder löschst du den lokalen Workspace, gehen sie mit; die Urteile längst gelöschter Agenten räumt One selbst auf.
