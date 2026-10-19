# Was als Nächstes kommt — Spezifikation (Stand 2026-10-19)

Live ist `main` @ 7805e03 (Prüfaufträge, Worker 1.13.0, lokaler Coder). Dieses Dokument beschreibt alle Arbeit, die
danach geplant war, in der Reihenfolge, in der ich sie angehen würde. Jedes Paket nennt Ziel, Umfang, die Dateien, wo es
anfängt, Regeln aus CLAUDE.md, die besonders zählen, und wann es fertig ist.

Allgemein für jedes Paket:
- Basis ist `main`. Alles läuft über die Regeln in CLAUDE.md (Writer, `prepare()`, Strings EN + DE, Tokens, keine
  neuen npm-Pakete ohne starken Grund).
- Fertig heißt: `npm run typecheck` sauber; neue Tests schlagen auf dem alten Stand fehl und laufen auf dem neuen;
  betroffene Spec-Dateien grün; Screenshots 1440×900 + 390×844, hell + dunkel angesehen; Hilfe EN + DE; ein „What's
  new“-Eintrag mit echtem Screenshot, wenn sichtbar.
- Vor dem Deploy: der volle Lauf (lokal in vier Teilen, Cloud, Server, `npm --prefix mcp test`, Perf). Fehler, die auch
  auf `main` unter Last scheitern (siehe Anhang), einzeln nachlaufen lassen.

---

## Paket 1 — KI-Terminal: Übernommenes faltet zu einer Zeile  ·  fertig gebaut, nicht live

**Problem (gemeldet):** Nach dem Übernehmen steht die Liste weiter da, Überschrift „3 vorgeschlagene Änderungen“ und
„Nichts ändert sich, bevor du übernimmst“ — es sieht aus, als wäre nichts passiert.

**Stand:** Commit `0273c94` auf `claude/friendly-fermi-n37qku` (ursprünglich 3e7be36). 120 Tests in den betroffenen
Specs grün, Screenshots angesehen.

**Was er tut:**
- Überschrift, Hinweis, Tastenzeile und „Alle verwerfen“ zählen nur Offenes (pending + failed); ohne Offenes fehlen sie.
- Übernommenes und Verworfenes faltet zu einer Zeile: „3 übernommen · 1 verworfen · u rückgängig · Anzeigen“
  (`Anzeigen` = Knopf mit `aria-expanded`). Aufgeklappt sieht man die Zeilen wie früher.
- Aufgeklappt bleibt pro Unterhaltung im Speicher (`doneShown`, `/new` faltet wieder).
- Tasten: j / k / ↑ / ↓ / Pos1 / Ende nur über sichtbare Zeilen; Leertaste / ↵ auf der Zeile klappt; `u` überall;
  Fokus landet nie auf `body`.
- Dateien: `src/app/features/ai/agent/AgentSheet.tsx` (Review), `state.ts`, `agent.css`,
  `src/app/features/messages-agent.ts`, Tests in `tests/e2e/ai-terminal.spec.ts` + angepasste Specs.

**Offen bis live:** „What's new“-Eintrag EN + DE mit Screenshot (`scripts/changelog-shots.mjs`), ein Satz im
Hilfeartikel `agent`, voller Testlauf.

---

## Paket 2 — Lokales Modell (Ollama, OpenAI-kompatibel) im KI-Terminal  ·  Priorität hoch

**Ziel:** Das KI-Terminal arbeitet mit einem lokalen Modell. Ones eigene Schleife ruft das Modell; Werkzeugaufrufe kommen
zurück, One führt seine Werkzeuge aus, das Ergebnis geht ans Modell. Das Modell selbst führt nichts aus.

**Verbindung des Owners:** `http://127.0.0.1:11434/v1` · Modell `marcel-coder` (Qwen3-Coder 30B Q4_K_M) · Schlüssel
„ollama“ (Platzhalter) · Kontext 32 768 · Streaming · Werkzeugaufrufe geprüft (`read_file`).

