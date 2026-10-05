/** Small pieces of the commands UI: a field-like picker, the command glyph with its LED. */
import type { ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'

/** A field-like key that opens a menu of choices. */
export function FieldPicker({ label, value, placeholder, entries, searchable, searchPlaceholder }: { label: string; value: ReactNode; placeholder: string; entries: MenuEntry[]; searchable?: boolean; searchPlaceholder?: string }) {
  const t = useT()
  const menu = useMenu()
  return (
    <div className="dbc-field">
      <span className="label">{label}</span>
      <button type="button" className="dbc-pick" aria-label={label} aria-haspopup="menu" aria-expanded={menu.open} onClick={(e) => (menu.open ? menu.close() : menu.openAt(e.currentTarget))}>
        <span className="dbc-pick__value">{value ?? <span className="faint">{placeholder}</span>}</span>
        <ChevronDown size={14} className="faint" aria-hidden />
      </button>
      <Menu {...menu.props} entries={entries} searchable={searchable} searchPlaceholder={searchPlaceholder ?? t('common.search')} width={280} />
    </div>
  )
}

/** A command's lucide glyph; `led`: a status light in its corner (the Gmail sync). */
export function CmdGlyph({ icon: Icon, led }: { icon: LucideIcon; led?: 'off' | 'on' | 'ok' }) {
  return (
    <span className="cmd-glyph">
      <Icon size={15} strokeWidth={1.7} aria-hidden />
      {led && <span className={`led cmd-glyph__led${led === 'on' ? ' led--on' : led === 'ok' ? ' led--ok' : ''}`} aria-hidden />}
    </span>
  )
}
