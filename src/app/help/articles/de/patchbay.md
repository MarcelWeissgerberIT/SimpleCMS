---
id: patchbay
title: Schaltplan: was von allein läuft
section: ai
order: 19
keywords: schaltplan, verdrahtung, rack, kabel, buchsen, module, was von allein läuft, sicherung, sicherungen, offener weg, weg nach außen, inhalt von außen, private daten, weg zulassen, zugelassen, zulassung erloschen, auf vorschläge stellen, nur von hand, schreib-werkzeuge abklemmen, hier unbekannt, fast offen, einrichten, lampen, profil einrichten, profil ablegen, integration.json, zurück zur einrichtung, live, läufe heute, patchen, verbinden mit, abziehen, stränge, netz-marke, ganzer arbeitsbereich, patchbay, fuse, allow this path, wiring, patching
related: automations, custom-agents, integrations, mcp-servers, outbox, governor, agent-trust, ai-autofill, mcp-bridge, preflight
summary: Eine Seite zeigt alles, was von allein läuft — Agenten, Automationen, Skripte, MCP-Server, Pipelines — als Rack mit Kabeln. Sicherungen markieren die Wege, auf denen Inhalt von außen private Daten hinausschicken könnte, ohne dass ein Mensch dazwischen ist.
---
Agenten, Automationen, Autofill, Skripte, MCP-Server, das Mail-Sortieren, der Sync und die Coding-Pipeline haben je einen eigenen Editor. Der **Schaltplan** bringt sie auf ein Rack: was was startet, was wo liest und schreibt, und welche Wege aus One hinausführen. Er beantwortet zwei Fragen — *was läuft hier von allein?* und *wo könnte eine Mail mit versteckter Anweisung meine Daten hinausschicken lassen?*

Du öffnest ihn über die Taste **Schaltplan** unter **Werkzeuge** in der Seitenleiste (zwischen Skripte und Bausteine), mit ⌘K **Schaltplan**, unter **Workspace-Einstellungen → Automatisierung** (**Als Schaltplan**, oder **Im Schaltplan zeigen** an einer Zeile), über die Zelle **SCHALTPLAN** in der Statusleiste oder die Lampe **SICHERUNG OFFEN** im Vorflug-Check. Das Öffnen sendet nichts an eine KI und ändert nichts.

## Das Rack lesen
- **Drei Spalten.** **§ 01 Quellen** — Uhren, Zeilen-Auslöser, MCP-Server, eingehende Webhooks, Sync, abgelegte Webseiten, Knöpfe und Befehle. **§ 02 Verarbeitung** — Agenten, Automationen, Skripte, KI-Autofill, Mail sortieren, die Brücke, Pipelines. **§ 03 Ziele** — Datenbanken und Seiten, der Ausgang und die Wege nach außen (beschriftet mit ihrer Art: WEBHOOK, GIT, HTTP, MCP, SYNC).
- **Buchsen** an einem Modul: **START**, **LESEN**, **SCHREIBEN?** (Werkzeuge, die schreiben können), **OUT n · VON HAND** (Werkzeuge, die nur der [Ausgang](help:outbox) aufruft). Ein **?** heißt: Lesen / Schreiben wurde aus den Werkzeugnamen geraten.
- **Kabel.** Durchgezogen: liest, schreibt, startet. **Gestrichelt: kann — die KI entscheidet** (ein Agent *darf* dort schreiben). **Schraffiert: Inhalt von außen.** **Orange: der Weg einer Sicherung.**
- **Netz-Marken.** Zwei Fähnchen mit demselben Namen sind dieselbe Verbindung — rechts setzt ein Agent *„Weiterleiten“*, links startet die Automation, die auf *„Weiterleiten“* hört. So laufen alle Kabel von links nach rechts.
- **Ganzer Arbeitsbereich.** Ein Agent, der alles nutzen darf, bekommt ein gestricheltes Kabel zu **Ganzer Arbeitsbereich · n Datenbanken** statt eines Kabels pro Datenbank. Ab dem siebten Kabel aus einer Buchse werden Kabel zu einem **+n**-Chip gebündelt; ↵ listet sie auf.
- **Eingeklappt.** *n ruhend* (kein Kabel), *n aus* (ausgeschaltet — läuft nur von Hand), *n ausgeblendet* (vom Filter). ↵ klappt sie auf.
- **Die Anzeige** zählt Module, Kabel (*n nach Wahl der KI*), **Läufe heute auf diesem Gerät** mit ihren Kosten und die Sicherungen. **Alle Datenbanken ▾** grenzt das Rack ein (Voreinstellungen: *Alles*, *Nur Sicherungswege*, *Läuft gerade*, ein Profil, gewählte Datenbanken). **Als Bild · Zoom** öffnet ein statisches Bild mit Minikarte und SVG-Download; **Als Liste** führt zu Workspace-Einstellungen → Automatisierung.
- **§ Im Klartext** unter dem Rack sagt jeden Strang in einem Satz — dieselben Worte, die ein Screenreader an jedem Modul vorliest.

