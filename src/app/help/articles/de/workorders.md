---
id: workorders
title: Prüfaufträge: von der Bitte zur laufenden Kette
section: ai
order: 20
keywords: Prüfauftrag, Prüfaufträge, Auftrag, Prüfen lassen, prüf mal, Kette, Planer, Planen, Kette bereit, Kette starten, Schritt, nächster Schritt, Grundlage, Business-Analyse, Coding, QA, Nach der Analyse anhalten, Weiter, Anpassen, Ab hier neu planen, Anhalten, Fortsetzen, Schritt überspringen, Alle Ketten anhalten, Budget je Kette, Ohne Bestätigung starten, Kontext, MCP-Server, Lese-Werkzeuge, fremd, von Hand, work order, work orders, have it checked, chain, planner, start chain, basis
related: coding-pipeline, pipelines, preflight, patchbay, mcp-servers, governor, ai-jev, sync, flight-recorder
summary: Schreib auf, was geprüft werden soll — One plant daraus eine Kette von Pipeline-Aufgaben (Business-Analyse, Coding, QA), zeigt jeden Schritt vollständig und lässt sie nacheinander laufen, sobald du sie startest.
---
Schreib auf, was geprüft werden soll — in einer Zeile der Datenbank **Prüfaufträge** oder auf jeder beliebigen Seite mit **Prüfen lassen**. Ein Druck genügt: One liest den Auftrag und die Seiten, die er verlinkt, und plant daraus eine **Kette** von Pipeline-Aufgaben — zuerst [Business-Analyse](help:pipelines), dann [Coding](help:coding-pipeline), dann QA. Du siehst jeden Schritt vollständig auf einer Platte; **↵ Kette starten** legt alle Aufgaben an, und sie laufen von selbst nacheinander. Standardmäßig hält die Kette einmal nach der Analyse an, damit du siehst, was Coding tun wird, bevor es losgeht.

Das alles braucht **Coding an auf diesem Gerät** und einen verbundenen [Coding-Worker](help:coding-pipeline). Einer deiner eigenen [MCP-Server](help:mcp-servers) kann Kontext beisteuern — als Option: ohne ihn plant One nur aus dem Auftrag und seinen Seiten.

## Geführter Aufgabenstart bis zur Abnahme

**Aufgabe geführt starten …** im Seitenmenü übernimmt die aktuelle Seite als Ausgangspunkt. Ein neuer Prüfauftrag bietet alternativ ein Zielfeld: **Kontext prüfen & Vorschlag vorbereiten**. Die Aufgabenbegleitung zeigt fünf Stationen: Ziel & Kontext, Vorschlag, Umsetzung, Nachweise und Abnahme. Sie lässt sich über ihre Kopfzeile einklappen; ONE merkt sich diese Ansicht in diesem Browser. Sie erzeugt keine zusätzlichen Benachrichtigungen oder Modellaufrufe.

Der Planer nutzt erlaubte Quellen und vorhandene Antworten zuerst. Reversible Details stehen als **Arbeitsannahmen** im Plan und lassen sich dort einzeln entfernen. Sie werden mit dem Plan bestätigt und in die Arbeitspakete übernommen. Fachliche Entscheidungen, Berechtigungen und erfolgreiche Tests darf er nicht annehmen. Rückfragen sind für echte Blocker reserviert und sollen gebündelt werden. Deine bestehenden Pipeline-Freigaben, Datenregeln und Budgets gelten weiter.

**Fertig in der Pipeline bedeutet noch nicht fachlich abgenommen.** Die Begleitung stellt die Nachweise auf dem ausführenden Gerät zusammen. Coding-Aufträge brauchen einen bestätigten Lieferumfang, abgeschlossene Arbeitspakete und einen erfolgreichen finalen QA-Lauf auf dem gemeinsamen Branch mit tatsächlich ausgeführtem Test (Exit-Code 0). Übersprungene Arbeit, geänderte ONE-Quellen oder seit der QA geänderte Coding-Pakete verhindern die Abnahme. Ältere Läufe ohne den neuen QA-Nachweis müssen erneut geprüft werden. Reine Analyse-Aufträge benötigen keinen erfundenen Coding-Test.

**Ergebnis fachlich abnehmen** bestätigt genau den angezeigten Nachweisstand. ONE legt einen Bericht im Prüfauftrag ab und merkt die Entscheidung auf diesem Gerät. Änderungen am Nachweisstand machen diese Entscheidung in der Begleitung ungültig; der alte Bericht bleibt als historischer Nachweis erhalten. Das ist keine revisionssichere Serversignatur und keine Live-Prüfung späterer Änderungen im lokalen Repository.

