import type { Messages } from '@/shared/i18n'

/**
 * Strings of the agent recipe "Mirror a list into a database" (features/agents/mirror.ts + MirrorSetup.tsx): the
 * setup dialog, the database it creates (property, option and view names), the agent's instructions with their
 * placeholders, and the editor's hints. Keys "features.agents.recipe.mirror.*" / "features.agents.mirror.*" — always
 * add both en and de. No service is named anywhere: the source is "an MCP server".
 */
export const messages: Messages = {
  en: {
    'features.agents.recipe.mirror.name': 'Mirror a list into a database',
    'features.agents.recipe.mirror.desc': 'Items of another tool (an MCP server) → a database, every weekday. Your own fields stay yours.',

    'features.agents.mirror.title': 'Mirror a list into a database',
    'features.agents.mirror.lead':
      'A new database and an agent that keeps it in step with another tool every weekday morning: new items are added, changed ones updated, nothing is written back. {yours} are filled in only by you.',
    'features.agents.mirror.source': 'Source',
    'features.agents.mirror.sourceHint': 'The MCP server the items come from. The agent starts with its reading tools only.',
    'features.agents.mirror.noServers': 'No MCP server yet — add the one of your tool first.',
    'features.agents.mirror.addServer': 'Settings → MCP servers',
    'features.agents.mirror.tools': '{n} tools · {read} read-only',
    'features.agents.mirror.untested': 'Not tested — test it once so the agent can be limited to reading tools',
    'features.agents.mirror.off': 'Switched off',
    'features.agents.mirror.name': 'Name',
    'features.agents.mirror.namePh': 'e.g. Tickets',
    'features.agents.mirror.nameHint': 'The database’s name — the agent and its report page are named after it.',
    'features.agents.mirror.where': 'Where',
    'features.agents.mirror.top': 'Top level',
    'features.agents.mirror.topPrivate': 'Private · top level',
    'features.agents.mirror.whereHint': 'The database and its report page go below this page.',
    'features.agents.mirror.whereTeam': 'In a team workspace both go into your Private section.',
    'features.agents.mirror.spec.db': 'Database',
    'features.agents.mirror.spec.dbValue': '{props} properties · {views} views · key: {key}',
    'features.agents.mirror.spec.yours': 'Only by hand',
    'features.agents.mirror.spec.agent': 'Agent',
    'features.agents.mirror.spec.agentValue': 'Weekdays {at} · proposals first · {usd} per run',
    'features.agents.mirror.spec.report': 'Report',
    'features.agents.mirror.create': 'Create database and agent',
    'features.agents.mirror.err.name': 'Give it a name.',
    'features.agents.mirror.err.server': 'Pick the MCP server the items come from.',
    'features.agents.mirror.err.failed': 'Could not create the database: {msg}',
    'features.agents.mirror.created': '“{name}” is ready: a database with {views} views and a report page.',
    'features.agents.mirror.agentName': 'Mirror · {name}',
    'features.agents.mirror.reportTitle': '{name} · Report',
    'features.agents.mirror.intro': 'The database “{name}” and the page “{report}” are ready. Replace the four parts in [SQUARE BRACKETS] in the instructions with how your tool works, then save.',
    'features.agents.mirror.writeHint': 'Starts with proposals: you review every run. Switch to Apply directly once the first runs look right.',
    'features.agents.mirror.toReplace': 'To replace',
    'features.agents.mirror.toReplaceHint': 'Click one to select it in the instructions, then type.',
    'features.agents.mirror.err.placeholders': 'Replace the parts in [SQUARE BRACKETS] first ({count} left) — or switch the agent off to save it as a draft.',
    'features.agents.mirror.err.unfinished': '“{name}” still has {count} parts in [SQUARE BRACKETS] to replace — fill them in under Edit first.',

    'features.agents.mirror.ph.list': '[HOW TO LIST THE ITEMS]',
    'features.agents.mirror.ph.read': '[HOW TO READ ONE ITEM WITH ITS COMMENTS]',
    'features.agents.mirror.ph.me': '[WHO I AM IN THE SOURCE]',
    'features.agents.mirror.ph.clear': '[WHAT "CLEAR" MEANS HERE]',
    'features.agents.mirror.phHint.list': 'Which tool lists the items, with which filter — e.g. “list_items with project WEB and status open”.',
    'features.agents.mirror.phHint.read': 'Which tool reads one item with its comments — e.g. “get_item with the id, comments included”.',
    'features.agents.mirror.phHint.me': 'Your name, user name or address in the tool — so comments addressed to you are found.',
    'features.agents.mirror.phHint.clear': 'When an item is ready to work on — e.g. “acceptance criteria written, no open question, nothing blocking”.',

    'features.agents.mirror.prop.name': 'Name',
    'features.agents.mirror.prop.key': 'Key',
    'features.agents.mirror.prop.link': 'Link',
    'features.agents.mirror.prop.srcStatus': 'Source status',
    'features.agents.mirror.prop.srcPriority': 'Source priority',
    'features.agents.mirror.prop.owner': 'Owner',
    'features.agents.mirror.prop.tags': 'Tags',
    'features.agents.mirror.prop.changedAt': 'Changed at',
    'features.agents.mirror.prop.comments': 'Comments',
    'features.agents.mirror.prop.lastComment': 'Last comment',
    'features.agents.mirror.prop.lastCommentAt': 'Last comment at',
    'features.agents.mirror.prop.newComment': 'New comment',
    'features.agents.mirror.prop.waiting': 'Waiting on me',
    'features.agents.mirror.prop.clarity': 'Clarity',
    'features.agents.mirror.prop.why': 'Why',
    'features.agents.mirror.prop.gone': 'Gone from source',
    'features.agents.mirror.prop.myStatus': 'My status',
    'features.agents.mirror.prop.myPriority': 'My priority',
    'features.agents.mirror.prop.nextStep': 'Next step',
    'features.agents.mirror.prop.due': 'Due',
    'features.agents.mirror.desc.key': 'The item’s id in the source — the agent finds rows by it.',
    'features.agents.mirror.desc.source': 'Written by the agent, as in the source.',
    'features.agents.mirror.desc.agent': 'The agent’s reading of the item.',
    'features.agents.mirror.desc.hand': 'Yours — the agent never writes it.',

    'features.agents.mirror.clarity.clear': 'Clear',
    'features.agents.mirror.clarity.open': 'Open questions',
    'features.agents.mirror.clarity.blocked': 'Blocked',
    'features.agents.mirror.clarity.elsewhere': 'In progress elsewhere',
    'features.agents.mirror.clarity.done': 'Done',

    'features.agents.mirror.view.board': 'Board by Clarity',
    'features.agents.mirror.view.newComments': 'New comments',
    'features.agents.mirror.view.ready': 'Ready to work',
    'features.agents.mirror.view.week': 'My week',
    'features.agents.mirror.view.source': 'As in the source',
    'features.agents.mirror.view.all': 'All',

    'features.agents.mirror.instructions': `Keep the database “{db}” in step with the items in {server} (an MCP server), every weekday. Only read {server}.

YOUR PART — replace each part in square brackets:
- List the items: {phList}
- Read one item with its comments: {phRead}
- Who I am in {server}: {phMe}
- An item is “{clear}” when: {phClear}

THE FIXED PART:
1. Only read {server}: never create, change, comment on, assign or close anything there.
2. Start with agent_state_get. Your state holds the time of your last run and the comment count per item: {"last": "<ISO time>", "comments": {"<key>": <count>}}. No state yet = the first run: take every item and leave no notes.
3. List the items. Read each item that is new or changed since your last run, with its comments.
4. Write with upsert_rows into “{db}”, key_property "{key}", at most 50 rows per call (more items: more calls). Per item: title = its title, key = its id, plus {link}, {status}, {prio}, {owner}, {tags}, {changed}, {comments} (how many), {last} (the newest comment, its author first, at most 200 characters) and {lastAt}.
5. {new}: checked when the item has more comments than your state says, otherwise unchecked. {waiting}: checked when the newest comment asks me something or names me and I have not answered since, otherwise unchecked.
6. {clarity}: {clear} · {open} · {blocked} · {elsewhere} · {done} — judged by what “{clear}” means above. {why}: one short sentence why.
7. Never write {myStatus}, {myPrio}, {next} or {due}: they are mine (only by hand).
8. A row whose item {server} no longer lists: check {gone} — never delete the row. An item that is back: uncheck it.
9. notify_me with page_id = the item’s row: one note per new comment addressed to me ("New comment on #8215") and one note for the items that became “{clear}” since your last run ("3 items became ready"). Nothing else.
10. At the end: agent_state_set with {"last": "<now, ISO>", "comments": {"<key>": <count>, …}} — keys and counts only, at most 4 KB.
11. Report in 3–8 lines: new, changed and gone items, what waits for me, what became “{clear}”.`,
  },
  de: {
    'features.agents.recipe.mirror.name': 'Liste in eine Datenbank spiegeln',
    'features.agents.recipe.mirror.desc': 'Einträge eines anderen Werkzeugs (ein MCP-Server) → eine Datenbank, jeden Werktag. Deine eigenen Felder bleiben deine.',

    'features.agents.mirror.title': 'Liste in eine Datenbank spiegeln',
    'features.agents.mirror.lead':
      'Eine neue Datenbank und ein Agent, der sie jeden Werktagmorgen mit einem anderen Werkzeug abgleicht: Neue Einträge kommen dazu, geänderte werden aktualisiert, zurückgeschrieben wird nichts. {yours} füllst nur du.',
    'features.agents.mirror.source': 'Quelle',
    'features.agents.mirror.sourceHint': 'Der MCP-Server, aus dem die Einträge kommen. Der Agent startet nur mit seinen lesenden Werkzeugen.',
    'features.agents.mirror.noServers': 'Noch kein MCP-Server — füge zuerst den deines Werkzeugs hinzu.',
    'features.agents.mirror.addServer': 'Einstellungen → MCP-Server',
    'features.agents.mirror.tools': '{n} Werkzeuge · {read} nur lesend',
    'features.agents.mirror.untested': 'Nicht getestet — teste ihn einmal, damit der Agent auf lesende Werkzeuge begrenzt werden kann',
    'features.agents.mirror.off': 'Ausgeschaltet',
    'features.agents.mirror.name': 'Name',
    'features.agents.mirror.namePh': 'z. B. Tickets',
    'features.agents.mirror.nameHint': 'Der Name der Datenbank — Agent und Berichtsseite heißen danach.',
    'features.agents.mirror.where': 'Wo',
    'features.agents.mirror.top': 'Oberste Ebene',
    'features.agents.mirror.topPrivate': 'Privat · oberste Ebene',
    'features.agents.mirror.whereHint': 'Datenbank und Berichtsseite kommen unter diese Seite.',
    'features.agents.mirror.whereTeam': 'Im Team-Workspace landen beide in deinem privaten Bereich.',
    'features.agents.mirror.spec.db': 'Datenbank',
    'features.agents.mirror.spec.dbValue': '{props} Eigenschaften · {views} Ansichten · Schlüssel: {key}',
    'features.agents.mirror.spec.yours': 'Nur von Hand',
    'features.agents.mirror.spec.agent': 'Agent',
    'features.agents.mirror.spec.agentValue': 'Werktags {at} · erst Vorschläge · {usd} pro Lauf',
    'features.agents.mirror.spec.report': 'Bericht',
    'features.agents.mirror.create': 'Datenbank und Agent anlegen',
    'features.agents.mirror.err.name': 'Gib ihr einen Namen.',
    'features.agents.mirror.err.server': 'Wähle den MCP-Server, aus dem die Einträge kommen.',
    'features.agents.mirror.err.failed': 'Die Datenbank konnte nicht angelegt werden: {msg}',
    'features.agents.mirror.created': '„{name}“ ist angelegt: eine Datenbank mit {views} Ansichten und eine Berichtsseite.',
    'features.agents.mirror.agentName': 'Spiegel · {name}',
    'features.agents.mirror.reportTitle': '{name} · Bericht',
    'features.agents.mirror.intro': 'Die Datenbank „{name}“ und die Seite „{report}“ sind angelegt. Ersetze die vier Teile in [ECKIGEN KLAMMERN] in den Anweisungen durch das, was für dein Werkzeug gilt, und speichere dann.',
    'features.agents.mirror.writeHint': 'Startet mit Vorschlägen: Du prüfst jeden Lauf. Stell auf Direkt anwenden um, sobald die ersten Läufe stimmen.',
    'features.agents.mirror.toReplace': 'Zu ersetzen',
    'features.agents.mirror.toReplaceHint': 'Klick auf einen Teil, um ihn in den Anweisungen auszuwählen, dann tippe.',
    'features.agents.mirror.err.placeholders': 'Ersetze zuerst die Teile in [ECKIGEN KLAMMERN] (noch {count}) — oder schalte den Agenten aus, um ihn als Entwurf zu speichern.',
    'features.agents.mirror.err.unfinished': '„{name}“ hat noch {count} Teile in [ECKIGEN KLAMMERN] zu ersetzen — fülle sie zuerst unter Bearbeiten aus.',

    'features.agents.mirror.ph.list': '[WIE ICH DIE EINTRÄGE AUFLISTE]',
    'features.agents.mirror.ph.read': '[WIE ICH EINEN EINTRAG MIT SEINEN KOMMENTAREN LESE]',
    'features.agents.mirror.ph.me': '[WER ICH IN DER QUELLE BIN]',
    'features.agents.mirror.ph.clear': '[WAS „KLAR“ HIER HEISST]',
    'features.agents.mirror.phHint.list': 'Welches Werkzeug die Einträge auflistet, mit welchem Filter — z. B. „list_items mit Projekt WEB und Status offen“.',
    'features.agents.mirror.phHint.read': 'Welches Werkzeug einen Eintrag mit seinen Kommentaren liest — z. B. „get_item mit der Kennung, samt Kommentaren“.',
    'features.agents.mirror.phHint.me': 'Dein Name, Benutzername oder deine Adresse im Werkzeug — damit Kommentare an dich gefunden werden.',
    'features.agents.mirror.phHint.clear': 'Wann ein Eintrag bereit zum Arbeiten ist — z. B. „Abnahmekriterien stehen, keine offene Frage, nichts blockiert“.',

    'features.agents.mirror.prop.name': 'Name',
    'features.agents.mirror.prop.key': 'Schlüssel',
    'features.agents.mirror.prop.link': 'Link',
    'features.agents.mirror.prop.srcStatus': 'Status (Quelle)',
    'features.agents.mirror.prop.srcPriority': 'Prio (Quelle)',
    'features.agents.mirror.prop.owner': 'Zuständig',
    'features.agents.mirror.prop.tags': 'Tags',
    'features.agents.mirror.prop.changedAt': 'Geändert am',
    'features.agents.mirror.prop.comments': 'Kommentare',
    'features.agents.mirror.prop.lastComment': 'Letzter Kommentar',
    'features.agents.mirror.prop.lastCommentAt': 'Letzter Kommentar am',
    'features.agents.mirror.prop.newComment': 'Neuer Kommentar',
    'features.agents.mirror.prop.waiting': 'Wartet auf mich',
    'features.agents.mirror.prop.clarity': 'Klarheit',
    'features.agents.mirror.prop.why': 'Warum',
    'features.agents.mirror.prop.gone': 'Nicht mehr in der Quelle',
    'features.agents.mirror.prop.myStatus': 'Mein Status',
    'features.agents.mirror.prop.myPriority': 'Meine Prio',
    'features.agents.mirror.prop.nextStep': 'Nächster Schritt',
    'features.agents.mirror.prop.due': 'Fällig',
    'features.agents.mirror.desc.key': 'Die Kennung des Eintrags in der Quelle — daran findet der Agent die Zeilen.',
    'features.agents.mirror.desc.source': 'Schreibt der Agent, wie in der Quelle.',
    'features.agents.mirror.desc.agent': 'Die Einschätzung des Agenten.',
    'features.agents.mirror.desc.hand': 'Deins — der Agent schreibt es nie.',

    'features.agents.mirror.clarity.clear': 'Klar',
    'features.agents.mirror.clarity.open': 'Offene Fragen',
    'features.agents.mirror.clarity.blocked': 'Blockiert',
    'features.agents.mirror.clarity.elsewhere': 'Woanders in Arbeit',
    'features.agents.mirror.clarity.done': 'Erledigt',

    'features.agents.mirror.view.board': 'Board nach Klarheit',
    'features.agents.mirror.view.newComments': 'Neue Kommentare',
    'features.agents.mirror.view.ready': 'Bereit zum Arbeiten',
    'features.agents.mirror.view.week': 'Meine Woche',
    'features.agents.mirror.view.source': 'Wie in der Quelle',
    'features.agents.mirror.view.all': 'Alle',

    'features.agents.mirror.instructions': `Halte die Datenbank „{db}“ jeden Werktag mit den Einträgen in {server} (ein MCP-Server) im Gleichstand. Lies {server} nur.

DEIN TEIL — ersetze jeden Teil in eckigen Klammern:
- Einträge auflisten: {phList}
- Einen Eintrag mit seinen Kommentaren lesen: {phRead}
- Wer ich in {server} bin: {phMe}
- Ein Eintrag ist „{clear}“, wenn: {phClear}

DER FESTE TEIL:
1. Lies {server} nur: Lege dort nichts an und ändere, kommentiere, vergib oder schließe nichts.
2. Beginne mit agent_state_get. Dein Zustand enthält die Zeit deines letzten Laufs und die Zahl der Kommentare je Eintrag: {"last": "<ISO-Zeit>", "comments": {"<Schlüssel>": <Zahl>}}. Noch kein Zustand = der erste Lauf: Nimm alle Einträge und hinterlasse keine Notizen.
3. Liste die Einträge auf. Lies jeden Eintrag, der seit deinem letzten Lauf neu ist oder sich geändert hat, mit seinen Kommentaren.
4. Schreibe mit upsert_rows in „{db}“, key_property "{key}", höchstens 50 Zeilen pro Aufruf (mehr Einträge: mehr Aufrufe). Je Eintrag: title = sein Titel, key = seine Kennung, dazu {link}, {status}, {prio}, {owner}, {tags}, {changed}, {comments} (wie viele), {last} (der neueste Kommentar, zuerst sein Autor, höchstens 200 Zeichen) und {lastAt}.
5. {new}: angehakt, wenn der Eintrag mehr Kommentare hat, als dein Zustand sagt, sonst nicht. {waiting}: angehakt, wenn der neueste Kommentar mich etwas fragt oder mich nennt und ich seitdem nicht geantwortet habe, sonst nicht.
6. {clarity}: {clear} · {open} · {blocked} · {elsewhere} · {done} — beurteilt danach, was „{clear}“ oben heißt. {why}: ein kurzer Satz, warum.
7. Schreibe nie {myStatus}, {myPrio}, {next} oder {due}: Die gehören mir (nur von Hand).
8. Eine Zeile, deren Eintrag {server} nicht mehr auflistet: {gone} anhaken — die Zeile nie löschen. Ein Eintrag, der wieder da ist: Haken weg.
9. notify_me mit page_id = die Zeile des Eintrags: eine Notiz je neuem Kommentar an mich („Neuer Kommentar zu #8215“) und eine Notiz für die Einträge, die seit deinem letzten Lauf „{clear}“ geworden sind („3 Einträge sind bereit“). Sonst nichts.
10. Zum Schluss: agent_state_set mit {"last": "<jetzt, ISO>", "comments": {"<Schlüssel>": <Zahl>, …}} — nur Schlüssel und Zahlen, höchstens 4 KB.
11. Bericht in 3–8 Zeilen: neue, geänderte und verschwundene Einträge, was auf mich wartet, was „{clear}“ geworden ist.`,
  },
}
