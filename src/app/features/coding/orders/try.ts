/**
 * Work orders B14 — the "Try it" key of the What's new entry (`try: workorders`, help/changelog/entries.ts): a sample
 * request. A row in **Entwurf** of the work orders database (made on first use, like N on #/coding), titled "Beispiel:
 * Login-Timeout prüfen", its body a filled-in example; opened on its own page, where its plate says what is still missing
 * (Coding, the worker …) and the toast how to go on. A Draft never plans by itself: nothing is read or sent until the person presses
 * ↵ Planen there. The sample is opened again while it still stands untouched in Entwurf (no second copy). The toast's
 * Undo takes back what this press made (the row; the database too when this press made it), as the person's undo.
 * A viewer (team, read-only): #/coding, nothing written. Registered with the help when the coding service starts —
 * lazily: the help imports the features, a static import here would be a cycle at boot.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { withWriter, type Writer } from '../../../store/writer'
import { useUI } from '../../../store/ui'
import { useCloud } from '../../../cloud'
import { t } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { readOrderConfig } from './config'
import { ensureOrderDb, orderProps, orderRowIds, orderStatusKey } from './db'

const ws = () => useWorkspace.getState()
const ui = () => useUI.getState()
const YOU: Writer = { kind: 'you', via: 'ui' }

const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })

/** The sample's body: the request as one would write it (plain text — no mention, no task); how to go on is the toast's. */
function sampleBody(): JSONContent {
  return { type: 'doc', content: [para(t('features.coding.order.sample.request')), para(t('features.coding.order.sample.repo'))] }
}

/** A sample made before and still as it was: in Entwurf, under the sample's title, not in the trash. */
function openSample(): ID | null {
  const s = ws()
  const title = t('features.coding.order.sample.title')
  for (const id of orderRowIds(s)) {
    const p = s.pages[id]
    if (p && !p.trashed && p.title === title && orderStatusKey(id, s) === 'draft') return id
  }
  return null
}

/** The "Try it" key: the sample request on its own page (made when there is none). */
export function trySampleOrder(): void {
  if (useCloud.getState().readOnly) return navigate({ name: 'coding' })
  const again = openSample()
  if (again) return navigate({ name: 'page', id: again })
  let made: { id: ID; made: boolean }
  try {
    made = ensureOrderDb(YOU)
  } catch {
    return navigate({ name: 'coding' })
  }
  const db = ws().databases[made.id]
  if (!db) return
  const read = readOrderConfig(db)
  const statusProp = orderProps(db).status
  const draft = read.kind === 'ok' ? read.config.status.draft : undefined
  const rowId = withWriter(YOU, () =>
    ws().createRow(made.id, {
      title: t('features.coding.order.sample.title'),
      properties: statusProp && draft ? { [statusProp]: draft } : {},
      content: sampleBody(),
    }),
  )
  navigate({ name: 'page', id: rowId })
  ui().toast({
    message: t('features.coding.order.sample.made'),
    action: {
      label: t('common.undo'),
      undo: true,
      run: () =>
        withWriter({ kind: 'you', via: 'undo' }, () => {
          // the database with its first request when this press made both, else the sample alone
          ws().trashPage(made.made ? made.id : rowId)
        }),
    },
  })
}

let registered = false
/** Hand the key to the help (once, from the coding service's start). */
export function registerOrdersTry(): void {
  if (registered) return
  registered = true
  void import('../../../help')
    .then(({ registerTry }) => registerTry('workorders', trySampleOrder))
    .catch((e) => console.warn('[one] work orders: the "Try it" key could not be registered', e))
}