**Was heute fehlt:**
- `src/shared/ai/wire/openrouterChat.ts` kann das OpenAI-Format schon (Nachrichten, `tool_calls`, `role:'tool'`, Stream-
  Parser), aber `build()` ist OpenRouter-spezifisch (feste URL, `provider`, `plugins`, Header).
- Die Terminal-Schleife ist Claude-only: `src/app/features/ai/agent/run.ts` `runAgent()` = Anthropic SDK `toolRunner`
  mit Claude-Feldern; `session.ts` hält die Historie als `BetaMessageParam[]`; `core/routable.ts` lässt OpenRouter nicht
  ans Terminal; `ProviderId` kennt nur anthropic / openai / openrouter.
- Die Werkzeuge selbst (`agent/tools.ts`, `TERMINAL_TOOLS`) sind schon neutral.

**Umfang Scheibe 1 (nur Terminal, nur lokale Arbeitsbereiche):**
1. Gemeinsam (pur, `src/shared/ai`):
   - `ProviderId` + `'local'`; `models.ts` (`STORED_PROVIDERS`, `ID_RE.local = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/`,
     Label „Lokal · <modell>“).
   - neu `local.ts` `localBase(url)`: nur `http(s)://127.0.0.1 | localhost | [::1]` (+ Port), keine Zugangsdaten in der
     URL, Pfad auf `/v1` normiert; sonst `null`.
   - `providers.ts`: Eintrag LOCAL (Code `'LO'`, Typ erweitern), ehrlicher Datenschutz-Satz: „Anfragen gehen von diesem
     Browser an das Programm unter <Adresse> auf diesem Rechner; nichts geht an One oder einen Anbieter. Was das Programm
     damit macht, sieht One nicht.“ (kein „verlässt nie den Rechner“ — ein `ssh -L`-Tunnel ist möglich).
     **Achtung:** `keyOfOther` mit leerem `keyPrefix` — `''.startsWith` ist immer wahr.
   - `prices.ts`: `priceRow()` liefert für `'local'` eine Null-Zeile (`source 'table'`). Sonst lehnt der Regler mit
     Budget jede Anfrage ab („kein Preis + Limit = abgelehnt“).
   - `policy.ts`: lokal darf auf diesem Gerät alle Klassen bekommen. Sanitizer lehnen `'local'` in `Workspace.ai`
     und `CustomAgent.route` ab (eine Adresse ist auf einem anderen Gerät sinnlos); der Team-Server-Guard
     (`server/src/collab/workspace-ai.ts`) ebenso.
   - `generations.ts`: neue Generation + `AI_POLICY_GEN` hoch, damit ältere Tabs „neu laden“ sagen statt eine Regel mit
     `'local'` falsch zu lesen.
2. Gerät: `settings.ai.local = { base, model, context }`, Schlüssel optional im Tresor (`ai-key:local`); ohne Schlüssel
   kein `Authorization`-Header. „Hat Schlüssel“ für lokal = Adresse + Modell gesetzt (`gate.ts` `hasKey`, `aiStatus`).
3. Adapter `src/app/features/ai/providers/local.ts` (lazy): `build()` mit `{model, messages, tools, stream:true,
   stream_options:{include_usage:true}, max_tokens}` (Render-Teile aus openrouterChat exportieren oder nach
   `wire/chatCompletions.ts` ziehen); `assertLocalBody` verbietet `mcp_servers`, Web-Suche, Server-Werkzeuge;
   `verify()` = `GET {base}/models` (kostenlos, kein Text) und das Modell muss gelistet sein.
   Parser tolerant: `tool_calls` vorhanden mit `finish_reason:"stop"` → als Werkzeugrunde behandeln; fehlende IDs
   erzeugen; unlesbare Argumente → `ToolInputError` zurück ans Modell.
