import { useEffect, useRef, useState } from 'react'
import { apiUrl } from './config'
import { t, type Lang } from './i18n'

export type UploadStatusStage = '' | 'type' | 'size' | 'scan' | 'ready' | 'error'

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

function parseAccept(accept: string): { exts: string[]; mimes: string[]; any: boolean } {
  const raw = (accept || '').trim()
  if (!raw || raw === '*/*' || raw === '*') return { exts: [], mimes: [], any: true }
  const exts: string[] = []
  const mimes: string[] = []
  for (const part of raw.split(',')) {
    const token = part.trim().toLowerCase()
    if (!token) continue
    if (token === '*' || token === '*/*') return { exts: [], mimes: [], any: true }
    if (token.startsWith('.')) exts.push(token)
    else if (token.includes('/')) mimes.push(token)
    else exts.push(`.${token}`)
  }
  return { exts, mimes, any: false }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function typeAllowed(file: File, accept: string): boolean {
  const { exts, mimes, any } = parseAccept(accept)
  if (any) return true
  const ext = extOf(file.name)
  if (ext && exts.includes(ext)) return true
  const ctype = (file.type || '').toLowerCase()
  for (const mime of mimes) {
    if (mime.endsWith('/*')) {
      if (ctype.startsWith(mime.slice(0, -1))) return true
    } else if (ctype === mime) return true
  }
  return false
}

async function looksLikeEicar(file: File): Promise<boolean> {
  const slice = file.slice(0, Math.min(file.size, 8192))
  const text = await slice.text()
  return text.includes(EICAR)
}

async function looksLikeExecutable(file: File): Promise<boolean> {
  const buf = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return true // MZ
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true // ELF
  return false
}

function acceptAllowsExec(accept: string): boolean {
  const { any, exts } = parseAccept(accept)
  if (any) return true
  return ['.exe', '.dll', '.so', '.bin', '.apk'].some((e) => exts.includes(e))
}

export function formatMaxBytes(maxBytes: number): string {
  if (maxBytes >= 1024 * 1024) return `${Math.round(maxBytes / (1024 * 1024))} MB`
  if (maxBytes >= 1024) return `${Math.round(maxBytes / 1024)} KB`
  return `${maxBytes} B`
}

export async function validateFilesLocally(
  files: File[],
  accept: string,
  maxBytes: number,
  onStage?: (stage: UploadStatusStage, detail?: string) => void,
): Promise<{ ok: true; files: File[] } | { ok: false; stage: UploadStatusStage; detail: string }> {
  for (const file of files) {
    onStage?.('type')
    if (!typeAllowed(file, accept)) {
      return { ok: false, stage: 'type', detail: `File type not allowed for this tool (${file.name}).` }
    }
    onStage?.('size')
    if (file.size <= 0) return { ok: false, stage: 'size', detail: 'Empty file.' }
    if (file.size > maxBytes) {
      return {
        ok: false,
        stage: 'size',
        detail: `File is too large (max ${formatMaxBytes(maxBytes)}).`,
      }
    }
    onStage?.('scan')
    if (await looksLikeEicar(file)) {
      return { ok: false, stage: 'scan', detail: 'Basic virus scan failed. File rejected.' }
    }
    if (!acceptAllowsExec(accept) && (await looksLikeExecutable(file))) {
      return { ok: false, stage: 'scan', detail: 'Executable files are not allowed for this tool.' }
    }
  }
  onStage?.('ready')
  return { ok: true, files }
}

/** Optional server confirm of the basic gate (does not keep the file). */
export async function confirmBasicScanOnServer(
  file: File,
  opts: { accept: string; maxBytes: number; toolId?: string; category?: string },
): Promise<void> {
  const body = new FormData()
  body.append('file', file, file.name)
  body.append('accept', opts.accept)
  body.append('max_bytes', String(opts.maxBytes))
  if (opts.toolId) body.append('tool_id', opts.toolId)
  if (opts.category) body.append('category', opts.category)
  const res = await fetch(apiUrl('/api/upload/basic-scan'), { method: 'POST', body })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new Error(payload.detail || 'Basic virus scan failed. File rejected.')
  }
}

