import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Cloud, CloudOff, GitCompareArrows } from 'lucide-react'
import { CloudError, checkoutWorkspace, compareCheckout, mergeCheckout, useCheckout, useCloud, switchWorkspace, type CheckoutReview } from '../../cloud'
import { planCheckout, type Choice, type Json } from '@/shared/checkout'
import { diff } from '../../store/merge'
import { docToMarkdown } from '../../editor'
import type { JSONContent } from '@tiptap/core'
import { useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import { HelpLink } from '../../help'
import { closeCloudDialog, openCloudDialog } from './state'
import { errorText } from './errors'
import './checkout.css'

export function CheckoutMode() {
  const t = useT()
  const record = useCheckout(s => s.record)
  const active = useCloud(s => s.active.kind)
  const online = useCloud(s => s.status === 'online')
  const canCheckout = useCloud(s => s.active.kind === 'cloud' && s.status === 'online' && !s.readOnly && !!s.supports?.includes('checkout:1'))
  if (active === 'local' && !record) return null
  return <button type="button" className="checkout-mode" data-local={active === 'local'} title={active === 'local' ? t('shell.checkout.localHint') : t('shell.checkout.action')} onClick={() => openCloudDialog(active === 'local' ? 'checkout-merge' : 'checkout')} disabled={active === 'cloud' && !canCheckout}>
    {active === 'local' ? <CloudOff size={16} aria-hidden /> : <Cloud size={16} fill="currentColor" aria-hidden />}
    <span>{t(active === 'local' ? 'shell.checkout.local' : online ? 'shell.checkout.live' : 'shell.checkout.offline')}</span>
  </button>
}

export function CheckoutBanner() {
  const t = useT()
  const record = useCheckout(s => s.record)
  const local = useCloud(s => s.active.kind === 'local')
  if (!local || !record) return null
  return <div className="checkout-banner" role="status">
    <CloudOff size={17} aria-hidden />
    <span><strong>{record.source.name} · {t('shell.checkout.local')}</strong><span>{t('shell.checkout.localHint')}</span></span>
    <button className="btn" onClick={() => openCloudDialog('checkout-merge')}><GitCompareArrows size={14} aria-hidden />{t('shell.checkout.compare')}</button>
  </div>
}

export function CheckoutDialog() {
  const t = useT()
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    try { await checkoutWorkspace(setProgress) } catch (e) { setError(errorText(e, t)); setBusy(false) }
  }
  return <Modal open title={t('shell.checkout.title')} label="CLOUD → LOCAL" width={650} onClose={() => !busy && closeCloudDialog()} footer={<>
    <button className="btn btn--ghost" onClick={closeCloudDialog} disabled={busy}>{t('common.cancel')}</button>
    <button className="btn btn--primary" onClick={() => void go()} disabled={!ack || busy}>{t(busy ? 'shell.checkout.busy' : 'shell.checkout.start')}</button>
  </>}>
    <div className="checkout-warning" role="alert"><AlertTriangle size={22} aria-hidden /><p>{t('shell.checkout.warning')}</p></div>
    <p>{t('shell.checkout.scope')}</p>
    <label className="checkout-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} />{t('shell.checkout.ack')}</label>
    {busy && <progress max={1} value={progress} aria-label={t('shell.checkout.busy')} />}
    {error && <p className="cl-err" role="alert">{error}</p>}
    <HelpLink id="team-cloud" />
  </Modal>
}

