---
id: coding-pipeline
title: Coding-Pipeline (Claude Code auf deinem Rechner)
section: ai
order: 9
keywords: coding, pipeline, claude code, worker, permalink, seitenadresse, link kopieren, seite mitgeben, seite verlinken, seite erwähnen, antwort, nacharbeit, one-worker, download, einrichten, windows, powershell, cmd, eingabeaufforderung, wsl, koppeln, modell, opus, sonnet, haiku, fable, repositories anhaken, git, branch, worktree, pull request, pr, diff, tests, repo, repository, code-review, programmieren, aufgaben, cloud-worker, one-worker-cloud, build-server, vm, relay, anderer rechner, lokal oder cloud, offline, nicht verbunden, Zugriff auf lokales Netzwerk, Apps auf dem Gerät, api-schlüssel, anthropic_api_key, console, abrechnung
related: pipelines, workorders, legacy-modernisation, mcp-bridge, custom-agents, agent
summary: Gib Programmieraufgaben an Claude Code auf deinem Rechner — planen, freigeben, umsetzen, testen, ausliefern — und verfolge jeden Schritt in One.
---
**#/coding** (⌘K *Coding-Pipeline*). One verwaltet die Aufgaben, die Freigaben, das Log und den Diff; ein kleiner Worker auf **deinem** Rechner führt Git und Claude Code aus. Der Worker läuft auf deinem Rechner. Ausgewählter Code und Werkzeugergebnisse gehen an den gewählten Modellanbieter; Lokal · Ollama führt das Modell lokal aus.

## Ein Geräte-Worker für mehrere Workspaces

Ab Worker **1.22** kannst du dieselbe lokale Worker-Verbindung für mehrere ausdrücklich freigegebene Workspaces verwenden. Den aktualisierten Worker zuerst im ursprünglichen Workspace starten. Im weiteren Workspace unter **Einstellungen → Coding-Worker** auf **Diesen Workspace am Geräte-Worker freigeben** klicken. Verwende dasselbe Browser-Profil, mit dem der ursprüngliche Worker heruntergeladen wurde. Danach verbindet sich One beim Workspace-Wechsel automatisch mit dem passenden Kontext.

Jeder zusätzliche Workspace erhält einen eigenen Kopplungsschlüssel, Auftragsstand, Memory-, Scratch- und Worktree-Ordner sowie eigene automatisch angelegte Branches. Auch gleichlautende Aufgaben-IDs bleiben getrennt. Modelle, API-Schlüssel, persönliche MCP-Verbindungen und die auf dem Gerät freigegebenen Repositories werden gemeinsam verwendet. Zugangsschlüssel und Worker-Freigaben werden nicht in Workspace-Pakete exportiert oder mit dem Team synchronisiert.

Aufträge behalten beim Wechsel ihre Zuordnung. Ergebnisse warten auf die Rückkehr des zugehörigen One-Tabs; ein anderer Workspace erhält sie nicht. Wenn ein Auftrag Daten oder eine Freigabe aus One braucht, muss sein Tab erreichbar sein. Dasselbe Repository bearbeitet der Geräte-Worker nur in einem Workspace gleichzeitig; die Parallelitäts- und Tageslimits gelten übergreifend. Kosten werden je Workspace angezeigt, soweit der Anbieter sie meldet.

Unter **Repositories ändern** öffnest du die geschützte Einrichtungsseite des Workers. Dort kannst du unter **Weitere Arbeitsbereiche auf diesem Gerät** eine Freigabe entziehen. Das stoppt die Aufträge dieses Workspace; gespeicherte Arbeitsstände bleiben erhalten. Ein neuer Download mit einem neuen ursprünglichen Kopplungsschlüssel widerruft bisherige zusätzliche Freigaben; die Workspaces anschließend erneut freigeben. Modelle und persönliche Verbindungen werden dabei nicht gelöscht.

Diese Freigaben gelten für die **lokale Verbindung**, auch zu einem Team-Workspace. Ein Cloud-Worker über den Team-Relay bleibt an seinen eigenen Workspace und sein Mitglieds-Token gebunden.

