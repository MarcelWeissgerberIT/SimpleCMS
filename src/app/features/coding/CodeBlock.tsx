/** A command to copy (Settings → Coding worker, the 3-step card): mono, one copy key. */
import { Copy } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'

export function CodeBlock({ code, label, testId }: { code: string; label: string; testId?: string }) {
  const t = useT()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      useUI.getState().toast({ message: t('features.coding.copied'), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t('features.coding.copyFailed'), kind: 'error' })
    }
  }
  return (
    <div className="cw-code" data-testid={testId}>
      <pre aria-label={label}>{code}</pre>
      <button type="button" className="icon-btn icon-btn--sm cw-code__copy" onClick={() => void copy()} aria-label={t('features.coding.copy', { what: label })} title={t('features.coding.copy', { what: label })}>
        <Copy size={13} strokeWidth={1.75} />
      </button>
    </div>
  )
}
