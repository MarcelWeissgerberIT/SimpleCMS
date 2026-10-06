/**
 * Workspace page § 03 — Building blocks: how many shared lists, own property types and record types the
 * workspace holds (Workspace.kit), each with the way to its place on the building blocks page (#/kit).
 */
import { ArrowRight, Boxes, ListChecks, Shapes, type LucideIcon } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { fmtNumber } from '../lib/format'
import { useKit } from './stats'
import { SectionHead } from './parts'

const BLOCKS: Array<{ id: 'lists' | 'types' | 'records'; part: 'lists' | 'propTypes' | 'recordTypes'; icon: LucideIcon }> = [
  { id: 'lists', part: 'lists', icon: ListChecks },
  { id: 'types', part: 'propTypes', icon: Shapes },
  { id: 'records', part: 'recordTypes', icon: Boxes },
]

export function BlocksSection() {
  const t = useT()
  const lang = useLang()
  const kit = useKit()
  return (
    <>
      <SectionHead n="03" title={t('shell.ws.sec.blocks')} lead={t('shell.ws.blocks.lead')} />
      <ul className="wsp-blocks" data-testid="ws-blocks">
        {BLOCKS.map(({ id, part, icon: Icon }) => {
          const entries = Object.values(kit[part]).sort((a, b) => a.name.localeCompare(b.name))
          return (
            <li key={id} className="wsp-block" data-block={id}>
              <div className="wsp-block__top">
                <span className="wsp-block__icon" aria-hidden>
                  <Icon size={17} strokeWidth={1.7} />
                </span>
                <span className="wsp-block__count" data-testid={`ws-kit-${id}`}>
                  {fmtNumber(entries.length, lang).padStart(2, '0')}
                </span>
              </div>
              <h3 className="wsp-block__title">{t(`shell.ws.blocks.${id}`)}</h3>
              <p className="wsp-block__what">{t(`shell.ws.blocks.${id}What`)}</p>
              {entries.length > 0 && (
                <p className="wsp-block__names">
                  {entries
                    .slice(0, 4)
                    .map((e) => e.name)
                    .join(' · ')}
                  {entries.length > 4 ? ` · +${entries.length - 4}` : ''}
                </p>
              )}
              <a className="btn btn--sm wsp-block__go" href={`#/kit/${id}`} data-testid={`ws-kit-link-${id}`}>
                {entries.length ? t('shell.ws.blocks.open') : t('shell.ws.blocks.create')}
                <ArrowRight size={13} aria-hidden />
              </a>
            </li>
          )
        })}
      </ul>
    </>
  )
}
