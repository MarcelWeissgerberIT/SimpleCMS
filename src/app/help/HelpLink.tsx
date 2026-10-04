/**
 * A small "?" keycap that opens one help article in the Help panel: <HelpLink id="mcp-servers" />.
 * Ids are the article file names (src/app/help/articles/en/<id>.md).
 */
import type { MouseEvent } from 'react'
import { useT } from '../i18n'
import { openHelp } from './state'

export interface HelpLinkProps {
  /** article id */
  id: string
  /** what the article is about, for the accessible name ("Help: MCP servers") */
  topic?: string
  className?: string
}

export function HelpLink({ id, topic, className }: HelpLinkProps) {
  const t = useT()
  const label = topic ? t('help.link.labelFor', { topic }) : t('help.link.label')
  const onClick = (e: MouseEvent) => {
    // never submit a form or toggle a <summary> / row it sits in
    e.preventDefault()
    e.stopPropagation()
    openHelp(id)
  }
  return (
    <button type="button" className={`help-link${className ? ` ${className}` : ''}`} aria-label={label} title={label} data-help-id={id} onClick={onClick}>
      ?
    </button>
  )
}
