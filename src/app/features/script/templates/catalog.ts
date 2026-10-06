/**
 * One Script templates ("Vorlagen") — ready-to-run scripts by category. Each one adapts to THIS
 * workspace when it is used: it picks a fitting database by its properties (a status, a date, people, a
 * relation; the Mails / Contacts databases by their setting / marker), writes stable @ references and
 * the real property and option names, comments in the person's language. When nothing fits, the code is
 * a clearly marked stub that says what is missing (the gallery card says it too).
 *
 * The three starter examples of earlier builds are templates too (ids 'query', 'raise', 'mail').
 */
import type { Database, PropertyDef } from '../../../store/types'
import type { Lang } from '@/shared/i18n'
import { t as translate } from '../../../i18n'
import { nameCode, textCode } from '../editor/complete'
import { archivedBoxOf, archivedOptionOf, dateOf, directoryDb, doneOf, findDb, hasRanges, lastMailOf, liveDbs, mailDb, openOf, personOf, prioOf, relationOf, statusOf, summaryOf, taskDb, titleOf, type DbPick } from './pick'

export type TemplateCat = 'tasks' | 'mail' | 'reports' | 'cleanup' | 'claude'
export const TEMPLATE_CATS: TemplateCat[] = ['tasks', 'mail', 'reports', 'cleanup', 'claude']

/** What a template touches (the card's spec line). */
export type Touch = 'read' | 'write' | 'create' | 'trash' | 'mail' | 'claude' | 'ask'

export interface Built {
  code: string
  /** the databases it uses (their names) */
  uses: string[]
  /** false: the workspace lacks what it needs — the code is a stub (see `needs`) */
  ready: boolean
  /** an i18n key: works, but with less (e.g. lists only, without a checkbox "Archived") */
  note?: string
}

export interface TemplateDef {
  id: string
  cat: TemplateCat
  kind: 'script' | 'query'
  touches: Touch[]
  build(c: Ctx): Built
}

interface Ctx {
  de: boolean
  L: (en: string, de: string) => string
  id: string
}

/* ------------------------------------------------------------------ code helpers */

