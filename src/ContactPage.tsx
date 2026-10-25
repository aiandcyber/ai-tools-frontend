import { useEffect, useRef, useState, type FormEvent } from 'react'
import { submitFeedback } from './api'
import { TURNSTILE_SITEKEY } from './config'
import { CategoryIcon } from './icons'
import { t, type Lang } from './i18n'

const TOPICS = ['new_tool', 'youtube', 'error', 'feedback', 'contact'] as const
type Topic = (typeof TOPICS)[number]
const TURNSTILE_ACTION = 'contact'
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

function topicFrom(value: string): Topic {
  return TOPICS.includes(value as Topic) ? (value as Topic) : 'new_tool'
}

function loadTurnstile(): Promise<TurnstileApi> {
  const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const done = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile
      if (api) resolve(api)
      else reject(new Error('CAPTCHA did not load'))
    }
    const found = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
    if (found) {
      found.addEventListener('load', done, { once: true })
      found.addEventListener('error', () => reject(new Error('CAPTCHA did not load')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.dataset.turnstile = '1'
    script.onload = done
    script.onerror = () => reject(new Error('CAPTCHA did not load'))
    document.head.appendChild(script)
  })
}

export function ContactPage({
  lang,
  initialYoutubeUrl = '',
  initialTopic = 'new_tool',
  signedInEmail = '',
}: {
  lang: Lang
  initialYoutubeUrl?: string
  initialTopic?: string
  signedInEmail?: string
}) {
  const lockedEmail = signedInEmail.trim()
  const [topic, setTopic] = useState<Topic>(topicFrom(initialTopic))
  const [email, setEmail] = useState(lockedEmail)
  const [youtubeUrl, setYoutubeUrl] = useState(initialYoutubeUrl)
  const [message, setMessage] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const widgetHost = useRef<HTMLDivElement | null>(null)
  const widgetId = useRef('')

  useEffect(() => {
    setTopic(topicFrom(initialTopic))
    setYoutubeUrl(initialYoutubeUrl)
  }, [initialTopic, initialYoutubeUrl])

  useEffect(() => {
    if (lockedEmail) setEmail(lockedEmail)
  }, [lockedEmail])

  useEffect(() => {
    if (!TURNSTILE_SITEKEY) return
    let cancelled = false
    void loadTurnstile().then((api) => {
      if (cancelled || !widgetHost.current) return
      if (widgetId.current) api.remove(widgetId.current)
      widgetId.current = api.render(widgetHost.current, {
        sitekey: TURNSTILE_SITEKEY,
        action: TURNSTILE_ACTION,
        size: 'compact',
        callback: (value: string) => setToken(value),
        'expired-callback': () => setToken(''),
        'error-callback': () => setToken(''),
      })
    }).catch((exc: Error) => {
      if (!cancelled) setError(exc.message)
    })
    return () => {
      cancelled = true
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile
      if (api && widgetId.current) {
        api.remove(widgetId.current)
        widgetId.current = ''
      }
    }
  }, [])

  function resetCaptcha() {
    const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile
    if (api && widgetId.current) api.reset(widgetId.current)
    setToken('')
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setOk(false)
    if (TURNSTILE_SITEKEY && !token) {
      setError(t(lang, 'contactCaptchaNeeded'))
      return
    }
    setBusy(true)
    try {
      await submitFeedback({
        email: email.trim(),
        topic,
        youtube_url: youtubeUrl.trim(),
        message: message.trim(),
        ...(token ? { 'cf-turnstile-response': token } : {}),
      })
      setOk(true)
      setMessage('')
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : t(lang, 'contactFailed'))
    } finally {
      resetCaptcha()
      setBusy(false)
    }
  }

  const showLink = topic === 'youtube' || topic === 'error'

  return (
    <form className="tool-form contact-form need-tool-form" onSubmit={onSubmit}>
      <div className="tool-hero">
        <span className="tool-glyph" style={{ background: '#ffedd5', color: '#b45309' }}>
          <CategoryIcon id="help" />
        </span>
        <div>
          <h2>{t(lang, 'contactTitle')}</h2>
          <p>{t(lang, 'contactLead')}</p>
          <p>{t(lang, 'contactLead2')}</p>
        </div>
      </div>
      <div className="contact-row">
        <label>
          {t(lang, 'contactTopic')}
          <select value={topic} onChange={(event) => setTopic(topicFrom(event.target.value))}>
            <option value="new_tool">{t(lang, 'topicNewTool')}</option>
            <option value="youtube">{t(lang, 'topicYoutube')}</option>
            <option value="error">{t(lang, 'topicError')}</option>
            <option value="feedback">{t(lang, 'topicFeedback')}</option>
            <option value="contact">{t(lang, 'topicContact')}</option>
          </select>
        </label>
        <label>
          {t(lang, 'contactEmail')}
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            readOnly={Boolean(lockedEmail)}
            onChange={lockedEmail ? undefined : (event) => setEmail(event.target.value)}
          />
        </label>
      </div>
      {showLink && (
        <label>
          {t(lang, 'contactYoutube')}
          <input
            type="url"
            required={topic === 'youtube'}
            placeholder="https://www.youtube.com/watch?v=…"
            value={youtubeUrl}
            onChange={(event) => setYoutubeUrl(event.target.value)}
          />
        </label>
      )}
      <label>
        {t(lang, 'contactMessage')}
        <textarea
          required
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <div className="contact-actions">
        {TURNSTILE_SITEKEY ? <div ref={widgetHost} className="contact-captcha" /> : null}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? t(lang, 'working') : t(lang, 'contactSend')}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {ok && <p className="ok">{t(lang, 'contactSent')}</p>}
    </form>
  )
}