**Übergabe an … vorbereiten** nutzt den im Plan gewählten MCP-Server, zum Beispiel Atlas, und öffnet einen Entwurf im KI-Terminal. Es wird noch nichts gesendet. Nach deinem Start soll das Terminal aktuelle Ziel-Records, Workspace und Projekt prüfen, vorhandene Nachweise anhand der Nachweisstand-ID abgleichen und gemäß den bestehenden Freigaben arbeiten. Fehlende Ziele oder Rechte bleiben als konkrete Blocker sichtbar. Der Bericht allein behauptet keine erfolgreiche Atlas-Synchronisation. Ein bereits laufendes Terminal oder ein vorhandener Entwurf wird nicht überschrieben.

## Einen Auftrag schreiben
- **Auf jeder Seite**: ⋯ → **Prüfen lassen** (auch im Menü der Seitenleisten-Zeile und in ⌘K). Beim ersten Mal legt One die Datenbank **Prüfaufträge** an — der Hinweis *Prüfaufträge angelegt · PA-1* hat **Rückgängig**. One legt eine Zeile mit dem Titel der Seite an, im Text *Seite: @die Seite*, und beginnt zu planen; die Seite selbst bleibt unverändert. **Aufgabe geführt starten …** fragt vorher nach einem Satz (*Worauf soll geachtet werden?*), der über der Erwähnung steht.
- Verlinkt schon ein offener Auftrag die Seite, öffnet sich dieser — *Schon in PA-3 (Planen)*, mit **Neuer Auftrag** im Hinweis.
- **In der Datenbank**: eine neue Zeile bleibt **Entwurf**, solange du schreibst, etwa *prüfe, warum der Login nach 30 s abbricht, siehe @Supportfall 4711, Repo website*. Nichts plant von selbst.
- **#/coding** hat neben den Pipelines eine Taste **Prüfaufträge · 2 offen** (<kbd>N</kbd> dort legt einen neuen Auftrag an); **Einstellungen → Coding-Worker → Prüfaufträge** legt die Datenbank an oder öffnet sie.

Die Datenbank hat ein **Board** nach Status — **Entwurf · Planen · Kette bereit · Läuft · Angehalten · Fertig** — und eine **Tabelle**. Felder: Name, Status, Repo, Pipelines, Priorität, ID (*PA-12*), Erstellt. **Repo** und **Pipelines** einer Zeile gehen den Einstellungen vor. Dass etwas auf dich wartet, zeigt ein Chip auf der Karte (*02 Coding · Review ●*), nie eine eigene Spalte.

## Planen
Geplant wird nur auf deinen eigenen Druck in diesem Tab: Status → **Planen** (oder in diese Spalte ziehen), der Datenbank-Befehl **Planen**, **↵ Planen** auf der Platte des Auftrags oder **Prüfen lassen**. Ein Agent, eine Automation, ein Skript, der Sync, eine Vorlage, ein Import oder ein Rückgängig planen nie.

Bevor etwas gelesen oder gesendet wird, prüft die Platte: Coding an, Worker verbunden und aktuell, eine Pipeline, die eine Kette aufnehmen kann, KI für diese Art Arbeit eingerichtet und ein Auftrag, der nicht leer ist. Was fehlt, steht dort mit seiner Taste — und es wird nichts gesendet. Ist der Worker gerade weg? Dann merkt sich One deinen Druck und plant, sobald er zurück ist, bis zu 24 Stunden lang (*Plant, sobald der Worker zurück ist (bis 14:30)*).

Während One plant, zeigt die Platte **§ PRÜFAUFTRAG · PA-12 · PLANER**, was gelesen wird — *Auftrag gelesen · 1.240 Zeichen · 1 verlinkte Seite*, jeden Abruf bei deinem Server mit Werkzeug, Argumenten und Größe — und was die Planung kostet. <kbd>Mod+.</kbd> bricht ab; es wird nichts angelegt.

## Die Kette auf der Platte
Steht der Plan, steht der Auftrag auf **Kette bereit** (auch als Karte im [Vorflug-Check](help:preflight)):

