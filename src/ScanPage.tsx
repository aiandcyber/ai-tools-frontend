import { useRef, useState, type FormEvent } from 'react'
import { SCAN_BASE } from './config'
import { ToolGlyph } from './icons'
import { t, type Lang } from './i18n'

type Verdict = {
  ok?: boolean
  labels?: string[]
}

const USER_LABELS: Record<string, string> = {
  virus: 'Virus',
  phishing: 'Phishing',
  scam: 'Scam',
  social_engineering: 'Social engineering',
  fraud: 'Fraud',
}

export function safetyTools(lang: Lang) {
  return [
    {
      id: 'scan_file',
      category: 'safety',
      title: t(lang, 'scanFileTool'),
      description: t(lang, 'scanFileDesc'),
      accept: '*/*',
      multiple: false,
      fields: [],
    },
    {
      id: 'scan_message',
      category: 'safety',
      title: t(lang, 'scanMsgTool'),
      description: t(lang, 'scanMsgDesc'),
      accept: '',
      multiple: false,
      fields: [],
    },
  ]
}

function friendlyLabels(raw: string[] | undefined): string[] {
  if (!raw?.length) return []
  const out: string[] = []
  for (const item of raw) {
    const mapped = USER_LABELS[item]
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

export function ScanPage({
  lang,
  mode,
  accent,
}: {
  lang: Lang
  mode: 'file' | 'message'
  accent: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)

  function syncNames(list: FileList | null) {
    setFileName(list?.[0]?.name || '')
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setVerdict(null)
    const file = inputRef.current?.files?.[0]
    const blob = text.trim()
    if (mode === 'file' && !file) {
      setError(t(lang, 'scanNeedFile'))
      return
    }
    if (mode === 'message' && !blob) {
      setError(t(lang, 'scanNeedText'))
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

  const labels = friendlyLabels(verdict?.labels)
  const hit = Boolean(verdict && (verdict.ok === false || labels.length))
  const title = mode === 'file' ? t(lang, 'scanFileTool') : t(lang, 'scanMsgTool')
  const description = mode === 'file' ? t(lang, 'scanFileDesc') : t(lang, 'scanMsgDesc')

  return (
    <form className="tool-form modern-tool" onSubmit={onSubmit}>
      <div className="tool-hero">
        <ToolGlyph category="safety" />
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {mode === 'file' && (
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
            name="sample"
            type="file"
            onChange={(event) => syncNames(event.target.files)}
          />
          <p className="dropzone-title">{t(lang, 'dropHint')}</p>
          <div className="dropzone-actions">
            <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
              {t(lang, 'browse')}
            </button>
            <p className="dropzone-files">{fileName || t(lang, 'files')}</p>
          </div>
        </div>
      )}
      {mode === 'message' && (
        <div className="field-stack">
          <label className="field-card">
            <span className="field-label">{t(lang, 'orPaste')}</span>
            <textarea
              rows={7}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t(lang, 'pastePlaceholder')}
            />
          </label>
        </div>
      )}
      <button type="submit" className="btn-primary" disabled={busy} style={{ background: accent }}>
        {busy ? t(lang, 'working') : t(lang, 'run')}
      </button>
      {error ? <p className="error">{error}</p> : null}
      {verdict ? (
        <div className="result-card" role="status">
          <h3>{t(lang, 'result')}</h3>
          <pre className="result-body">
            {hit ? t(lang, 'scanHit') : t(lang, 'scanClean')}
            {labels.length ? `\n${labels.join(', ')}` : ''}
          </pre>
        </div>
      ) : null}
    </form>
  )
}