Jede Zahl im Kopf passt zu dem, was gezeichnet und eingeklappt ist, und Seitenleiste, Statusleiste und Vorflug-Check zeigen dieselbe Zahl offener Sicherungen.

## Sicherungen
Eine **Sicherung** leuchtet auf einem Weg, auf dem eine KI selbst entscheidet (1) und drei Bedingungen zusammenkommen (2–4) — die drei Lampen auf der Platte der Sicherung:

1. **Eine KI entscheidet**, ohne dass ein Mensch jede Aktion freigibt: ein [eigener Agent](help:custom-agents) (auch ein ausgeschalteter — *Jetzt ausführen* ist einen Druck entfernt), [KI-Autofill](help:ai-autofill), das automatisch füllt, das Mail-Sortieren nach jedem Sync, oder die [Brücke](help:mcp-bridge), wenn Claude Desktop / Code ohne Rückfrage schreiben darf.
2. **Inhalt von außen erreicht sie**: Zeilen einer Mail-Datenbank, Leseergebnisse eines MCP-Servers, der Inhalt eines Webhooks, der einen Server-Agenten startet, Zeilen aus einem eingehenden Webhook oder API-Token, Seiten, die der GitHub-Sync holt, abgelegte Webseiten — und jeder Ort, den etwas schreibt, das selbst von außen gespeist wird.
3. **Private Daten sind in Reichweite** — mehr als die eine Zeile, die den Inhalt gebracht hat, und die eigene Berichtsseite des Agenten: andere Zeilen, andere Seiten, *alles*, die Lese-Werkzeuge eines anderen Servers, das Gedächtnis.
4. **Ein Weg nach außen ohne einen Menschen dazwischen**: der Webhook einer Automation nach einem direkten Schreiben der KI, die eigenen MCP-Schreib-Werkzeuge der KI, die MCP-Server, die Autofill bekommt, weil sie auf *Alle KI-Aufrufe* stehen, der automatische GitHub-Push dieses Geräts, ein Git-Schritt einer Pipeline ohne Freigabe.

Jede Sicherung bekommt eine Marke (**F1**, **F2** …) auf ihrem Weg und eine Platte unter dem Rack: die drei Lampen mit dem, was sie entzündet hat, den Weg als Chips, einen Satz, die Fakten (Schreibmodus, Zugriff, Auslöser, Länge der Kette) und die Tasten. Die Prüfung verfolgt jeden Weg bis zum Ende; nur die Zeichnung klappt lange Wege ein (**+n Schritte**).

**Ein Mensch dazwischen schließt einen Weg**: Vorschläge zur Prüfung, ein Skript-Effekt, der fragt, die Brücke, die vor jedem Schreiben fragt, eine Coding-Aufgabe, die auf Bestätigung oder Freigabe wartet, eine Sendung von Hand im Ausgang. Solche Wege — und Wege, die eine Datenregel oder eine fehlende Lampe schließt — stehen in der Sicherungsliste als **Fast offen**: nie gezählt, damit du siehst, was sie geschlossen hält. Vorschläge halten MCP-Werkzeuge nicht auf: Diese laufen in der Werkzeug-Schleife der KI.