- **Verstanden:** — die Zusammenfassung des Planers. Mit Server: **Kontext · Zusammenfassung des Planers**, als **FREMD** markiert, über allen Abrufen, die gemacht wurden; sie *geht in Schritt 01 mit*.
- **Eine Station je Schritt**, nie abgeschnitten: Art, Titel, Projekt, Repo, Modell, **stoppt bei:** (wo er unter den Freigaben dieses Geräts auf dich wartet), warum, das Ziel, die Kriterien, die Seiten, die mitgehen (jede mit ihrer Marke — **PRIVAT**, **MAIL**, **FREMD** — und ihrem Text zum Aufklappen), der Branch (*neu*, oder *von Schritt 02 (gemeinsam)* bei QA) und der *nächste Schritt*.
- **Offen:** — die Rückfragen des Planers, jede mit einem Antwortfeld. Deine Antworten kommen unter *Antworten* in den Auftrag, und One plant neu.
- Über der Starttaste: was Claude Code bisher je Art Aufgabe gekostet hat (*Ø 1,20 $ je Coding-Aufgabe (letzte 10) · der Regler begrenzt das nicht*) und das Feld **Budget je Kette** — *hält vor dem nächsten Schritt, nicht mittendrin*.

Tasten, mit dem Fokus in der Platte: <kbd>E</kbd> Schritt bearbeiten · <kbd>Entf</kbd> Schritt entfernen (<kbd>Z</kbd> holt ihn zurück) · <kbd>Alt+↑</kbd> / <kbd>Alt+↓</kbd> verschieben · <kbd>R</kbd> neu planen · <kbd>O</kbd> ohne Server neu planen · <kbd>D</kbd> verwerfen (zurück zu Entwurf; <kbd>Z</kbd> nimmt es zurück) · <kbd>Esc</kbd> verlässt nur die Platte.

**↵ Kette starten** wirkt erst, wenn jede Station, jede aufgeklappte Seite und der Kontext des Servers vollständig auf dem Bildschirm waren — die Zeile darunter sagt, was du noch nicht gesehen hast. Es ist eine **VON HAND**-Taste: ein eigener, frischer Druck, nie Teil einer Sammel-Übernahme. Mit Server-Inhalt heißt sie **Kette starten · mit Server-Inhalt**.

## Starten und Laufen
↵ legt jeden Schritt als geparkte Aufgabe in seiner Pipeline an — sofort in #/coding zu sehen. Schritt 01 startet nach **10 Sekunden**: bis dahin nimmt <kbd>Z</kbd> die ganze Kette zurück, ↵ startet sofort. Scheitert das Anlegen mittendrin, bleibt nichts zurück.

Dann läuft die Kette von selbst:
- Ist ein Schritt fertig, bekommt der **nächste Schritt** dessen Ergebnis oben als **Grundlage** hineinkopiert — *Aus Schritt 01 (Analyse): …* — und startet. QA arbeitet auf dem Branch des Coding-Schritts.
- Deine Freigaben halten sie wie gewohnt an. Ein Gate, dessen Freigabe den nächsten Schritt startet, sagt das (*Freigeben startet den nächsten Schritt: 03 · QA ‹…›*) und ist ebenfalls VON HAND.
- **Nach der Analyse anhalten** (standardmäßig an): nach einer Business-Analyse zeigt One dir den Coding-Schritt so, wie er laufen wird — **↵ Weiter**, **E Anpassen**, **R Ab hier neu planen** (der Planer liest die Analyse) oder **H Anhalten**. Hat die Analyse eine eigene Freigabe und klappst du dort den nächsten Schritt auf, ist genau diese Freigabe der Halt — kein zweiter Druck.
- Die Platte wird zur Laufleiste: jeder Schritt mit seinem Zustand in Worten — *läuft · wartet auf dich · Fehler · fertig · geparkt*. #/coding zeigt *PA-12 · 2/3* auf jeder Karte der Kette, das Aufgaben-Panel *Teil von Prüfauftrag PA-12 · Schritt 2 von 3*.
- Am Ende zeigt die Platte jeden Schritt mit seinem Ergebnis — Merge-Request, Testfälle, Kosten von Claude Code. <kbd>W</kbd> schreibt diese Zusammenfassung als einen Kasten in deinen Auftrag.