4. Kern: `core/routable.ts` `ROUTABLE.local = ['terminal']`; `core/registry.ts` synthetisiert ModelInfo aus der
   Geräte-Konfiguration (caps: tools ja; vision, pdf, mcp, cache, effort, reasoning, web nein; context = eingestellt;
   maxOutput 4096); `core/call.ts` lokaler Zweig ohne Katalog/Pins/Upstream, mit `meterCall` (0 $);
   `gate.ts` — keine günstigeren Routen (kein „H“).
5. Schleife: neu `agent/runLocal.ts`, gleiche Signatur und `RunHooks` wie `runAgent`; `session.ts` verzweigt auf
   `prepared.route.p`. Die Werkzeug-Ausführung aus der Closure in run.ts (~Z. 313–351) in ein gemeinsames `execTool()`
   ziehen — **ohne** die Claude-Requests zu ändern (Golden-Tests müssen byte-gleich bleiben). Historie übersetzen
   (`toNeutral` / `toBeta`: Text, tool_use ↔ tool_call, tool_result; Thinking/MCP-Blöcke weg). Der Anbieter einer
   Unterhaltung wird beim ersten Auftrag festgelegt; Wechsel braucht `/new`. Jede Runde über `prepare()` /
   `beforeRound()`; `MAX_TOOL_CALLS` wie heute.
6. **Kontext (größtes Risiko):** Ollama schneidet still vorne ab (System-Prompt + Werkzeuge gehen verloren).
   System-Prompt + ~20 Werkzeug-Schemas ≈ 8–12 k Token (messen: `JSON.stringify(TERMINAL_TOOLS)`). Also:
   `max_tokens` lokal ≈ 4096; Werkzeug-Ergebnisse auf ~6 000 Zeichen kürzen (`clipResult`); vor jeder Runde schätzen
   (`messagesChars` / `CHARS_PER_TOKEN`); über `context − max_tokens` → Stopp „Kontext voll — /new“ (EN + DE).
   `usage.prompt_tokens ≈ num_ctx` ist ein Warnsignal.
7. Auf diesem Weg abgelehnt (mit klarer Meldung, nie still weg): MCP-Server (als „skipped: provider“ zeigen),
   Codewörter, `/generate`, Web-Suche, Bilder, PDFs, Datei-Referenzen, Gedächtnis-Vorschläge, Caching/Thinking/Effort,
   „H günstigeres Modell“, eigene Agenten, Coding-/Pipeline-Werkzeuge.
8. Oberfläche: Einstellungen › KI eine Platte „Lokal (OpenAI-kompatibel)“ — Adresse (Vorgabe
   `http://127.0.0.1:11434/v1`), Modell, Kontext (Vorgabe 32768), Schlüssel optional, **Prüfen**. Diagnose in dieser
   Reihenfolge: Chrome-Berechtigung „Lokales Netzwerk“ verweigert (`lib/localNetwork.ts`) · Server antwortet, aber CORS
   abgelehnt (no-cors-Probe kommt durch) → „`OLLAMA_ORIGINS=<diese Adresse>` setzen und Ollama neu starten“ · nichts
   antwortet → „Ollama läuft nicht“ · Safari (https → http blockiert) → „Chrome/Firefox oder One auf localhost“.
   „Lokal fürs Terminal wählen“ = Geräteregel für den Zweck `terminal` (`setDeviceRule`, gestempelt).
   `Receipt.tsx` `COMPANY` und `PROVIDER_NAME` (erschöpfende Records) bekommen `'local'`.
9. Team-Arbeitsbereiche: in Scheibe 1 abgelehnt (sagt es). Die CSP des Team-Servers (`server/src/http/security.ts`)
   bleibt unverändert.