## In drei Schritten einrichten
Du brauchst Node.js 22 oder neuer, Git und die **Claude-Code**-CLI, einmal angemeldet (`claude`) — unter macOS, Linux oder Windows 10 / 11 (siehe *Windows* unten). Dann **Einstellungen → Coding-Worker** (oder **#/coding**):

1. **Lade den Worker für diesen Arbeitsbereich herunter.** Die Datei ist schon mit diesem Browser und diesem Arbeitsbereich gekoppelt — nichts einzustellen. One schaltet die Verbindung selbst ein.
2. **Starte ihn** in einem Terminal und lass ihn laufen. Die Karte zeigt die Zeile für deinen Rechner — Schalter **Windows | macOS · Linux**. macOS und Linux:
```
node ~/Downloads/one-worker.mjs
```
Windows — in PowerShell (erste Zeile) oder der Eingabeaufforderung (zweite Zeile); die Anführungszeichen halten einen Benutzerordner mit Leerzeichen zusammen:
```
node "$env:USERPROFILE\Downloads\one-worker.mjs"
node "%USERPROFILE%\Downloads\one-worker.mjs"
```
Die Zeilen erwarten den üblichen Downloads-Ordner. Hat dein Browser die Datei woanders gespeichert (oder liegt Downloads woanders, z. B. in OneDrive)? `node` und ein Leerzeichen tippen, den Pfad der Datei einfügen — im Explorer: Umschalt + Rechtsklick auf die Datei → **Als Pfad kopieren** — und Enter drücken.
3. **Hak deine Repositories auf der Seite an, die sich öffnet.** Der Worker findet die Git-Repositories auf deinem Rechner und öffnet eine Seite in deinem Browser: Hak die an, in denen One arbeiten darf, prüf Basis-Branch und Testbefehl (z. B. `npm test`), dann **Speichern & starten**. Die Karte zeigt *Verbunden · laptop · 2 Repos*, und die **WORKER**-LED in der Statusleiste wird grün.

Business-Analyse und QA haben eigene Pipelines – siehe [Business-Analyse- und QA-Pipelines](help:pipelines). Soll One aus einem geschriebenen Auftrag eine ganze Kette planen — Analyse, Coding, QA —, siehe [Prüfaufträge](help:workorders). Erwähne Seiten in einer Aufgabe mit **@**: Ihr Text geht mit an Claude Code — siehe *Claude Code eine Seite mitgeben* unten.

Neuer Code? Dieselbe Seite klont von **GitLab / GitHub** (eine Adresse oder ein Projekt aus deiner Liste mit `glab` / `gh`) oder importiert eine **ZIP** als neues Repository nach `~/one-repos` – siehe [Altsoftware modernisieren](help:legacy-modernisation). Pro Repository kann sie Claude Code auch deine eigenen MCP-Server geben (z. B. eine Wissensbasis), und mit **Eigene Claude-Code-Einstellungen dieses Repos nutzen** entscheidet sie, ob Claude Code `.claude/`, `.mcp.json` und `CLAUDE.md` des Repositorys lädt: an für deine eigenen Repositories, aus – mit dem Grund – für eines, das der Worker geklont oder importiert hat; dessen Hooks liefen sonst auf deinem Rechner, sobald eine Aufgabe startet.

**MCP-Server: zwei Claudes.** Deine MCP-Server in One (Einstellungen → Claude KI → [MCP-Server](help:mcp-servers)) gelten für Ones eigenen Claude – KI-Menü, Terminal, Agenten. Claude Code auf deinem Rechner bekommt nur die Aufgaben-Werkzeuge von One, solange die Setup-Seite des Workers nicht mehr erlaubt: pro Repository **Eigene MCP-Server für Claude Code**, für Aufgaben ohne Repository **Aufgaben ohne Repository – eigene MCP-Server** – Namen wie in `claude mcp list`. Einen Server gibst du Claude Code zuerst im Bereich **user**: `claude mcp add -s user …` – einer im Standard-Bereich (local) gehört zu einem einzigen Ordner und erreicht weder Aufgaben ohne Repository noch ein Repository, das der Worker geklont oder importiert hat (Claude Code lässt dessen eigene Einstellungen weg und deine lokalen Server mit ihnen). Das Coding-Panel zeigt, welche Server eine Aufgabe nutzen darf (**Claude Code · MCP**), und warnt, wenn ihr Text einen erwähnt, den Claude Code nicht nutzen darf – mit **Setup-Seite öffnen**.

Später ändern: **Repositories ändern** — der Worker öffnet seine Seite wieder auf deinem Rechner. One erfährt immer nur die Namen der Repos; Pfade und Befehle bleiben in `~/.config/one/worker.json` auf deinem Rechner.

> Tipp: Ein neuer Download ersetzt die Kopplung — starte die zuletzt heruntergeladene Datei. Auf einem Rechner ohne Browser fragt `node one-worker.mjs --no-browser` stattdessen im Terminal (Zahlen haken an, Enter speichert).

## Wenn sich der Worker nicht verbindet
Die **WORKER**-LED bleibt dunkel; **Einstellungen → Coding-Worker** und die Lampe *Worker offline* im [Vorflug-Check](help:preflight) sagen, warum:
- **Der Worker antwortet nicht** — er läuft nicht: Starte ihn wieder in einem Terminal (Schritt 2) und lass das Fenster offen.
- **Ein älterer Download läuft** — beende ihn (<kbd>Ctrl+C</kbd>) und starte die zuletzt heruntergeladene Datei. Dein Browser hat sie vielleicht als `one-worker (1).mjs` gespeichert: Starte diesen Namen, oder lösche die alten Kopien und lade sie erneut herunter. Wechselst du zurück zu One, versucht One es erneut – oder wähle **Jetzt erneut versuchen**.
- **Vom Browser blockiert** — Chrome fragt, ob One Apps auf diesem Gerät erreichen darf: Wähle **Zulassen**. Abgelehnt? Erlaube es in den Website-Einstellungen (Symbol links neben der Adresse: **Apps auf dem Gerät** / **Zugriff auf lokales Netzwerk**; im App-Fenster von One gibt es keine Adresszeile: ⋮ → **App-Info**) und wähle dann **Jetzt erneut versuchen**.

## Den Worker auf einem anderen Rechner laufen lassen (Cloud)
In einem **Team-Arbeitsbereich auf einem One-Server** bietet **Einstellungen → Coding-Worker → Wo der Worker läuft** die Wahl **Lokal | Cloud**. Mit **Cloud** läuft der Worker auf einem beliebigen Rechner — Build-Server, VM, der Rechner im Büro — und verbindet sich selbst mit deinem One-Server: kein Port, kein VPN.

1. **one-worker-cloud.mjs herunterladen.** Die Datei enthält einen Worker-Token nur für dich und nur für diesen Arbeitsbereich und einen Schlüssel, den nur dieser Browser hat.
2. **Auf den Rechner kopieren und dort starten**: `node one-worker-cloud.mjs` (laufen lassen — tmux oder ein Dienst). Die Datei ist der Schlüssel: Behandle sie vertraulich (`chmod 600`; unter Windows `icacls`, siehe unten).
3. **Dort die Repositories anhaken** — die Einrichtungsseite öffnet sich auf jenem Rechner, oder `node one-worker-cloud.mjs setup --no-browser` fragt in seinem Terminal.

Die Karte zeigt dann *Verbunden · build-box · 1 Repo · über Cloud*. Alles andere funktioniert wie mit einem lokalen Worker.

- **One offen lassen.** Aufgaben laufen nur, solange One in **diesem** Browser offen ist (irgendeine Seite des Arbeitsbereichs) — dieser Tab verteilt die Arbeit und schreibt die Ergebnisse. Schließt du ihn, wartet der Worker; auf dem Server läuft nichts. Ein neuerer Tab übernimmt den Worker; der ältere holt ihn sich von selbst zurück, sobald dieser Tab geschlossen wird.
- **Durchgehend versiegelt.** Der Server reicht Nachrichten zwischen diesem Browser und dem Worker weiter, kann sie aber weder lesen noch ändern — Aufgabentext, Code, Diffs und Logs bleiben zwischen den beiden.
- **Ein Gerät.** Der Worker ist mit dem Browser gekoppelt, der ihn heruntergeladen hat. Ein anderes Gerät zeigt *Mit einem anderen Gerät gekoppelt* und bietet **Für dieses Gerät herunterladen** an (ersetzt den anderen — One fragt vorher; bis die neue Datei startet, arbeitet das andere Gerät weiter und dieses wartet, dann verbindet es sich von selbst).
- **Ersetzen oder beenden.** Ein neuer Download übernimmt, sobald er startet — auf demselben Rechner stoppst du zuerst den alten Worker. **Widerrufen** beendet den Worker endgültig. Wer aus dem Arbeitsbereich entfernt wird, dessen Worker endet ebenfalls.
- **Nur https.** Cloud braucht den One-Server unter `https://`; bei reinem `http://` ist die Option mit Begründung ausgegraut.

In einem lokalen Arbeitsbereich, für Leser und auf einem Server ohne Worker-Relay ist Cloud ausgegraut – mit dem Grund daneben.

## Windows
Der Worker läuft ab Version **1.9.0** direkt unter Windows 10 und 11 — WSL2 geht auch. **Unter Windows Worker 1.9.0 oder neuer nehmen**: Ältere Worker konnten ein Programm namens `git.exe`, `claude.exe` oder `npm.exe` aus dem Hauptordner eines geklonten oder importierten Repositorys starten. Ist deiner älter: **Erneut herunterladen** und die neue Datei starten. Läuft ein älterer Worker auf diesem Rechner (**Lokal**), sagen **#/coding** und die Einrichtungskarte das selbst, mit der Download-Taste. Ob er in WSL läuft, kann One nicht erkennen: Auch ein Worker in WSL bekommt den Hinweis, und der Hinweis sagt, dass er dann nicht gilt.

- **Installieren**: Node.js 22 oder neuer, **Git for Windows** (Claude Code braucht dessen Git Bash) und Claude Code — mit dem eigenen Installer oder `npm i -g @anthropic-ai/claude-code` —, einmal mit `claude` angemeldet. `node one-worker.mjs check` zeigt, was der Worker gefunden hat. Ein frisches Git braucht einmal deinen Namen und deine E-Mail: `git config --global user.name "Dein Name"` und `git config --global user.email du@example.com` — sonst kann der Worker nicht committen, und das Log sagt es. Claude Code installiert, während der Worker läuft? **Erneut versuchen** an der Aufgabe findet es (die Einrichtungsseite des Workers merkt es auch) — kein Neustart.
- **Windows Terminal** ist der beste Ort dafür: Im alten Konsolenfenster hält der Worker an, sobald du Text markierst, bis du <kbd>Esc</kbd> drückst.
- **Repositories auf einem lokalen Laufwerk** ablegen, z. B. `C:\code`. Ein Repository in **OneDrive** (Dokumente und Desktop liegen oft dort) geht, aber OneDrive sperrt Dateien beim Synchronisieren — das Log warnt und sagt, wo die Worktrees der Aufgaben liegen (standardmäßig in `.one-worktrees` in deinem Benutzerordner, außerhalb von OneDrive).
- **Lange Pfade**: Das git des Workers kommt damit klar. Für dein git und deine Werkzeuge einmal `git config --global core.longpaths true` ausführen.
- **Einmal anmelden**: git fragt nie, solange der Worker es ausführt. **SSH**: Das ssh, das mit Git kommt, sieht den Windows-Dienst **OpenSSH Authentication Agent** nicht. Entweder in der Eingabeaufforderung `start-ssh-agent` ausführen (der Agent von Git — er fragt einmal nach der Passphrase) und den Worker in diesem Fenster starten, oder einmal `git config --global core.sshCommand C:/Windows/System32/OpenSSH/ssh.exe` ausführen und deinen Schlüssel in diesen Dienst legen (`ssh-add`). Ein Schlüssel ohne Passphrase braucht keins von beiden. **HTTPS**: einmal `git fetch` im Terminal ausführen — der Git Credential Manager merkt sich die Anmeldung. Das Log sagt, was fehlt.
- **Programme**: One nimmt git und Claude Code nie aus dem Repository-Ordner — der Worker sucht sie nur im `PATH`, ebenso das erste Wort deines Testbefehls: Ein Programm im Repository braucht seinen Pfad, z. B. `.\gradlew.bat test`. Eine Claude-Code-Stufe (Plan, Umsetzung, Dokument) startet nicht, solange ganz oben in ihrem Ordner ein Programm liegt, das eine Suche über den Namen nehmen könnte (`git.exe`, `node.exe`, `npm.cmd`, ein Programm aus deinem `PATH` – außer aus den Ordnern von Windows selbst, `find.js` oder `sort.js` gehen also –, der Starter eines deiner MCP-Server …) — das Log nennt die Datei. Entfernen oder umbenennen, im Repository **und** im Branch der Aufgabe (ein vorhandener Worktree behält sie: dort ändern — **Git → Ordner zeigen** schreibt seinen Ort ins Terminal des Workers — oder die Änderung im Basis-Branch committen und pushen und **Von Basis aktualisieren** drücken), dann **Erneut versuchen**. Tests und Analyse führen den eigenen Code deines Repositorys aus, wie in deinem Terminal. Nichts, was One schickt, läuft je über `cmd.exe`.
- **Die Cloud-Datei** ist ein Schlüssel: `icacls "$env:USERPROFILE\one-worker-cloud.mjs" /inheritance:r /grant:r "${env:USERNAME}:F"` (PowerShell) macht sie nur für dich lesbar. Für den Autostart die Aufgabenplanung — das Rezept steht in `docs/CODING.md`.
- **Port abgelehnt?** Hyper-V, WSL oder Docker können Port-Bereiche reservieren. Das Terminal des Workers sagt es — wähl vor dem Download in **Einstellungen → Coding-Worker** einen anderen Port.

## Freigaben – oder einfach machen
Im Coding-Panel wählst du bei **Freigaben**, wo die Aufgabe auf dich wartet: **Plan und Review freigeben** (Standard), **Nur Review – der Plan läuft durch** oder **Keine – einfach machen**: Dann laufen Plan, Umsetzung, Tests und Ausliefern ohne Halt durch; schlagen die Tests zweimal fehl, hält sie trotzdem beim Review. Die Wahl gilt je Aufgabe, auf diesem Gerät. **Für neue Aufgaben übernehmen** macht sie zum Standard dieses Geräts für Aufgaben, die ab dann entstehen – weder die Wahl bei einer Aufgabe noch ein neuer Standard ändert eine andere Aufgabe (eine ohne eigene Wahl behält den Standard, unter dem sie entstand; eine Seite, die zur Aufgabe wird – auf das Board gezogen, hineinverschoben –, bekommt den Standard dieses Moments). In der **Pipeline** lässt sich eine Freigabe-Stufe auf **Immer hier anhalten** stellen: Freigaben *Keine* läuft an jeder anderen vorbei, hält aber dort (neue Pipelines aus *Review & Merge* setzen es für *Review & Merge freigeben*). Wartet eine Aufgabe schon an einer Freigabe, die du gerade abwählst, geht sie sofort weiter.

Im Tab **Log** siehst du jeden Schritt: *Fetching origin…*, den neuen Branch, *Starting Claude Code…*, jedes Werkzeug, das Claude Code benutzt – und solange es still arbeitet, einmal pro Minute *still working*. Kann der Worker das Remote nicht holen (kein Netz, oder git bräuchte ein Passwort bzw. die Passphrase des SSH-Schlüssels), steht das nach höchstens 60 Sekunden im Log, und die Aufgabe arbeitet mit dem Stand auf deinem Rechner weiter. Für Push und Pull Request braucht git einen SSH-Agent oder einen Credential Helper – tippen kann der Worker nichts.

## Modell je Stufe
Welches Claude-Modell Claude Code nutzt, legst du in der **Pipeline** (auf #/coding) fest: Öffne die Details einer Stufe (Plan-, Umsetzungs- und Dokument-Stufen) und wähle ihr **Modell** — **Standard** (das Modell des Repos in der `worker.json` des Workers, sonst die Vorgabe von Claude Code), **Opus**, **Sonnet**, **Haiku**, **Fable** oder **Eigenes …** für jeden anderen Modellnamen (Buchstaben, Ziffern und `. _ : - [ ]`; One prüft ihn beim Tippen). Eine Stufe mit Modell zeigt es als kleinen Chip in ihrer Zeile. Mit einem starken Modell planen, mit einem schnelleren umsetzen — jede Stufe läuft mit ihrem eigenen.

Für eine Aufgabe überschreibt **Modell** im Coding-Panel (neben den Freigaben) jede Claude-Code-Stufe dieser Aufgabe — auf diesem Gerät: **Wie die Pipeline**, eines der Modelle oben oder ein eigener Name, den die Pipeline schon nutzt. Während Claude Code läuft, zeigt ein Chip unter **Jetzt** das Modell, das es wirklich nutzt, und das Log nennt das Modell, das der Worker weitergegeben hat. Ein Worker, der vor den Modellen heruntergeladen wurde, bekommt nie eine Stufe mit Modell — die Aufgabe meldet *Diese Stufe braucht einen neueren Coding-Worker*: lade ihn neu herunter, dann **Erneut versuchen**.

## Wer Claude Code bezahlt
Claude Code nutzt deine eigene Anmeldung — außer der Worker wurde mit gesetztem `ANTHROPIC_API_KEY` in dieser Shell gestartet. In den Läufen, die der Worker startet (`claude -p`), hat ein API-Schlüssel aus der Umgebung (oder `ANTHROPIC_AUTH_TOKEN`, oder die Einstellungen eines Cloud-Anbieters) Vorrang vor deinem Abo und einem `apiKeyHelper` — ohne Rückfrage. Praktisch für einen Workshop oder ein Team-Konto: Setz einen Schlüssel aus der Claude Console (`export ANTHROPIC_API_KEY=…`, in PowerShell `$env:ANTHROPIC_API_KEY = "…"`), starte den Worker aus dieser Shell und gib dem Console-Workspace des Schlüssels ein Ausgabenlimit. Bei jeder Claude-Code-Stufe sagt das Log, was es nutzt — *API-Schlüssel aus ANTHROPIC_API_KEY · …1a2b* (nur die letzten 4 Zeichen) oder *deine Claude-Code-Anmeldung*. Schlüssel erreichen One nie: Der Worker entfernt sie aus jeder Logzeile, jedem Abschnitt, Diff und Fehler.

## Eine Aufgabe von Anfang bis Ende
1. **Neue Aufgabe**: Titel, Repo, Ziel, Abnahmekriterien. *Der Worker darf gleich anfangen* angehakt lassen. Die Aufgabe selbst steht im **Seiteninhalt** der Aufgabe (unter dem Coding-Panel) — mit diesem Text arbeitet Claude Code. Ist die Seite leer, fügt **Gliederung einfügen** Ziel, Abnahmekriterien und Hinweise zum Ausfüllen ein.
2. **Plan** — Claude Code liest den Code im Plan-Modus (ändert nichts) und schreibt den Plan in die Aufgabe. Die Aufgabe wartet bei **Plan freigeben**.
3. **Freigeben** — oder **Nacharbeit…** mit Anweisungen: Sie geht mit deiner Notiz zurück zum Plan.
4. **Umsetzen** — Claude Code ändert den Code in einem eigenen Git-Worktree; **Testen** führt deinen Testbefehl aus. Schlagen die Tests fehl, bekommt „Umsetzen“ mit deren Ausgabe noch einen Versuch.
5. **Review** — die Tabs **Diff** und **Tests** zeigen, was sich geändert hat. Freigeben oder zurückschicken.
6. **Ausliefern** — committen, pushen, Pull Request (mit der GitHub-CLI) oder ein Vergleichslink — mit Links in der Seite festgehalten (**Was One festhält**). **Fertig**.

Jede Aufgabe arbeitet auf einem eigenen Branch (`one/<titel>-<id>`) in einem eigenen Worktree — dein Haupt-Checkout bleibt, wie er ist. Bevor eine Aufgabe läuft, wählst du im Coding-Panel das **Repo** (die Repos, die dein Worker meldet) und den **Branch**: *Neuer Branch (automatisch)* oder einen vorhandenen Branch des Repos auf deinem Rechner, um darauf weiterzuarbeiten (der Basis-Branch wird nie angeboten). Eintippen geht auch im Feld **Branch**.

## Während sie läuft
- **Jetzt** zeigt die letzte Zeile des Workers und wie lange sie her ist; darunter **Schritt 6/30** (der Schritt von Claude Code von der Grenze der Stufe), **≈ +0,07 $** (diese Stufe bisher, geschätzt — den genauen Betrag gibt es am Ende) und **Dateien** (was sich bisher geändert hat; ein Klick öffnet den Diff). #/coding zeigt dieselbe Zeile unter jeder laufenden Aufgabe.
- **Log** zeigt live, was Claude Code tut – ein Tool-Aufruf zeigt seinen Namen, ein Klick öffnet, womit er aufgerufen wurde, bei Edit / Write die Änderung als Code-Diff; die eigenen Zeilen des Workers erscheinen in deiner Sprache. Braucht Claude eine Entscheidung, zeigt die Aufgabe **Claude fragt** — deine **Antwort** startet die Stufe neu.
- **Benachrichtigungen**: in **Einstellungen → Coding-Worker** *Benachrichtigen, solange One im Hintergrund ist* einschalten — der Browser meldet sich, wenn eine Aufgabe wartet, fragt, fehlschlägt oder fertig ist, während der Tab im Hintergrund ist (auf diesem Gerät).
- **Stopp** beendet Claude Code sofort; **Erneut versuchen** oder **Jetzt ausführen** starten die Stufe wieder.
- **Git**: Aktualisieren, Committen, Pushen, PR öffnen, Von Basis aktualisieren, Ordner zeigen (der Pfad erscheint nur im Terminal des Workers). **Force-Push** und **Worktree verwerfen** fragen zweimal; **Aufräumen** wartet, bis der Branch gemergt ist; solange eine andere Aufgabe auf demselben Branch arbeitet (ein QA-Schritt auf dem seines Coding-Schritts), bleiben **Worktree verwerfen** und **Aufräumen** aus und nennen diese Aufgabe. **Merge Request**: **Review posten** und **Mergen** (fragen vorher, mit deinem glab / gh) – siehe [KI-Review und Merge Requests](help:review-merge).
- **Pipeline** (auf #/coding) ändert die Stufen: Namen, welche von selbst laufen, Modus, Schrittlimit, Modell und Anweisungen für Claude Code. Vorlagen: *Standard*, *Altsoftware modernisieren*, *Code erklären* ([eine Seite je Komponente](help:explain-code)), *Review & Merge*. Eine Stufe **Statische Analyse** führt Linter / Compiler des Repositorys aus (auf der Einrichtungsseite des Workers festgelegt) und schreibt die Befunde in die Seite.
- **Projekte**: mehrere Coding-Datenbanken nebeneinander – über dem Board wählen, anlegen und löschen ([Projekte](help:pipelines)).
- **Ist Claude Code fertig, ist die Stufe fertig** – mit jedem Modell. Was es gestartet und laufen gelassen hat (ein Dev-Server, ein Watcher), wird beendet, und das Log nennt es. Ein Server, den deine anderen Werkzeuge mitnutzen – ein Gradle- oder Kotlin-Daemon, eine ssh-Verbindung, watchman –, läuft weiter und steht stattdessen im Log; ebenso ein Programm, das sich als eigener Dienst eingerichtet hat. Jede Aufgabe hat einen eigenen Scratch-Ordner für Zwischendateien auf deinem Rechner; er geht mit dem Branch der Aufgabe.

## Wenn Claude Code eine Erlaubnis braucht
Claude Code fragt, bevor es einen Befehl ausführt oder ein Tool nutzt, das die Regeln deines Repositorys nicht abdecken. Die Aufgabe zeigt dann **WARTET AUF DICH · ERLAUBNIS**, und die Karte **Claude möchte** sagt genau was – zum Beispiel *Bash* `npm run lint`:

- **Einmal erlauben** – nur dieses Mal.
- **Für dieses Repo immer erlauben** – der Worker trägt die Regel der Karte (z. B. `Bash(npm run lint:*)`) in seine eigene `worker.json` ein; die Einrichtungsseite des Workers listet diese Regeln unter **Ohne Nachfrage erlaubt**, jede mit einer Taste zum Entfernen. Angeboten werden nur enge Regeln: nie eine Shell, `git`, `rm`, `curl` oder eine Datei außerhalb des Projekts – die gibt es nur **einmal**.
- **Ablehnen** – Claude Code macht ohne diese Aktion weiter.

Die Karte zeigt die Anfrage immer vollständig; was zu lang ist, um es ganz zu zeigen (über 4.000 Zeichen), lehnt der Worker ab, ohne zu fragen. Seinen Plan gibt Claude Code in der Plan-Stufe direkt an One – er kommt nie als Anfrage. Die Lampe **Claude möchte** auf Start zeigt jede wartende Anfrage (jede von Hand, nie in einer Sammelübernahme), und – wenn unter **Einstellungen → Coding-Worker** die Benachrichtigungen an sind – meldet sich der Browser, solange One im Hintergrund ist. Ohne Antwort lehnt der Worker nach 15 Minuten ab; ist kein One-Tab offen, der antworten kann, lehnt er sofort ab (eine wartende Anfrage nach einer Minute ohne Tab). Antworten kann nur das Gerät, dessen Worker die Aufgabe ausführt; One schickt dem Worker die Antwort und sonst nichts. Nach dem Lauf zählt eine Zeile, was gefragt, erlaubt und abgelehnt wurde.

## Schrittlimit
Jede Stufe darf eine bestimmte Zahl von Schritten machen (**Schrittlimit** in der Pipeline). Braucht Claude Code sie alle, zeigt die Aufgabe **Schrittlimit erreicht (40/40)**: **Weitermachen (+40 Schritte)** setzt die Stufe dort fort, wo sie stand – derselbe Worktree, alles Bisherige bleibt, die Kosten zählen wie bei jedem Lauf –, und **Neu starten** führt die Stufe mit der ursprünglichen Anweisung noch einmal aus – im selben Worktree; für einen sauberen Neuanfang vorher **Worktree verwerfen** (Tab Git). **Weitermachen** gibt so viele Schritte, wie das Schrittlimit der Stufe jetzt erlaubt. **Weitermachen** braucht Worker 1.11.0; es steht auch auf der Karte *Task gescheitert* im Vorflug-Check und im KI-Terminal.

**Repos in iCloud Drive** (z. B. in Dokumente, wenn „Schreibtisch & Dokumente“ synchronisiert wird): git wartet, sobald eine Datei nur in der Cloud liegt — Schritte können dann Minuten dauern, das Log sagt es. Schneller: den Ordner dauerhaft geladen halten, oder es auf der Setup-Seite des Workers mit **Von GitLab / GitHub klonen …** neu klonen (nach `~/one-repos`, nicht synchronisiert) und diesen Klon anhaken. Der Worker startet in jedem Fall sofort und nennt im Log ein Repository, dessen git langsam ist. Die Arbeitskopien des Workers landen nie in iCloud.

## Claude Code eine Seite mitgeben
Claude Code liest die Aufgabe — nie den Rest deines Arbeitsbereichs. Was es lesen darf, geht als Lesetext mit der Aufgabe mit: die Seiten, die die Aufgabe mit **@** erwähnt oder verlinkt, und die Seiten, die in **diesen** Seiten verlinkt sind (eine Ebene tiefer) — höchstens 8, je bis zu 20.000 Zeichen, und nur, was Claude davon lesen darf (markierte Blöcke). **Geht mit** im Coding-Panel zeigt sie, bevor eine Stufe läuft; ↳ steht vor einer Seite, die in einer anderen verlinkt ist.

- **In deiner Antwort, einer Nacharbeit oder einer neuen Aufgabe**: **@** (oder `one:`) und ein paar Buchstaben des Titels tippen — dieselbe Suche wie in einer Seite. <kbd>↑</kbd> <kbd>↓</kbd> wählen, <kbd>Enter</kbd> oder <kbd>Tab</kbd> übernimmt die Seite, <kbd>Esc</kbd> schließt die Liste. Die Seite steht als *@Titel* im Feld und geht schon bei diesem Lauf mit, vor den eigenen Seiten der Aufgabe; **Geht mit** markiert sie beim Schreiben als *neu*. <kbd>Rücktaste</kbd> direkt dahinter nimmt sie ganz heraus.
- **Seite mitgeben**: Nennt Claudes Frage eine Seite in Anführungszeichen — *„Launch plan“*, *"Launch plan"*, *'Launch plan'* — und hat eine Seite hier genau diesen Titel, setzt eine Taste unter der Frage sie in deine Antwort. Tragen mehrere Seiten den Titel, steht bei jeder, wo sie liegt. Nichts geht weg, bevor du **Antworten** drückst.
- **Adresse einfügen**: Der Permalink einer Seite (oder `#/p/<id>`), ins Feld eingefügt, wird ebenfalls zu *@Titel*.
- Eine Ebene tiefer bringt eine Seite höchstens ihre ersten 8 verlinkten Seiten mit — und nie eine Mail, einen Eintrag aus dem One-Gedächtnis oder eine Seite aus One-eigenen Datenbanken (Pipelines, Testfälle), in einer geteilten Aufgabe auch keine private Seite. Die gehen nur mit, wenn du sie selbst mitgibst.
- Eine Seite, die Claude genannt sieht, aber nicht bekommt — über den 8, tiefer verlinkt oder zurückgehalten — steht für Claude unter den Seiten, die es bekommt, und für dich unter **Geht mit**: Gib sie mit **@** in deiner Antwort mit. Eine Seite unter **Geht mit** öffnet sich neben der Aufgabe — was du schreibst, bleibt stehen.
- Im Team gehören die mitgehenden Seiten zu dem, was du bestätigst: Ändert jemand anderes eine davon, wartet die Aufgabe wieder auf **Auf diesem Gerät bestätigen**.

## Permalinks
Jede Seite hat einen Permalink: die Adresse von One mit `#/p/<id>` am Ende. **Permalink kopieren** steht im ⋯-Menü der Seite, im Zeilenmenü der Seitenleiste und in ⌘K; das Typenschild am Ende jeder Seite hat eine Taste **Permalink**, die Seitenvorschau eine Link-Taste neben dem Pfad der Seite. Die Meldung zeigt die Adresse. Sie funktioniert
- in der Adresszeile des Browsers — die Seite öffnet sich;
- als Link in jeder Seite — in eine Seite eingefügt, wird sie zur Seitenerwähnung (ein Link auf einen Block, aus **Link zum Block kopieren**, bleibt ein Link und öffnet beim Block);
- in einer Coding-Antwort, einer Nacharbeit oder einer neuen Aufgabe — die Seite geht mit an Claude Code;
- im KI-Terminal — sie wird zu *@Titel*;
- in ⌘K — Permalink, `#/p/<id>`, eine Seiten-ID oder die kurze ID vom Typenschild (*ID ABCD·1234*) einfügen: Die Seite steht oben, <kbd>Enter</kbd> öffnet sie. Die Adresse einer Seite, die es auf diesem Gerät nicht gibt, sagt das — eine neue Seite entsteht daraus nie.

Die kurze ID funktioniert auch hinter `#/p/` in der Adresszeile.

## Was One festhält
Wenn eine Git-Stufe oder eine Taste im Tab **Git** committet, pusht oder einen Merge / Pull Request öffnet, bekommt die Aufgabenseite eine graue Notiz – zum Beispiel **Ausliefern · 14.10. 14:32** mit der Zeile *Commit a1b2c3d · Branch one/login-reparieren-ab12cd · MR !42 · nach origin/one/login-reparieren-ab12cd gepusht*.

- Commit, Branch und Request sind Links zu deinem GitLab / GitHub – sobald sie auf dem Remote sind. Auch ein Commit, dessen Push oder Request danach scheitert, wird festgehalten (*Push fehlgeschlagen*, *MR konnte nicht geöffnet werden*): So siehst du, was nur auf deinem Rechner liegt.
- **PR / Commit** (das Feld der Aufgabe) enthält den Merge / Pull Request – ohne einen den Link zum gepushten Commit. Ein Request-Link wird nie durch einen Commit-Link ersetzt.
- Die Commits, die der Worker für eine Aufgabe macht (Git-Stufen und die Taste **Commit**), und die Beschreibung ihres Merge / Pull Requests enden mit `One-Task: <Aufgaben-ID>`. Der Tab **Git** der Aufgabe zeigt diese Zeile unter **Auf dem Host finden**, mit einer Taste zum Kopieren: Danach suchst du auf GitLab / GitHub, um zu finden, was eine Aufgabe ausgeliefert hat. (Ein Merge-Commit von **Von Basis aktualisieren** trägt sie nicht.)
- Die Notiz nennt die Web-Adresse des Repositorys (Host und Projekt) – nie einen Ordner deines Rechners. Der ganze Git-Stand und das Log bleiben auf diesem Gerät (Tabs **Git** und **Log**).
- Ein selbst betriebenes GitLab oder GitHub Enterprise, dessen Adresse nicht *gitlab* / *github* enthält: Wähl auf der Setup-Seite des Workers seine **Host-Art** – dann klappen Links und Merge Requests auch dort. Ein offener Merge Request wird wiedergefunden statt eines Links für einen neuen.
- **Push abgelehnt?** Der Branch auf dem Remote hat Commits, die hier fehlen. **Von Basis aktualisieren** holt sie zuerst herein, dann **Erneut versuchen**. Der Worker pusht nie von sich aus mit Force.
- Ein Worker älter als 1.10.0 schreibt weiter die Zusammenfassung der Stufe – **Erneut herunterladen** für die Notiz mit Links.

## Aus dem KI-Terminal
Frag das [KI-Terminal](help:agent) (<kbd>Mod+J</kbd>) *„Was wartet in den Pipelines auf mich?“*, *„Leg eine Aufgabe an, die das Login-Formular in website repariert, und starte sie“* oder *„Gib den Plan von Fix login frei“*: Claude liest die Pipelines und **schlägt** Aufgaben und Aktionen **vor**, du übernimmst sie in seiner Prüfliste. Die Karte einer neuen Aufgabe zeigt ihre ganze Seite so, wie Claude Code sie lesen wird; eine Freigabe zeigt den Plan. Was den Worker startet (**STARTET WORKER**), übernimmst du einzeln, nie mit *Alle übernehmen*; eine Aufgabe, die auf **Auf diesem Gerät bestätigen** wartet, bestätigst nur du hier in ihrem Panel. `/pipelines` listet die offenen Aufgaben.

## Sicherheit
Der Worker fasst nur die Repos an, die du angehakt hast; One kann ihm Aufgabentext und feste Git-Aktionen schicken — nie einen Befehl, und selbst nie ein Repo anhaken. Ein heruntergeladener Worker nimmt nur diesen Browser und diesen Arbeitsbereich an; die Nachrichten eines Cloud-Workers sind zwischen diesem Browser und dem Worker versiegelt — der Server reicht sie nur weiter. Claude Code behält seine Berechtigungsregeln, und Aufgabentext geht als Daten mit, nicht als Anweisung. Eine Kostengrenze pro Aufgabe stellst du auf der Seite des Workers ein, eine pro Tag in der `worker.json`. Für die Notiz erfährt One die Web-Adresse des Repositorys (Host und Projekt) – nie einen Pfad. In einem Team-Arbeitsbereich nimmt dein Worker nur Aufgaben, die du auf diesem Gerät geschrieben oder bestätigt hast (**Auf diesem Gerät bestätigen**) — eine Stufe (auch ihr Modell), ein Repo oder ein Branch, auf einem anderen Gerät geändert, fragt erneut. Eine Aufgabe, die einer deiner eigenen Agenten geschrieben hat, wartet auf dieselbe Bestätigung, auch in deinem lokalen Arbeitsbereich. Das KI-Terminal bestätigt nie eine Aufgabe: Seine Aktionen sind Vorschläge, die du übernimmst, die den Worker startenden einzeln, und sie werden für eine Aufgabe abgelehnt, die auf die Bestätigung wartet. Eine Aufgaben-Datei, die der [Ordner- / GitHub-Sync](help:sync) aufnimmt, verschiebt nie eine Aufgabe — Stufe, Repo, Branch und die übrigen Pipeline-Felder bleiben, wie One sie hat, und die Datei wird neu geschrieben —, und eine Aufgabe, deren Text aus der Datei kam, wartet auf **Auf diesem Gerät bestätigen**, auch in deinem lokalen Arbeitsbereich.

> Tipp: Die vollständige Referenz — Konfiguration, Protokoll, Fehlersuche — steht in `docs/CODING.md` im Repository.


## MiniMax M3.1 Flash
Unter **Typ → MiniMax · API** oder je Rolle BA / Coding / QA im Prüfauftrag wählen. Worker **1.18.0** ergänzt diesen Adapter um die gemeinsamen Dateiwerkzeuge, Aufgaben-MCP von One, ausgewählte externe MCP-Server (auch Atlas), Aufgabengedächtnis und Prüfungen. Ein Worker ohne `agent:minimax` übernimmt die Aufgabe nicht als Claude.

**Einstellungen → Coding-Worker → Repositories ändern** öffnen, dann den Abschnitt **MiniMax M3.1 Flash · API**. Dort deinen Key eingeben, Denktiefe und Kontextbudget wählen und speichern. Der Key liegt in `minimax.json` neben der Worker-Konfiguration, auf macOS/Linux nur für den Besitzer lesbar. Er wird weder Arbeitsbereichseigenschaft noch Werkzeugargument. `MINIMAX_API_KEY` in der Worker-Umgebung hat Vorrang; das Entfernen der gespeicherten Datei widerruft keinen Umgebungs-Key.

Kontextbudgets: 65.536, 131.072 (Standard), 262.144 oder 1.000.000 Tokens. Denktiefe standardmäßig `high`, Antwortbudget 16.384 Tokens einschließlich Denken. Gedächtnis-Komprimierung und Fortschrittsgrenzen gelten weiter. Ausgewählter Code, Prompts und Werkzeugergebnisse gehen an die MiniMax-Cloud-API. Das Speichern des Keys sendet keine Modellanfrage.

Kostenschätzungen verwenden die veröffentlichten Preise vom 19. Oktober 2026: 0,15 US-Dollar je Million Eingabetokens, 0,015 für gecachte Eingaben und 0,60 für Ausgaben einschließlich Denken. Verbrauch wird zur Aufgabe gebucht; Aufgaben- und Tagesbudgets begrenzen weitere Anfragen. Bei einer ungewissen Antwort bleibt eine konservative obere Schätzung bestehen, ohne automatische Wiederholung. Das ist kein Abrechnungsbeleg. Siehe [MiniMax-Ankündigung](https://www.minimax.io/blog/minimax-m31f) und [API-Dokumentation](https://platform.minimax.io/docs/guides/text-generation).

Nach dem Hinterlegen eines Keys lässt sich ein kleiner synthetischer Vergleich ausdrücklich mit `node one-worker.mjs benchmark --agent minimax --limit 3 --budget 1` starten. Das US-Dollar-Budget gilt für diesen Lauf. `--agent local` nutzt das lokale Modell. Diese kleinen Programmierfälle belegen keine Gleichwertigkeit mit einem Spitzenmodell; dafür reale Arbeitspakete und Abnahmekriterien vergleichen.

## Ollama Cloud

Wähle **Ollama Cloud** unter Typ oder getrennt für jede Rolle eines Prüfauftrags. Ab Worker **1.19.0** öffnest du **Ollama Cloud einrichten**, gibst deinen eigenen Ollama-Key im Passwortfeld ein und speicherst. Der Key bleibt beim Worker dieses Rechners und wird nicht mit One synchronisiert. Verwende den API-Namen eines werkzeugfähigen Cloud-Modells, anfangs `minimax-m3.1-flash`. Das Kontextbudget kann das eigene Limit des Modells nicht vergrößern.

Speichern sendet keine Cloud-Anfrage. Die eigene Schaltfläche **Verbindung testen (Cloud-Anfrage)** prüft gespeicherten Key und Modell. Ausgewählter Code und Werkzeugergebnisse gehen an Ollama. Dessen Tariflimits gelten; One kann bei diesem Abotarif keine Dollarbudgets durchsetzen. Aufgabenberechtigungen, Schrittlimits, Atlas-/MCP-Werkzeuge und Prüfungen gelten weiter. Lokales Ollama bleibt separat.

## Ollama Cloud zentral für Coding einrichten

Öffne **Einstellungen → KI → Ollama Cloud → API-Key und Modell einrichten …**. Dieselbe Karte steht unter **Coding-Worker**. Sie öffnet die geschützte Einrichtungsseite des Workers. Dort den Key einmal eintragen und speichern; alle Coding-Aufgaben mit Ollama Cloud auf diesem Worker teilen sich Key und Modell. Ist der Worker offline, führt die Karte zuerst zu seinen Verbindungseinstellungen. One liest und synchronisiert diesen Key nicht. Einstellungen öffnen und speichern sendet keine Modellanfrage; **Verbindung testen (Cloud-Anfrage)** ist eine eigene Aktion. Die Anbieterwahl für KI-Terminal und Browser-Agenten bleibt separat.


## Copilot-Modell und Laufnachweis
Bei **GitHub Copilot** ab Worker **1.27.0** Modell, unterstützten Denkaufwand und Kontextbudget direkt an der Aufgabe wählen. Prüfaufträge bieten getrennte Vorgaben für BA, Coding und QA. Die Aufgabenwahl geht der bei Anlage übernommenen Rolle und dem Worker-Standard vor. **Laufnachweise** zeigen gemeldete Modelle, Tokens und verfügbare Kontingentdaten; fehlende Geldbeträge bleiben unbekannt. Einrichtung und Grenzen: [GitHub Copilot in One](help:copilot-coding).