## Anhalten
- <kbd>H</kbd> **Nach diesem Schritt anhalten** geht auf jedem Gerät: der laufende Schritt läuft fertig, nichts Weiteres startet. In die Spalte **Angehalten** ziehen wirkt genauso.
- <kbd>Mod+.</kbd> **Sofort stoppen** beendet den laufenden Schritt sofort — auf dem Gerät mit dem Worker.
- **↵ Fortsetzen** geht weiter. Nur so endet ein Halt: keine andere Änderung am Status hebt ihn auf.
- <kbd>S</kbd> **Schritt überspringen** bei einem fehlgeschlagenen, gestoppten, gelöschten oder ausgeworfenen Schritt — der nächste Schritt bekommt dann keine Grundlage.
- **Alle Ketten anhalten** steht oben im Board der Prüfaufträge und in #/coding.
- **Im Vorflug-Check** tragen die Karten die Tasten des Vorflug-Checks: auf *Weiter mit Schritt 02?* geht <kbd>A</kbd> weiter und <kbd>D</kbd> **hält die Kette an** — dort heißt D nicht Verwerfen —, auf *Kette angehalten* setzt <kbd>A</kbd> fort und <kbd>1</kbd> **überspringt den Schritt**. H und S gelten auf der Platte des Auftrags.

## Was sicher bleibt
- **Nur du startest.** Das Planen, der Start und jede Taste, die dem Worker Arbeit gibt — Kette starten, Weiter, Fortsetzen, Überspringen, eine Freigabe, die den nächsten Schritt startet — sind deine eigenen Drücke: im Vorflug-Check **VON HAND**, nie per ⇧A oder Wischen.
- **Du siehst alles, was Claude Code bekommt**, bevor du ↵ drückst: jeden Schritt vollständig, die Seiten, die mitgehen, den Inhalt des Servers. Dein Auftrag geht wörtlich in jeden Schritt. Links, die der Planer erfindet, werden zu reinem Text; was wie ein Schlüssel aussieht, wird entfernt, und die Platte nennt den Schritt.
- **Dein MCP-Server wird nur gelesen.** Du wählst ihn in den Prüfauftrag-Einstellungen (⚙ auf der Platte): **Kontext · MCP-Server (optional)** listet deine Server unter den Namen, die du ihnen gegeben hast, keiner ist vorgewählt. Nur dieser Server ist dabei, nur mit seinen Lese-Werkzeugen; die Werkzeuge, die fehlen, stehen dort mit Grund. Ohne Auswahl ist kein Server dabei — auch keiner, der auf *Alle KI-Aufrufe* steht.
- **Die Kette folgt nur dem, was du bestätigt hast.** Dieses Gerät merkt sich, welche Aufgaben dazugehören. Eine kopierte Zeile, eine umnummerierte Schrittnummer oder ein von Hand gesetzter Status starten nie etwas.
- **Wer „fertig“ setzt, zählt.** Der Worker, du oder das KI-Terminal: die Kette geht weiter. Ein Agent, eine Automation, der Sync oder ein anderes Gerät: One fragt erst — *Schritt 01 wurde von einem Agenten auf Fertig gesetzt — weiter?*
- **Agenten schleichen sich nicht ein.** Ein Schritt, den ein Agent geändert hat, wartet, bis du diese Fassung auf diesem Gerät bestätigt hast. Agenten und die MCP-Brücke schreiben nie den Status eines Auftrags, und nie Stufe, Repo oder Branch einer Aufgabe.
- **Ordner- / GitHub-Sync**: eine Aufgaben-Datei, die der [Sync](help:sync) aufnimmt, verschiebt keine Aufgabe — Stufe, Repo und Branch bleiben, wie One sie hat, und die Datei wird neu geschrieben —, und eine Aufgabe, deren Text aus der Datei kam, wartet auf **Auf diesem Gerät bestätigen**.
- **Ein Branch, zwei Schritte**: solange QA auf dem Branch des Coding-Schritts arbeitet, bleiben **Worktree verwerfen** und **Aufräumen** aus — der Branch gehört beiden.

## Kosten
Das Planen ist eine KI-Anfrage, gezählt und gebremst vom [Regler](help:governor) wie jede andere (meist ein paar Cent); an seiner Linie fragt die Platte zuerst. Was Claude Code auf dem Worker ausgibt, begrenzt der Regler **nicht** — das steht so auf der Platte. Das **Budget je Kette** zählt die Kostenmeldungen deines Workers auf diesem Gerät und hält die Kette vor dem nächsten Schritt an, sobald es erreicht ist, nie mitten in einem.