**Browser-Fakten:** `http://127.0.0.1` gilt in Chrome und Firefox als vertrauenswürdig (kein Mixed-Content-Block),
Safari blockiert. CORS: Ollama erlaubt nur localhost-Origins → `OLLAMA_ORIGINS` setzen (Mac:
`launchctl setenv OLLAMA_ORIGINS "https://getonecms.com,http://localhost:5173"`, dann Ollama neu starten). Chrome fragt
einmal nach „Lokales Netzwerk“.

**Tests:**
- Node: `localBase` (akzeptiert 127.0.0.1 / localhost / [::1]; lehnt `127.0.0.1.evil.com`, `user@…`, `10.x`, `0.0.0.0`
  ab); Golden `build()` lokal; Parser auf Ollama-Streams (ein Chunk, keine ID, stop + tool_calls); `toNeutral`/`toBeta`
  Rundreise; `priceRow` 0 → Band 0 $, nie `noprice`; Sanitizer lehnen `'local'` in Workspace / Agent ab.
- E2E: `mockLocalScript(ctx, steps)` routet `http://127.0.0.1:11434/**` (GET /v1/models, POST /v1/chat/completions
  SSE); Host in `tests/e2e/helpers/aiNet.ts` aufnehmen. Auftrag → `search_pages`-Aufruf → One führt aus → zweite Anfrage
  hat `role:'tool'` → Text → vorgemerkte Änderung erscheint; Ledger `usd 0`, `served.p 'local'`; mit MCP-Servern: kein
  `mcp_servers` im Body; Kontext-Stopp; null Anfragen an api.anthropic.com; Platte: OK / CORS-Hinweis / läuft nicht.
- Bestehende ai-*, Terminal-, Regler- und Golden-Specs bleiben grün.

**Danach (Scheibe 2):** KI-Menü, Umwandeln, ⌘K „?“ über `viaNeutral`; strukturierte Antworten (`response_format`),
wenn das Modell sie sauber kann.

---

## Paket 3 — Workshop (bis 2026-10-25)

**Ziel:** Fachanalyse + Coding laufen sauber; jeder Teilnehmer rechnet über einen eigenen Schlüssel mit Budget ab.

