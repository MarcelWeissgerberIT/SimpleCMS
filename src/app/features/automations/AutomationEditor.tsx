/** Editor for one automation, drawn as a signal chain: WHEN (trigger) → THEN (actions, in order). */
import { useState } from 'react'
import { Bell, Copy, Globe, PenLine, Plus, Send, Trash2, X } from 'lucide-react'
import { Menu, useMenu } from '../../ui/Menu'
import { Switch, Led } from '../../ui/controls'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import type { Automation, AutomationAction, AutomationTrigger, Database } from '../../store/types'
import { testWebhook, type WebhookResult } from './engine'
import { blankAction, problemOf } from './recipes'
import { PropertyPicker, ValuePicker } from './pickers'

const ACTION_ICON = { webhook: Globe, set_property: PenLine, notify: Bell }

export function AutomationEditor({ db, automation, onChange, onDelete, onDuplicate }: { db: Database; automation: Automation; onChange: (a: Automation) => void; onDelete: () => void; onDuplicate: () => void }) {
  const t = useT()
  const addMenu = useMenu()
  const problem = problemOf(automation, db)
  const set = (patch: Partial<Automation>) => onChange({ ...automation, ...patch })
  const setTrigger = (trigger: AutomationTrigger) => set({ trigger })
  const setAction = (i: number, a: AutomationAction) => set({ actions: automation.actions.map((x, j) => (j === i ? a : x)) })
  const trig = automation.trigger
  const watched = trig.type === 'property_changed' ? db.properties.find((p) => p.id === trig.propertyId) : undefined

  return (
    <div className="auto-ed" data-armed={automation.enabled && !problem ? '' : undefined}>
      <div className="auto-ed__head">
        <input className="auto-ed__name" value={automation.name} onChange={(e) => set({ name: e.target.value })} aria-label={t('features.auto.name')} placeholder={t('features.auto.untitled')} />
        <div className="auto-ed__arm">
          <span className="label">{automation.enabled ? t('features.auto.armed') : t('features.auto.off')}</span>
          <Switch checked={automation.enabled} disabled={!!problem && !automation.enabled} onChange={(v) => set({ enabled: v })} label={t('features.auto.enabled')} />
        </div>
        <Tooltip label={t('common.duplicate')}>
          <button type="button" className="icon-btn" onClick={onDuplicate}>
            <Copy size={15} />
          </button>
        </Tooltip>
        <Tooltip label={t('common.delete')}>
          <button type="button" className="icon-btn auto-danger" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </Tooltip>
      </div>
      {problem && (
        <div className="auto-problem" role="status">
          <Led state="on" /> {problem}
        </div>
      )}

      <ol className="auto-chain">
        {/* WHEN */}
        <li className="auto-node auto-node--trigger">
          <div className="auto-node__tag">
            <span className="auto-node__port" />
            <span className="label">{t('features.auto.when')}</span>
          </div>
          <div className="auto-node__body">
            <div className="auto-seg" role="radiogroup" aria-label={t('features.auto.trigger')}>
              {(['row_created', 'property_changed', 'row_deleted'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={trig.type === type}
                  className="auto-seg__btn"
                  onClick={() => setTrigger(type === 'property_changed' ? { type, propertyId: null } : { type })}
                >
                  {t(`features.auto.trig.${type}`)}
                </button>
              ))}
            </div>
            {trig.type === 'property_changed' && (
              <div className="auto-sentence">
                <span className="auto-sentence__word">{t('features.auto.sentence.when')}</span>
                <PropertyPicker
                  db={db}
                  value={trig.propertyId}
                  allowAny
                  ariaLabel={t('features.auto.watchProperty')}
                  onChange={(propertyId) => setTrigger({ type: 'property_changed', propertyId })}
                />
                <span className="auto-sentence__word">{t('features.auto.sentence.changesTo')}</span>
                {trig.propertyId ? (
                  <ValuePicker
                    prop={watched}
                    value={trig.toValue}
                    allowAny
                    ariaLabel={t('features.auto.toValue')}
                    onChange={(toValue) => setTrigger({ type: 'property_changed', propertyId: trig.propertyId, ...(toValue === undefined ? {} : { toValue }) })}
                  />
                ) : (
                  <span className="auto-pick auto-pick--off faint">{t('features.auto.anyValue')}</span>
                )}
              </div>
            )}
            {trig.type !== 'property_changed' && <p className="auto-note muted">{t(`features.auto.trigNote.${trig.type}`)}</p>}
          </div>
        </li>

        {/* THEN */}
        {automation.actions.map((a, i) => {
          const Icon = ACTION_ICON[a.type]
          return (
            <li key={i} className="auto-node">
              <div className="auto-node__tag">
                <span className="auto-node__port" />
                <span className="label">
                  {t('features.auto.then')} · {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <div className="auto-node__body">
                <div className="auto-act__head">
                  <Icon size={14} />
                  <span className="auto-act__type">{t(`features.auto.act.${a.type}`)}</span>
                  <button type="button" className="icon-btn icon-btn--sm" aria-label={t('features.auto.removeAction')} onClick={() => set({ actions: automation.actions.filter((_, j) => j !== i) })}>
                    <X size={13} />
                  </button>
                </div>
                {a.type === 'webhook' && <WebhookFields db={db} automation={automation} action={a} onChange={(next) => setAction(i, next)} />}
                {a.type === 'set_property' && (
                  <div className="auto-sentence">
                    <span className="auto-sentence__word">{t('features.auto.sentence.set')}</span>
                    <PropertyPicker db={db} value={a.propertyId || null} settableOnly ariaLabel={t('features.auto.setProperty')} onChange={(pid) => setAction(i, { ...a, propertyId: pid ?? '', value: null })} />
                    <span className="auto-sentence__word">{t('features.auto.sentence.to')}</span>
                    <ValuePicker prop={db.properties.find((p) => p.id === a.propertyId)} value={a.value} ariaLabel={t('features.auto.setValue')} onChange={(v) => setAction(i, { ...a, value: v ?? null })} />
                  </div>
                )}
                {a.type === 'notify' && (
                  <div className="auto-field">
                    <input className="input" value={a.message} placeholder={t('features.auto.notifyPlaceholder')} aria-label={t('features.auto.act.notify')} onChange={(e) => setAction(i, { ...a, message: e.target.value })} />
                    <span className="auto-hint faint">{t('features.auto.notifyHint')}</span>
                  </div>
                )}
              </div>
            </li>
          )
        })}

        <li className="auto-node auto-node--add">
          <div className="auto-node__tag">
            <span className="auto-node__port auto-node__port--open" />
          </div>
          <div className="auto-node__body">
            <button type="button" className="btn btn--sm" onClick={addMenu.toggle}>
              <Plus size={14} /> {t('features.auto.addAction')}
            </button>
            <Menu
              {...addMenu.props}
              className="auto-menu"
              entries={(['webhook', 'set_property', 'notify'] as const).map((type) => {
                const Icon = ACTION_ICON[type]
                return { label: t(`features.auto.act.${type}`), icon: <Icon size={14} />, hint: t(`features.auto.actHint.${type}`), onSelect: () => set({ actions: [...automation.actions, blankAction(type, db)] }) }
              })}
            />
          </div>
        </li>
      </ol>
    </div>
  )
}

function WebhookFields({ db, automation, action, onChange }: { db: Database; automation: Automation; action: Extract<AutomationAction, { type: 'webhook' }>; onChange: (a: Extract<AutomationAction, { type: 'webhook' }>) => void }) {
  const t = useT()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<WebhookResult | null>(null)
  const runTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await testWebhook(db.id, automation, action))
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="auto-field">
      <div className="auto-url">
        <div className="auto-method" role="radiogroup" aria-label={t('features.auto.method')}>
          {(['POST', 'PUT'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={action.method === m} onClick={() => onChange({ ...action, method: m })}>
              {m}
            </button>
          ))}
        </div>
        <input
          className="input mono auto-url__input"
          type="url"
          inputMode="url"
          spellCheck={false}
          placeholder="https://your-n8n.app/webhook/…"
          value={action.url}
          aria-label={t('features.auto.url')}
          onChange={(e) => {
            setResult(null)
            onChange({ ...action, url: e.target.value.trim() })
          }}
        />
        <button type="button" className="btn btn--sm btn--ink" onClick={runTest} disabled={testing || !action.url}>
          <Send size={13} /> {testing ? t('features.auto.sending') : t('features.auto.sendTest')}
        </button>
      </div>
      {result && (
        <div className="auto-response" data-ok={result.ok || undefined} role="status">
          <Led state={result.ok ? 'ok' : 'on'} />
          <span className="mono auto-response__status">{result.opaque ? 'OPAQUE' : result.status || 'ERR'}</span>
          <span className="auto-response__msg">{result.message}</span>
          <span className="mono faint">{result.ms} ms</span>
          {result.body && <code className="auto-response__body">{result.body}</code>}
        </div>
      )}
    </div>
  )
}
