import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import { shortcutLabel, ALT } from '../../ui/controls'

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
        [t('shell.cmd.settings'), ['Mod+,']],
        [t('shell.cmd.shortcuts'), ['Mod+/', '?']],
        [t('shell.keys.closePeek'), ['Esc']],
      ],
    },
    {
      label: t('shell.keys.navigate'),
      items: [
        [t('shell.keys.openPane'), [`${ALT}+Click`]],
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
      ],
    },
  ]
}

export function ShortcutList() {
  const groups = useShortcutGroups()
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
                      <span className="kbd">{k.includes('Click') || k.includes('↵') ? k : shortcutLabel(k)}</span>
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

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <Modal open onClose={onClose} width={760} label={`§ ${t('shell.shortcuts.code')}`} title={t('shell.cmd.shortcuts')}>
      <ShortcutList />
    </Modal>
  )
}
