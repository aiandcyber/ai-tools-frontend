import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { fetchCatalog, runTool, sendChat, type Download, type SearchHit, type SearchMeta, type Tool } from './api'
import { useOptionalAuth } from './auth'
import { apiUrl, portalUrl } from './config'
import { CATEGORIES, CATEGORY_META, CategoryIcon, ToolGlyph, type CategoryId } from './icons'
import { LANGS, speechLang, t, type Lang } from './i18n'

type Rec = {
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: { results: { 0: { 0: { transcript: string } } } }) => void) | null
}

function browserLang(): Lang {
  const stored = localStorage.getItem('tools-lang')
  if (LANGS.some((item) => item.id === stored)) return stored as Lang
  const code = navigator.language.toLowerCase()
  const match = LANGS.find((item) => code.startsWith(item.id))
  return match?.id ?? 'en'
}

function speak(text: string, lang: Lang) {
  if (!('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = speechLang(lang)
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

export function App() {
  const auth = useOptionalAuth()
  const [lang, setLang] = useState<Lang>(browserLang)
  const [tools, setTools] = useState<Tool[]>([])
  const [category, setCategory] = useState<CategoryId>('search')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Tool | null>(null)
  const [message, setMessage] = useState('')
  const [downloads, setDownloads] = useState<Download[]>([])
  const [searchHits, setSearchHits] = useState<SearchHit[]>([])
  const [searchMeta, setSearchMeta] = useState<SearchMeta>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [chat, setChat] = useState<{ role: 'user' | 'assistant'; text: string }[]>([])
  const [draft, setDraft] = useState('')
  const [speakReplies, setSpeakReplies] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [assistantWidth, setAssistantWidth] = useState(() => {
    const saved = Number(localStorage.getItem('tools-assistant-width') || '420')
    return Number.isFinite(saved) ? Math.min(720, Math.max(300, saved)) : 420
  })
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    localStorage.setItem('tools-lang', lang)
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang
  }, [lang])

  useEffect(() => {
    localStorage.setItem('tools-assistant-width', String(assistantWidth))
  }, [assistantWidth])

  useEffect(() => {
    fetchCatalog().then((catalog) => {
      setTools(catalog.tools)
      const first = catalog.tools.find((tool) => tool.id === 'web_search')
        ?? catalog.tools.find((tool) => tool.category === 'search')
        ?? catalog.tools[0]
        ?? null
      setSelected(first)
    }).catch((exc: Error) => setLoadError(exc.message))
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const categories = category === 'search' ? ['search', 'ai'] : [category]
    return tools.filter((tool) => categories.includes(tool.category) && (
      !needle || tool.title.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle)
    ))
  }, [tools, category, query])

  function categoryLabel(id: CategoryId | string): string {
    return id === 'search' ? t(lang, 'searchCat') : t(lang, id)
  }

  function pickCategory(id: CategoryId) {
    setCategory(id)
    setMessage('')
    setError('')
    setSearchHits([])
    setSearchMeta({})
    setDownloads([])
    if (id === 'search') {
      setSelected(tools.find((tool) => tool.id === 'web_search') ?? tools.find((tool) => tool.category === 'ai') ?? null)
      return
    }
    const first = tools.find((tool) => tool.category === id) ?? null
    setSelected(first)
  }

  async function onRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const result = await runTool(selected.id, form)
      setMessage(result.message)
      setDownloads(result.downloads)
      setSearchHits(result.results || [])
      setSearchMeta(result.meta || {})
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Request failed')
      setSearchHits([])
      setSearchMeta({})
    } finally {
      setBusy(false)
    }
  }

  async function onChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setChat((items) => [...items, { role: 'user', text }])
    const form = new FormData(event.currentTarget)
    form.set('message', text)
    form.set('language', lang)
    setBusy(true)
    try {
      const result = await sendChat(form)
      setChat((items) => [...items, { role: 'assistant', text: result.reply }])
      setDownloads(result.downloads)
      if (speakReplies) speak(result.reply, lang)
    } catch (exc) {
      const detail = exc instanceof Error ? exc.message : 'Request failed'
      setChat((items) => [...items, { role: 'assistant', text: detail }])
    } finally {
      setBusy(false)
    }
  }

  function onVoice() {
    const ctor = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition
    if (!ctor) {
      setError('This browser has no speech recognition')
      return
    }
    const recognition = new ctor()
    recognition.lang = speechLang(lang)
    recognition.onresult = (event) => setDraft(event.results[0][0].transcript)
    recognition.start()
  }

  function onResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: assistantWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const next = dragRef.current.startWidth + (dragRef.current.startX - event.clientX)
    setAssistantWidth(Math.min(720, Math.max(300, next)))
  }

  function onResizeEnd() {
    dragRef.current = null
  }

  const accent = CATEGORY_META[category]

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={portalUrl()}>
          <span className="brand-mark" aria-hidden="true">AI</span>
          <span>
            <strong>{t(lang, 'portal')}</strong>
            <small>{t(lang, 'brand')}</small>
          </span>
        </a>
        <h1 className="site-headline">{t(lang, 'headline')}</h1>
        <div className="top-actions">
          <label className="field-inline">
            {t(lang, 'language')}
            <select value={lang} onChange={(event) => setLang(event.target.value as Lang)}>
              {LANGS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {auth.configured && (
            <button type="button" className="btn-secondary" onClick={auth.isAuthenticated ? auth.logout : auth.login}>
              {auth.isAuthenticated ? t(lang, 'signOut') : t(lang, 'signIn')}
            </button>
          )}
        </div>
      </header>

      <section className="category-band">
        <div className="category-grid" role="tablist" aria-label="Tool categories">
          {CATEGORIES.map((id) => {
            const meta = CATEGORY_META[id]
            const active = id === category
            const label = categoryLabel(id)
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`category-card ${active ? 'on' : ''} ${id === 'search' ? 'search-card' : ''}`}
                style={{
                  ['--accent' as string]: meta.accent,
                  ['--soft' as string]: meta.soft,
                }}
                onClick={() => pickCategory(id)}
              >
                <span className="category-icon"><CategoryIcon id={id} /></span>
                <span className="category-label">{label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="workspace" style={{ ['--assistant-width' as string]: `${assistantWidth}px` }}>
        <aside className="catalog">
          <div className="catalog-head" style={{ borderColor: accent.accent }}>
            <ToolGlyph category={category} />
            <div>
              <strong>{categoryLabel(category)}</strong>
              <span>{visible.length} tools</span>
            </div>
          </div>
          <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(lang, 'search')} />
          <ul>
            {visible.map((tool) => (
              <li key={tool.id}>
                <button
                  type="button"
                  className={selected?.id === tool.id ? 'on' : ''}
                  onClick={() => { setSelected(tool); setMessage(''); setError(''); setSearchHits([]); setSearchMeta({}); setDownloads([]) }}
                >
                  <ToolGlyph category={tool.category} />
                  <span>
                    <strong>{tool.title}</strong>
                    <em>{tool.description}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {loadError && <p className="error">{loadError}</p>}
        </aside>

        <main className="panel">
          {!selected && <p className="empty">{t(lang, 'empty')}</p>}
          {selected && selected.id === 'web_search' && (
            <form
              key={selected.id}
              className={`google-search${searchHits.length ? ' has-results' : ''}`}
              onSubmit={onRun}
            >
              <h2>{selected.title}</h2>
              <p className="search-subtitle">{t(lang, 'searchSubtitle')}</p>
              <div className="google-box">
                <span className="google-icon" aria-hidden="true">
                  <CategoryIcon id="search" />
                </span>
                <input
                  name="query"
                  type="text"
                  required
                  autoFocus
                  placeholder={t(lang, 'searchPlaceholder')}
                  aria-label={selected.title}
                />
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? t(lang, 'working') : t(lang, 'searchAction')}
                </button>
              </div>
              <div className="search-controls">
                <label>
                  {t(lang, 'searchMode')}
                  <select name="mode" defaultValue="auto">
                    <option value="auto">{t(lang, 'modeAuto')}</option>
                    <option value="person">{t(lang, 'modePerson')}</option>
                    <option value="topic">{t(lang, 'modeTopic')}</option>
                  </select>
                </label>
                <label>
                  {t(lang, 'searchRegion')}
                  <select name="region" defaultValue="SG">
                    <option value="SG">Singapore</option>
                    <option value="IN">India</option>
                    <option value="MY">Malaysia</option>
                    <option value="US">United States</option>
                    <option value="GB">United Kingdom</option>
                    <option value="AU">Australia</option>
                    <option value="GLOBAL">Global</option>
                  </select>
                </label>
                <input type="hidden" name="language" value={lang} />
              </div>
              {error && <p className="error">{error}</p>}
              {message && <p className="ok">{t(lang, 'result')}: {message}</p>}
              <SearchMetaBar meta={searchMeta} />
              <SearchResults items={searchHits} />
            </form>
          )}
          {selected && selected.id !== 'web_search' && (
            <form key={selected.id} className="tool-form" onSubmit={onRun}>
              <div className="tool-hero" style={{ background: `linear-gradient(135deg, ${accent.soft}, #ffffff 60%)` }}>
                <ToolGlyph category={selected.category} />
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                </div>
              </div>
              {selected.accept && (
                <label className="block">
                  {t(lang, 'upload')}
                  <input name="files" type="file" accept={selected.accept} multiple={selected.multiple} />
                </label>
              )}
              {selected.fields.map((field) => (
                <label key={field.name} className="block">
                  {field.label}
                  {field.kind === 'textarea' ? (
                    <textarea name={field.name} defaultValue={field.default} required={field.required} rows={6} />
                  ) : field.kind === 'select' ? (
                    <select name={field.name} defaultValue={field.default}>
                      {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input name={field.name} type={field.kind} defaultValue={field.default} required={field.required} />
                  )}
                </label>
              ))}
              <button type="submit" className="btn-primary" disabled={busy} style={{ background: accent.accent }}>
                {busy ? t(lang, 'working') : t(lang, 'run')}
              </button>
              {error && <p className="error">{error}</p>}
              {message && <p className="ok">{t(lang, 'result')}: {message}</p>}
              <DownloadList items={downloads} />
            </form>
          )}
        </main>

        <div
          className="resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
        />

        <aside className="assistant">
          <div className="assistant-head">
            <h2>{t(lang, 'assistant')}</h2>
            <label className="check">
              <input type="checkbox" checked={speakReplies} onChange={(event) => setSpeakReplies(event.target.checked)} />
              {t(lang, 'speak')}
            </label>
          </div>
          <div className="thread">
            {chat.length === 0 && <p className="empty-thread">{t(lang, 'placeholder')}</p>}
            {chat.map((item, index) => (
              <div key={index} className={`bubble ${item.role}`}>{item.text}</div>
            ))}
          </div>
          <form className="assistant-form" onSubmit={onChat}>
            <textarea name="draft" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t(lang, 'placeholder')} rows={3} />
            <input name="files" type="file" multiple />
            <div className="row">
              <button type="button" className="btn-secondary" onClick={onVoice}>{t(lang, 'voice')}</button>
              <button type="submit" className="btn-primary" disabled={busy}>{t(lang, 'send')}</button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  )
}

function DownloadList({ items }: { items: Download[] }) {
  if (!items.length) return null
  return (
    <ul className="downloads">
      {items.map((item) => (
        <li key={item.url}><a href={apiUrl(item.url)}>{item.name}</a></li>
      ))}
    </ul>
  )
}

function SearchMetaBar({ meta }: { meta: SearchMeta }) {
  if (!meta.mode && !meta.region_label) return null
  const blocked = (meta.unresponsive || [])
    .filter((item) => item.engine)
    .slice(0, 4)
    .map((item) => `${item.engine}: ${item.reason || item.error || 'unavailable'}`)
  return (
    <div className="search-meta">
      <span className="pill">{meta.mode || 'auto'}</span>
      {meta.region_label ? <span className="pill region">{meta.region_label}</span> : null}
      {(meta.categories || []).map((category) => (
        <span key={category} className="pill soft">{category}</span>
      ))}
      {blocked.length ? (
        <span className="search-warn" title={blocked.join('\n')}>
          Some engines unavailable
        </span>
      ) : null}
    </div>
  )
}

function SearchResults({ items }: { items: SearchHit[] }) {
  if (!items.length) return null
  return (
    <ol className="search-results">
      {items.map((hit) => {
        const host = hit.host || (() => {
          try {
            return new URL(hit.url).hostname.replace(/^www\./, '')
          } catch {
            return hit.url
          }
        })()
        return (
          <li key={`${hit.url}-${hit.category || ''}`}>
            <a href={hit.url} target="_blank" rel="noopener noreferrer" className="search-hit">
              <span className="search-host">
                {host}
                {(hit.categories || (hit.category ? [hit.category] : [])).slice(0, 2).map((category) => (
                  <em key={category}>{category}</em>
                ))}
                {(hit.reasons || []).includes('regional') ? <em className="regional">local</em> : null}
              </span>
              <span className="search-title">{hit.title}</span>
              {hit.snippet ? <span className="search-snippet">{hit.snippet}</span> : null}
            </a>
          </li>
        )
      })}
    </ol>
  )
}
