import { useState, type FormEvent } from 'react'
import { submitFeedback } from './api'
import { t, type Lang } from './i18n'

export function ContactPage({
  lang,
  initialYoutubeUrl = '',
  onBack,
}: {
  lang: Lang
  initialYoutubeUrl?: string
  onBack: () => void
}) {
  const [email, setEmail] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState(initialYoutubeUrl)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setOk(false)
    setBusy(true)
    try {
      await submitFeedback({
        email: email.trim(),
        youtube_url: youtubeUrl.trim(),
        message: message.trim(),
      })
      setOk(true)
      setMessage('')
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : t(lang, 'contactFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="contact-page">
      <div className="contact-card">
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t(lang, 'contactBack')}
        </button>
        <h1>{t(lang, 'contactTitle')}</h1>
        <p className="contact-lead">{t(lang, 'contactLead')}</p>
        <form className="contact-form" onSubmit={onSubmit}>
          <label>
            {t(lang, 'contactEmail')}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            {t(lang, 'contactYoutube')}
            <input
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
            />
          </label>
          <label>
            {t(lang, 'contactMessage')}
            <textarea
              required
              rows={6}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t(lang, 'working') : t(lang, 'contactSend')}
          </button>
          {error && <p className="error">{error}</p>}
          {ok && <p className="ok">{t(lang, 'contactSent')}</p>}
        </form>
      </div>
    </main>
  )
}
