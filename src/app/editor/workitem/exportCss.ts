/**
 * Task block — the static placard for exported / shared HTML (docToHTML's markup, schema/workItem.ts):
 * the same grid as the editor (workitem.css) in plain CSS with the stock tokens. Exports are never text
 * scaled, so sizes are fixed here. `s`: the selector the document's content sits in ('' | '.doc').
 */
export function workItemExportCss(s = ''): string {
  const p = s ? `${s} ` : ''
  return [
    `${p}.workitem{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:10px;align-items:start;margin:.7em 0;padding:7px 12px 9px 15px;border-radius:4px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--rule);break-inside:avoid}`,
    `${p}.workitem::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:4px 0 0 4px;background:var(--ink-3)}`,
    `${p}.workitem[data-status=in_progress]::before,${p}.workitem[data-late]::before{background:var(--signal)}`,
    `${p}.workitem[data-status=done]{background:color-mix(in srgb,var(--surface-2) 45%,var(--surface))}`,
    `${p}.workitem[data-status=done]::before{background:var(--rule-strong)}`,
    // consecutive tasks: one plate, 2px apart (sibling margins collapse to .7em + (2px − .7em) = 2px)
    `${p}.workitem+.workitem{margin-top:calc(2px - .7em)}`,
    `${p}.workitem__head,${p}.workitem__body{display:contents}`,
    `${p}.workitem__key{grid-column:1;grid-row:1;display:grid;place-items:center;box-sizing:border-box;width:22px;height:22px;margin-top:3px;border:1px solid var(--rule-strong);border-bottom-width:2.5px;border-radius:3px;background:var(--surface)}`,
    `${p}.workitem__key .led{display:block;width:7px;height:7px;border-radius:50%;background:var(--led-off)}`,
    `${p}.workitem__key .led--on{background:var(--led-on)}`,
    `${p}.workitem__key .led--ok{background:var(--led-ok)}`,
    `${p}.workitem[data-status=done] .workitem__key{border-bottom-width:1px;transform:translateY(1px)}`,
    `${p}.workitem__label{grid-column:3;grid-row:1;margin-top:9px;font:500 10.5px/1 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;color:var(--ink-3)}`,
    `${p}.workitem__state[data-signal]{color:var(--signal-ink)}`,
    `${p}.workitem__body>*{grid-column:2/-1;min-width:0;margin:.15em 0}`,
    `${p}.workitem__body>:first-child{grid-column:2;grid-row:1;margin:.15em 0;font-weight:600}`,
    `${p}.workitem__body>:nth-child(2){margin-top:8px;padding-top:6px;border-top:1px solid var(--rule)}`,
    `${p}.workitem[data-status=done] .workitem__body>:first-child{color:var(--ink-3);text-decoration:line-through;text-decoration-color:var(--rule-strong)}`,
    `${p}.workitem__chips{grid-column:2/-1;grid-row:2;display:flex;flex-wrap:wrap;align-items:center;gap:5px 6px;margin:2px 0}`,
    `${p}.workitem__chip{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:23px;padding:0 7px;border:1px solid var(--rule-strong);border-bottom-width:2px;border-radius:3px;background:var(--surface);color:var(--ink);font:500 10.5px/1 var(--font-mono);letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}`,
    `${p}.workitem__chip[data-late]{border-color:var(--signal);background:var(--signal-wash);color:var(--signal-ink);font-weight:600}`,
    `${p}.workitem__chip--person{padding:0 7px 0 3px;font:550 12.5px/1 var(--font-sans);letter-spacing:0;text-transform:none}`,
    `${p}.workitem__avatar{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:2px;font:600 8.5px/1 var(--font-mono)}`,
    `${p}.workitem[data-status=done] .workitem__chip{color:var(--ink-3);background:transparent;border-bottom-width:1px}`,
    `@media (max-width:420px){${p}.workitem__id{display:none}${p}.workitem:is(:not([data-status=in_progress]),[data-late]) .workitem__label{display:none}${p}.workitem:is(:not([data-status=in_progress]),[data-late]) .workitem__body>:first-child{grid-column:2/-1}${p}.workitem__chips,${p}.workitem__body>:not(:first-child){grid-column:1/-1}}`,
  ].join('\n')
}
