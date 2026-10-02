import { useState } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Popover } from '../../ui/Popover'
import { IconPicker } from '../../ui/IconPicker'
import { resolveAssetUrl } from '../../lib/files'
import { COLOR_NAMES, type ColorName } from '../../store/types'
import { useT } from '../../i18n'

export function CalloutIcon({ icon }: { icon: unknown }) {
  if (typeof icon === 'string' && icon.startsWith('asset:'))
    return <img src={resolveAssetUrl(`assets/icons/${icon.slice(6)}.webp`)} alt="" width={22} height={22} draggable={false} />
  const text = typeof icon === 'string' ? icon : icon && typeof icon === 'object' && 'value' in icon ? String((icon as { value: string }).value) : '💡'
  return <span>{text || '💡'}</span>
}

export function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const color = (node.attrs.color as ColorName) || 'gray'
  return (
    <NodeViewWrapper className={`callout callout--${color}`} data-type="callout" data-color={color}>
      <button
        type="button"
        className="callout__icon"
        contentEditable={false}
        aria-label={t('editor.callout.icon')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => editor.isEditable && setAnchor(e.currentTarget)}
      >
        <CalloutIcon icon={node.attrs.icon} />
      </button>
      <NodeViewContent className="callout__body" />
      <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} bare autoFocus={false} className="callout-popover">
        <div className="callout-popover__colors" role="radiogroup" aria-label={t('common.color')}>
          <span className="label">{t('common.color')}</span>
          <div className="callout-popover__swatches">
            {/* "default" and "gray" are the same placard — offer it once */}
            {COLOR_NAMES.filter((c) => c !== 'default').map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color || (c === 'gray' && color === 'default')}
                className="swatch"
                title={t(`color.${c}`)}
                style={{ background: c === 'gray' ? 'var(--surface-2)' : `var(--c-${c}-bg)`, color: `var(--c-${c}-text)` }}
                onClick={() => updateAttributes({ color: c })}
              >
                A
              </button>
            ))}
          </div>
        </div>
        <IconPicker
          onSelect={(icon) => {
            updateAttributes({ icon: icon.type === 'asset' ? `asset:${icon.value}` : icon.value })
            setAnchor(null)
          }}
        />
      </Popover>
    </NodeViewWrapper>
  )
}
