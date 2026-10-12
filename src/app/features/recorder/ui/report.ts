/**
 * The incident report's keys (the plate's "Bericht", the read dialog's footer): made on demand from the read window,
 * downloaded through the export's own download, or copied — never stored, never written into the workspace.
 */
import { t, currentLang } from '../../../i18n'
import { toast } from '../../../store/ui'
import { downloadBlob } from '../../io/export/collect'
import { reportFacts } from '../window/facts'
import { incidentReport } from '../window/report'
import type { ReadModel } from '../window/read'
import type { EjectRecord } from '../model/types'

/** The report of a read window ('rec-report' measure). */
export async function makeReport(model: ReadModel, eject?: EjectRecord): Promise<{ md: string; file: string }> {
  const t0 = performance.now()
  const facts = await reportFacts(model, t)
  const out = incidentReport(model, facts, { t, lang: currentLang(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, now: Date.now(), ...(eject ? { eject } : {}) })
  try {
    performance.measure('rec-report', { start: t0, end: performance.now() })
  } catch {
    /* no marks */
  }
  return out
}

export async function downloadReport(model: ReadModel, eject?: EjectRecord): Promise<void> {
  try {
    const { md, file } = await makeReport(model, eject)
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), file)
    toast(t('features.recorder.report.downloaded', { file }))
  } catch (e) {
    console.warn('[recorder] the incident report failed', e)
    toast(t('features.recorder.report.failed'))
  }
}

export async function copyReport(model: ReadModel): Promise<void> {
  try {
    const { md } = await makeReport(model)
    await navigator.clipboard.writeText(md)
    toast(t('features.recorder.report.copied'))
  } catch (e) {
    console.warn('[recorder] the incident report failed', e)
    toast(t('features.recorder.report.failed'))
  }
}
