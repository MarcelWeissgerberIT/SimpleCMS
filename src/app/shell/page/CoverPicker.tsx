import { useEffect, useRef, useState } from 'react'
import { ImageUp, Link2, Trash2 } from 'lucide-react'
import { Popover } from '../../ui/Popover'
import { COLOR_NAMES, type PageCover } from '../../store/types'
import { resolveAssetUrl, saveFile } from '../../lib/files'
import { colorBg } from '../../lib/colors'
import { useT } from '../../i18n'
import { useInCloud } from '../cloud/state'
import { GRADIENTS, coverAssetPath, loadCoverManifest, type CoverManifestEntry } from './covers'

type Tab = 'gallery' | 'upload' | 'link'

export function CoverPicker({ anchor, onClose, onPick, onRemove, hasCover }: { anchor: Element | null; onClose: () => void; onPick: (c: PageCover) => void; onRemove: () => void; hasCover: boolean }) {
  const t = useT()
  const inCloud = useInCloud()
  const [tab, setTab] = useState<Tab>('gallery')
  const [covers, setCovers] = useState<CoverManifestEntry[] | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (anchor) loadCoverManifest(resolveAssetUrl).then(setCovers)
  }, [anchor])

  const upload = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    setBusy(true)
    try {
      const ref = await saveFile(file, file.name)
      onPick({ type: 'image', value: ref, positionY: 50 })
    } finally {
      setBusy(false)
    }
  }

  const tabs: Array<[Tab, string]> = [
    ['gallery', t('shell.cover.gallery')],
    ['upload', t('shell.cover.upload')],
    ['link', t('shell.cover.link')],
  ]

  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="bottom-end" className="cp" aria-label={t('shell.cover.change')} role="dialog">
      <div className="cp-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="cp-tab" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {hasCover && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onRemove}>
            <Trash2 size={13} />
            {t('common.remove')}
          </button>
        )}
      </div>
      <div className="cp-body">
        {tab === 'gallery' && (
          <>
            {covers && covers.length > 0 && (
              <>
                <div className="label cp-label">{t('shell.cover.oneCovers')}</div>
                <div className="cp-grid">
                  {covers.map((c) => (
                    <button key={c.name} type="button" className="cp-swatch" title={c.label ?? c.name} onClick={() => onPick({ type: 'image', value: coverAssetPath(c), positionY: 50 })}>
                      <img src={resolveAssetUrl(coverAssetPath(c))} alt={c.label ?? c.name} loading="lazy" />
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="label cp-label">{t('shell.cover.patterns')}</div>
            <div className="cp-grid">
              {GRADIENTS.map((g) => (
                <button key={g.id} type="button" className="cp-swatch" title={t(`shell.cover.g.${g.id}`)} aria-label={t(`shell.cover.g.${g.id}`)} style={{ background: g.value }} onClick={() => onPick({ type: 'gradient', value: g.value, positionY: 50 })} />
              ))}
            </div>
            <div className="label cp-label">{t('shell.cover.colors')}</div>
            <div className="cp-grid cp-grid--colors">
              {COLOR_NAMES.filter((c) => c !== 'default').map((c) => (
                <button key={c} type="button" className="cp-swatch cp-swatch--color" title={t(`color.${c}`)} aria-label={t(`color.${c}`)} style={{ background: colorBg(c) }} onClick={() => onPick({ type: 'color', value: c, positionY: 50 })} />
              ))}
            </div>
          </>
        )}
        {tab === 'upload' && (
          <div
            className="cp-drop"
            data-over={dragOver || undefined}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void upload(e.dataTransfer.files?.[0])
            }}
          >
            <ImageUp size={22} strokeWidth={1.5} />
            <button type="button" className="btn btn--ink" disabled={busy} onClick={() => fileRef.current?.click()} data-autofocus="">
              {busy ? t('common.loading') : t('shell.cover.chooseFile')}
            </button>
            <span className="label">{t(inCloud ? 'shell.cover.uploadHintCloud' : 'shell.cover.uploadHint')}</span>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          </div>
        )}
        {tab === 'link' && (
          <form
            className="cp-link"
            onSubmit={(e) => {
              e.preventDefault()
              const v = url.trim()
              if (/^(https?:|data:image\/)/.test(v)) onPick({ type: 'image', value: v, positionY: 50 })
            }}
          >
            <div className="cp-link__row">
              <Link2 size={14} className="faint" />
              <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} data-autofocus="" />
            </div>
            <button type="submit" className="btn btn--primary" disabled={!/^(https?:|data:image\/)/.test(url.trim())}>
              {t('shell.cover.useLink')}
            </button>
            <span className="label">{t('shell.cover.linkHint')}</span>
          </form>
        )}
      </div>
    </Popover>
  )
}