export function CheckoutMergeDialog() {
  const t = useT()
  const record = useCheckout(s => s.record)
  const [review, setReview] = useState<CheckoutReview | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  const compare = async () => {
    setLoading(true); setReview(null); setChoices({}); setError(''); setStale(false)
    try { setReview(await compareCheckout()) } catch (e) { setError(errorText(e, t)) } finally { setLoading(false) }
  }
  useEffect(() => { void compare() }, []) // A read on an explicit press; never an unattended sync.
  const plan = useMemo(() => review ? planCheckout(review.record.source.data, review.proposed, review.snapshot.data, choices) : null, [review, choices])
  const cloudChanges = useMemo(() => review ? planCheckout(review.record.source.data, review.snapshot.data, review.record.source.data).changes : [], [review])
  const apply = async () => {
    if (!review) return
    setBusy(true); setError('')
    try { await mergeCheckout(review, choices); setDone(true) } catch (e) { setError(errorText(e, t)); if (e instanceof CloudError && e.code === 'checkout_checkpoint') setDone(true); else setStale(true) } finally { setBusy(false) }
  }
  const value = (v: Json | undefined): string => {
    if (v === undefined) return t('shell.checkout.missing')
    if (v && typeof v === 'object' && !Array.isArray(v) && v.type === 'doc') return docToMarkdown(v as JSONContent) || '∅'
    if (v && typeof v === 'object' && !Array.isArray(v) && v.meta && v.content) return `${value(v.meta)}\n\n${value(v.content)}`
    if (typeof v === 'string') return v
    return JSON.stringify(v, null, 2)
  }
  const field = (key: string) => ['content', 'meta', 'title', 'pages', 'databases', 'properties'].includes(key) ? t(`shell.checkout.field.${key}`) : key
  const open = () => { if (record) { closeCloudDialog(); switchWorkspace({ kind: 'cloud', id: record.source.workspaceId }) } }
  return <Modal open title={t('shell.checkout.review')} label="LOCAL ⇄ CLOUD" width={1100} onClose={() => !busy && closeCloudDialog()} className="checkout-review" footer={<>
    <button className="btn btn--ghost" disabled={busy} onClick={closeCloudDialog}>{t('common.close')}</button>
    {done ? <button className="btn btn--primary" onClick={open}>{t('shell.checkout.openCloud')}</button> : <>
      <button className="btn" onClick={() => void compare()} disabled={busy || loading}>{t('shell.checkout.refresh')}</button>
      <button className="btn btn--primary" onClick={() => void apply()} disabled={busy || loading || stale || !plan?.changes.length || !!plan.unresolved.length}>{t(busy ? 'shell.checkout.applying' : 'shell.checkout.apply')}</button>
    </>}
  </>}>
    {loading && <p role="status">{t('shell.checkout.loading')}</p>}
    {error && <p className="cl-err" role="alert">{error}</p>}
    {done ? <p role="status">{t('shell.checkout.done')}</p> : plan && review && <>
      <div className="checkout-summary"><strong>{t(plan.changes.length === 1 ? 'shell.checkout.localCount.one' : 'shell.checkout.localCount', { n: plan.changes.length })} · {t(plan.changes.filter(c => c.conflict).length === 1 ? 'shell.checkout.conflictCount.one' : 'shell.checkout.conflictCount', { n: plan.changes.filter(c => c.conflict).length })}</strong><span>{t('shell.checkout.cloudChanges', { n: cloudChanges.length })}</span></div>
      <p className="muted">{t('shell.checkout.limit')}</p>
      {cloudChanges.length > 0 && <details className="checkout-cloud-changes"><summary>{t('shell.checkout.cloudChanges', { n: cloudChanges.length })}</summary>{cloudChanges.map(change => <section key={change.key} className="checkout-change">
        <header><strong>{String(review.snapshot.data.pages[change.path[1]]?.meta.title || change.path[1])}</strong><span className="label">{change.path.filter((_, i) => i !== 1).map(field).join(' / ')}</span></header>
        <div className="checkout-values" data-two><div><span className="label">{t('shell.checkout.base')}</span><DiffText base={value(change.base)} text={value(change.base)} other={[value(change.local)]} /></div><div><span className="label">{t('shell.checkout.theirs')}</span><DiffText base={value(change.base)} text={value(change.local)} other={[]} /></div></div>
      </section>)}</details>}
      {!plan.changes.length && <p>{t('shell.checkout.empty')}</p>}
      <div className="checkout-changes">{plan.changes.map(change => {
        const id = change.path[1]
        const page = review.proposed.pages[id] ?? review.snapshot.data.pages[id] ?? review.record.source.data.pages[id]
        const selected = choices[change.key] ?? (change.conflict ? undefined : 'local')
        return <section key={change.key} className="checkout-change" data-conflict={change.conflict}>
          <header><strong>{String(page?.meta.title || id)}</strong><span className="label">{change.path.filter((_, i) => i !== 1).map(field).join(' / ')}</span></header>
          {change.conflict && <p className="checkout-conflict"><AlertTriangle size={14} aria-hidden />{t('shell.checkout.conflict')}</p>}
          <div className="checkout-values">{(['base', 'cloud', 'local'] as const).map(side => <div key={side}><span className="label">{t(side === 'base' ? 'shell.checkout.base' : side === 'cloud' ? 'shell.checkout.theirs' : 'shell.checkout.mine')}</span><DiffText base={value(change.base)} text={value(change[side])} other={side === 'base' ? [value(change.cloud), value(change.local)] : []} /></div>)}</div>
          <div className="checkout-choices" role="group" aria-label={t('shell.checkout.conflict')}>
            <button className="btn" aria-pressed={selected === 'cloud'} onClick={() => setChoices({ ...choices, [change.key]: 'cloud' })} disabled={busy}>{t('shell.checkout.keepCloud')}</button>
            <button className="btn" aria-pressed={selected === 'local'} onClick={() => setChoices({ ...choices, [change.key]: 'local' })} disabled={busy}>{t('shell.checkout.keepLocal')}</button>
          </div>
        </section>
      })}</div>
    </>}
  </Modal>
}

function DiffText({ base, text, other }: { base: string; text: string; other: string[] }) {
  const lines = text.split('\n')
  const changed = new Set<number>()
  if (other.length) for (const version of other) for (const h of diff(lines, version.split('\n'))) for (let i = h.a0; i < h.a1; i++) changed.add(i)
  else for (const h of diff(base.split('\n'), lines)) for (let i = h.b0; i < h.b1; i++) changed.add(i)
  return <pre>{lines.map((line, i) => <span key={i} className={changed.has(i) ? other.length ? 'checkout-removed' : 'checkout-added' : undefined}>{line || '\u00a0'}</span>)}</pre>
}
