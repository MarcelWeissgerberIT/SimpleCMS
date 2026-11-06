import { useId, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useT } from '../../i18n'
import { HelpLink } from '../../help'
import { Led } from '../../ui/controls'
import { useCoding } from './state'
import { changeRepositories } from './SetupCard'
import { openCodingSettings } from './open'
import './ollamaSettings.css'

/** One worker-wide key, entered only on its authenticated setup page. Opening this card sends no request. */
export function OllamaCloudSettings({ inWorker = false }: { inWorker?: boolean }) {
  const t = useT()
  const id = useId()
  const connected = useCoding(s => s.conn === 'connected')
  const worker = useCoding(s => s.worker)
  const capable = useCoding(s => s.can?.includes('agent:ollama') ?? false)
  const ready = connected && capable && worker?.setup === true
  const [busy, setBusy] = useState(false)
  const open = async () => {
    if (!ready) return openCodingSettings()
    setBusy(true)
    try { await changeRepositories(t) } finally { setBusy(false) }
  }
  return <section className="ocs" aria-labelledby={id} data-testid="ollama-cloud-settings">
    <header className="ocs__head">
      <span className="ocs__code" aria-hidden>OL</span>
      <div><h3 id={id}>Ollama Cloud</h3><span className="label">{t('features.coding.ollamaGlobal.scope')}</span></div>
      <HelpLink id="coding-pipeline" />
    </header>
    <div className="ocs__body">
      <p>{t('features.coding.ollamaGlobal.lead')}</p>
      <p className="ocs__state" role="status"><Led state={ready ? 'ok' : 'off'} />{t(ready ? 'features.coding.ollamaGlobal.ready' : connected ? 'features.coding.ollamaGlobal.old' : 'features.coding.ollamaGlobal.off', { name: worker?.name ?? '' })}</p>
      <p className="ocs__hint">{t('features.coding.ollamaGlobal.privacy')}</p>
      {(ready || !inWorker) && <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void open()} data-testid="ollama-cloud-settings-open">
        <ArrowUpRight size={14} aria-hidden />{t(ready ? 'features.coding.ollamaGlobal.open' : 'features.coding.ollamaGlobal.connect')}
      </button>}
      <p className="ocs__hint">{t('features.coding.ollamaGlobal.use')}</p>
    </div>
  </section>
}
