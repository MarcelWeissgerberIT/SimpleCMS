/**
 * The menu of a filled node: edit its value (numbers, text, yes / no), replace it, wrap it into a
 * function, unwrap a function, add or remove an optional argument, empty the slot.
 */
import { useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, CornerDownLeft, Eraser, Minus, Plus, Replace } from 'lucide-react'
import { Popover } from '../../../ui/Popover'
import { useT, useLang } from '../../../i18n'
import { isOperator } from '../../../store/functions'
import { OPERATOR_KEYS } from './catalog'
import { describe } from './NodePicker'
import { numText, signature, type CallSpec, type DNode } from './model'

export type NodeAction = 'replace' | 'wrap' | 'unwrap' | 'addArg' | 'removeArg' | 'delete'

export interface NodeMenuProps {
  anchor: HTMLElement
  node: Exclude<DNode, { k: 'hole' }>
  spec: CallSpec | undefined
  canAdd: boolean
  canRemove: boolean
  readOnly: boolean
  onValue: (node: DNode) => void
  onAction: (a: NodeAction) => void
  onClose: () => void
}

export function NodeMenu({ anchor, node, spec, canAdd, canRemove, readOnly, onValue, onAction, onClose }: NodeMenuProps) {
  const t = useT()
  const lang = useLang()
  const listRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(node.k === 'num' ? numText(node.v) : node.k === 'str' ? node.v : '')
  const num = Number(text.replace(',', '.'))
  const numOk = node.k !== 'num' || (text.trim() !== '' && Number.isFinite(num))

  const commit = () => {
    if (node.k === 'num' && numOk) onValue({ k: 'num', v: num })
    else if (node.k === 'str') onValue({ k: 'str', v: text })
  }

  const actions: Array<{
    id: NodeAction
    label: string
    icon: React.ReactNode
    key?: string
    danger?: boolean
  }> = readOnly
    ? []
    : [
        {
          id: 'replace',
          label: t('features.fn.act.replace'),
          icon: <Replace size={14} />,
          key: 'A–Z',
        },
        {
          id: 'wrap',
          label: t('features.fn.act.wrap'),
          icon: <ArrowDownToLine size={14} />,
        },
        ...(node.k === 'call'
          ? [
              {
                id: 'unwrap' as const,
                label: t('features.fn.act.unwrap'),
                icon: <ArrowUpFromLine size={14} />,
              },
            ]
          : []),
        ...(canAdd
          ? [
              {
                id: 'addArg' as const,
                label: t('features.fn.act.addArg'),
                icon: <Plus size={14} />,
                key: '+',
              },
            ]
          : []),
        ...(canRemove
          ? [
              {
                id: 'removeArg' as const,
                label: t('features.fn.act.removeArg'),
                icon: <Minus size={14} />,
              },
            ]
          : []),
        {
          id: 'delete',
          label: t('features.fn.act.delete'),
          icon: <Eraser size={14} />,
          key: '⌫',
          danger: true,
        },
      ]

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('button') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    items[next]?.focus()
  }

  const kindLabel =
    node.k === 'call'
      ? isOperator(node.fn)
        ? t('features.fn.kind.op')
        : spec?.kind === 'custom'
          ? t('features.fn.kind.custom')
          : `${t('features.fn.kind.fn')}${spec ? ` · ${t(`features.fn.cat.${spec.category}`)}` : ''}`
      : t(`features.fn.kind.${node.k}`)

  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-start" className="fx-menu" aria-label={kindLabel}>
      <div className="fx-menu__head">
        <span className="label">{kindLabel}</span>
        {node.k === 'call' && (
          <div className="fx-menu__sig mono">
            {isOperator(node.fn) ? `a ${OPERATOR_KEYS[node.fn as keyof typeof OPERATOR_KEYS]?.key ?? node.fn} b` : signature(node.fn, spec?.args ?? [])}
          </div>
        )}
        {node.k === 'call' && spec && (
          <p className="fx-menu__desc">
            {isOperator(node.fn) ? t(`features.fn.op.${OPERATOR_KEYS[node.fn as keyof typeof OPERATOR_KEYS]?.id}`) : describe(spec, lang) || t('features.fn.noDesc')}
          </p>
        )}
        {node.k === 'call' && !spec && <p className="fx-menu__desc fx-menu__desc--warn">{t('features.fn.issue.unknown', { name: node.fn })}</p>}
        {node.k === 'param' && <div className="fx-menu__sig mono">{node.name}</div>}
      </div>
      {(node.k === 'num' || node.k === 'str') && !readOnly && (
        <form
          className="fx-menu__value"
          onSubmit={(e) => {
            e.preventDefault()
            commit()
          }}
        >
          <input
            className="input fx-menu__input"
            value={text}
            data-autofocus=""
            inputMode={node.k === 'num' ? 'decimal' : undefined}
            aria-label={t('features.fn.value')}
            aria-invalid={!numOk || undefined}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn--sm btn--primary" disabled={!numOk} aria-label={t('features.fn.apply')}>
            <CornerDownLeft size={13} />
          </button>
        </form>
      )}
      {node.k === 'bool' && !readOnly && (
        <div className="fx-menu__bool" role="radiogroup" aria-label={t('features.fn.value')}>
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={node.v === v}
              data-autofocus={node.v === v ? '' : undefined}
              className="btn btn--sm"
              onClick={() => onValue({ k: 'bool', v })}
            >
              {v ? t('features.fn.yes') : t('features.fn.no')}
            </button>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="fx-menu__list" ref={listRef} onKeyDown={onListKey}>
          {actions.map((a) => (
            <button key={a.id} type="button" className={`menu-item${a.danger ? ' menu-item--danger' : ''}`} data-action={a.id} onClick={() => onAction(a.id)}>
              <span className="menu-item__icon">{a.icon}</span>
              <span className="menu-item__label">{a.label}</span>
              {a.key && <span className="menu-item__hint">{a.key}</span>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}
