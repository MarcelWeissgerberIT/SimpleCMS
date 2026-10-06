/**
 * The kit's dialogs (loaded on first use by KitHost):
 *  - Review: an own type's scripts in a version this device did not save or confirm (team workspaces) —
 *    the exact code of each binding; Confirm lets this device run it (SHA-256 per code, per device).
 *  - Turn into list: the items found in a selection, ticked; a name; Create → a shared list.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, ShieldAlert } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { toast } from '../../store/ui'
import { useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import { CodePreview } from '../script/editor/CodeEditor'
import { BINDING_KEYS, editorName, trustType, untrustedOf, useKitTrust } from './scripts'
import { closeReview, closeTurnIntoList, useKitDialogs } from './review'
import { createList } from './model'
import { openKit } from './open'
import '../script/script.css'
import './kit.css'

export default function KitDialogs() {
  const review = useKitDialogs((s) => s.review)
  const toList = useKitDialogs((s) => s.toList)
  return (
    <>
      {review && <ReviewDialog typeId={review} />}
      {toList && <ToListDialog items={toList.items} name={toList.name} />}
    </>
  )
}

function ReviewDialog({ typeId }: { typeId: string }) {
  const t = useT()
  const type = useWorkspace((s) => s.kit?.propTypes[typeId] ?? null)
  useKitTrust((s) => s.ok)
  const pending = untrustedOf(type)
  const [busy, setBusy] = useState(false)
  if (!type) return null
  const who = editorName(type)
  const keys = BINDING_KEYS.filter((k) => type.scripts?.[k]?.trim())
  return (
    <Modal
      open
      onClose={closeReview}
      label={t('features.kit.trust.label')}
      title={t('features.kit.trust.title', { name: type.name })}
      width={720}
      className="kt-review-dialog"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={closeReview}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !pending.length}
            data-testid="kt-trust-confirm"
            onClick={async () => {
              setBusy(true)
              await trustType(type)
              setBusy(false)
              closeReview()
              toast(t('features.kit.trust.confirmed', { name: type.name }))
            }}
          >
            <Check size={14} strokeWidth={2} aria-hidden /> {t('features.kit.trust.confirm')}
          </button>
        </>
      }
    >
      <p className="kt-dialog__lead">
        <ShieldAlert size={16} strokeWidth={1.8} aria-hidden /> {who ? t('features.kit.trust.explainBy', { name: who }) : t('features.kit.trust.explain')}
      </p>
      {!pending.length && <p className="kt-note">{t('features.kit.trust.nothing')}</p>}
      <div className="kt-review-codes">
        {keys.map((k) => (
          <section key={k} className="kt-review-code" data-pending={pending.includes(k) || undefined}>
            <h3 className="label">
              {t(`features.kit.binding.${k}`)}
              {pending.includes(k) && <span className="kt-review-code__new">{t('features.kit.trust.changed')}</span>}
            </h3>
            <CodePreview code={type.scripts?.[k] ?? ''} />
          </section>
        ))}
      </div>
    </Modal>
  )
}

function ToListDialog({ items, name: start }: { items: string[]; name: string }) {
  const t = useT()
  const [name, setName] = useState(start || t('features.kit.toList.defaultName'))
  const [on, setOn] = useState<Set<number>>(() => new Set(items.map((_, i) => i)))
  useEffect(() => setOn(new Set(items.map((_, i) => i))), [items])
  const picked = useMemo(() => items.filter((_, i) => on.has(i)), [items, on])
  const create = () => {
    const id = createList({ name: name.trim() || t('features.kit.toList.defaultName'), items: picked })
    closeTurnIntoList()
    if (!id) return
    toast({ message: t('features.kit.toList.created', { name: name.trim(), n: picked.length }), action: { label: t('features.kit.toList.open'), run: () => openKit('lists', id) } })
  }
  return (
    <Modal
      open
      onClose={closeTurnIntoList}
      label={t('features.kit.toList.label')}
      title={t('features.kit.toList.title')}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={closeTurnIntoList}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!picked.length || !name.trim()} onClick={create} data-testid="kt-tolist-create">
            {t('features.kit.toList.create', { n: picked.length })}
          </button>
        </>
      }
    >
      <p className="kt-dialog__lead">{t('features.kit.toList.lead')}</p>
      <label className="kt-field">
        <span className="label">{t('features.kit.toList.name')}</span>
        <input
          className="input"
          value={name}
          maxLength={80}
          data-autofocus=""
          data-testid="kt-tolist-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && picked.length && name.trim()) {
              e.preventDefault()
              create()
            }
          }}
        />
      </label>
      <div className="kt-proposals__head label">
        <span>{t('features.kit.toList.found', { n: items.length })}</span>
        <span className="kt-rule" aria-hidden />
        <button type="button" className="kt-link" onClick={() => setOn(on.size === items.length ? new Set() : new Set(items.map((_, i) => i)))}>
          {on.size === items.length ? t('features.kit.fill.none') : t('features.kit.fill.all')}
        </button>
      </div>
      <ul className="kt-proposals__list kt-proposals__list--dialog" data-testid="kt-tolist-items">
        {items.map((it, i) => (
          <li key={i}>
            <label className="kt-proposal">
              <input
                type="checkbox"
                checked={on.has(i)}
                onChange={() =>
                  setOn((s) => {
                    const n = new Set(s)
                    if (n.has(i)) n.delete(i)
                    else n.add(i)
                    return n
                  })
                }
              />
              <span className="kt-proposal__box" aria-hidden>
                {on.has(i) && <Check size={11} strokeWidth={3} />}
              </span>
              <span>{it}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