**Hier unbekannt** (ein graues **?**) ist ein Teil, das dieses Gerät nicht sehen kann — der Browser-Agent eines anderen Mitglieds und seine Server, die Laufzeit der Server-Agenten, die nur Eigentümer und Admins lesen dürfen, neuere Einstellungen, ein Skript, das Orte beim Namen nennt, eine Coding-Pipeline, deren Aufgaben Inhalt von außen tragen, während Claude Code daran arbeitet und der Git-Schritt ohne einen Menschen dazwischen hinausgeht. Es zählt nie als Sicherung und gilt nie als sicher.

**Werkzeuglisten.** Die Werkzeuge eines Servers teilen sich in LESEN, SCHREIBEN? und OUT. Ein Server, den hier niemand getestet hat und der ohne Auswahl der Werkzeuge angehängt ist, zählt mit **allen** Werkzeugen: *Werkzeuge unbekannt — Server testen oder Werkzeuge eingrenzen*. Ein Integrationsprofil kann Werkzeuge als lesend erklären; ein Werkzeug, dessen Name nach Schreiben klingt, bleibt trotzdem bei SCHREIBEN?. Lese-Werkzeuge, deren Namen nach dem Web klingen (fetch, url, search …), stehen weiter unter *Bleibt verbunden* — sie können Daten in ihren Argumenten mitnehmen.

> Eine Sicherung ist aus den Einstellungen gelesen — sie **schützt nicht während eines Laufs**. One sieht nicht: Importe und den Ordner-Sync (gelten als deine eigenen Dateien), was du tippst, geteilte Formulare (ihre Antworten landen nie in One), Lese-Werkzeuge, die über ihre Argumente etwas hinausgeben, und die eigenen Werkzeuge von Claude Code im Coding-Worker oder des Claude hinter der Brücke. Was schon hilft — der [Vorprüfer](help:ai-jev), die gesperrten Werkzeuge des Ausgangs, Web-Bilder, die zu Links werden — steht in den Fakten, schließt eine Sicherung aber nicht.

## Die Tasten einer Sicherung
Die Tasten der Platte ändern die **echte Einstellung**, mit demselben Schreiber wie ihr Editor:

1. **Die KI von „direkt“ nehmen** — *Auf Vorschläge stellen* (der Agent), *Autofill nur von Hand*, *Mail nur von Hand sortieren* oder *Brücke: vor jedem Schreiben fragen*. Die Zeile unter der Taste sagt, was weiter passiert („Anwenden löst … trotzdem aus“). Eine Füllung, die du von Hand startest, trägt die Server für „Alle KI-Aufrufe“ weiter mit und schreibt mit „Ohne Prüfung übernehmen“ direkt in die Zellen — *Autofill nur von Hand* gibt es deshalb nur dort, wo die Prüfung den Weg dann wirklich anhält; ein Autofill, das schon nur von Hand läuft, bleibt mit „läuft nur von Hand“ auf seiner Sicherung.
2. **Auslöser oder Werkzeuge kappen** — *„Feld“ nur von Hand* (Agenten und die Brücke schreiben das Feld nie, lösen also die Automation, die darauf hört, nicht mehr aus), *Schreib-Werkzeuge abklemmen* (beim Agenten bleiben nur die Lese-Werkzeuge des Servers) oder *Server: nicht mehr für Autofill* (**nur auf diesem Gerät** — andere Geräte behalten den Weg).
3. **Weg zulassen** — dein Name und das Datum. Der Weg zählt nicht mehr, solange sich an ihm nichts ändert; jede Änderung an einem Modul darauf (eine neue Webhook-Adresse, ein anderer Schreibmodus, mehr Werkzeuge) beendet die Zulassung: *Zulassung erloschen: … geändert*. **Zulassung zurückziehen** nimmt sie zurück.