**Fakten (geprüft, Doku-Quellen in den Notizen):**
- `claude -p`: `ANTHROPIC_API_KEY` aus der Umgebung schlägt `/login` ohne Rückfrage. Reihenfolge: Cloud-Provider →
  `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → apiKeyHelper → `CLAUDE_CODE_OAUTH_TOKEN` → Anmeldung.
- Der Worker reicht die Umgebung an Claude Code durch (`mcp/src/worker/run.ts` `claudeEnv()`); seit 1.13.0 nennt das
  Protokoll pro Stufe, womit abgerechnet wird, und Geheimnisse gehen nie an One.
- Ausgabenlimit gibt es in der Console nur **je Workspace**, nicht je Schlüssel → ein Workspace je Teilnehmer mit
  Monatslimit und einem Schlüssel darin (Default-Workspace kann kein Limit). Nutzung je Schlüssel über die Admin-API
  (`usage_report/messages`, `group_by=api_key_id`).
- Der Regler bremst nur Ones eigene Anfragen, nicht Claude Code im Worker → harte Grenze = Console-Limit.

**Arbeit:**
1. **Verständliche Meldung am Limit:** Wenn Claude Code wegen Guthaben/Limit scheitert (Texte wie „credit balance“,
   „usage limit“, HTTP 400/429 mit billing), meldet der Worker einen eigenen Log-Code (`limitReached`, EN + DE: „Das
   Ausgabenlimit dieses Schlüssels ist erreicht — in der Claude Console erhöhen oder auf den nächsten Monat warten“) und
   die Aufgabe scheitert mit diesem Grund statt einer rohen Meldung. Worker-Version erhöhen, Test mit dem Fake-CLI.
2. **Leitfaden final** (`Leitfaden-Entwurf.md` im Session-Scratchpad, Inhalt unten zusammengefasst) — Menüwege im
   Probelauf bestätigen, dann als Seite/Dokument an die Teilnehmer.
3. **Vorab-Checkliste für Teilnehmer:** Node.js ≥ 20, git, Claude Code (`claude --version`), Chrome oder Firefox,
   Firmen-Proxy-Test (api.anthropic.com + euer MCP-Server erreichbar).
4. **Probelauf Tag 1 + Tag 2** im Container mit Fake-Claude und Mock-MCP-Server, aus Teilnehmersicht; was hakt, beheben.
5. **Checkliste echter Schlüssel** (Owner, ~45 min, Workspace mit 5 $ Limit): Einrichten in One, Worker mit
   `ANTHROPIC_API_KEY`, Prüfauftrag → Planen → Kette starten → Analyse → Coding → QA, Abrechnungszeile im Protokoll,
   Kosten in #/regler und in der Console, Schlüssel nirgends sichtbar, optional Limit-Test.
6. **Notfallplan:** ein vorbereiteter Demo-Arbeitsbereich (Sicherung zum Import) für Teilnehmer, bei denen etwas klemmt.

Leitfaden in Kürze: Console (Workspace je Teilnehmer, Limit, Warnschwelle, Schlüssel) → One (Schlüssel in Schritt 02,
Tagesbudget § 06, MCP-Server eintragen + Verbindung testen) → Worker (`export ANTHROPIC_API_KEY=…; node
one-worker.mjs`) → Ablauf (⌘K Prüfen lassen → Planen → Kette starten → Freigaben im Vorflug-Check) → Abrechnung
(Console je Workspace; Schlüssel danach widerrufen).

---

## Paket 4 — Dateien direkt ins KI-Terminal (auch ZIP)  ·  vom Owner freigegeben

**Ziel:** Dateien vom Rechner ins Terminal ziehen, wählen oder einfügen, um sie mit One-Seiten abzugleichen.

- Ziehen / Taste „Datei“ / Einfügen → `TermRef.file`-Referenz ohne Umweg über eine Seite (gespeichert über `saveFile`,
  Herkunft wie heutige Datei-Referenzen; private / Team-Regeln wie „Claude für Dateien“).
- Dieselben Leser wie „Claude für Dateien“: PDF (≤ 600 Seiten, Haiku 100, ≤ 23 MB), docx, csv, xlsx, md, html, txt;
  Ablehnungen wie heute, vor dem Senden.
- ZIP: im Browser entpackt (fflate, streaming), Liste zeigen, Person (oder Claude per Werkzeug) wählt Einträge.
  Schutz: Größe gesamt und je Eintrag begrenzen, Anzahl begrenzen, verschachtelte ZIPs nur eine Ebene, Namen säubern
  (kein `..`, keine absoluten Pfade, Steuerzeichen); nur gewählte Einträge gehen an Claude.
- Änderungen an Seiten laufen wie immer als vorgemerkte Änderungen mit Review.
- Läuft über `prepare()` mit der richtigen Quelle/Klasse; Regler-Band zählt PDF-Seiten / Zeichen (`messagesChars`).
- Tests: Ablage + Auswahl, ZIP-Bombe / Pfadangriff abgelehnt, PDF zu groß abgelehnt vor dem Senden, Vergleich mit
  einer Seite erzeugt eine `edit`-Änderung.

---

## Paket 5 — Backlog (bekannte Fehler und Lücken)

1. **Einseitige Zwei-Wege-Verknüpfungen aus Terminal/Agenten** (`src/app/features/ai/agent/apply.ts`): `create_row` /
   `update_row` schreiben eine Relation nur auf der eigenen Zeile; bei Zwei-Wege-Paaren (`<propId>.2way`, Unterpunkte,
   Abhängigkeiten) fehlt die Gegenseite, bei Unterpunkten kann eine Zeile zwei Eltern haben. Fertig: Partnerseite wie
   die UI (ein Store-Update, gleicher Writer), ein Elternteil, Schleifen abgelehnt, Undo nimmt beide Seiten zurück.
   MCP bleibt bei Zwei-Wege-Relationen gesperrt (Weg 4) — nicht dorthin zurückbringen.
2. **MCP `one_move_row`** (`src/app/features/mcp/tidy.ts`) prüft das Zwei-Wege-Paar nur beim Planen, nicht beim Anwenden
   (die Zeilen-Werkzeuge tun es über `assertOneWayStage`).
3. **Prüfaufträge, Befund 11 (teilweise offen):** zwei Local-Worker eines Mitglieds — die Anfrage-Karte auf dem zweiten
   Gerät, während das erste plant.
4. **#192** KI-Menü mit Schlüssel: erste Sitzung verliert ein Leerzeichen im Tipp-Burst; Esc im 300-ms-Fenster;
   iOS-Tastatur bei Karten-Fokus.
5. **#193** Nachrichtenpakete lazy laden (Setup, Regler, Decide-Texte aus dem Boot-Pfad).
6. **#196** Store: Zusammenführen über Tabs neu entwerfen (zwei Tabs, Seiten ohne ID) — nach dem Revert von b6a78b8.
7. **#198** `workitem-p2-keys:268` „#2 verwerfen“ per Enter bleibt manchmal offen (auch auf main, 2 von 6).
8. **#199** `perf-budget:343` stabilisieren (längste Tipp-Aufgabe ≤ 50 ms, kalter Index ≤ 60 ms) — scheitert unter Last.
9. **#268** Sidebar: `memo(Sidebar)` + memoisierter `DropContext`-Wert.
10. **#269** vorbestehende E2E-Fehler auf main (siehe Anhang) einzeln aufräumen.
11. **Flugschreiber-Deck:** erzwungenes Layout in `DeckHead.tsx:38` beim Öffnen.

## Paket 6 — Größere Vorhaben (Reihenfolge offen)

- **Aufgaben-Block P1, P3, P4:** Block-UI, #/tasks-Übersicht, Server-Parität (P2 „Claude schreibt“ ist live).
- **Flugschreiber R4 (Geist) + R5 (Team).**
- **Regler G2 (Hebel / Decke) + G3 (Bänder / Sparregeln).**
- **OpenAI als Anbieter** (Scheibe nach OpenRouter; `getAIKey('openai')` ist vorbereitet).
- **Restliche „Killer-Features“:** Rundlauf, Tickets hören mit, Einwurf.

## Betrieb / Hinweise an den Owner

- **Team-Server aktualisieren** (seit Zug 14 ausstehend; nötig für MCP-Wiederherstellen ganz-oder-gar-nicht, das
  zentrale Gate, gesperrte Zwei-Wege-Relationen und die Prüfauftrags-Datenbank als Systemdatenbank).
- Worker 1.13.0 neu laden; Erweiterung 1.12.0 bleibt.
- Liegengebliebener Zweig `claude/backup-worker113` kann auf GitHub gelöscht werden.

## Anhang — Test-Betrieb

- Gate-Skripte (Session-Scratchpad): `gate-drive.sh <sha> <tag>` (base → cloud, l1–l4, perf), `suite3.sh`, Einzel-
  Nachläufe wie `rerun17.sh`. Coding-/Prüfauftrags-Specs nehmen jetzt einen Fake-Worker-Port je Parallel-Worker
  (lokal 47484 + 10·i, Cloud 47584 + 10·i) — keine Port-Kollisionen mehr.
- Unter Last auch auf main wackelig: patchbay-perf, perf-budget:343, preflight-perf, recorder-deck, patchbay-layout,
  patchbay-fuses:954, mail-gmail:1605; gelegentlich block-hover:498, coding-ship-fake:128, recorder-eject-f1:559,
  workitem-p1-block:780, preflight-queue:646 (alle einzeln grün).
- MCP-Tests und Specs mit festem Port nur unter `flock …/mcp-test.lock`.
