import { useLayoutEffect } from 'react'
import { useT } from '../../i18n'
import { shortcutLabel, ALT } from '../../ui/controls'
import { openHelp } from '../../help'

export interface ShortcutGroup {
  label: string
  items: Array<[string, string[]]>
}

export function useShortcutGroups(): ShortcutGroup[] {
  const t = useT()
  return [
    {
      label: t('shell.keys.general'),
      items: [
        [t('shell.cmd.palette'), ['Mod+K']],
        [t('shell.cmd.newPage'), ['Mod+Alt+N']],
        [t('shell.cmd.sidebar'), ['Mod+\\']],
        [t('shell.cmd.theme'), ['Mod+Shift+L']],
        [t('shell.cmd.focus'), ['Mod+Shift+F']],
        [t('shell.rail.toggle'), ['Mod+.']],
        [t('shell.cmd.settings'), ['Mod+,']],
        [t('shell.cmd.shortcuts'), ['Mod+/']],
        [t('help.title'), ['?']],
        [t('shell.keys.closePeek'), ['Esc']],
      ],
    },
    {
      label: t('shell.keys.navigate'),
      items: [
        [t('shell.keys.openPane'), [`${ALT}+${t('shell.tips.click')}`]],
        [t('shell.keys.paletteFind'), ['Mod+P']],
        [t('shell.keys.paletteCommands'), ['>']],
        [t('shell.keys.paletteAsk'), ['?']],
        [t('shell.keys.palettePane'), [`${ALT}+↵`]],
      ],
    },
    {
      label: t('shell.keys.editing'),
      items: [
        [t('shell.keys.slash'), ['/']],
        [t('shell.keys.bold'), ['Mod+B']],
        [t('shell.keys.italic'), ['Mod+I']],
        [t('shell.keys.link'), ['Mod+Shift+K']],
        [t('shell.keys.titleToBody'), ['↵']],
        [t('shell.keys.undo'), ['Mod+Z']],
        [t('shell.keys.comment'), ['Mod+Alt+M']],
        [t('shell.keys.agent'), ['Mod+J']],
        [t('shell.keys.switchTab'), ['Mod+Alt+←', 'Mod+Alt+→']],
      ],
    },
    {
      label: t('shell.nav.inbox'),
      items: [
        [t('shell.keys.inbox'), ['G I']],
        [t('shell.keys.inboxMove'), ['↑', '↓']],
        [t('shell.keys.inboxRead'), ['U']],
        [t('shell.keys.inboxArchive'), ['E']],
      ],
    },
    {
      label: t('shell.nav.agenda'),
      items: [
        [t('shell.keys.agendaMove'), ['←', '→']],
        [t('shell.keys.agendaToday'), ['T']],
        [t('shell.keys.agendaViews'), ['M', 'W', 'L']],
        [t('shell.keys.agendaShift'), ['Alt+←', 'Alt+→']],
      ],
    },
  ]
}

export function ShortcutList() {
  const t = useT()
  const groups = useShortcutGroups()
  // pointer gestures and literal keys are shown as written, chords go through shortcutLabel()
  const literal = (k: string) => k.includes('↵') || k.endsWith(`+${t('shell.tips.click')}`)
  return (
    <div className="keysheet">
      {groups.map((g) => (
        <section key={g.label} className="keysheet__group">
          <div className="label keysheet__label">{g.label}</div>
          <dl className="keysheet__list">
            {g.items.map(([label, keys]) => (
              <div key={label} className="keysheet__row">
                <dt>{label}</dt>
                <dd>
                  {keys.map((k, i) => (
                    <span key={k} className="keysheet__keys">
                      {i > 0 && <span className="faint keysheet__or">/</span>}
                      <span className="kbd">{literal(k) ? k : shortcutLabel(k)}</span>
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

/**
 * The keyboard sheet lives in the Help panel now (its "Keys" tab): the `shortcuts` modal — ⌘/ / Ctrl+/,
 * the palette's "Keyboard shortcuts", the sidebar menu — hands over to it and closes at once.
 */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useLayoutEffect(() => {
    openHelp({ tab: 'keys' })
    onClose()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
