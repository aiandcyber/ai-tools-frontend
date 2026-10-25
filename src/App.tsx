import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  exportGeneratedText,
  fetchCatalog,
  formatApiError,
  formatYoutubeError,
  isBackendUnreachable,
  probeYoutube,
  runTool,
  sendChat,
  synthesizeSpeech,
  withBackendRetry,
  type Download,
  type SearchHit,
  type SearchMeta,
  type Tool,
  type YoutubeQuality,
} from './api'
import { useOptionalAuth } from './auth'
import { ContactPage } from './ContactPage'
import { apiUrl, portalUrl } from './config'
import { useRequireAuth } from './useRequireAuth'
import { CATEGORY_META, CategoryIcon, NAV_CATEGORIES, ToolGlyph, type NavCategoryId } from './icons'
import { LANGS, languageOptionLabel, speechLang, t, type Lang } from './i18n'
import { PROFILE_CODES, WORLD_REGIONS, regionLabel } from './regions'

type Rec = {
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: { results: { 0: { 0: { transcript: string } } } }) => void) | null
}

let activeAudio: HTMLAudioElement | null = null
let activeObjectUrl: string | null = null

/** Tools that always call OpenRouter / Gemini. TTS only needs login when it must translate first. */
const LLM_TOOL_IDS = new Set([
  'summarize',
  'translate',
  'rewrite',
  'generate_document',
  'classify',
  'stt',
])
const YOUTUBE_TOOL_IDS = new Set(['youtube_mp4', 'youtube_mp3'])
const YOUTUBE_USED_KEY = 'tools-youtube-used'

function isSignInRequiredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('sign in required') || msg.includes('invalid token') || msg.includes('"status":401')
}

function browserLang(): Lang {
  const stored = localStorage.getItem('tools-lang')
  if (LANGS.some((item) => item.id === stored)) return stored as Lang
  const code = navigator.language.toLowerCase()
  const match = LANGS.find((item) => code.startsWith(item.id))
  return match?.id ?? 'en'
}

function stopSpeech() {
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.src = ''
    activeAudio = null
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl)
    activeObjectUrl = null
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