Die Ziffern <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> wirken, solange die Sicherungsliste oder ihre Platte die Tastatur hat. Nach Taste 1 oder 2 wird die Platte schwarz: **Für diesen Besuch geschlossen**, mit Rückgängig. Jede Taste zeigt eine Meldung mit **Rückgängig**, das von jeder Seite aus wirkt; <kbd>Mod+Z</kbd> im Schaltplan nimmt die letzte Taste zurück. Rückgängig lehnt ab, wenn sich die Einstellung seitdem geändert hat — *Seitdem geändert — Editor öffnen*. **Link kopieren** gibt eine Sicherung an jemand anderen weiter (`#/patchbay?f=…`).

Dort, wo die Einstellung lebt, steht es auch: *Liegt auf Sicherung F1 — im Schaltplan zeigen* im Agenten-Editor, in seiner MCP-Werkzeugliste und in den Automationen der Datenbank.

**Im Team** nutzt jedes Mitglied, das bearbeiten darf, die Tasten 1 und 2 mit den Rechten der Editoren; bist du nicht die Person, die den Agenten angelegt hat, muss diese den Agenten danach bestätigen — die Taste sagt es vorher. Einen Weg zulassen dürfen nur **Eigentümer und Admins** — sonst nennt die Taste ihre Namen. Eine Sicherung, die nur der Browser eines anderen Mitglieds sehen kann, zeigt sich Eigentümern und Admins als graue Zeile: Dieses Mitglied kann sie mit Taste 1 oder 2 schließen. Wer nur lesen darf, sieht das Rack; jede Taste bleibt dann ohne Wirkung.

Die Tasten 1 und 2 funktionieren ohne ein [Integrationsprofil](help:integrations), das „Nur von Hand“ oder Werkzeuglisten freischaltet: Sie nehmen nur Fähigkeiten weg. Steht ein Feld einmal auf *Nur von Hand*, zeigt sein Eigenschaftsmenü den Schalter allen, damit er dort immer wieder ausgeschaltet werden kann.

## Ein Profil einrichten
Leg eine `.integration.json` auf dem Rack ab, oder nimm **Profil hier ablegen** (Datei wählen, oder ihren Text einfügen — geprüft, bevor etwas gespeichert wird). **Workspace-Einstellungen → Integrationen → Im Schaltplan einrichten** tut dasselbe für ein vorhandenes Profil (das liest nur, darum darf es jedes Mitglied). Im Team legen nur Eigentümer und Admins Profile an.

Die Seite zeigt den Teil des Racks, den das Profil berührt, in einem Band — was es schon gibt, und gepunktete Module, die die Einrichtung anlegt — und klappt den Rest ein. Darunter **§ 00 Einrichten · n Lampen · in dieser Reihenfolge**:

- **00 Schlüssel** · **01 Server** · **02 Test** · **03 Profil** · und pro Rezept **04 Datenbank** · **05 Agent** · **06 Erster Lauf**.
- Jede Lampe sagt ihren Stand in Worten (*Erledigt*, *Als Nächstes*, *Später*) und, solange sie dunkel ist, in einem Satz, was fehlt. Nur die nächste Lampe trägt die Haupttaste, und ↵ öffnet genau diesen Schritt — die Schlüssel-Einrichtung, die Server-Einstellungen, den Agenten-Editor oder die Spiegel-Einrichtung als Dialog über dem Schaltplan.
- Ein Schritt, der woanders hinführt (der Test, das Profil, das Prüfen der Vorschläge des ersten Laufs), lässt oben einen Chip stehen: **Zurück zur Einrichtung · 05 als Nächstes ↵**.
- Rückgängig (<kbd>Mod+Z</kbd> oder die Taste des Bands) nimmt das Ablegen zurück, bis ein Lampen-Schritt etwas angelegt hat; danach wird das Profil nur unter Integrationen entfernt. Spätere Besuche zeigen statt des Bands eine Zeile mit dem nächsten Schritt.

