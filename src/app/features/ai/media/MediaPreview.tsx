/**
 * The media of a staged "insert media" change (AI terminal review, custom agents' runs): what goes into the
 * page — kind, name, size and a small preview of saved images (they are on this device: nothing loads from the web).
 */
import { AudioLines, File, Film, ImageIcon } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useFileUrl } from '../../../lib/files'
import { formatSize } from './MediaCards'
import type { StagedMedia } from '../agent/types'
import './media.css'

const ICON = { image: ImageIcon, video: Film, audio: AudioLines, file: File } as const

export function MediaPreview({ media }: { media: StagedMedia[] }) {
  const t = useT()
  return (
    <ul className="media-preview" aria-label={t('features.ai.media.review.list')}>
      {media.map((m, i) => (
        <Item key={`${m.src}-${i}`} m={m} />
      ))}
    </ul>
  )
}

function Item({ m }: { m: StagedMedia }) {
  const t = useT()
  const lang = useLang()
  const url = useFileUrl(m.kind === 'image' ? m.src : null)
  const Icon = ICON[m.kind]
  return (
    <li className="media-preview__item">
      <span className="media-preview__plate" aria-hidden>
        {url ? <img src={url} alt="" /> : <Icon size={14} strokeWidth={1.7} />}
      </span>
      <span className="media-preview__name" title={m.caption || m.name}>
        {m.name}
      </span>
      <span className="media-preview__meta">{[t(`features.ai.media.kind.${m.kind}`), formatSize(m.size, lang)].filter(Boolean).join(' · ')}</span>
    </li>
  )
}