type Props = {
  lang: Lang
  accept: string
  maxBytes: number
  multiple?: boolean
  name?: string
  toolId?: string
  category?: string
  dropHint: string
  browseLabel: string
  emptyLabel: string
  assignedFile?: File | null
  cameraLabel?: string
  onCameraClick?: () => void
  /** When true, also POST /api/upload/basic-scan after local checks. */
  confirmOnServer?: boolean
  onValidated?: (files: File[]) => void
  onError?: (message: string) => void
}

export function FileUpload({
  lang,
  accept,
  maxBytes,
  multiple = false,
  name = 'files',
  toolId,
  category,
  dropHint,
  browseLabel,
  emptyLabel,
  assignedFile = null,
  cameraLabel,
  onCameraClick,
  confirmOnServer = true,
  onValidated,
  onError,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [names, setNames] = useState('')
  const [dragging, setDragging] = useState(false)
  const [stage, setStage] = useState<UploadStatusStage>('')
  const [statusDetail, setStatusDetail] = useState('')

  function stageLabel(value: UploadStatusStage): string {
    if (value === 'type') return t(lang, 'uploadCheckType')
    if (value === 'size') return t(lang, 'uploadCheckSize')
    if (value === 'scan') return t(lang, 'uploadCheckScan')
    if (value === 'ready') return t(lang, 'uploadCheckReady')
    if (value === 'error') return t(lang, 'uploadCheckError')
    return ''
  }

  async function applyFiles(list: FileList | File[] | null) {
    const files = list ? Array.from(list) : []
    setStatusDetail('')
    if (!files.length) {
      setNames('')
      setStage('')
      onValidated?.([])
      return
    }
    const local = await validateFilesLocally(files, accept, maxBytes, (s) => setStage(s))
    if (!local.ok) {
      setStage('error')
      setStatusDetail(local.detail)
      setNames('')
      if (inputRef.current) inputRef.current.value = ''
      onError?.(local.detail)
      onValidated?.([])
      return
    }
    if (confirmOnServer) {
      setStage('scan')
      try {
        for (const file of local.files) {
          await confirmBasicScanOnServer(file, { accept, maxBytes, toolId, category })
        }
      } catch (exc) {
        const detail = exc instanceof Error ? exc.message : t(lang, 'uploadCheckError')
        setStage('error')
        setStatusDetail(detail)
        setNames('')
        if (inputRef.current) inputRef.current.value = ''
        onError?.(detail)
        onValidated?.([])
        return
      }
    }
    setStage('ready')
    setNames(local.files.map((f) => f.name).join(', '))
    onValidated?.(local.files)
  }

  useEffect(() => {
    if (!assignedFile || !inputRef.current) return
    const transfer = new DataTransfer()
    transfer.items.add(assignedFile)
    inputRef.current.files = transfer.files
    void applyFiles(transfer.files)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedFile])

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
        void applyFiles(event.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        className="sr-only"
        name={name}
        type="file"
        accept={accept || undefined}
        multiple={multiple}
        onChange={(event) => void applyFiles(event.target.files)}
      />
      <p className="dropzone-title">{dropHint}</p>
      <p className="field-hint">{t(lang, 'uploadMaxHint')}: {formatMaxBytes(maxBytes)}</p>
      <div className="dropzone-actions">
        <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
          {browseLabel}
        </button>
        {cameraLabel && onCameraClick ? (
          <button type="button" className="btn-secondary" onClick={onCameraClick}>
            {cameraLabel}
          </button>
        ) : null}
        <p className="dropzone-files">{names || emptyLabel}</p>
      </div>
      {stage ? (
        <p className={`upload-status${stage === 'error' ? ' error' : stage === 'ready' ? ' ok' : ''}`} role="status">
          {stageLabel(stage)}
          {statusDetail ? ` — ${statusDetail}` : ''}
        </p>
      ) : null}
    </div>
  )
}