const lines = (...ls: Array<string | false | null | undefined>) => `${ls.filter((l): l is string => typeof l === 'string').join('\n')}\n`
/** A property as code (bare or in backticks). */
const C = (p: PropertyDef) => nameCode(p.name)
/** A text literal. */
const Q = textCode
/** A name inside a script text ("…"): no quotes, braces or backslashes. */
const inStr = (s: string) => s.replace(/["\\]/g, "'").replace(/[{}]/g, '').replace(/\n/g, ' ')

/** The stub when the workspace lacks what a template needs. */
function stub(c: Ctx, name: string): Built {
  const needs = translate(`features.script.tpl.${c.id}.needs`)
  return {
    ready: false,
    uses: [],
    code: lines(
      `# ${name}`,
      c.L(`# ⚠ Needs ${needs} — there is none in this workspace yet.`, `# ⚠ Braucht ${needs} — gibt es in diesem Workspace noch nicht.`),
      c.L('#   Add it (the mail databases: connect Gmail in Settings → Mail), then create this script again from the template.', '#   Leg sie an (die Mail-Datenbanken: Gmail in Einstellungen → Mail verbinden) und erstell das Skript dann neu aus der Vorlage.'),
      `notify(${Q(c.L(`This script needs ${needs}.`, `Dieses Skript braucht ${needs}.`))})`,
    ),
  }
}

/** Conditions "not done" (when there is a status). */
const notDone = (s: PropertyDef | undefined) => (s ? [`${C(s)} != ${Q(doneOf(s))}`] : [])

/** The date something is due by: the end of a range, else the date. */
function due(db: Database, d: PropertyDef): { expr: string; guard: string[] } {
  if (!hasRanges(db, d)) return { expr: C(d), guard: [] }
  return { expr: `(${C(d)}.end or ${C(d)})`, guard: [`${C(d)} != null`] }
}

/** The database the starter examples use: one with a status and a date, else the first one. */
function exampleDb(): DbPick | null {
  const all = liveDbs()
  return all.find((x) => x.db.properties.some((p) => p.type === 'status' || p.type === 'select') && x.db.properties.some((p) => p.type === 'date')) ?? all[0] ?? null
}

const name = (c: Ctx) => translate(`features.script.tpl.${c.id}.name`)

/* ------------------------------------------------------------------ the templates */

export const TEMPLATES: TemplateDef[] = [
  /* ---------------------------------------------------------------- tasks & projects */
  {
    id: 'overdue',
    cat: 'tasks',
    kind: 'script',
    touches: ['read', 'create'],
    build(c) {
      const x = taskDb()
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)!
      const D = dateOf(x.db)!
      const P = personOf(x.db)
      const d = due(x.db, D)
      const cols = `[${[titleOf(x.db)?.name ?? 'title', D.name, S.name, P?.name].filter((n): n is string => !!n).map(Q).join(', ')}]`
      const v = c.L('late', 'spät')
      const r = c.L('report', 'bericht')
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Overdue → a report page', '# Überfällig → eine Berichtsseite'),
          c.L(`# Everything in ${x.name} that is not done and past its date, listed on a new page.`, `# Alles in ${x.name}, was nicht erledigt und über dem Datum ist — auf einer neuen Seite.`),
          `let ${v} = db(${x.ref}).where(${[...notDone(S), ...d.guard, `${d.expr} < today()`].join(', ')}).sort(${C(D)})`,
          '',
          `if ${v}.count = 0 {`,
          `  notify(${Q(c.L('Nothing is overdue.', 'Nichts ist überfällig.'))})`,
          '} else {',
          `  let ${r} = create.page(title: "${c.L('Overdue', 'Überfällig')} — {format(today())}", markdown: "**{${v}.count}** ${c.L(`entries in ${inStr(x.name)} are past their date.`, `Einträge in ${inStr(x.name)} sind überfällig.`)}\\n\\n" + md_table(${v}, ${cols}))`,
          `  notify("{${v}.count} ${c.L('overdue — listed on', 'überfällig — stehen auf')} “{${r}.title}”")`,
          `  ${r}.open()`,
          '}',
        ),
      }
    },
  },
  {
    id: 'week',
    cat: 'tasks',
    kind: 'script',
    touches: ['read', 'create'],
    build(c) {
      const x = findDb((db) => !!dateOf(db))
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)
      const D = dateOf(x.db)!
      const d = due(x.db, D)
      const [ws, we, v, md] = c.de ? ['wochenStart', 'wochenEnde', 'fällig', 'md'] : ['weekStart', 'weekEnd', 'due', 'md']
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Due this week, by day → a page', '# Diese Woche fällig, nach Tagen → eine Seite'),
          c.L(`# From today until Sunday: a heading per day in ${x.name}, the entries below it.`, `# Von heute bis Sonntag: eine Überschrift pro Tag, darunter die Einträge aus ${x.name}.`),
          `let ${ws} = today()`,
          `let ${we} = add_days(${ws}, 7 - weekday(${ws}))`,
          `let ${v} = db(${x.ref}).where(${[...notDone(S), ...d.guard, `${d.expr} >= ${ws}`, `${d.expr} <= ${we}`].join(', ')}).sort(${C(D)})`,
          '',
          `if ${v}.count = 0 {`,
          `  notify(${Q(c.L('Nothing is due this week.', 'Diese Woche ist nichts fällig.'))})`,
          '} else {',
          `  let ${md} = ""`,
          `  for ${c.L('day', 'tag')} in ${v}.group(format(${d.expr}, "${c.L('EEEE, MMMM d', 'EEEE, d. MMMM')}")) {`,
          `    ${md} = ${md} + "## {${c.L('day', 'tag')}.key}\\n" + ${c.L('day', 'tag')}.rows.map(t => "- [{t.title}]({t.url})").join("\\n") + "\\n\\n"`,
          '  }',
          `  create.page(title: "${c.L('This week', 'Diese Woche')} — {format(${ws})}", markdown: ${md}).open()`,
          '}',
        ),
      }
    },
  },
  {
    id: 'raise',
    cat: 'tasks',
    kind: 'script',
    touches: ['read', 'write'],
    build(c) {
      const pick = exampleDb()
      if (!pick) return stub(c, name(c))
      const status = statusOf(pick.db) ?? pick.db.properties.find((p) => p.type === 'select')
      const date = dateOf(pick.db)
      const prio = prioOf(pick.db, status)
      if (!status || !date || !prio) return stub(c, name(c))
      const S = C(status)
      const D = C(date)
      const P = C(prio)
      const done = Q(doneOf(status))
      const high = Q(prio.options?.[0]?.name ?? c.L('High', 'Hoch'))
      return {
        ready: true,
        uses: [pick.name],
        code: c.de
          ? `# Alles Offene, das in den nächsten 3 Tagen fällig ist, bekommt Priorität ${high}.\n# Erst der Probelauf: er zeigt, was sich ändern würde — ohne etwas zu ändern.\nlet fällig = db(${pick.ref}).where(${S} != ${done}, ${D} < today() + 3d)\n\nfor t in fällig {\n  t.set(${P}: ${high})\n}\n\nnotify("{fällig.count} Einträge hochgestuft")\n`
          : `# Everything open that is due within 3 days gets priority ${high}.\n# Try the dry run first: it shows what would change — without changing anything.\nlet due = db(${pick.ref}).where(${S} != ${done}, ${D} < today() + 3d)\n\nfor t in due {\n  t.set(${P}: ${high})\n}\n\nnotify("{due.count} entries raised")\n`,
      }
    },
  },
  {
    id: 'assign',
    cat: 'tasks',
    kind: 'script',
    touches: ['read', 'write'],
    build(c) {
      const x = findDb((db) => !!statusOf(db) && !!personOf(db))
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)!
      const P = personOf(x.db)!
      const [who, todo] = c.de ? ['wer', 'offen'] : ['who', 'todo']
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Assign unassigned open entries to me', '# Offene Einträge ohne Zuständige mir zuweisen'),
          c.L(`# Every open entry in ${x.name} without ${P.name} gets you — or the person you pick.`, `# Jeder offene Eintrag in ${x.name} ohne ${P.name} bekommt dich — oder die Person, die du wählst.`),
          `let ${who} = me()`,
          `if not ${who} {`,
          `  ${who} = choose(${Q(c.L('Who gets the unassigned entries?', 'Wer bekommt die Einträge ohne Zuständige?'))}, people())`,
          '}',
          `if ${who} {`,
          `  let ${todo} = db(${x.ref}).where(${[...notDone(S), `empty(${C(P)})`].join(', ')}).rows`,
          `  for t in ${todo} {`,
          `    t.set(${C(P)}: ${who})`,
          '  }',
          `  notify("{${todo}.count} ${c.L('entries assigned to', 'Einträge zugewiesen an')} {${who}.name}")`,
          '}',
        ),
      }
    },
  },
  {
    id: 'shift',
    cat: 'tasks',
    kind: 'script',
    touches: ['read', 'write', 'ask'],
    build(c) {
      const x = taskDb()
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)!
      const D = dateOf(x.db)!
      const todo = c.L('todo', 'offen')
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Shift open dates by N days', '# Offene Termine um N Tage verschieben'),
          c.L('# Asks for the number of days (negative = earlier); a date range moves as a whole.', '# Fragt nach der Zahl der Tage (negativ = früher); ein Zeitraum verschiebt sich als Ganzes.'),
          `let n = number(ask(${Q(c.L(`Move the dates of all open entries in ${x.name} by how many days? (negative = earlier)`, `Um wie viele Tage sollen die Termine aller offenen Einträge in ${x.name} rücken? (negativ = früher)`))}, default: "7"))`,
          'if n {',
          `  let ${todo} = db(${x.ref}).where(${[...notDone(S), `${C(D)} != null`].join(', ')}).rows`,
          `  for t in ${todo} {`,
          `    t.set(${C(D)}: t.${C(D)} + days(n))`,
          '  }',
          `  notify("{${todo}.count} ${c.L('dates moved by {n} days', 'Termine um {n} Tage verschoben')}")`,
          '}',
        ),
      }
    },
  },
  {
    id: 'repeat',
    cat: 'tasks',
    kind: 'script',
    touches: ['read', 'write', 'ask'],
    build(c) {
      const x = findDb((db) => !!dateOf(db), /task|aufgabe|todo/i) ?? findDb((db) => !!dateOf(db))
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)
      const D = dateOf(x.db)!
      const P = personOf(x.db)
      const open = S ? openOf(S) : null
      const [src, mon, day, copy] = c.de ? ['vorlage', 'montag', 'tag', 'kopie'] : ['source', 'monday', 'day', 'copy']
      const values = [`${C(D)}: ${day}`, ...(S && open ? [`${C(S)}: ${Q(open)}`] : []), ...(P ? [`${C(P)}: ${src}.${C(P)}`] : [])].join(', ')
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Next week from a template entry', '# Nächste Woche aus einem Vorlage-Eintrag'),
          c.L(`# Pick one entry of ${x.name}: it is copied — with its text — for every weekday of next week, each on its day.`, `# Wähl einen Eintrag aus ${x.name}: Er wird — mit seinem Text — für jeden Werktag der nächsten Woche kopiert, jeder mit seinem Datum.`),
          `let ${src} = choose(${Q(c.L('Which entry should repeat every weekday next week?', 'Welcher Eintrag soll sich nächste Woche jeden Werktag wiederholen?'))}, db(${x.ref}).sort(title).limit(40).rows)`,
          `if ${src} {`,
          `  let ${mon} = add_days(today(), 8 - weekday(today()))`,
          '  for i in range(0, 5) {',
          `    let ${day} = add_days(${mon}, i)`,
          `    let ${copy} = db(${x.ref}).add("{${src}.title} · {format(${day}, "${c.L('EEE MMM d', 'EEE d. MMM')}")}", ${values})`,
          `    if ${src}.markdown {`,
          `      ${copy}.append(${src}.markdown)`,
          '    }',
          '  }',
          `  notify("${c.L('5 entries added for the week of', '5 Einträge angelegt für die Woche ab')} {format(${mon})}")`,
          '}',
        ),
      }
    },
  },
  {
    id: 'progress',
    cat: 'tasks',
    kind: 'script',
    touches: ['read', 'create'],
    build(c) {
      const x = findDb((db) => !!statusOf(db) && !!relationOf(db))
      const R = x ? relationOf(x.db) : undefined
      const target = R?.relationDatabaseId ? liveDbs().find((d) => d.db.id === R.relationDatabaseId) : undefined
      if (!x || !R || !target) return stub(c, name(c))
      const S = statusOf(x.db)!
      const [items, out, total, fin] = c.de ? ['einträge', 'ergebnis', 'gesamt', 'fertig'] : ['items', 'out', 'total', 'finished']
      const [fP, fD, fT, fG, fO] = c.de ? ['Projekt', 'Erledigt', 'Gesamt', 'Fortschritt', 'Offen'] : ['Project', 'Done', 'Total', 'Progress', 'Open']
      return {
        ready: true,
        uses: [...new Set([x.name, target.name])],
        code: lines(
          c.L('# Project progress → a table page', '# Projektfortschritt → eine Tabellenseite'),
          c.L(`# For every entry of ${target.name}: how many of the entries in ${x.name} linked through “${R.name}” are done.`, `# Für jeden Eintrag in ${target.name}: wie viele der über „${R.name}“ verknüpften Einträge in ${x.name} erledigt sind.`),
          `let ${items} = db(${x.ref})`,
          `let ${out} = []`,
          `for p in db(${target.ref}).rows {`,
          `  let mine = ${items}.where(${C(R)}.contains(p))`,
          `  let ${total} = mine.count`,
          `  if ${total} > 0 {`,
          `    let ${fin} = mine.where(${C(S)} = ${Q(doneOf(S))}).count`,
          `    ${out}.push({${fP}: p, ${fD}: ${fin}, ${fT}: ${total}, ${fG}: "{round(${fin} / ${total} * 100)} %"})`,
          '  }',
          '}',
          `if ${out}.count = 0 {`,
          `  notify(${Q(c.L(`No entries in ${x.name} are linked to ${target.name} yet.`, `Noch keine Einträge in ${x.name} sind mit ${target.name} verknüpft.`))})`,
          '} else {',
          `  let chart = md_chart(${out}.select(${fP}: ${fP}.title, ${fD}: ${fD}, ${fO}: ${fT} - ${fD}), "stacked", "${c.L('Done and open', 'Erledigt und offen')}")`,
          `  create.page(title: "${c.L('Progress', 'Fortschritt')} — {format(today())}", markdown: md_table(${out}) + "\\n\\n" + chart).open()`,
          '}',
        ),
      }
    },
  },
  {
    id: 'query',
    cat: 'tasks',
    kind: 'query',
    touches: ['read'],
    build(c) {
      const pick = exampleDb()
      if (!pick) return stub(c, name(c))
      const status = statusOf(pick.db) ?? pick.db.properties.find((p) => p.type === 'select')
      const date = dateOf(pick.db)
      const where = status ? `.where(${C(status)} != ${Q(doneOf(status))})` : ''
      const sort = date ? `.sort(${C(date)})` : ''
      return {
        ready: true,
        uses: [pick.name],
        code: c.L(`# Open entries, soonest first — the result shows live below\ndb(${pick.ref})${where}${sort}.limit(10)\n`, `# Offene Einträge, die nächsten zuerst — das Ergebnis steht live darunter\ndb(${pick.ref})${where}${sort}.limit(10)\n`),
      }
    },
  },

  /* ---------------------------------------------------------------- mail & contacts */
  {
    id: 'replies',
    cat: 'mail',
    kind: 'script',
    touches: ['read', 'write'],
    build(c) {
      const m = mailDb()
      const needs = m ? (m.role('needsReply') ?? m.role('unread')) : undefined
      const x = m ? taskDb([m.db.id]) : null
      if (!m || !needs || !x) return stub(c, name(c))
      const S = statusOf(x.db)!
      const D = dateOf(x.db)!
      const link = m.role('link')
      const from = m.role('from')
      const date = m.role('date')
      const open = openOf(S)
      const [mails, tasks, known, added, task] = c.de ? ['mails', 'aufgaben', 'bekannt', 'neu', 'aufgabe'] : ['mails', 'tasks', 'known', 'added', 'task']
      const reply = c.L('Reply', 'Antworten')
      const values = [...(open ? [`${C(S)}: ${Q(open)}`] : []), `${C(D)}: today() + 1d`].join(', ')
      const body = link ? `"${from ? `${c.L('Mail from', 'Mail von')} {m.${C(from)}}: ` : ''}[{m.title}]({${c.L('link', 'link')}})"` : `"${from ? `${c.L('Mail from', 'Mail von')} {m.${C(from)}}: ` : ''}{m.title}"`
      return {
        ready: true,
        uses: [m.name, x.name],
        code: lines(
          c.L('# Mails that need a reply → tasks', '# Mails, die eine Antwort brauchen → Aufgaben'),
          c.L(`# One task in ${x.name} per mail that needs a reply${link ? ', with a link to the mail' : ''}. Run it again any time:`, `# Eine Aufgabe in ${x.name} pro Mail, die eine Antwort braucht${link ? ', mit Link zur Mail' : ''}. Lass es jederzeit wieder laufen:`),
          c.L('# mails that already have a task are skipped.', '# Mails, die schon eine Aufgabe haben, werden übersprungen.'),
          `let ${mails} = db(${m.ref}).where(${C(needs)} = true)${date ? `.sort(${C(date)} desc)` : ''}.limit(50)`,
          `let ${tasks} = db(${x.ref})`,
          link ? `let ${known} = ${tasks}.rows.map(t => t.markdown).join("\\n")` : `let ${known} = ${tasks}.rows.map(t => t.title)`,
          `let ${added} = 0`,
          `for m in ${mails}.rows {`,
          ...(link
            ? [`  let link = m.${C(link)}`, `  if link and not contains(${known}, link) {`]
            : [`  if not ("${reply}: {m.title}" in ${known}) {`]),
          `    let ${task} = ${tasks}.add("${reply}: {m.title}", ${values})`,
          `    ${task}.append(${body})`,
          `    ${added} = ${added} + 1`,
          '  }',
          '}',
          `notify("{${added}} ${c.L('new tasks from mails', 'neue Aufgaben aus Mails')}")`,
        ),
      }
    },
  },
  {
    id: 'followup',
    cat: 'mail',
    kind: 'script',
    touches: ['read', 'create'],
    build(c) {
      const x = directoryDb('mail-contacts')
      const L = x ? lastMailOf(x.db) : undefined
      if (!x || !L) return stub(c, name(c))
      const [quiet, list] = c.de ? ['still', 'liste'] : ['quiet', 'list']
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Contacts without a mail for 30 days → a follow-up list', '# Kontakte ohne Mail seit 30 Tagen → eine Nachfass-Liste'),
          c.L(`# The contacts in ${x.name} whose last mail is more than 30 days ago, as a checklist on a new page.`, `# Die Kontakte in ${x.name}, deren letzte Mail mehr als 30 Tage her ist, als Checkliste auf einer neuen Seite.`),
          `let ${quiet} = db(${x.ref}).where(${C(L)} != null, ${C(L)} < today() - 30d).sort(${C(L)})`,
          `if ${quiet}.count = 0 {`,
          `  notify(${Q(c.L('Every contact had a mail in the last 30 days.', 'Jeder Kontakt hatte in den letzten 30 Tagen eine Mail.'))})`,
          '} else {',
          `  let ${list} = ${quiet}.rows.map(k => "- [ ] [{k.title}]({k.url}) — ${c.L('last mail', 'letzte Mail')} {format(k.${C(L)})}").join("\\n")`,
          `  create.page(title: "${c.L('Follow up', 'Nachfassen')} — {format(today())}", markdown: "{${quiet}.count} ${c.L('contacts have not had a mail for 30 days:', 'Kontakte hatten seit 30 Tagen keine Mail:')}\\n\\n" + ${list}).open()`,
          '}',
        ),
      }
    },
  },
  {
    id: 'mail',
    cat: 'mail',
    kind: 'script',
    touches: ['read', 'mail', 'ask'],
    build(c) {
      const pick = exampleDb()
      if (!pick) return stub(c, name(c))
      return {
        ready: true,
        uses: [pick.name],
        code: c.de
          ? `# Schickt eine Seite als Mail — vor dem Lauf fragt One nach.\n# Ohne verbundenes Gmail öffnet sich ein fertiger Entwurf in deinem Mailprogramm.\nlet an = ask("An wen?", default: "team@example.com")\nlet eintrag = choose("Welche Seite?", db(${pick.ref}).limit(5).rows)\n\nif eintrag {\n  mail.send(to: an, subject: eintrag.title, body: eintrag.markdown)\n  modal("Gesendet", buttons: ["OK"])\n}\n`
          : `# Sends a page as a mail — One asks before the run.\n# Without Gmail connected, a ready draft opens in your mail program.\nlet to = ask("Send to?", default: "team@example.com")\nlet entry = choose("Which page?", db(${pick.ref}).limit(5).rows)\n\nif entry {\n  mail.send(to: to, subject: entry.title, body: entry.markdown)\n  modal("Sent", buttons: ["OK"])\n}\n`,
      }
    },
  },
  {
    id: 'companies',
    cat: 'mail',
    kind: 'script',
    touches: ['read', 'create'],
    build(c) {
      const m = mailDb()
      const company = m?.role('company')
      const date = m?.role('date')
      if (!m || !company || !date) return stub(c, name(c))
      const [since, month, per] = c.de ? ['seit', 'monat', 'proFirma'] : ['since', 'month', 'perCompany']
      const [fC, fM] = c.de ? ['Firma', 'Mails'] : ['Company', 'Mails']
      return {
        ready: true,
        uses: [m.name],
        code: lines(
          c.L('# Mails per company this month → a summary page', '# Mails pro Firma in diesem Monat → eine Übersichtsseite'),
          c.L(`# Counts this month's mails in ${m.name} by “${company.name}”, as a table and a chart.`, `# Zählt die Mails dieses Monats in ${m.name} nach „${company.name}“, als Tabelle und Diagramm.`),
          `let ${since} = date(today().year, today().month, 1)`,
          `let ${month} = db(${m.ref}).where(${C(date)} >= ${since})`,
          `if ${month}.count = 0 {`,
          `  notify(${Q(c.L('No mails this month yet.', 'In diesem Monat noch keine Mails.'))})`,
          '} else {',
          `  let ${per} = ${month}.group(${C(company)}).sort(count desc).select(${fC}: key, ${fM}: count)`,
          `  create.page(title: "${c.L('Mails per company', 'Mails pro Firma')} — {format(today(), "MMMM yyyy")}", markdown: "{${month}.count} ${c.L('mails since', 'Mails seit')} {format(${since})}.\\n\\n" + md_table(${per}) + "\\n\\n" + md_chart(${per}, "barH")).open()`,
          '}',
        ),
      }
    },
  },

  /* ---------------------------------------------------------------- reports */
  {
    id: 'counts',
    cat: 'reports',
    kind: 'script',
    touches: ['read', 'create'],
    build(c) {
      const x = findDb((db) => !!statusOf(db) || db.properties.some((p) => p.type === 'select'))
      const S = x ? (statusOf(x.db) ?? x.db.properties.find((p) => p.type === 'select')) : undefined
      if (!x || !S) return stub(c, name(c))
      const v = c.L('byStatus', 'nachStatus')
      const entries = c.L('Entries', 'Einträge')
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Entries per status → a page with a table and a chart', '# Einträge pro Status → eine Seite mit Tabelle und Diagramm'),
          `let ${v} = db(${x.ref}).group(${C(S)}).sort(count desc).select(${C(S)}: key, ${entries}: count)`,
          `create.page(title: "${inStr(x.name)} ${c.L('by', 'nach')} ${inStr(S.name)} — {format(today())}", markdown: md_table(${v}) + "\\n\\n" + md_chart(${v}, "donut")).open()`,
        ),
      }
    },
  },
  {
    id: 'review',
    cat: 'reports',
    kind: 'script',
    touches: ['read', 'create'],
    build(c) {
      const x = findDb((db) => !!statusOf(db) && !!dateOf(db)) ?? findDb((db) => !!statusOf(db))
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)!
      const D = dateOf(x.db)
      const d = D ? due(x.db, D) : null
      const done = Q(doneOf(S))
      const [since, all, fin, fresh, late, list, md] = c.de ? ['seit', 'alle', 'erledigt', 'neu', 'spät', 'liste', 'md'] : ['since', 'all', 'finished', 'fresh', 'late', 'bullets', 'md']
      const section = (title: string, v: string) => `## ${title} ({${v}.count})\\n{${list}(${v})}`
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Weekly review → a dated page', '# Wochenrückblick → eine Seite mit Datum'),
          c.L(`# What was done and what is new in ${x.name} in the last 7 days${d ? ', and what is overdue' : ''}.`, `# Was in ${x.name} in den letzten 7 Tagen erledigt wurde und neu ist${d ? ', und was überfällig ist' : ''}.`),
          c.L('# (Done = done and changed in the last 7 days.)', '# (Erledigt = erledigt und in den letzten 7 Tagen geändert.)'),
          `let ${since} = today() - 7d`,
          `let ${all} = db(${x.ref})`,
          `let ${fin} = ${all}.where(${C(S)} = ${done}, edited >= ${since})`,
          `let ${fresh} = ${all}.where(created >= ${since})`,
          d ? `let ${late} = ${all}.where(${[...notDone(S), ...d.guard, `${d.expr} < today()`].join(', ')})` : null,
          '',
          `fn ${list}(q) {`,
          '  if q.count = 0 {',
          `    return "_${c.L('Nothing.', 'Nichts.')}_"`,
          '  }',
          '  return q.rows.map(t => "- [{t.title}]({t.url})").join("\\n")',
          '}',
          '',
          `let ${md} = "${[section(c.L('Done', 'Erledigt'), fin), section(c.L('New', 'Neu'), fresh), ...(d ? [section(c.L('Overdue', 'Überfällig'), late)] : [])].join('\\n\\n')}"`,
          `create.page(title: "${c.L('Weekly review', 'Wochenrückblick')} — {format(today())}", markdown: ${md}).open()`,
        ),
      }
    },
  },
  {
    id: 'table',
    cat: 'reports',
    kind: 'script',
    touches: ['read', 'write', 'create'],
    build(c) {
      const x = taskDb() ?? liveDbs()[0] ?? null
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)
      const D = dateOf(x.db)
      const [rows, target] = c.de ? ['zeilen', 'ziel'] : ['rows', 'target']
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# A query as a table on this page', '# Eine Abfrage als Tabelle auf dieser Seite'),
          c.L('# From a button, a database command or ⌘K on a page, the table goes to the end of that page;', '# Von einem Button, einem Datenbank-Befehl oder ⌘K auf einer Seite kommt die Tabelle ans Ende dieser Seite;'),
          c.L('# from the editor it lands on a new page.', '# aus dem Editor landet sie auf einer neuen Seite.'),
          `let ${rows} = db(${x.ref})${S ? `.where(${notDone(S)[0]})` : ''}${D ? `.sort(${C(D)})` : ''}.limit(25)`,
          `let ${target} = page.here`,
          `if not ${target} or type(${target}) = "database" {`,
          `  ${target} = create.page(title: "${inStr(x.name)} — {format(today())}")`,
          '}',
          `${target}.append("### ${inStr(x.name)} · {format(now())}\\n\\n" + md_table(${rows}))`,
          `notify("{${rows}.count} ${c.L('rows written to', 'Zeilen geschrieben in')} “{${target}.title}”")`,
        ),
      }
    },
  },

  /* ---------------------------------------------------------------- clean-up */
  {
    id: 'dupes',
    cat: 'cleanup',
    kind: 'script',
    touches: ['read', 'trash', 'ask'],
    build(c) {
      const x = taskDb() ?? liveDbs()[0] ?? null
      if (!x) return stub(c, name(c))
      const [groups, extra] = c.de ? ['gruppen', 'zuviel'] : ['groups', 'extra']
      const [fT, fN] = c.de ? ['Titel', 'Kopien'] : ['Title', 'Copies']
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# Duplicate titles → a list, and the extra copies to the trash if you say so', '# Doppelte Titel → eine Liste, und die überzähligen Kopien in den Papierkorb, wenn du zustimmst'),
          c.L('# Titles count as the same when they differ only in case or spaces. The oldest entry of each title stays.', '# Titel gelten als gleich, wenn sie sich nur in Groß-/Kleinschreibung oder Leerzeichen unterscheiden. Der älteste Eintrag jedes Titels bleibt.'),
          `let ${groups} = db(${x.ref}).group(lower(join(split(title), " "))).where(count > 1, key != "")`,
          `if ${groups}.count = 0 {`,
          `  notify(${Q(c.L(`No duplicates in ${x.name}.`, `Keine Doppelten in ${x.name}.`))})`,
          '} else {',
          `  print(${groups}.select(${fT}: rows.first.title, ${fN}: count))`,
          `  let ${extra} = sum(${groups}.map(g => g.count - 1))`,
          `  if confirm("${c.L('Move {' + extra + '} duplicates to the trash? The oldest entry of each title stays — Undo brings them back.', '{' + extra + '} Doppelte in den Papierkorb legen? Der älteste Eintrag jedes Titels bleibt — Rückgängig holt sie zurück.')}") {`,
          `    for g in ${groups} {`,
          '      for t in g.rows.sort(created).skip(1) {',
          '        trash(t)',
          '      }',
          '    }',
          '  }',
          '}',
        ),
      }
    },
  },
  {
    id: 'titles',
    cat: 'cleanup',
    kind: 'script',
    touches: ['read', 'write'],
    build(c) {
      const x = taskDb() ?? liveDbs()[0] ?? null
      if (!x) return stub(c, name(c))
      const [fixed, clean] = c.de ? ['repariert', 'sauber'] : ['fixed', 'clean']
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L(`# Tidy titles in ${x.name}: no spaces around them, single spaces inside`, `# Titel in ${x.name} aufräumen: keine Leerzeichen außen, einfache innen`),
          `let ${fixed} = 0`,
          `for t in db(${x.ref}).rows {`,
          `  let ${clean} = join(split(t.title), " ")`,
          c.L('  # A capital first letter too? Remove the # at the start of the next line.', '  # Auch den ersten Buchstaben groß? Entferne das # am Anfang der nächsten Zeile.'),
          `  # ${clean} = upper(slice(${clean}, 0, 1)) + slice(${clean}, 1)`,
          `  if ${clean} != t.title {`,
          `    t.set(title: ${clean})`,
          `    ${fixed} = ${fixed} + 1`,
          '  }',
          '}',
          `notify("{${fixed}} ${c.L('titles tidied', 'Titel aufgeräumt')}")`,
        ),
      }
    },
  },
  {
    id: 'archive',
    cat: 'cleanup',
    kind: 'script',
    touches: ['read', 'write'],
    build(c) {
      const fits = (db: Database) => !!statusOf(db) && (!!archivedBoxOf(db) || !!archivedOptionOf(statusOf(db)))
      const x = findDb(fits, null) ?? findDb((db) => !!statusOf(db))
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)!
      const box = archivedBoxOf(x.db)
      const opt = archivedOptionOf(S)
      const done = Q(doneOf(S))
      const old = c.L('old', 'alt')
      const head = [c.L('# Archive what was done more than 30 days ago', '# Archivieren, was vor mehr als 30 Tagen erledigt wurde'), c.L(`# Entries in ${x.name} that are “${doneOf(S)}” and nobody changed for 30 days.`, `# Einträge in ${x.name}, die „${doneOf(S)}“ sind und seit 30 Tagen niemand geändert hat.`)]
      if (box || opt)
        return {
          ready: true,
          uses: [x.name],
          code: lines(
            ...head,
            `let ${old} = db(${x.ref}).where(${C(S)} = ${done}, ${box ? `${C(box)} = false, ` : ''}edited < today() - 30d).rows`,
            `for t in ${old} {`,
            box ? `  t.set(${C(box)}: true)` : `  t.set(${C(S)}: ${Q(opt!)})`,
            '}',
            `notify("{${old}.count} ${c.L('entries archived', 'Einträge archiviert')}")`,
          ),
        }
      return {
        ready: true,
        note: 'features.script.tpl.archive.noBox',
        uses: [x.name],
        code: lines(
          ...head,
          c.L(`# ⚠ ${x.name} has no checkbox “Archived” and no status “Archived”: add a Checkbox property named Archived,`, `# ⚠ ${x.name} hat keine Checkbox „Archiviert“ und keinen Status „Archiviert“: leg eine Checkbox-Eigenschaft Archiviert an`),
          c.L('#   then create this script again — until then it only lists what it would archive.', '#   und erstell das Skript dann neu — bis dahin listet es nur, was es archivieren würde.'),
          `let ${old} = db(${x.ref}).where(${C(S)} = ${done}, edited < today() - 30d)`,
          `print(${old})`,
          `notify("{${old}.count} ${c.L('entries would be archived', 'Einträge würden archiviert')}")`,
        ),
      }
    },
  },

  /* ---------------------------------------------------------------- with Claude */
  {
    id: 'summarise',
    cat: 'claude',
    kind: 'script',
    touches: ['read', 'write', 'claude'],
    build(c) {
      const withProp = findDb((db) => !!summaryOf(db), null)
      const x = withProp ?? taskDb() ?? liveDbs()[0] ?? null
      if (!x) return stub(c, name(c))
      const P = summaryOf(x.db)
      const S = statusOf(x.db)
      const [todo, answer] = c.de ? ['offen', 'antwort'] : ['todo', 'answer']
      const prompt = Q(c.L('Summarise this entry in one or two plain sentences, in the language it is written in.', 'Fasse diesen Eintrag in ein, zwei schlichten Sätzen zusammen, in der Sprache, in der er geschrieben ist.'))
      const label = c.L('Summary', 'Zusammenfassung')
      return {
        ready: true,
        note: P ? undefined : 'features.script.tpl.summarise.noProp',
        uses: [x.name],
        code: lines(
          c.L(`# Summarise entries with Claude → ${P ? `“${P.name}”` : 'their text'}`, `# Einträge mit Claude zusammenfassen → ${P ? `„${P.name}“` : 'ihr Text'}`),
          c.L('# Up to 10 entries per run; One lists the Claude requests before it starts. From a database command', '# Bis zu 10 Einträge pro Lauf; One zeigt die Claude-Anfragen vorher an. Als Datenbank-Befehl'),
          c.L('# with rows selected it runs once per row — then only that row.', '# mit ausgewählten Zeilen läuft es einmal pro Zeile — dann nur für diese Zeile.'),
          P
            ? `let ${todo} = db(${x.ref}).where(${C(P)} = "").limit(10).rows`
            : `let ${todo} = db(${x.ref})${S ? `.where(${notDone(S)[0]})` : ''}.rows.where(t => not contains(t.text, "${label}:")).limit(10)`,
          'if type(page.here) = "row" {',
          `  ${todo} = [page.here]`,
          '}',
          `for t in ${todo} {`,
          `  let ${answer} = claude(${prompt}, "# {t.title}\\n\\n{t.markdown}")`,
          `  if ${answer} {`,
          P ? `    t.set(${C(P)}: trim(${answer}))` : `    t.append("**${label}:** {trim(${answer})}")`,
          '  }',
          '}',
          `notify("{${todo}.count} ${c.L('entries summarised', 'Einträge zusammengefasst')}")`,
        ),
      }
    },
  },
  {
    id: 'update',
    cat: 'claude',
    kind: 'script',
    touches: ['read', 'claude', 'mail', 'ask'],
    build(c) {
      const x = findDb((db) => !!statusOf(db))
      if (!x) return stub(c, name(c))
      const S = statusOf(x.db)!
      const [fin, list, draft, to] = c.de ? ['erledigt', 'liste', 'entwurf', 'an'] : ['finished', 'list', 'draft', 'to']
      return {
        ready: true,
        uses: [x.name],
        code: lines(
          c.L('# A weekly update mail, drafted by Claude', '# Eine Wochen-Update-Mail, von Claude entworfen'),
          c.L(`# From what was finished in ${x.name} in the last 7 days. One asks before Claude and before the mail.`, `# Aus dem, was in ${x.name} in den letzten 7 Tagen fertig wurde. One fragt vor Claude und vor der Mail.`),
          `let ${fin} = db(${x.ref}).where(${C(S)} = ${Q(doneOf(S))}, edited >= today() - 7d)`,
          `if ${fin}.count = 0 {`,
          `  notify(${Q(c.L('Nothing was finished in the last 7 days.', 'In den letzten 7 Tagen wurde nichts fertig.'))})`,
          '} else {',
          `  let ${list} = ${fin}.rows.map(t => "- {t.title}").join("\\n")`,
          `  let ${draft} = claude(${Q(c.L('Write a short, friendly weekly update mail about these finished items. Plain text, no subject line.', 'Schreib eine kurze, freundliche Wochen-Update-Mail über diese erledigten Punkte. Reiner Text, keine Betreffzeile.'))}, ${list})`,
          `  let ${to} = ask(${Q(c.L('Send the update to?', 'An wen geht das Update?'))}, default: "team@example.com")`,
          `  if ${to} {`,
          `    mail.send(to: ${to}, subject: "${c.L('Weekly update', 'Wochen-Update')} — {format(today())}", body: ${draft} or ${list})`,
          '  }',
          '}',
        ),
      }
    },
  },
]

export const templateById = (id: string) => TEMPLATES.find((x) => x.id === id) ?? null

/** A template's code (and fit) for this workspace, in the person's language. */
export function buildTemplate(id: string, lang: Lang): Built | null {
  const def = templateById(id)
  if (!def) return null
  const de = lang === 'de'
  return def.build({ de, L: (en, deText) => (de ? deText : en), id })
}
