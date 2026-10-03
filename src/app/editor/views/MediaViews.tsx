import { useRef, useState, type ReactNode } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Bookmark as BookmarkIcon, Download, ExternalLink, Link2, MonitorPlay, Paperclip, Pencil, Upload } from 'lucide-react'
import { saveFile, useFileUrl } from '../../lib/files'
import { useT } from '../../i18n'
import { detectProvider, domainOf, embedRatio, embedSrc, parseUrl, PROVIDER_LABEL, safeDecode, safeHref, webUrl, type EmbedProvider } from '../lib/embeds'
import { pickFiles } from '../lib/upload'
import { caretAfterNode, leaveNodeView } from '../lib/blocks'

/** Inline URL form used by empty bookmark / embed blocks. */
function UrlForm({ icon, label, placeholder, autoFocus, onSubmit, hint, submit }: { icon: ReactNode; label: string; placeholder: string; autoFocus: boolean; onSubmit: (url: string) => string | null; hint?: string; submit: string }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="media-empty__inner">
      <div className="media-empty__head">
        {icon}
        <span className="label">{label}</span>
      </div>
      <form
        className="media-empty__form"
        onSubmit={(e) => {
          e.preventDefault()
          setError(onSubmit(value.trim()))
        }}
      >
        <input className="input" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
        <button type="submit" className="btn btn--sm btn--ink" disabled={!value.trim()}>
          {submit}
        </button>
      </form>
      {(error || hint) && <div className={`media-empty__hint${error ? ' is-error' : ''}`}>{error ?? hint}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function BookmarkView({ node, updateAttributes, selected, editor, getPos }: ReactNodeViewProps) {
  const t = useT()
  const url = String(node.attrs.url ?? '')
  const title = (node.attrs.title as string | null) ?? ''
  const description = (node.attrs.description as string | null) ?? ''
  const [editingTitle, setEditingTitle] = useState(false)
  const cancelTitle = useRef(false)

  if (!url) {
    return (
      <NodeViewWrapper className={`media-empty${selected ? ' is-selected' : ''}`} data-type="bookmark" contentEditable={false}>
        {editor.isEditable ? (
          <UrlForm
            icon={<BookmarkIcon size={16} strokeWidth={1.7} />}
            label={t('editor.bookmark.empty')}
            placeholder={t('editor.bookmark.placeholder')}
            submit={t('editor.media.add')}
            autoFocus={selected}
            onSubmit={(v) => {
              // web pages only — never javascript:, data: …
              const u = webUrl(v)
              if (!u) return t('editor.embed.invalid')
              updateAttributes({ url: u.toString(), title: null })
              caretAfterNode(editor, getPos(), { newLine: true })
              return null
            }}
          />
        ) : (
          <span className="label">{t('editor.bookmark.empty')}</span>
        )}
      </NodeViewWrapper>
    )
  }

  const domain = domainOf(url)
  const u = parseUrl(url)
  const href = safeHref(url) ?? undefined
  const path = u ? safeDecode(u.pathname + u.search).replace(/\/$/, '') : ''
  return (
    <NodeViewWrapper className={`bookmark-card${selected ? ' is-selected' : ''}`} data-type="bookmark" contentEditable={false}>
      <a className="bookmark-card__main" href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => (editingTitle || !href) && e.preventDefault()} draggable={false}>
        <span className="bookmark-card__text">
          {editingTitle ? (
            <input
              className="bookmark-card__title-input"
              defaultValue={title || domain}
              autoFocus
              onClick={(e) => e.preventDefault()}
              onBlur={(e) => {
                if (!cancelTitle.current) updateAttributes({ title: e.currentTarget.value.trim() || null })
                cancelTitle.current = false
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== 'Escape') return
                e.preventDefault()
                e.stopPropagation()
                cancelTitle.current = e.key === 'Escape'
                // leaving the input blurs it, which commits (or cancels)
                leaveNodeView(editor, getPos(), e.key === 'Enter' ? 'enter' : 'escape')
              }}
            />
          ) : (
            <span className="bookmark-card__title">{title || domain}</span>
          )}
          {description && <span className="bookmark-card__desc">{description}</span>}
          <span className="bookmark-card__url">
            <Link2 size={12} strokeWidth={1.75} />
            <span>{domain}</span>
            {path && path !== '/' && <span className="faint">{path}</span>}
          </span>
        </span>
        <span className="bookmark-card__plate" aria-hidden>
          <span className="bookmark-card__mono">{domain.replace(/^www\./, '').charAt(0).toUpperCase()}</span>
          <span className="label">{domain.split('.').slice(-2).join('.')}</span>
        </span>
      </a>
      {editor.isEditable && !editingTitle && (
        <button type="button" className="icon-btn icon-btn--sm bookmark-card__edit" title={t('editor.bookmark.editTitle')} onClick={() => setEditingTitle(true)}>
          <Pencil size={12} />
        </button>
      )}
    </NodeViewWrapper>
  )
}

