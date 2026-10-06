/**
 * Media cards: what an MCP server returned (images, videos, audio), one card each — host, file type and size
 * when known, never the picture itself from the web (nothing loads before "Save to One"; inline bytes from the
 * result and files already saved here show a small preview, they are on this device).
 *
 *  - "Save to One" (+ "Save all") → save.ts → `onSaved(saved)`: the host puts the blocks where the request came
 *    from (AI menu: at the selection; terminal: a staged change; ⌘K: the page).
 *  - `pick` (generated results): compact cards with a checkbox and "Preview" (a click fetches the picture and
 *    shows it from memory — nothing is stored); the host's key saves the picked ones (GeneratePanel).
 *  - Refused by the host (CORS): Open (a new tab) · Upload a copy · in a team workspace "Fetch through the team
 *    server". Wrong type / not what the bytes say / too large: said plainly, nothing stored.
 */
import { useId, useMemo, useState } from 'react'
import { AudioLines, Check, CloudDownload, Download, ExternalLink, Eye, Film, ImageIcon, Upload } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useFileUrl } from '../../../lib/files'
import { useCloud } from '../../../cloud'
import { previewCard, previewCards, saveCard, saveCards, type SaveWay } from './actions'
import { setPicked, useMediaCards, type CardState, type PreviewState } from './state'
import { teamFetchAvailable } from './save'
import type { MediaItem, SavedMedia } from './types'
import './media.css'

export interface MediaCardsProps {
  items: MediaItem[]
  /** the saved media, in order — the host inserts them (resolves once they are in) */
  onSaved: (saved: SavedMedia[]) => void | Promise<void>
  /** generated variants: a checkbox and "Preview" per card; the host's key saves the picked ones */
  pick?: boolean
  /** the media go into a private page (team: a fetched file stays private too) */
  privateTarget?: boolean
  /** nothing can be saved right now (a read-only workspace, a run still going) */
  disabled?: boolean
  /** where the media go, for the head line ("into this page", "staged for review") */
  where?: string
}

const ICON = { image: ImageIcon, video: Film, audio: AudioLines } as const
const RASTER = /^image\/(png|jpeg|gif|webp|avif)$/

/** "PNG", "MP4" … from the type or the address; else the kind. */
export function typeLabel(item: MediaItem): string {
  const fromMime = item.mime?.split('/')[1]?.replace(/^(x-|vnd\.)/, '').replace('+xml', '').replace('jpeg', 'jpg')
  if (fromMime) return fromMime.toUpperCase()
  const ext = item.url ? /\.([a-z0-9]{2,5})$/i.exec(new URL(item.url).pathname)?.[1] : ''
  return (ext || item.kind).toUpperCase()
}