## Live
Solange die Seite offen ist, leuchten Läufe **auf diesem Gerät** auf: Die Lampe des Moduls blinkt, ein Punkt wandert über seine Kabel, und kleine Fenster sagen *LÄUFT 0:04 · 0,21 $*, *07:30:00 AUSGELÖST* oder *+3 ZUR PRÜFUNG*. Ein fehlgeschlagener Lauf zeigt eine rote Lampe und **! FEHLER**; einen Lauf, den der Regler angehalten hat, zeigt **ANGEHALTEN**, nie rot. Automationen leuchten nur im Tab, in dem sie laufen; Agenten, die in einem anderen Tab dieses Browsers laufen, zeigen Lampe und Fenster; Server-Agenten sagen *auf dem Server*. Mit reduzierter Bewegung gibt es keinen Punkt und kein Blinken — die Kabel des Laufs werden kräftiger gezeichnet.

## Patchen
Der Schalter **Patchen** im Kopf (aus, bis du ihn einschaltest; dieses Gerät merkt ihn sich) lässt dich die Verdrahtung am Rack ändern:

- Von einer Buchse auf eine helle Buchse ziehen — oder auf einer Buchse klicken, tippen oder <kbd>J</kbd> drücken für **Verbinden mit …**: Es listet, was passt, und warum der Rest nicht passt. <kbd>Entf</kbd> auf einer gesteckten Buchse zieht das Kabel ab.
- Ein Kabel bedeutet eine echte Einstellung: den Auslöser eines Agenten, seine Datenbanken, seine Berichtsseite, seine MCP-Server und Werkzeuge, den Auslöser oder das Skript einer Automation, einen Befehl einer Datenbank. Die Prüfungen der Editoren gelten.
- **Wege nach außen entstehen in ihrem Editor** — eine Webhook-Adresse wird hier nie getippt; Wege nach außen lassen sich nur abziehen.
- Ein Kabel, das einen Weg nach außen öffnen würde, zeigt **+F2**, bevor du loslässt, und fragt vorher: *Das öffnet einen Weg nach außen — Sicherung F2. Trotzdem stecken?*
- Eigentümer und Admins können ein Werkzeug eines Servers für den Ausgang sperren (**Werkzeug sperren (OUT)**), über das passende Integrationsprofil.
- Jedes Stecken hat Rückgängig (Meldung, <kbd>Mod+Z</kbd> hier). Wer nur lesen darf, kann nicht patchen; die Knöpfe für Modell und Budget öffnen ihren Editor.

## Tastatur
<kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> wechseln zwischen Modulen · <kbd>Enter</kbd> öffnet den Editor eines Moduls · <kbd>Leertaste</kbd> zeigt seine Verbindungen (und markiert seinen Satz im *Klartext*) · <kbd>J</kbd> sucht eine Buchse · <kbd>F</kbd> springt zur nächsten Sicherung · <kbd>Tab</kbd> verlässt das Rack zur Sicherungsliste · <kbd>Esc</kbd> bricht ein Ziehen ab, dann die Auswahl.

## Auf dem Telefon
Das Rack wird zu **Strängen** — eine Karte pro Verarbeitung mit ihren Quellen und Zielen in Worten, offene Sicherungen zuerst, dann *Nicht verarbeitet* für alles, was nichts ausführt. Ein laufender Strang leuchtet an seinem Platz; ein Chip unten am Bildschirm springt zu ihm. Sicherungstasten und Einrichtungs-Lampen funktionieren dort; Patchen nicht.

## Was auf diesem Gerät bleibt
Die Läufe des Tages, was der Schaltplan beim Öffnen gelesen hat (nur IDs, nie Text), der Stand der Einrichtung, der Schalter Patchen und die Reihenfolge im Rack bleiben in diesem Browser — nie synchronisiert, exportiert oder in ein Backup übernommen — und gehen mit der Gerätekopie. Zugelassene Wege gehören zum Arbeitsbereich: im Team geteilt, in vollständigen Backups enthalten und beim Wiederherstellen nie aus einem Backup übernommen.