async function speakEdge(text: string, lang: Lang, onEnd?: () => void) {
  stopSpeech()
  try {
    const url = await synthesizeSpeech(text, lang)
    activeObjectUrl = url
    const audio = new Audio(url)
    activeAudio = audio
    audio.onended = () => {
      stopSpeech()
      onEnd?.()
    }
    audio.onerror = () => {
      stopSpeech()
      onEnd?.()
    }
    await audio.play()
  } catch {
    // Fallback to browser TTS if edge-tts endpoint is unavailable
    if (!('speechSynthesis' in window)) {
      onEnd?.()
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = speechLang(lang)
    utterance.onend = () => onEnd?.()
    utterance.onerror = () => onEnd?.()
    window.speechSynthesis.speak(utterance)
  }
}

export function App() {
  const auth = useOptionalAuth()
  const ensureAuth = useRequireAuth()
  const [lang, setLang] = useState<Lang>(browserLang)
  const [tools, setTools] = useState<Tool[]>([])
  const [category, setCategory] = useState<NavCategoryId>(() => (
    window.location.pathname === '/contact' ? 'help' : 'ai'
  ))
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
  const [speaking, setSpeaking] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [openInfoId, setOpenInfoId] = useState<string | null>(null)
  const [regionMode, setRegionMode] = useState<'auto' | 'manual'>('auto')
  const [regionChoice, setRegionChoice] = useState('SG')
  const [regionCustom, setRegionCustom] = useState('')
  const [docFormat, setDocFormat] = useState('docx')
  const [docTemplate, setDocTemplate] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [contactPrefill, setContactPrefill] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const url = params.get('url') || ''
    return {
      url,
      topic: params.get('topic') || (url ? 'youtube' : 'new_tool'),
    }
  })
  const [assistantWidth, setAssistantWidth] = useState(() => {
    const saved = Number(localStorage.getItem('tools-assistant-width') || '420')
    return Number.isFinite(saved) ? Math.min(720, Math.max(300, saved)) : 420
  })
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const chatAbortRef = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    localStorage.setItem('tools-lang', lang)
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang === 'yue' ? 'zh-HK' : lang
  }, [lang])

  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname === '/contact') {
        const params = new URLSearchParams(window.location.search)
        const url = params.get('url') || ''
        setContactPrefill({
          url,
          topic: params.get('topic') || (url ? 'youtube' : 'new_tool'),
        })
        setCategory('help')
        setSelected(null)
        return
      }
      setCategory((current) => (current === 'help' ? 'ai' : current))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function openContact(youtubeUrl = '') {
    const params = new URLSearchParams()
    params.set('topic', 'youtube')
    if (youtubeUrl) params.set('url', youtubeUrl)
    window.history.pushState({}, '', `/contact?${params}`)
    setContactPrefill({ url: youtubeUrl, topic: 'youtube' })
    setCategory('help')
    setSelected(null)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const authError = params.get('error_description') || params.get('error')
    if (!authError) return
    setError(decodeURIComponent(authError.replace(/\+/g, ' ')))
    params.delete('error')
    params.delete('error_description')
    params.delete('state')
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
    window.history.replaceState({}, '', next)
  }, [])

  useEffect(() => {
    localStorage.setItem('tools-assistant-width', String(assistantWidth))
  }, [assistantWidth])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chat, busy])

  useEffect(() => () => {
    chatAbortRef.current?.abort()
    stopSpeech()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void withBackendRetry(
      () => fetchCatalog(controller.signal),
      {
        signal: controller.signal,
        onAttempt: (_attempt, error) => {
          setLoadError(formatApiError(error) + ' Reconnecting…')
        },
      },
    ).then((catalog) => {
      if (controller.signal.aborted) return
      setLoadError('')
      setTools(catalog.tools)
      const first = catalog.tools.find((tool) => tool.id === 'web_search')
        ?? catalog.tools.find((tool) => tool.category === 'search')
        ?? catalog.tools[0]
        ?? null
      setSelected(first)
    }).catch((exc: Error) => {
      if (controller.signal.aborted || exc.name === 'AbortError' || /aborted/i.test(exc.message)) return
      setLoadError(formatApiError(exc))
    })
    return () => controller.abort()
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Site-wide tool search (title, description, id, category).
    if (needle) {
      return tools.filter((tool) => (
        tool.title.toLowerCase().includes(needle)
        || tool.description.toLowerCase().includes(needle)
        || tool.id.toLowerCase().includes(needle)
        || tool.category.toLowerCase().includes(needle)
      ))
    }
    // AI home: AI tools only (web search is the main panel default, not listed again).
    if (category === 'ai') {
      return tools.filter((tool) => tool.category === 'ai')
    }
    return tools.filter((tool) => tool.category === category)
  }, [tools, category, query])

  function categoryLabel(id: NavCategoryId | string): string {
    return t(lang, id)
  }

  function pickCategory(id: NavCategoryId) {
    setCategory(id)
    setMessage('')
    setError('')
    setSearchHits([])
    setSearchMeta({})
    setDownloads([])
    setOpenInfoId(null)
    if (id === 'help') {
      window.history.pushState({}, '', '/contact')
      setContactPrefill({ url: '', topic: 'new_tool' })
      setSelected(null)
      return
    }
    if (window.location.pathname === '/contact') {
      window.history.pushState({}, '', '/')
    }
    if (id === 'ai') {
      setSelected(tools.find((tool) => tool.id === 'web_search') ?? tools.find((tool) => tool.category === 'ai') ?? null)
      return
    }
    const first = tools.find((tool) => tool.category === id) ?? null
    setSelected(first)
  }

  async function onRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    // Capture before any await — React nulls event.currentTarget after yield.
    const formEl = event.currentTarget
    if (LLM_TOOL_IDS.has(selected.id)) {
      if (!(await ensureAuth())) return
    }
    if (YOUTUBE_TOOL_IDS.has(selected.id) && !auth.isAuthenticated) {
      if (localStorage.getItem(YOUTUBE_USED_KEY) === '1') {
        setError(t(lang, 'youtubeSignInHint'))
        if (!(await ensureAuth())) return
      }
    }
    setBusy(true)
    setError('')
    if (YOUTUBE_TOOL_IDS.has(selected.id)) {
      localStorage.setItem(YOUTUBE_USED_KEY, '1')
    }
    try {
      let result
      try {
        result = await runTool(selected.id, new FormData(formEl))
      } catch (exc) {
        // TTS (and similar) may need login only when the server must call the LLM.
        if (!isSignInRequiredError(exc) || !(await ensureAuth())) throw exc
        result = await runTool(selected.id, new FormData(formEl))
      }
      setMessage(result.message)
      if (selected.id === 'summarize' || selected.id === 'rewrite') {
        setDownloads([])
      } else {
        setDownloads(result.downloads)
      }
      setSearchHits(result.results || [])
      setSearchMeta(result.meta || {})
    } catch (exc) {
      setError(YOUTUBE_TOOL_IDS.has(selected.id) ? formatYoutubeError(exc) : formatApiError(exc))
      setSearchHits([])
      setSearchMeta({})
    } finally {
      setBusy(false)
    }
  }

  async function onExportResult(format: string) {
    if (!message.trim()) return
    setExportBusy(true)
    setError('')
    try {
      const result = await exportGeneratedText(message, format)
      setDownloads((prev) => [...prev, ...result.downloads])
    } catch (exc) {
      setError(formatApiError(exc))
    } finally {
      setExportBusy(false)
    }
  }

  async function onChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    // Capture before any await — React nulls event.currentTarget after yield.
    const formEl = event.currentTarget
    if (!(await ensureAuth())) return
    setDraft('')
    setChat((items) => [...items, { role: 'user', text }])
    const form = new FormData(formEl)
    form.set('message', text)
    form.set('language', lang)
    chatAbortRef.current?.abort()
    const controller = new AbortController()
    chatAbortRef.current = controller
    setBusy(true)
    try {
      const result = await withBackendRetry(
        () => sendChat(form, controller.signal),
        {
          signal: controller.signal,
          maxAttempts: 4,
          baseDelayMs: 1500,
          onAttempt: (attempt, error) => {
            if (!isBackendUnreachable(error)) return
            setChat((items) => {
              const next = [...items]
              const notice = formatApiError(error) + ` Retry ${attempt}/3…`
              if (next.length && next[next.length - 1]?.role === 'assistant' && next[next.length - 1].text.includes('Backend unreachable')) {
                next[next.length - 1] = { role: 'assistant', text: notice }
                return next
              }
              return [...next, { role: 'assistant', text: notice }]
            })
          },
        },
      )
      setChat((items) => {
        const withoutRetry = items.filter((item) => !(item.role === 'assistant' && item.text.includes('Backend unreachable')))
        return [...withoutRetry, { role: 'assistant', text: result.reply }]
      })
      setDownloads(result.downloads)
      if (speakReplies) {
        setSpeaking(true)
        void speakEdge(result.reply, lang, () => setSpeaking(false))
      }
    } catch (exc) {
      if (controller.signal.aborted || (exc instanceof DOMException && exc.name === 'AbortError')) {
        setChat((items) => [...items, { role: 'assistant', text: 'Stopped.' }])
      } else {
        setChat((items) => {
          const withoutRetry = items.filter((item) => !(item.role === 'assistant' && item.text.includes('Backend unreachable')))
          return [...withoutRetry, { role: 'assistant', text: formatApiError(exc) }]
        })
      }
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null
      setBusy(false)
    }
  }

  function onStopAssistant() {
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    stopSpeech()
    setSpeaking(false)
    setBusy(false)
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
            <button
              type="button"
              className={auth.isAuthenticated ? 'btn-signout' : 'btn-primary'}
              onClick={auth.isAuthenticated ? auth.logout : auth.login}
            >
              {auth.isAuthenticated ? t(lang, 'signOut') : t(lang, 'signIn')}
            </button>
          )}
        </div>
      </header>

      <section className="category-band">
        <div className="category-grid" role="tablist" aria-label="Tool categories">
          {NAV_CATEGORIES.map((id) => {
            const meta = CATEGORY_META[id]
            const active = id === category
            const label = categoryLabel(id)
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`category-card ${active ? 'on' : ''} ${id === 'ai' ? 'home-card' : ''}`}
                style={{
                  ['--accent' as string]: meta.accent,
                  ['--soft' as string]: meta.soft,
                }}
                onClick={() => pickCategory(id)}
              >
                <span className={`category-icon${id === 'media' ? ' youtube' : ''}`}>
                  <CategoryIcon id={id} />
                </span>
                <span className="category-label">{label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <div className={`workspace${category === 'help' ? ' need-tool' : ''}`} style={{ ['--assistant-width' as string]: `${assistantWidth}px` }}>
        {category !== 'help' && (
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
                <div className={`catalog-item${selected?.id === tool.id ? ' on' : ''}`}>
                  <button
                    type="button"
                    className="catalog-pick"
                    title={tool.description}
                    onClick={() => {
                      setSelected(tool)
                      if (tool.category === 'search') setCategory('ai')
                      else if (NAV_CATEGORIES.includes(tool.category as NavCategoryId)) {
                        setCategory(tool.category as NavCategoryId)
                      }
                      setMessage('')
                      setError('')
                      setSearchHits([])
                      setSearchMeta({})
                      setDownloads([])
                      setOpenInfoId(null)
                    }}
                  >
                    <strong>{tool.title}</strong>
                  </button>
                  <button
                    type="button"
                    className={`catalog-info${openInfoId === tool.id ? ' open' : ''}`}
                    aria-label={`About ${tool.title}`}
                    aria-expanded={openInfoId === tool.id}
                    title={tool.description}
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenInfoId((current) => (current === tool.id ? null : tool.id))
                    }}
                  >
                    i
                  </button>
                  {openInfoId === tool.id ? (
                    <div className="catalog-tip" role="status">
                      {tool.description}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {loadError && <p className="error">{loadError}</p>}
        </aside>
        )}

        <main className={`panel${category === 'help' ? ' need-tool' : ''}`}>
          {category === 'help' && (
            <ContactPage
              lang={lang}
              initialYoutubeUrl={contactPrefill.url}
              initialTopic={contactPrefill.topic}
              signedInEmail={auth.isAuthenticated ? auth.email : ''}
            />
          )}
          {category !== 'help' && !selected && <p className="empty">{t(lang, 'empty')}</p>}
          {category !== 'help' && selected && selected.id === 'web_search' && (
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
                  <select
                    name="region_mode"
                    value={regionMode}
                    onChange={(event) => setRegionMode(event.target.value as 'auto' | 'manual')}
                  >
                    <option value="auto">Auto</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                {regionMode === 'manual' ? (
                  <>
                    <label>
                      Choose region
                      <select
                        value={regionChoice}
                        onChange={(event) => {
                          setRegionChoice(event.target.value)
                          setRegionCustom('')
                        }}
                      >
                        {WORLD_REGIONS.map((item) => (
                          <option key={item.code} value={item.code}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Or type region
                      <input
                        type="text"
                        value={regionCustom}
                        onChange={(event) => setRegionCustom(event.target.value)}
                        placeholder="City, state, or country"
                      />
                    </label>
                    <input
                      type="hidden"
                      name="region"
                      value={regionCustom.trim() ? 'GLOBAL' : (PROFILE_CODES.has(regionChoice) ? regionChoice : 'GLOBAL')}
                    />
                    <input
                      type="hidden"
                      name="location"
                      value={regionCustom.trim() || regionLabel(regionChoice)}
                    />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="region" value="AUTO" />
                    <input type="hidden" name="location" value="" />
                  </>
                )}
                <input type="hidden" name="language" value={lang} />
              </div>
              {error && <p className="error">{error}</p>}
              {message && <p className="ok">{t(lang, 'result')}: {message}</p>}
              <SearchMetaBar meta={searchMeta} />
              <SearchResults items={searchHits} />
            </form>
          )}
          {category !== 'help' && selected && selected.id !== 'web_search' && selected.id === 'translate' && (
            <form key={selected.id} className="tool-form translate-form" onSubmit={onRun}>
              <div className="tool-hero">
                <ToolGlyph category={selected.category} />
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                </div>
              </div>
              <div className="gt-shell">
                <div className="gt-langs">
                  <label className="gt-lang-pill">
                    <span className="sr-only">{t(lang, 'detectLang')}</span>
                    <select name="source_language" defaultValue="auto">
                      <option value="auto">{t(lang, 'detectLang')}</option>
                      {(selected.fields.find((f) => f.name === 'language')?.options || []).map((option) => (
                        <option key={option} value={option}>{languageOptionLabel(option)}</option>
                      ))}
                    </select>
                  </label>
                  <span className="gt-swap" aria-hidden="true">⇄</span>
                  <label className="gt-lang-pill">
                    <span className="sr-only">{t(lang, 'targetLang')}</span>
                    <select name="language" defaultValue={selected.fields.find((f) => f.name === 'language')?.default || 'en'}>
                      {(selected.fields.find((f) => f.name === 'language')?.options || []).map((option) => (
                        <option key={option} value={option}>{languageOptionLabel(option)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="gt-panels">
                  <div className="gt-panel">
                    <textarea
                      name="text"
                      rows={10}
                      defaultValue=""
                      placeholder={t(lang, 'pastePlaceholder')}
                      aria-label={t(lang, 'orPaste')}
                    />
                  </div>
                  <div className="gt-panel result-panel">
                    {message ? (
                      <div className="gt-result">{message}</div>
                    ) : (
                      <p className="gt-result-empty">{t(lang, 'result')}</p>
                    )}
                  </div>
                </div>
                <FileDropField
                  accept={selected.accept}
                  multiple={selected.multiple}
                  dropHint={t(lang, 'dropHint')}
                  browseLabel={t(lang, 'browse')}
                  emptyLabel={t(lang, 'files')}
                />
                <button type="submit" className="btn-primary gt-action" disabled={busy}>
                  {busy ? t(lang, 'working') : selected.title}
                </button>
                {error && <p className="error">{error}</p>}
                <DownloadList items={downloads} />
              </div>
            </form>
          )}
          {category !== 'help' && selected && (selected.id === 'youtube_mp4' || selected.id === 'youtube_mp3') && (
            <YoutubeToolForm
              tool={selected}
              kind={selected.id === 'youtube_mp3' ? 'mp3' : 'mp4'}
              accent={accent.accent}
              busy={busy}
              error={error}
              message={message}
              downloads={downloads}
              runLabel={t(lang, 'run')}
              workingLabel={t(lang, 'working')}
              resultLabel={t(lang, 'result')}
              signInHint={t(lang, 'youtubeSignInHint')}
              investigateLabel={t(lang, 'youtubeInvestigate')}
              onInvestigate={(url) => openContact(url)}
              onSubmit={onRun}
            />
          )}
          {category !== 'help' && selected && selected.id !== 'web_search' && selected.id !== 'translate'
            && selected.id !== 'summarize' && selected.id !== 'rewrite' && selected.id !== 'generate_document'
            && selected.id !== 'youtube_mp4' && selected.id !== 'youtube_mp3' && (
            <form key={selected.id} className="tool-form modern-tool" onSubmit={onRun}>
              <div className="tool-hero">
                <ToolGlyph category={selected.category} />
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                </div>
              </div>
              {selected.accept && (
                <FileDropField
                  accept={selected.accept}
                  multiple={selected.multiple}
                  dropHint={t(lang, 'dropHint')}
                  browseLabel={t(lang, 'browse')}
                  emptyLabel={t(lang, 'files')}
                />
              )}
              <div className="field-stack">
                {selected.fields.map((field) => (
                  <label key={field.name} className="field-card">
                    <span className="field-label">{field.label}</span>
                    {field.kind === 'textarea' ? (
                      <textarea
                        name={field.name}
                        defaultValue={field.default}
                        required={field.required}
                        rows={7}
                        placeholder={field.label}
                      />
                    ) : field.kind === 'select' ? (
                      <select name={field.name} defaultValue={field.default}>
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {field.name === 'language' ? languageOptionLabel(option) : option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        name={field.name}
                        type={field.kind}
                        defaultValue={field.default}
                        required={field.required}
                        placeholder={field.label}
                      />
                    )}
                  </label>
                ))}
              </div>
              <button type="submit" className="btn-primary" disabled={busy} style={{ background: accent.accent }}>
                {busy ? t(lang, 'working') : t(lang, 'run')}
              </button>
              {error && <p className="error">{error}</p>}
              {message && <p className="ok">{t(lang, 'result')}: {message}</p>}
              <DownloadList items={downloads} />
            </form>
          )}
          {category !== 'help' && selected && (selected.id === 'summarize' || selected.id === 'rewrite') && (
            <form key={selected.id} className="tool-form modern-tool" onSubmit={onRun}>
              <div className="tool-hero">
                <ToolGlyph category={selected.category} />
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                </div>
              </div>
              {selected.accept && (
                <FileDropField
                  accept={selected.accept}
                  multiple={selected.multiple}
                  dropHint={t(lang, 'dropHint')}
                  browseLabel={t(lang, 'browse')}
                  emptyLabel={t(lang, 'files')}
                />
              )}
              <div className="field-stack">
                {selected.fields.map((field) => (
                  <label key={field.name} className="field-card">
                    <span className="field-label">{field.label}</span>
                    {field.kind === 'textarea' ? (
                      <textarea name={field.name} defaultValue={field.default} required={field.required} rows={7} placeholder={field.label} />
                    ) : (
                      <input name={field.name} type={field.kind} defaultValue={field.default} required={field.required} placeholder={field.label} />
                    )}
                  </label>
                ))}
              </div>
              <button type="submit" className="btn-primary" disabled={busy} style={{ background: accent.accent }}>
                {busy ? t(lang, 'working') : t(lang, 'run')}
              </button>
              {error && <p className="error">{error}</p>}
              {message ? (
                <div className="result-card">
                  <h3>{t(lang, 'result')}</h3>
                  <pre className="result-body">{message}</pre>
                  <p className="export-ask">Export in another file format?</p>
                  <div className="export-actions">
                    {['txt', 'md', 'docx', 'pdf'].map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        className="btn-secondary"
                        disabled={exportBusy}
                        onClick={() => void onExportResult(fmt)}
                      >
                        {exportBusy ? t(lang, 'working') : fmt.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <DownloadList items={downloads} />
                </div>
              ) : null}
            </form>
          )}
          {category !== 'help' && selected && selected.id === 'generate_document' && (
            <form key={selected.id} className="tool-form modern-tool" onSubmit={onRun}>
              <div className="tool-hero">
                <ToolGlyph category={selected.category} />
                <div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                </div>
              </div>
              <div className="format-picker" role="group" aria-label="Document format">
                {(['pdf', 'docx', 'pptx'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    className={`format-card${docFormat === fmt ? ' on' : ''}`}
                    onClick={() => setDocFormat(fmt)}
                  >
                    <strong>{fmt.toUpperCase()}</strong>
                    <span>{fmt === 'pdf' ? 'Portable document' : fmt === 'docx' ? 'Word document' : 'PowerPoint slides'}</span>
                  </button>
                ))}
              </div>
              <input type="hidden" name="format" value={docFormat} />
              <label className="field-card">
                <span className="field-label">Request</span>
                <textarea name="request" required rows={7} placeholder="Describe the document you need…" />
              </label>
              <div className="template-block">
                <p className="field-label">Template (optional)</p>
                <div className="template-chips">
                  {['', 'Business letter', 'Meeting notes', 'Resume / CV', 'Project proposal', 'Status report'].map((item) => (
                    <button
                      key={item || 'none'}
                      type="button"
                      className={`chip${docTemplate === item ? ' on' : ''}`}
                      onClick={() => setDocTemplate(item)}
                    >
                      {item || 'No template'}
                    </button>
                  ))}
                </div>
                <input type="hidden" name="template_preset" value={docTemplate} />
                <FileDropField
                  accept=".docx,.txt,.md"
                  multiple={false}
                  dropHint="Upload your own template (optional)"
                  browseLabel={t(lang, 'browse')}
                  emptyLabel="No template file selected"
                />
              </div>
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
          <div className="thread" ref={threadRef}>
            {chat.length === 0 && <p className="empty-thread">{t(lang, 'placeholder')}</p>}
            {chat.map((item, index) => (
              <div key={index} className={`bubble ${item.role}`}>{item.text}</div>
            ))}
            {busy ? <div className="bubble assistant">{t(lang, 'working')}</div> : null}
          </div>
          <form className="assistant-form" onSubmit={onChat}>
            <textarea name="draft" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t(lang, 'placeholder')} rows={3} />
            <input name="files" type="file" multiple />
            <div className="row">
              <button type="button" className="btn-secondary" onClick={onVoice}>{t(lang, 'voice')}</button>
              <div className="row" style={{ gap: '0.45rem', marginLeft: 'auto' }}>
                {(busy || speaking) ? (
                  <button type="button" className="btn-stop" onClick={onStopAssistant}>{t(lang, 'stop')}</button>
                ) : null}
                <button type="submit" className="btn-primary" disabled={busy}>{t(lang, 'send')}</button>
              </div>
            </div>
          </form>
        </aside>
      </div>
    </div>
  )
}

function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function youtubeQualityLabel(kind: 'mp4' | 'mp3', option: string): string {
  if (kind === 'mp3') return `${option} kbps`
  if (option === 'best') return 'Best available'
  return `${option}p`
}

function YoutubeToolForm({
  tool,
  kind,
  accent,
  busy,
  error,
  message,
  downloads,
  runLabel,
  workingLabel,
  resultLabel,
  signInHint,
  investigateLabel,
  onInvestigate,
  onSubmit,
}: {
  tool: Tool
  kind: 'mp4' | 'mp3'
  accent: string
  busy: boolean
  error: string
  message: string
  downloads: Download[]
  runLabel: string
  workingLabel: string
  resultLabel: string
  signInHint: string
  investigateLabel: string
  onInvestigate: (url: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const urlField = tool.fields.find((field) => field.name === 'url')
  const qualityField = tool.fields.find((field) => field.name === 'quality')
  const qualityOptions = qualityField?.options?.length
    ? qualityField.options
    : kind === 'mp3'
      ? ['64', '128', '192', '320']
      : ['360', '480', '720', '1080', 'best']
  const defaultQuality = qualityField?.default || (kind === 'mp3' ? '192' : '720')
  const [url, setUrl] = useState('')
  const [quality, setQuality] = useState(defaultQuality)
  const [qualities, setQualities] = useState<YoutubeQuality[]>([])
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeError, setProbeError] = useState('')
  const [title, setTitle] = useState('')

  useEffect(() => {
    setUrl('')
    setQuality(defaultQuality)
    setQualities([])
    setProbeError('')
    setTitle('')
  }, [tool.id, defaultQuality])

  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      setQualities([])
      setProbeError('')
      setTitle('')
      return
    }
    if (!/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(trimmed)) {
      setQualities([])
      setProbeError('')
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setProbeBusy(true)
      setProbeError('')
      void probeYoutube(trimmed, kind, controller.signal)
        .then((payload) => {
          setTitle(payload.title || '')
          setQualities(payload.qualities || [])
        })
        .catch((exc) => {
          if (exc instanceof DOMException && exc.name === 'AbortError') return
          setQualities([])
          setProbeError(formatYoutubeError(exc))
        })
        .finally(() => setProbeBusy(false))
    }, 500)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [url, kind])

  const chosen = qualities.find((item) => item.id === quality)
  const sizeLabel = formatBytes(chosen?.bytes)
  let sizeText = 'Choose a quality to see expected file size.'
  if (!url.trim()) sizeText = 'Paste a YouTube URL, then choose quality to see expected file size.'
  else if (probeBusy) sizeText = 'Checking expected file size…'
  else if (probeError) sizeText = 'Expected file size is unavailable until YouTube allows this video.'
  else if (sizeLabel) sizeText = `Expected file size: ${sizeLabel}`
  else if (qualities.length) sizeText = 'Expected file size: unknown until download.'

  return (
    <form key={tool.id} className="tool-form modern-tool" onSubmit={onSubmit}>
      <div className="tool-hero">
        <ToolGlyph category={tool.category} />
        <div>
          <h2>{tool.title}</h2>
          <p>{tool.description}</p>
        </div>
      </div>
      <div className="field-stack">
        <label className="field-card">
          <span className="field-label">{urlField?.label || 'YouTube URL'}</span>
          <input
            name="url"
            type="text"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
          />
          {title ? <span className="field-hint">{title}</span> : null}
        </label>
        <label className="field-card">
          <span className="field-label">{qualityField?.label || 'Quality'}</span>
          <select name="quality" value={quality} onChange={(event) => setQuality(event.target.value)}>
            {qualityOptions.map((option) => (
              <option key={option} value={option}>
                {youtubeQualityLabel(kind, option)}
              </option>
            ))}
          </select>
          <span className="field-hint">{sizeText}</span>
        </label>
      </div>
      <p className="field-hint">{signInHint}</p>
      <button type="submit" className="btn-primary" disabled={busy} style={{ background: accent }}>
        {busy ? workingLabel : runLabel}
      </button>
      {(error || probeError) && (
        <p className="error">
          {error || probeError}{' '}
          <button type="button" className="linkish" onClick={() => onInvestigate(url)}>
            {investigateLabel}
          </button>
        </p>
      )}
      {message && <p className="ok">{resultLabel}: {message}</p>}
      <DownloadList items={downloads} />
    </form>
  )
}

function FileDropField({
  accept,
  multiple,
  dropHint,
  browseLabel,
  emptyLabel,
}: {
  accept: string
  multiple: boolean
  dropHint: string
  browseLabel: string
  emptyLabel: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [names, setNames] = useState('')
  const [dragging, setDragging] = useState(false)

  function syncNames(list: FileList | null) {
    if (!list || !list.length) {
      setNames('')
      return
    }
    setNames(Array.from(list).map((file) => file.name).join(', '))
  }

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const input = inputRef.current
        if (!input || !event.dataTransfer.files.length) return
        input.files = event.dataTransfer.files
        syncNames(event.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        className="sr-only"
        name="files"
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => syncNames(event.target.files)}
      />
      <div className="dropzone-icon" aria-hidden="true">⬆</div>
      <p className="dropzone-title">{dropHint}</p>
      <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
        {browseLabel}
      </button>
      <p className="dropzone-files">{names || emptyLabel}</p>
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