export function formatSize(bytes: number | null, lang: string): string {
  if (!bytes) return ''
  const f = (n: number, d: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: d })
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${f(bytes / 1024, 0)} KB`
  return `${f(bytes / 1024 / 1024, 1)} MB`
}

export function MediaCards({ items, onSaved, pick, privateTarget, disabled, where }: MediaCardsProps) {
  const t = useT()
  const headId = useId()
  const cards = useMediaCards((s) => s.cards)
  const picked = useMediaCards((s) => s.picked)
  const previews = useMediaCards((s) => s.previews)
  const [busy, setBusy] = useState(false)
  // re-render when the team connection changes (Fetch through the team server comes and goes)
  useCloud((s) => `${s.status}:${s.readOnly}`)
  const team = teamFetchAvailable()
  const open = items.filter((x) => (cards[x.id]?.state ?? 'idle') !== 'saved')
  const chosen = pick ? open.filter((x) => picked[x.id]) : open
  /** pictures without a preview yet (pick mode: "Preview all") */
  const unseen = open.filter((x) => x.kind === 'image' && !previews[x.id] && cards[x.id]?.state !== 'failed' && !x.data)

  const deliver = async (list: Array<SavedMedia | null>) => {
    const saved = list.filter((x): x is SavedMedia => !!x)
    if (saved.length) await onSaved(saved)
  }

  const saveOne = async (item: MediaItem, way: SaveWay) => {
    const saved = await saveCard(item, way, { privateTarget, n: items.indexOf(item) + 1 })
    if (saved && pick) setPicked(item.id, false)
    await deliver([saved])
  }

  const saveMany = async () => {
    if (busy || !chosen.length) return
    setBusy(true)
    try {
      const out = await saveCards(chosen, { privateTarget, all: items })
      for (const s of out) if (pick) setPicked(s.itemId, false)
      await deliver(out)
    } finally {
      setBusy(false)
    }
  }

  if (!items.length) return null
  return (
    <section className="media-cards" aria-labelledby={headId} data-testid="media-cards" data-pick={pick || undefined}>
      <div className="media-cards__head">
        <span className="label media-cards__title" id={headId}>
          {t(pick ? 'features.ai.media.variants' : 'features.ai.media.title', { count: items.length })}
        </span>
        <span className="media-cards__note">
          {t(pick ? 'features.ai.media.notLoadedPick' : 'features.ai.media.notLoaded')}
          {where ? ` ${where}` : ''}
        </span>
        {pick
          ? unseen.length > 1 && (
              <button type="button" className="btn btn--sm btn--ghost media-cards__all" disabled={disabled} onClick={() => void previewCards(unseen)} data-testid="media-preview-all">
                <Eye size={13} strokeWidth={1.75} aria-hidden />
                {t('features.ai.media.previewAll')}
              </button>
            )
          : items.length > 1 && (
              <button type="button" className="btn btn--sm btn--ink media-cards__all" disabled={disabled || busy || !chosen.length} onClick={() => void saveMany()} data-testid="media-save-all">
                <Download size={13} strokeWidth={1.75} aria-hidden />
                {t('features.ai.media.saveAll')}
              </button>
            )}
      </div>
      <ul className="media-cards__list">
        {items.map((item, i) => (
          <Card
            key={item.id}
            item={item}
            n={i + 1}
            card={cards[item.id] ?? { state: 'idle' }}
            preview={previews[item.id] ?? null}
            pick={pick}
            picked={!!picked[item.id]}
            team={team}
            disabled={disabled || busy}
            onSave={(way) => void saveOne(item, way)}
          />
        ))}
      </ul>
    </section>
  )
}

interface CardProps {
  item: MediaItem
  /** its place in the list (pick mode: "Result 2") */
  n: number
  card: CardState
  preview: PreviewState | null
  pick?: boolean
  picked: boolean
  team: boolean
  disabled?: boolean
  onSave: (way: SaveWay) => void
}

function Card({ item, n, card, preview: shown, pick, picked, team, disabled, onSave }: CardProps) {
  const t = useT()
  const lang = useLang()
  const Icon = ICON[item.kind]
  const savedUrl = useFileUrl(card.state === 'saved' && item.kind === 'image' ? card.src : null)
  // inline bytes from the result are on this device already: a raster preview loads nothing
  const inline = useMemo(() => (item.data && item.mime && RASTER.test(item.mime) ? `data:${item.mime};base64,${item.data}` : ''), [item.data, item.mime])
  const preview = savedUrl || shown?.url || inline
  const spec = [...(pick ? [t('features.ai.media.variant', { n })] : []), typeLabel(item), item.host, formatSize(item.size, lang)].filter(Boolean).join(' · ')
  const what = item.prompt || item.tool
  const failed = card.state === 'failed'
  const cors = failed && (card.issue === 'cors' || card.issue === 'http' || card.issue === 'offline' || card.issue === 'server' || card.issue === 'blocked')
  const name = t('features.ai.media.cardLabel', { kind: t(`features.ai.media.kind.${item.kind}`), host: item.host })
  return (
    <li className="media-card" data-state={card.state} data-kind={item.kind} data-picked={picked || undefined} data-preview={preview ? '' : undefined} aria-label={name} data-testid="media-card" data-url={item.url ?? ''}>
      {pick && (
        <label className="media-card__pick">
          <input type="checkbox" checked={picked} disabled={card.state === 'saved' || card.state === 'saving'} onChange={(e) => setPicked(item.id, e.target.checked)} aria-label={t('features.ai.media.pick', { n: spec })} />
        </label>
      )}
      <span className="media-card__plate" aria-hidden>
        {preview ? <img src={preview} alt="" /> : <Icon size={18} strokeWidth={1.6} />}
      </span>
      <span className="media-card__body">
        <span className="media-card__spec label">{spec}</span>
        {/* generated results share the prompt and the server: the panel says them once */}
        {!pick && what && (
          <span className="media-card__what" title={what}>
            {what}
          </span>
        )}
        {!pick && (
          <span className="media-card__src label">
            {item.server.toUpperCase()}
            {item.tool ? ` · ${item.tool}` : ''}
            {item.from === 'answer' ? ` · ${t('features.ai.media.fromAnswer')}` : ''}
          </span>
        )}
        {failed && card.issue && (
          <span className="media-card__issue" role="alert" data-issue={card.issue}>
            {t(`features.ai.media.issue.${card.issue}`)}
          </span>
        )}
      </span>
      <span className="media-card__keys">
        {card.state === 'saved' ? (
          <span className="media-card__done label" data-testid="media-saved">
            <Check size={12} strokeWidth={2} aria-hidden /> {t('features.ai.media.saved')}
          </span>
        ) : pick && !failed ? (
          // picked results are saved with the panel's key; a picture can be looked at first
          item.kind === 'image' &&
          !preview && (
            <button type="button" className="btn btn--sm btn--ghost" disabled={disabled || shown?.state === 'loading'} onClick={() => void previewCard(item)} data-testid="media-preview">
              <Eye size={12} strokeWidth={1.75} aria-hidden /> {shown?.state === 'loading' ? t('features.ai.media.loading') : t('features.ai.media.preview')}
            </button>
          )
        ) : (
          <button type="button" className={`btn btn--sm ${pick ? 'btn--ghost' : 'btn--primary'}`} disabled={disabled || card.state === 'saving'} onClick={() => onSave('browser')} data-testid="media-save">
            {card.state === 'saving' ? t('features.ai.media.saving') : failed ? t('features.ai.media.retry') : t('features.ai.media.save')}
          </button>
        )}
        {cors && item.url && (
          <a className="btn btn--sm btn--ghost" href={item.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-testid="media-open">
            <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t('features.ai.media.open')}
          </a>
        )}
        {failed && card.issue !== 'type' && card.issue !== 'mismatch' && (
          <button type="button" className="btn btn--sm btn--ghost" disabled={disabled} onClick={() => onSave('upload')} data-testid="media-upload">
            <Upload size={12} strokeWidth={1.75} aria-hidden /> {t('features.ai.media.upload')}
          </button>
        )}
        {cors && team && item.url && (
          <button type="button" className="btn btn--sm btn--ghost" disabled={disabled} onClick={() => onSave('team')} data-testid="media-team">
            <CloudDownload size={12} strokeWidth={1.75} aria-hidden /> {t('features.ai.media.team')}
          </button>
        )}
      </span>
    </li>
  )
}