## Ohne Bestätigung starten
In den Prüfauftrag-Einstellungen lässt **Ohne Bestätigung starten** einen fertigen Plan ohne ↵ starten — auf **diesem Gerät**, nur in **lokalen Arbeitsbereichen** und nur mit einem **Budget je Kette**. Beim Einschalten wird der [Schaltplan](help:patchbay) gefragt: ein Weg, der eine Sicherung auslösen würde, wird genannt, mit **Im Schaltplan zeigen** und **Weg zulassen**; gefragt wird er bei jedem Start erneut. Jede Unklarheit fällt auf **Kette bereit** zurück und sagt warum — eine offene Rückfrage, ein fehlendes oder anderes Repo, ein benannter Branch, Inhalt aus Mails oder von außen geschrieben, ein Auftrag, der sich seit deinem Druck geändert hat, ein entfernter Schlüssel: *Nicht automatisch gestartet: 1 offener Punkt · Repo fehlt bei 02*. Eine Änderung an den Einstellungen, an den Pipelines oder an deinen Freigaben schaltet es aus (*Einstellungen geändert seit dem Einschalten — erneut einschalten*). Ein Backup oder eine Wiederherstellung schaltet es nie ein.

Im Schaltplan ist jede Datenbank Prüfaufträge ein Modul **Planer**; seine nächsten Schritte — und die eigenen Weitergaben der Pipelines (Folgeaufgaben, Stories) — sind als Ketten-Kabel gezeichnet.

## Im Team
Die Datenbank Prüfaufträge ist privat. Planen, Starten und Weitergehen passieren auf dem Gerät mit der Worker-Verbindung. Ein anderes Gerät kann eine Planung anfordern — das Worker-Gerät zeigt dann eine VON-HAND-Karte *Auf anderem Gerät angefordert · ↵ Hier planen* — und eine Kette anhalten, aber nie starten oder fortsetzen. Ohne Bestätigung starten gibt es im Team nicht. Ein Gerät ohne Eintrag zu einer Kette (ihr Worker ist dorthin umgezogen) bekommt eine Karte **Kette bestätigen** im Vorflug-Check, mit jedem Schritt unter seinen eigenen Freigaben. Setzt ein anderes Gerät **Fertig** und nimmt es mit *Nein* zurück, bleibt die Kette angehalten — der Status zeigt **Angehalten**, und **↵ Fortsetzen** auf dem Gerät mit dem Worker geht weiter.

## Nicht die Vorprüfung
**Prüfen lassen** gibt deinen Auftrag an Claude Code in den Pipelines. Jevs [Vorprüfung](help:ai-jev) ist etwas anderes: ein Entscheidungsmodell, das die Vorschläge deiner Agenten markiert, bevor du entscheidest. Pläne von Prüfaufträgen prüft Jev nicht vor.

## Was auf diesem Gerät bleibt
Der Plan, der Eintrag der Kette (welche Aufgaben dazugehören, wer jede auf Fertig gesetzt hat), was sie ausgegeben hat, und der Schalter für Ohne Bestätigung starten liegen in diesem Browser — nie synchronisiert, exportiert oder im Backup — und gehen mit der Gerätekopie und dem lokalen Zurücksetzen. Vollständige Backups tragen die Einstellungen der Datenbank, nie einen Plan oder eine Kette. Der [Flugschreiber](help:flight-recorder) kann die Schritte einer Kette auswerfen: ein ausgeworfener Schritt hält seine Kette an, und <kbd>S</kbd> entscheidet.

## Kontext und QA-Reparaturen
Unter **Einstellungen → Automatische QA-Reparaturen** kannst du begrenzte Reparatur-Unterläufe zulassen. Standard ist Aus; die bestätigte Kette hält Auswahl und Coding-Agent fest. Ablauf, Grenzen, Modelltests und Atlas-Memory erklärt [Coding-Harness, Kontext und Qualität](help:coding-harness).


## Copilot je Rolle
In den Einstellungen unter **Pipelines** BA, Coding und QA unabhängig auf **GitHub Copilot** stellen und darunter Modell, Denkaufwand und Kontext wählen. Ab Worker **1.27.0** werden diese Werte bei Anlage in die Aufgaben übernommen; persönliche Aufgabenwahl geht vor. Automatische QA-Reparaturen nutzen die bestätigte Coding-Rolle, Nachprüfungen die QA-Rolle. Der Abnahmebericht enthält die beobachtete Copilot-Modell-/Token-Zusammenfassung. Siehe [GitHub Copilot in One](help:copilot-coding).
