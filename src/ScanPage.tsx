import { useRef, useState, type FormEvent } from 'react'
import { runTool, type Download } from './api'
import { SCAN_BASE } from './config'
import { FileUpload, formatMaxBytes, validateFilesLocally } from './FileUpload'
import { ToolGlyph } from './icons'
import { t, type Lang } from './i18n'
import { MdIcon } from './MdIcon'

type Verdict = {
  ok?: boolean
  labels?: string[]
  detail?: string
  stage?: string
  /** virus | unsafe | safe_to_use */
  recommendation?: string
}

const USER_LABELS: Record<string, string> = {
  virus: 'Virus',
  phishing: 'Phishing',
  scam: 'Scam',
  social_engineering: 'Social engineering',
  fraud: 'Fraud',
}

const VIRUS_MAX_BYTES = 32 * 1024 * 1024

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
      max_upload_bytes: VIRUS_MAX_BYTES,
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
  onOpenRemovePrivacy,
}: {
  lang: Lang
  mode: 'file' | 'message' | 'privacy'
  accent: string
  onOpenRemovePrivacy?: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')
  const [downloads, setDownloads] = useState<Download[]>([])
  const [showPrivacyLink, setShowPrivacyLink] = useState(false)
  const [reportText, setReportText] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')
  const [privacyFile, setPrivacyFile] = useState<File | null>(null)

  function syncNames(list: FileList | null) {
    setFileName(list?.[0]?.name || '')
  }

  async function runVirusCheck(file: File) {
    if (!SCAN_BASE) {
      setError(t(lang, 'scanNoServer'))
      return
    }
    setUploadStatus(t(lang, 'uploadCheckType'))
    const local = await validateFilesLocally([file], '*/*', VIRUS_MAX_BYTES, (stage) => {
      if (stage === 'type') setUploadStatus(t(lang, 'uploadCheckType'))
      if (stage === 'size') setUploadStatus(t(lang, 'uploadCheckSize'))
      if (stage === 'scan') setUploadStatus(t(lang, 'uploadCheckScan'))
      if (stage === 'ready') setUploadStatus(t(lang, 'uploadCheckReady'))
    })
    if (!local.ok) {
      setError(local.detail)
      setUploadStatus(t(lang, 'uploadCheckError'))
      return
    }

    setUploadStatus(t(lang, 'uploadCheckScan'))
    const basicBody = new FormData()
    basicBody.append('file', file, file.name)
    const basicRes = await fetch(`${SCAN_BASE}/v1/basic-scan`, { method: 'POST', body: basicBody })
    const basicJson = (await basicRes.json().catch(() => ({}))) as Verdict & { message?: string }
    if (!basicRes.ok) {
      setError(basicJson.message || basicJson.detail || t(lang, 'scanFailed'))
      setUploadStatus(t(lang, 'uploadCheckError'))
      return
    }
    if (basicJson.ok === false) {
      setVerdict(basicJson)
      setError(t(lang, 'virusBasicRejected'))
      setUploadStatus(t(lang, 'uploadCheckError'))
      return
    }

    setUploadStatus(t(lang, 'working'))
    const body = new FormData()
    body.append('file', file, file.name)
    const res = await fetch(`${SCAN_BASE}/v1/analyze`, { method: 'POST', body })
    const json = (await res.json()) as Verdict & { message?: string }
    if (!res.ok) {
      setError(json.message || t(lang, 'scanFailed'))
      return
    }
    setVerdict(json)
    setUploadStatus(t(lang, 'uploadCheckReady'))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setVerdict(null)
    setMessage('')
    setDownloads([])
    setShowPrivacyLink(false)
    setReportText('')
    setUploadStatus('')
    const file = inputRef.current?.files?.[0]
    const blob = text.trim()
    if ((mode === 'file' || mode === 'privacy') && !file) {
      setError(t(lang, 'scanNeedFile'))
      return
    }
    if (mode === 'message' && !blob) {
      setError(t(lang, 'scanNeedText'))
      return
    }

    if (mode === 'privacy') {
      const chosen = privacyFile || file
      if (!chosen) {
        setError(t(lang, 'scanNeedFile'))
        return
      }
      setBusy(true)
      try {
        const form = new FormData()
        form.append('file', chosen, chosen.name)
        const result = await runTool('image_privacy_check', form)
        setMessage(result.message)
        setDownloads(result.downloads)
        setShowPrivacyLink(Boolean(result.meta?.privacy_sensitive || result.meta?.open_tool === 'image_strip_exif'))
        if (result.downloads[0]?.url) {
          try {
            const res = await fetch(result.downloads[0].url)
            setReportText(await res.text())
          } catch {
            setReportText('')
          }
        }
      } catch {
        setError(t(lang, 'scanFailed'))
      } finally {
        setBusy(false)
      }
      return
    }

    if (mode === 'file') {
      if (!file) return
      setBusy(true)
      try {
        await runVirusCheck(file)
      } catch {
        setError(t(lang, 'scanFailed'))
        setUploadStatus(t(lang, 'uploadCheckError'))
      } finally {
        setBusy(false)
      }
      return
    }

    if (!SCAN_BASE) {
      setError(t(lang, 'scanNoServer'))
      return
    }
    const body = new FormData()
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
  const recommendationText = (() => {
    const rec = verdict?.recommendation
    if (rec === 'virus') return t(lang, 'scanRecVirus')
    if (rec === 'unsafe') return t(lang, 'scanRecUnsafe')
    if (rec === 'safe_to_use') return t(lang, 'scanRecSafe')
    if (!verdict) return ''
    return hit ? t(lang, 'scanHit') : t(lang, 'scanClean')
  })()
  const title =
    mode === 'file' ? t(lang, 'scanFileTool')
      : mode === 'message' ? t(lang, 'scanMsgTool')
        : 'Image Privacy Check'
  const description =
    mode === 'file' ? t(lang, 'scanFileDesc')
      : mode === 'message' ? t(lang, 'scanMsgDesc')
        : 'Check privacy information such as your GPS location and other metadata in your image.'

  return (
    <form className="tool-form modern-tool" onSubmit={onSubmit}>
      <div className="tool-hero">
        <ToolGlyph category="safety" />
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {mode === 'privacy' && (
        <FileUpload
          lang={lang}
          accept="image/*"
          maxBytes={20 * 1024 * 1024}
          toolId="image_privacy_check"
          category="safety"
          name="sample"
          dropHint={t(lang, 'dropHint')}
          browseLabel={t(lang, 'browse')}
          emptyLabel={t(lang, 'files')}
          confirmOnServer
          onError={(msg) => setError(msg)}
          onValidated={(files) => setPrivacyFile(files[0] || null)}
        />
      )}
      {mode === 'file' && (
        <div
          className={`dropzone dropzone-inline${dragging ? ' dragging' : ''}`}
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
            name="virus-sample"
            type="file"
            onChange={(event) => syncNames(event.target.files)}
          />
          <span className="dropzone-icon" aria-hidden>
            <MdIcon name="upload_file" />
          </span>
          <div className="dropzone-copy">
            <p className="dropzone-title">{t(lang, 'dropHint')}</p>
            <p className="field-hint dropzone-max">{t(lang, 'uploadMaxHint')}: {formatMaxBytes(VIRUS_MAX_BYTES)}</p>
          </div>
          <div className="dropzone-actions">
            <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
              <MdIcon name="folder_open" />
              <span>{t(lang, 'browse')}</span>
            </button>
          </div>
          <p className="dropzone-files">{fileName || t(lang, 'files')}</p>
          {uploadStatus ? <p className="upload-status" role="status">{uploadStatus}</p> : null}
        </div>
      )}
      {mode === 'message' && (
        <div className="field-stack">
          <label className="field-card">
            <textarea
              rows={7}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t(lang, 'pastePlaceholder')}
              aria-label={t(lang, 'orPaste')}
            />
          </label>
        </div>
      )}
      <button type="submit" className="btn-primary" disabled={busy} style={{ background: accent }}>
        <MdIcon name={busy ? 'hourglass_top' : 'play_arrow'} />
        <span>{busy ? t(lang, 'working') : t(lang, 'run')}</span>
      </button>
      {error ? <p className="error">{error}</p> : null}
      {verdict ? (
        <div className="result-card" role="status">
          <h3>{t(lang, 'result')}</h3>
          <pre className="result-body">
            {recommendationText}
            {labels.length ? `\n${labels.join(', ')}` : ''}
            {verdict.detail ? `\n${verdict.detail}` : ''}
          </pre>
        </div>
      ) : null}
      {mode === 'privacy' && message ? <p className="ok">{t(lang, 'result')}: {message}</p> : null}
      {mode === 'privacy' && showPrivacyLink && onOpenRemovePrivacy ? (
        <p className="field-hint">
          {t(lang, 'privacySensitiveHint')}{' '}
          <button type="button" className="linkish" onClick={onOpenRemovePrivacy}>
            {t(lang, 'openRemovePrivacy')}
          </button>
        </p>
      ) : null}
      {mode === 'privacy' && reportText ? (
        <div className="result-card" role="status">
          <h3>{t(lang, 'result')}</h3>
          <pre className="result-body">{reportText}</pre>
        </div>
      ) : null}
      {mode === 'privacy' && downloads.length > 0 ? (
        <ul className="downloads">
          {downloads.map((item) => (
            <li key={item.url}>
              <a
                href={item.url}
                download={item.name}
                onClick={(event) => {
                  event.preventDefault()
                  void (async () => {
                    try {
                      const response = await fetch(item.url)
                      if (!response.ok) {
                        setError(t(lang, 'downloadUnavailable'))
                        return
                      }
                      const blob = await response.blob()
                      const objectUrl = URL.createObjectURL(blob)
                      const anchor = document.createElement('a')
                      anchor.href = objectUrl
                      anchor.download = item.name
                      anchor.click()
                      URL.revokeObjectURL(objectUrl)
                    } catch {
                      setError(t(lang, 'downloadUnavailable'))
                    }
                  })()
                }}
              >
                {item.name}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  )
}
