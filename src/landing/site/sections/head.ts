import { dotted } from './hero'
import { esc } from '../util'

/** Manual-style chapter head: "§ 02 — FEATURES", expanded title, lead, drawn rule. */
export function sectionHead(id: string, label: string, title: string, lead?: string, extra = ''): string {
  return `
<header class="sec-head">
  <div class="sec-rule" aria-hidden="true"></div>
  <p class="lbl sec-label"><span data-type>${esc(label)}</span></p>
  <h2 id="${id}-h" class="sec-h disp"><span class="line"><span class="line-in">${dotted(title)}</span></span></h2>
  ${lead ? `<p class="sec-lead">${esc(lead)}</p>` : ''}
  ${extra}
</header>`
}