/* ------------------------------------------------------------------ */

export function EmbedView({ node, updateAttributes, selected, editor, getPos }: ReactNodeViewProps) {
  const t = useT()
  const url = String(node.attrs.url ?? '')
  const provider = ((node.attrs.provider as EmbedProvider | null) || detectProvider(url) || 'web') as EmbedProvider

  if (!url) {
    return (
      <NodeViewWrapper className={`media-empty${selected ? ' is-selected' : ''}`} data-type="embed" contentEditable={false}>
        {editor.isEditable ? (
          <UrlForm
            icon={<MonitorPlay size={16} strokeWidth={1.7} />}
            label={t('editor.embed.empty')}
            placeholder={t('editor.embed.placeholder')}
            hint={t('editor.embed.hint')}
            submit={t('editor.embed.submit')}
            autoFocus={selected}
            onSubmit={(v) => {
              const p = detectProvider(v) ?? 'web'
              if (!embedSrc(v, p)) return t('editor.embed.invalid')
              updateAttributes({ url: parseUrl(v)!.toString(), provider: p })
              caretAfterNode(editor, getPos(), { newLine: true })
              return null
            }}
          />
        ) : (
          <span className="label">{t('editor.embed.empty')}</span>
        )}
      </NodeViewWrapper>
    )
  }

  const src = embedSrc(url, provider)
  const toBookmark = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: 'bookmark', attrs: { url } }).run()
  }
  return (
    <NodeViewWrapper className={`embed-view${selected ? ' is-selected' : ''}`} data-type="embed" data-provider={provider} contentEditable={false}>
      <div className="embed-view__bar">
        <span className="led led--on" />
        <span className="label">{PROVIDER_LABEL[provider] ?? 'Embed'}</span>
        <span className="embed-view__domain">{domainOf(url)}</span>
        <span style={{ flex: 1 }} />
        {editor.isEditable && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={toBookmark} title={t('editor.embed.toBookmark')}>
            <BookmarkIcon size={12} />
          </button>
        )}
        <a className="btn btn--ghost btn--sm" href={safeHref(url) ?? undefined} target="_blank" rel="noopener noreferrer" title={t('common.open')}>
          <ExternalLink size={12} />
        </a>
      </div>
      <div className="embed-view__frame" style={{ paddingTop: `${embedRatio(provider) * 100}%` }}>
        {src ? (
          <iframe
            src={src}
            title={`${PROVIDER_LABEL[provider]} — ${domainOf(url)}`}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="embed-view__error label">{t('editor.embed.invalid')}</div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

/* ------------------------------------------------------------------ */

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export function FileBlockView({ node, updateAttributes, selected, editor, getPos }: ReactNodeViewProps) {
  const t = useT()
  const src = String(node.attrs.src ?? '')
  const name = String(node.attrs.name ?? 'file')
  const size = Number(node.attrs.size ?? 0)
  const url = useFileUrl(src || null)

  const upload = async () => {
    const [file] = await pickFiles('*/*')
    if (!file) return
    const ref = await saveFile(file, file.name)
    updateAttributes({ src: ref, name: file.name, size: file.size })
    leaveNodeView(editor, getPos(), 'escape')
  }

  if (!src) {
    return (
      <NodeViewWrapper className={`media-empty${selected ? ' is-selected' : ''}`} data-type="file" contentEditable={false}>
        <div className="media-empty__head">
          <Paperclip size={16} strokeWidth={1.7} />
          <span className="label">{t('editor.file.empty')}</span>
        </div>
        {editor.isEditable && (
          <div className="media-empty__body">
            <button type="button" className="btn btn--sm" onClick={upload} autoFocus={selected}>
              <Upload size={13} /> {t('editor.file.upload')}
            </button>
          </div>
        )}
      </NodeViewWrapper>
    )
  }

  const ext = (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'file').toUpperCase()
  return (
    <NodeViewWrapper className={`file-view${selected ? ' is-selected' : ''}`} data-type="file" contentEditable={false}>
      <span className="file-view__tile" aria-hidden>
        <span>{ext}</span>
      </span>
      <span className="file-view__meta">
        <span className="file-view__name">{name}</span>
        <span className="file-view__size">{formatBytes(size)}</span>
      </span>
      <a className="btn btn--sm" href={url || undefined} download={name} aria-disabled={!url} onClick={(e) => !url && e.preventDefault()}>
        <Download size={13} /> {t('editor.file.download')}
      </a>
    </NodeViewWrapper>
  )
}
