import { useState, type FormEvent } from 'react'
import { SCAN_BASE } from './config'
import { t, type Lang } from './i18n'

type Verdict = {
  ok?: boolean
  sha256?: string
  size?: number
  labels?: string[]
  stored?: boolean
}

export function ScanPage({ lang }: { lang: Lang }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setVerdict(null)
    const form = event.currentTarget
    const input = form.elements.namedItem('sample') as HTMLInputElement | null
    const file = input?.files?.[0]
    const blob = text.trim()
    if (!file && !blob) {
      setError(t(lang, 'scanNeedInput'))
      return
    }
    if (!SCAN_BASE) {
      setError(t(lang, 'scanNoServer'))
      return
    }
    const body = new FormData()
    if (file) body.append('file', file, file.name)
    if (blob) body.append('text', blob)
    setBusy(true)
    try {
      const res = await fetch(`${SCAN_BASE}/v1/analyze`, { method: 'POST', body })
      const json = (await res.json()) as Verdict & { message?: string }
      if (!res.ok) {
        setError(json.message || t(lang, 'scanFailed'))
        return
      }
      setVerdict(json)
    } catch {
      setError(t(lang, 'scanFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scan-page need-tool-form">
      <h2>{t(lang, 'safety')}</h2>
      <p>{t(lang, 'scanLead')}</p>
      <p className="search-subtitle">{t(lang, 'scanLead2')}</p>
      <section className="apps-chooser" aria-label={t(lang, 'apps')}>
        <h3>{t(lang, 'apps')}</h3>
        <ol>
          <li>
            <strong>{t(lang, 'appsAll')}</strong>
            <span> {t(lang, 'appsAllDetail')}</span>
          </li>
          <li>
            <strong>{t(lang, 'appsSenior')}</strong>
            <span> {t(lang, 'appsSeniorDetail')}</span>
          </li>
          <li>
            <strong>{t(lang, 'appsTools')}</strong>
            <span> {t(lang, 'appsToolsDetail')}</span>
          </li>
          <li>
            <strong>{t(lang, 'appsSafety')}</strong>
            <span> {t(lang, 'appsSafetyDetail')}</span>
          </li>
        </ol>
      </section>
      <form className="tool-form" onSubmit={onSubmit}>
        <label>
          {t(lang, 'scanFile')}
          <input
            name="sample"
            type="file"
            onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
          />
        </label>
        {fileName ? <p>{fileName}</p> : null}
        <label>
          {t(lang, 'scanText')}
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t(lang, 'scanTextPh')}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? t(lang, 'working') : t(lang, 'scanRun')}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {verdict ? (
        <div className="scan-verdict" role="status">
          <p>
            <strong>{verdict.ok ? t(lang, 'scanClean') : t(lang, 'scanHit')}</strong>
          </p>
          {verdict.labels?.length ? <p>{verdict.labels.join(', ')}</p> : null}
          {verdict.sha256 ? <p>SHA-256 {verdict.sha256}</p> : null}
          <p>{t(lang, 'scanDeleted')}</p>
        </div>
      ) : null}
    </div>
  )
}
