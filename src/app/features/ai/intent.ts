/**
 * AI menu — what an own request really asks for, read from its words (EN + DE, small patterns, no extra
 * Claude call). A text request cannot make pages, so these run the right action instead:
 *
 *  - 'topage': the selection as a (sub)page — "make a subpage out of this", "mach daraus eine Unterseite",
 *    "eigene Seite", "auslagern" → Turn into page (editor/split).
 *  - 'pagesPerItem': one (sub)page per item — "a page for every ticket", "für jeden Punkt eine Unterseite",
 *    "pro Ticket eine Seite" → Sub-page per item (editor/split/items.ts).
 *  - 'todb': as a table / database / board — "als Tabelle", "turn this into a board" → offers Turn into database.
 *  - 'terminal': work beyond the selection — create pages or rows, update a database, anything that pulls from a
 *    connected MCP server ("for every ticket in Atlas …"), or a page action mixed with writing → the AI terminal.
 *  - null: a writing request (rewrite, summarise, translate, ask …) — it goes to Claude as before.
 *
 * Pure (no imports): the AI menu passes the enabled MCP server names.
 */
export type RequestIntent = 'topage' | 'pagesPerItem' | 'todb' | 'terminal'

/** A pattern with Unicode word boundaries: `\b` also works next to ä, ö, ü, ß. */
const W = (src: string) => new RegExp(src.replace(/\\b/g, String.raw`(?:(?<![\p{L}\p{N}_])(?=[\p{L}\p{N}_])|(?<=[\p{L}\p{N}_])(?![\p{L}\p{N}_]))`), 'u')

const PAGE = String.raw`(?:sub-?pages?|pages?)`
const SEITE = String.raw`(?:unter-?seiten?|seiten?)`
const ART = String.raw`(?:a|an|one|1|its|their|own|a new|new|separate|dedicated|individual)`
const ARTDE = String.raw`(?:eine[nmrs]?|ein|ne|'ne|1|je|jeweils|neue[nmrs]?|eigene[nmrs]?|separate[nmrs]?|extra)`
const THIS = String.raw`(?:this|it|that|these|them|the selection|the selected (?:text|blocks?)|the text|everything|all of (?:it|this))`

/** One (sub)page per item. */
const PER_ITEM = [
  // "one page per item", "a sub-page for every ticket", "pages for each entry", "separate pages per row"
  String.raw`\b(?:${ART}\s+)*${PAGE}\s+(?:per|each|for\s+(?:each|every|all(?:\s+the)?))\b`,
  // "each item as its own page", "every ticket gets a subpage", "each bullet into a page"
  String.raw`\b(?:each|every)\s+(?:\S+\s+){1,3}?(?:as|into|to|gets?|becomes?|on|in)\s+(?:${ART}\s+)*${PAGE}\b`,
  // "per ticket a page", "per item one subpage", "for every ticket in the list create a sub-page"
  String.raw`\bper\s+\S+\s+(?:${ART}\s+)*${PAGE}\b`,
  String.raw`\bfor\s+(?:each|every)\s+(?:\S+\s+){1,6}?(?:${ART}\s+)*${PAGE}\b`,
  // "für jeden Punkt eine Unterseite", "für alle Tickets je eine Seite"
  String.raw`\b(?:für|zu)\s+(?:jede[nmrs]?|alle[nm]?)\s+(?:\S+\s+){0,4}?(?:${ARTDE}\s+)*${SEITE}\b`,
  // "pro Ticket eine Seite", "je Eintrag eine Unterseite"
  String.raw`\b(?:pro|je)\s+\S+\s+(?:${ARTDE}\s+)*${SEITE}\b`,
  // "jeden Punkt als eigene Seite", "alle Einträge in Unterseiten"
  String.raw`\b(?:jede[nmrs]?|alle)\s+(?:\S+\s+){1,3}?(?:als|in|auf|zu|bekommt|bekommen|erhält|erhalten|wird|werden)\s+(?:${ARTDE}\s+)*${SEITE}\b`,
  // "Unterseiten pro Ticket", "Seiten je Abschnitt", "jeweils eine Unterseite"
  String.raw`\b${SEITE}\s+(?:pro|je|für\s+jede[nmrs]?)\b`,
  String.raw`\bjeweils\s+(?:${ARTDE}\s+)*${SEITE}\b`,
].map(W)

