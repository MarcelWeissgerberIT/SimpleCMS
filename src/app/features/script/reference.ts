/**
 * One Script — the language in one compact page for Claude (model-facing English): the AI terminal's
 * run_query / write_script tool descriptions, "Ask Claude" in the script editor and the query builder,
 * and the MCP tools one_run_query / one_run_script. Pure text, no imports (the agent's tool list loads
 * it statically and is part of a cached prompt prefix — keep it stable).
 */
export const SCRIPT_REFERENCE = `One Script — a small, safe language that only reaches the One workspace.
Syntax
- let x = 1 (define) · x = 2 (change) · # or // comments · if c { } else { } · for t in list { } · while c { } · fn name(a, b = 1) { return a + b } · short functions x => x.Name
- Values: numbers, "texts with {expressions} inside", true / false / null, lists [1, 2], records {to: "a@b.c", subject: "Hi"}, dates today(), now(), date("2026-10-05"), durations 3d 2h 30m 1w (today() + 3d)
- Conditions compare like SQL: = (equal), !=, <, <=, >, >=, and, or, not, in. Calls take named values: mail.send(to: x, subject: "Hi").
- Property names are plain names inside where / sort / select / set: Status, Due. A name with spaces or other characters goes in backticks: \`Due date\`.
- The value of the last top-level expression is the result (a query's result is shown as a table).
References
- A page, database or person is referenced as a stable token @[Title](p:<page id>) (u:<person id>), or by title: db("Tasks"), page("Parent / Page").
Library
- db(@Tasks) → .where(cond, …) .sort(Due desc, Name) .limit(n) .select(id, Name, Status) (records; keep id to know the rows) .count .rows .first .sum(Budget) .avg(x) .min(x) .max(x) .group(Status) .add("Title", Status: "Open") .schema
- rows / pages: t.Status, t.title, t.markdown, t.text, t.url, t.id, t.set(Status: "Done"), t.append(markdown), t.prepend(markdown), t.replace(markdown), t.open(), trash(t); page(@P).children, .parent; page.current = the page / row the script runs for
- create.page(title: "…", parent: @page, markdown: "…") · person("Name") · people() · me()
- Values follow the database: options by name, dates, people by name, relations by title.
- Text: upper lower trim split join replace contains starts_with ends_with slice len text format(date, "dd.MM.yyyy") · numbers: round floor ceil abs min max sum avg number · dates: days_between add_days add_months weekday · lists: range sort unique reverse first last keys; list methods .where .map .sort .select .group .sum .find .any .all .join .count .first .last — inside them a row's properties / a record's fields are plain names, \`it\` is the item, or pass a function: .map(x => x.Name)
- Asking: modal(text, buttons: ["OK"]), confirm(text), ask(text, default: ""), choose(text, options), notify(text), print(…), log(…)
- Effects (the person confirms them before a run): mail.send(to:, subject:, body:, cc:) · claude(prompt, context) · http.post(url, data) (https only)
Rules
- A query is read-only: no set / add / append / create / trash / effects / dialogs. Scripts may write; every run can be a dry run first and undone.
- No eval, no imports, no access to the browser: only these names exist.
Example query: db(@[Tasks](p:abc123)).where(Status != "Done", Due < today() + 7d).sort(Due).limit(20).select(Name, Status, Due)
Example script:
let due = db("Tasks").where(Status = "Open", Due < today() + 3d)
for t in due {
  t.set(Priority: "High")
}
notify("{due.count} tasks raised")`
