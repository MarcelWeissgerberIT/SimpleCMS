/**
 * Building blocks — starting points for an own type's script bindings. Each template adapts to the
 * workspace where it can (a number / relation / date property of a database holding the type, another
 * database for options); names stay plain One Script, the person edits them. Comments are English like
 * every One Script template; the names shown in the menu are translated (features.kit.tpl.<id>).
 */
import { useWorkspace } from '../../store/store'
import type { CustomPropBase, Database, ID, PropertyType } from '../../store/types'
import type { BindingKey } from './scripts'

export interface TemplateContext {
  base: CustomPropBase
  /** a database holding properties of the type (its other properties name the examples) */
  dbId: ID | null
}

export interface BindingTemplate {
  id: string
  binding: BindingKey
  /** bases it fits (absent: every one) */
  bases?: CustomPropBase[]
  build: (c: TemplateContext) => string
}

const ws = () => useWorkspace.getState()

/** A name as code: plain when it can be, else in backticks. */
const nameCode = (n: string) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(n) ? n : `\`${n.replace(/`/g, '')}\``)
const textCode = (s: string) => `"${s.replace(/["\\{]/g, '')}"`

function propOf(c: TemplateContext, types: PropertyType[], fallback: string): string {
  const db = c.dbId ? ws().databases[c.dbId] : undefined
  const p = db?.properties.find((x) => types.includes(x.type) && !x.custom)
  return nameCode(p?.name ?? fallback)
}

/** Another database than the type's own one (options from a query). */
function otherDb(c: TemplateContext): { name: string; filter: string } {
  const s = ws()
  const dbs = Object.values(s.databases).filter((d: Database) => d.id !== c.dbId && s.pages[d.id] && !s.pages[d.id].trashed && s.pages[d.id].title.trim() && !s.pages[d.id].template)
  const pick = dbs.find((d) => d.properties.some((p) => p.type === 'status')) ?? dbs[0]
  if (!pick) return { name: 'Projects', filter: '' }
  const status = pick.properties.find((p) => p.type === 'status')
  const done = status?.options?.find((o) => o.group === 'done')
  return { name: s.pages[pick.id].title.trim(), filter: status && done ? `.where(${nameCode(status.name)} != ${textCode(done.name)})` : '' }
}

const TEXTISH: CustomPropBase[] = ['text', 'free', 'email', 'url', 'phone']

export const TEMPLATES: BindingTemplate[] = [
  // validate
  {
    id: 'iban',
    binding: 'validate',
    bases: TEXTISH,
    build: () => `# A valid IBAN: 15–34 characters, check digits mod 97 = 1
fn iban_ok(raw) {
  let s = upper(replace(raw, " ", ""))
  if len(s) < 15 or len(s) > 34 { return false }
  let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
  let moved = slice(s, 4) + slice(s, 0, 4)
  let rest = 0
  for ch in moved.split("") {
    let i = letters.indexof(ch)
    if i >= 0 {
      rest = (rest * 100 + i + 10) % 97
    } else {
      let d = ch.number()
      if d = null { return false }
      rest = (rest * 10 + d) % 97
    }
  }
  return rest = 1
}
let answer = true
if value and not iban_ok(value) {
  answer = "Not a valid IBAN"
}
answer`,
  },
  {
    id: 'domain',
    binding: 'validate',
    bases: ['email', 'text', 'free'],
    build: () => `# Only addresses of one domain
let domain = "example.com"
let answer = true
if value and not ends_with(lower(value), "@" + domain) {
  answer = "Use an address @{domain}"
}
answer`,
  },
  {
    id: 'range',
    binding: 'validate',
    bases: ['number', 'rating'],
    build: () => `# A number from 0 to 100
let answer = true
if value != null and (value < 0 or value > 100) {
  answer = "Enter a number from 0 to 100"
}
answer`,
  },
  {
    id: 'required',
    binding: 'validate',
    build: () => `# Never empty
let answer = true
if not value {
  answer = "This field must not be empty"
}
answer`,
  },
  // value
  {
    id: 'traffic',
    binding: 'value',
    bases: ['select', 'text', 'free'],
    build: (c) => `# Traffic light from a number (red under 40, yellow under 70)
let n = row.${propOf(c, ['number', 'rating'], 'Score')}
let light = null
if n != null {
  light = "Green"
  if n < 70 { light = "Yellow" }
  if n < 40 { light = "Red" }
}
light`,
  },
  {
    id: 'countRelated',
    binding: 'value',
    bases: ['number'],
    build: (c) => `# How many entries are related
len(row.${propOf(c, ['relation'], 'Tasks')})`,
  },
  {
    id: 'daysLeft',
    binding: 'value',
    bases: ['number'],
    build: (c) => `# Days until a date (negative: overdue)
let due = row.${propOf(c, ['date'], 'Due')}
let days = null
if due {
  days = days_between(today(), due)
}
days`,
  },
  // options
  {
    id: 'optionsQuery',
    binding: 'options',
    bases: ['select', 'multi_select'],
    build: (c) => {
      const o = otherDb(c)
      return `# The options: entries of another database (here: the open ones)
db(${textCode(o.name)})${o.filter}.sort(title).map(x => x.title)`
    },
  },
  {
    id: 'optionsFixed',
    binding: 'options',
    bases: ['select', 'multi_select'],
    build: () => `# Fixed options with colours
[{name: "Low", color: "gray"}, {name: "Medium", color: "yellow"}, {name: "High", color: "red"}]`,
  },
  // format
  {
    id: 'groups',
    binding: 'format',
    bases: TEXTISH,
    build: () => `# Upper case in groups of four (IBAN, codes)
let s = upper(replace(text(value), " ", ""))
let out = ""
let i = 0
while i < len(s) {
  out = out + slice(s, i, i + 4) + " "
  i = i + 4
}
trim(out)`,
  },
  {
    id: 'upper',
    binding: 'format',
    build: () => `# Shown in capitals
upper(text(value))`,
  },
  {
    id: 'relative',
    binding: 'format',
    bases: ['date'],
    build: () => `# "in 3 days" / "2 days ago"
let shown = ""
if value {
  let d = days_between(today(), value)
  shown = "in {d} days"
  if d = 0 { shown = "today" }
  if d < 0 { shown = "{0 - d} days ago" }
}
shown`,
  },
  // onChange
  {
    id: 'notify',
    binding: 'onChange',
    build: () => `# A note on screen after every change
notify("{row.title}: {old} → {value}")`,
  },
  {
    id: 'stamp',
    binding: 'onChange',
    bases: ['select', 'checkbox'],
    build: (c) => `# Stamp the date when it is set
if value {
  row.set(${propOf(c, ['date'], 'Done on')}: today())
}`,
  },
  {
    id: 'mail',
    binding: 'onChange',
    build: () => `# Tell the team by mail (asked before it is sent)
mail.send(to: "team@example.com", subject: "{row.title} changed", body: "{old} → {value}")`,
  },
]

export const templatesFor = (binding: BindingKey, base: CustomPropBase): BindingTemplate[] => TEMPLATES.filter((x) => x.binding === binding && (!x.bases || x.bases.includes(base)))