/** The selection as a (sub)page. */
const TO_PAGE = [
  // "a subpage out of this", "a page from it"
  String.raw`\b${PAGE}\s+(?:out\s+of|from)\s+${THIS}\b`,
  // "turn this into a page", "move it to its own page", "put these on a separate page"
  String.raw`\b(?:make|turn|convert|move|put|extract|split|transform|change)\s+${THIS}\s+(?:out\s+)?(?:into|to|on|onto|as|in)\s+(?:${ART}\s+)*${PAGE}\b`,
  // "as its own page", "on a separate page", "into a subpage", "into a page"
  String.raw`\b(?:into|to|onto|on|as)\s+(?:(?:a|an|its|their)\s+)?(?:own|separate|dedicated)\s+page\b`,
  String.raw`\b(?:into|to|onto|as)\s+(?:(?:a|an)\s+)?(?:new\s+)?sub-?page\b`,
  String.raw`\binto\s+(?:a|an)\s+(?:new\s+)?page\b`,
  // "daraus eine Unterseite", "Unterseite daraus", "eine eigene Seite"
  String.raw`\b(?:daraus|draus)\s+(?:${ARTDE}\s+)*${SEITE}\b`,
  String.raw`\b${SEITE}\s+(?:daraus|draus)\b`,
  String.raw`\beigene[nmrs]?\s+(?:unter-?)?seite\b`,
  // "in eine Unterseite", "als Unterseite", "in eine neue Seite verschieben", "in Seite umwandeln"
  String.raw`\b(?:in|als|auf|zu)\s+(?:eine[rn]?\s+)?(?:neue[nr]?\s+)?unter-?seite\b`,
  String.raw`\bin\s+(?:eine\s+)?(?:neue\s+)?seite\s+(?:umwandeln|verschieben|packen|stecken|auslagern|ausgliedern)\b`,
  String.raw`\b(?:auslagern|ausgliedern)\b`,
].map(W)

/** As a table / database / board (not "table of contents"). */
const TO_DB = [
  String.raw`\b(?:as|into|in|to)\s+(?:(?:a|an)\s+)?(?:kanban\s+)?(?:table|database|board|kanban|tracker)\b(?!\s+of\s+contents)`,
  String.raw`\b(?:table|database|board|tracker)\s+(?:out\s+of|from)\s+(?:this|it|these|them|the selection)\b`,
  String.raw`\bmake\s+(?:a|an)\s+(?:table|database|board|tracker)\b(?!\s+of\s+contents)`,
  String.raw`\b(?:als|in|zu)\s+(?:(?:eine[rnm]?|ein|einem)\s+)?(?:tabelle|datenbank|board|kanban)\b`,
  String.raw`\b(?:daraus|draus)\s+(?:eine?\s+)?(?:tabelle|datenbank|board|kanban)\b`,
  String.raw`\b(?:tabelle|datenbank|board)\s+(?:daraus|draus)\b`,
].map(W)

/** Writes in the workspace beyond the selection: new pages / rows / databases, changed databases. */
const WORKSPACE = [
  String.raw`\b(?:create|make|add|generate|set\s+up|build)\b[^.?!]{0,60}\b(?:sub-?pages|pages|rows|entries|records|cards|databases?)\b`,
  String.raw`\b(?:update|change|fill|set|edit|move|rename|delete|archive|sync|import)\b[^.?!]{0,40}\b(?:databases?|rows?|records|tracker|pages)\b`,
  String.raw`\b(?:erstelle|erstell|erzeuge|erzeug|lege|leg|füge|füg|baue|bau|generiere|mach|mache)\b[^.?!]{0,60}\b(?:unter-?seiten|seiten|zeilen|einträge|datensätze|karten|datenbank(?:en)?)\b`,
  String.raw`\b(?:aktualisiere|aktualisier|ändere|änder|fülle|füll|verschiebe|verschieb|benenne|lösche|lösch|trage|trag|importiere)\b[^.?!]{0,40}\b(?:datenbank(?:en)?|zeilen?|einträgen?|einträge|seiten)\b`,
].map(W)

/** Writing, besides a page action: then it is a job for the terminal ("summarise this on its own page"). */
const WRITING = W(String.raw`\b(?:summari[sz]e|summary|rewrite|translate|improve|shorten|expand|explain|draft|write|zusammenfass\p{L}*|fasse|umschreib\p{L}*|übersetz\p{L}*|verbesser\p{L}*|kürz\p{L}*|erklär\p{L}*|schreib\p{L}*|formulier\p{L}*)\b`)

/** Sources outside the selection: the workspace, connected MCP servers. */
const OUTSIDE = W(String.raw`\b(?:mcp|workspace|arbeitsbereich|all\s+(?:my\s+)?pages|alle\s+seiten)\b`)

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The intent of an own request. `selection`: the menu is on a selection (Turn into page / Sub-page per item /
 * Turn into database work on it); `servers`: names of the enabled MCP servers.
 */
export function requestIntent(raw: string, opts: { selection: boolean; servers?: string[] }): RequestIntent | null {
  const text = raw.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
  if (!text) return null
  const any = (list: RegExp[]) => list.some((re) => re.test(text))
  const servers = (opts.servers ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)
  const outside = OUTSIDE.test(text) || servers.some((s) => W(String.raw`\b${esc(s)}\b`).test(text))
  const perItem = any(PER_ITEM)
  const toPage = any(TO_PAGE)
  const workspace = any(WORKSPACE)
  // the items (or the work) live outside the selection, or the page action comes with writing: the terminal
  if (outside && (perItem || toPage || workspace)) return 'terminal'
  if ((perItem || toPage) && (!opts.selection || WRITING.test(text))) return 'terminal'
  if (perItem) return 'pagesPerItem'
  if (toPage) return 'topage'
  if (opts.selection && any(TO_DB)) return 'todb'
  if (workspace) return 'terminal'
  return null
}
