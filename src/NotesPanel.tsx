import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { fetchDownloadText, formatApiError, runTool } from './api'
import { speechLang, t, type Lang } from './i18n'
import { MdIcon } from './MdIcon'
import { type NoteStroke } from './notesStore'
import { useRequireAuth } from './useRequireAuth'

type SpeechRec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort?: () => void
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechSession = {
  rec: SpeechRec
  base: string
  stopped: boolean
}

type Props = {
  lang: Lang
  accent: string
  /** Bumps when a search finishes — collapses Notes unless pinned or actively editing. */
  collapseToken?: number
  /** Bumps when search results are cleared — opens Notes again. */
  expandToken?: number
  onUseAsSearch?: (text: string) => void
}

const NOTES_PIN_KEY = 'ai-forall-notes-pinned'
const PEN_COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#ca8a04'] as const
const PEN_WIDTHS = [1.6, 2.4, 4.2, 7] as const
const ERASER_RADIUS = 28

type DrawTool = 'pen' | 'eraser'
type FileHandle = FileSystemFileHandle

/** App-owned note file: text + handwriting strokes. Not plain .txt (that cannot store drawing). */
const NOTE_EXT = '.note'
const NOTE_MIME = 'application/json'
const NOTE_FORMAT_VERSION = 1

type NoteFilePayload = {
  format: 'ai-forall-note'
  version: number
  text: string
  strokes: NoteStroke[]
  updatedAt: number
}

function defaultNoteName(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `note-${y}-${m}-${day}${NOTE_EXT}`
}

/** Always save as .note — app chooses the format, not the user. */
function ensureNoteFileName(name: string): string {
  const trimmed = (name || '').trim() || defaultNoteName()
  const bare = trimmed.replace(/\.[^.]+$/i, '')
  return `${bare || 'note'}${NOTE_EXT}`
}

function serializeNote(text: string, strokes: NoteStroke[]): string {
  const payload: NoteFilePayload = {
    format: 'ai-forall-note',
    version: NOTE_FORMAT_VERSION,
    text,
    strokes,
    updatedAt: Date.now(),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

function parseNoteFile(raw: string): { text: string; strokes: NoteStroke[] } {
  const trimmed = raw.trim()
  if (!trimmed) return { text: '', strokes: [] }
  // Plain .txt from older saves: text only
  if (!trimmed.startsWith('{')) {
    return { text: raw, strokes: [] }
  }
  try {
    const data = JSON.parse(trimmed) as Partial<NoteFilePayload> & { title?: string }
    if (data && (data.format === 'ai-forall-note' || Array.isArray(data.strokes) || typeof data.text === 'string')) {
      const strokes = Array.isArray(data.strokes) ? (data.strokes as NoteStroke[]) : []
      return { text: typeof data.text === 'string' ? data.text : '', strokes }
    }
  } catch {
    // fall through to plain text
  }
  return { text: raw, strokes: [] }
}

function supportsFilePicker(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window
}

function NoteButton({
  icon,
  label,
  onClick,
  disabled,
  primary,
  accent,
  listening,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  accent?: string
  listening?: boolean
}) {
  return (
    <button
      type="button"
      className={`md-text-btn${primary ? ' md-text-btn-primary' : ' btn-secondary'}${listening ? ' listening' : ''}`}
      style={primary ? { background: accent } : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <MdIcon name={icon} />
      <span>{label}</span>
    </button>
  )
}

function paintCanvas(canvas: HTMLCanvasElement, strokes: NoteStroke[]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#fffef8'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
    }
    ctx.stroke()
  }
}

function strokeHitsPoint(stroke: NoteStroke, x: number, y: number, radius: number): boolean {
  const r2 = radius * radius
  for (const point of stroke.points) {
    const dx = point.x - x
    const dy = point.y - y
    if (dx * dx + dy * dy <= r2) return true
  }
  return false
}

export function NotesPanel({ lang, accent, collapseToken = 0, expandToken = 0, onUseAsSearch }: Props) {
  const ensureAuth = useRequireAuth()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const current = useRef<NoteStroke | null>(null)
  const fileHandleRef = useRef<FileHandle | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [fileLabel, setFileLabel] = useState('')
  const [text, setText] = useState('')
  const [strokes, setStrokes] = useState<NoteStroke[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const speechSessionRef = useRef<SpeechSession | null>(null)
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(NOTES_PIN_KEY) === '1'
    } catch {
      return false
    }
  })
  /** Start open so Notes is ready; Pin is optional (keeps Notes open during search). */
  const [open, setOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [drawTool, setDrawTool] = useState<DrawTool>('pen')
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0])
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[1])
  const [undoStack, setUndoStack] = useState<NoteStroke[][]>([])
  const [redoStack, setRedoStack] = useState<NoteStroke[][]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    paintCanvas(canvas, strokes)
  }, [strokes, open, fullscreen])

  function commitStrokes(next: NoteStroke[] | ((prev: NoteStroke[]) => NoteStroke[])) {
    setStrokes((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      setUndoStack((stack) => [...stack.slice(-40), prev])
      setRedoStack([])
      return value
    })
  }

  useEffect(() => {
    if (!fullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [fullscreen])

  function enterFullscreen() {
    setOpen(true)
    setFullscreen(true)
  }

  function exitFullscreen() {
    setFullscreen(false)
  }

  useEffect(() => {
    if (collapseToken <= 0) return
    if (pinned) {
      setOpen(true)
      return
    }
    const active = document.activeElement
    const editingInside = Boolean(bodyRef.current && active && bodyRef.current.contains(active))
    if (recording || busy || drawing.current || editingInside) return
    setOpen(false)
  }, [collapseToken, pinned, recording, busy])

  useEffect(() => {
    if (expandToken <= 0) return
    setOpen(true)
  }, [expandToken])

  function setPinnedPersist(next: boolean) {
    setPinned(next)
    try {
      localStorage.setItem(NOTES_PIN_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (next) setOpen(true)
  }

  function toggleOpen() {
    if (pinned) return
    setOpen((currentOpen) => !currentOpen)
  }

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const point = pointFromEvent(event)
    if (drawTool === 'eraser') {
      commitStrokes((prev) => prev.filter((stroke) => !strokeHitsPoint(stroke, point.x, point.y, ERASER_RADIUS)))
      current.current = null
      return
    }
    const stroke = { color: penColor, width: penWidth, points: [point] }
    current.current = stroke
    commitStrokes((prev) => [...prev, stroke])
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const point = pointFromEvent(event)
    if (drawTool === 'eraser') {
      setStrokes((prev) => {
        const next = prev.filter((stroke) => !strokeHitsPoint(stroke, point.x, point.y, ERASER_RADIUS))
        return next.length === prev.length ? prev : next
      })
      return
    }
    if (!current.current) return
    current.current.points.push(point)
    const snapshot = { ...current.current, points: [...current.current.points] }
    setStrokes((prev) => {
      if (!prev.length) return [snapshot]
      return [...prev.slice(0, -1), snapshot]
    })
  }

  function onPointerUp() {
    drawing.current = false
    current.current = null
  }

  function undoStroke() {
    setUndoStack((stack) => {
      if (!stack.length) return stack
      const previous = stack[stack.length - 1]
      setStrokes((current) => {
        setRedoStack((redo) => [...redo, current])
        return previous
      })
      return stack.slice(0, -1)
    })
  }

  function redoStroke() {
    setRedoStack((stack) => {
      if (!stack.length) return stack
      const next = stack[stack.length - 1]
      setStrokes((current) => {
        setUndoStack((undo) => [...undo, current])
        return next
      })
      return stack.slice(0, -1)
    })
  }

  function clearPad() {
    if (!strokes.length) return
    commitStrokes([])
  }

  function onNew() {
    fileHandleRef.current = null
    setFileLabel('')
    setText('')
    setStrokes([])
    setUndoStack([])
    setRedoStack([])
    setStatus(t(lang, 'noteNewReady'))
  }

  async function writeToHandle(handle: FileHandle, contents: string) {
    const writable = await handle.createWritable()
    await writable.write(contents)
    await writable.close()
  }

  async function onSave() {
    const payload = serializeNote(text, strokes)
    const suggested = ensureNoteFileName(fileLabel || defaultNoteName())
    try {
      if (fileHandleRef.current) {
        await writeToHandle(fileHandleRef.current, payload)
        setStatus(t(lang, 'noteSavedFile').replace('{name}', fileHandleRef.current.name || suggested))
        return
      }
      if (supportsFilePicker()) {
        try {
          // @ts-expect-error File System Access API
          const handle = await window.showSaveFilePicker({
            suggestedName: suggested,
            excludeAcceptAllOption: true,
            types: [{
              description: t(lang, 'noteFileType'),
              accept: { [NOTE_MIME]: [NOTE_EXT] },
            }],
          }) as FileHandle
          await writeToHandle(handle, payload)
          fileHandleRef.current = handle
          const savedName = ensureNoteFileName(handle.name || suggested)
          setFileLabel(savedName)
          setStatus(t(lang, 'noteSavedFile').replace('{name}', savedName))
          return
        } catch (exc) {
          if (exc instanceof DOMException && exc.name === 'AbortError') {
            setStatus(t(lang, 'cancelled'))
            return
          }
        }
      }
      const blob = new Blob([payload], { type: NOTE_MIME })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = suggested
      a.click()
      URL.revokeObjectURL(url)
      setFileLabel(suggested)
      setStatus(t(lang, 'noteSavedDownload').replace('{name}', suggested))
    } catch (exc) {
      setStatus(formatApiError(exc, t(lang, 'somethingWrong')))
    }
  }

  async function onOpen() {
    try {
      if (!supportsFilePicker()) {
        setStatus(t(lang, 'noteOpenUnsupported'))
        return
      }
      // @ts-expect-error File System Access API
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: true,
        types: [{
          description: t(lang, 'noteFileType'),
          accept: {
            [NOTE_MIME]: [NOTE_EXT],
            'text/plain': ['.txt'],
          },
        }],
      }) as FileHandle[]
      const file = await handle.getFile()
      const contents = await file.text()
      const parsed = parseNoteFile(contents)
      fileHandleRef.current = handle
      setFileLabel(ensureNoteFileName(handle.name || file.name))
      setText(parsed.text)
      setStrokes(parsed.strokes)
      setUndoStack([])
      setRedoStack([])
      setStatus(t(lang, 'noteOpenedFile').replace('{name}', handle.name || file.name))
    } catch (exc) {
      if (exc instanceof DOMException && exc.name === 'AbortError') {
        setStatus(t(lang, 'cancelled'))
        return
      }
      setStatus(formatApiError(exc, t(lang, 'somethingWrong')))
    }
  }

  async function handwritingToText() {
    const canvas = canvasRef.current
    if (!canvas || !strokes.length) {
      setStatus(t(lang, 'noteNeedHandwriting'))
      return
    }
    setBusy(true)
    setStatus(t(lang, 'noteOcrWorking'))
    if (!(await ensureAuth())) {
      setBusy(false)
      setStatus(t(lang, 'signIn'))
      return
    }
    try {
      paintCanvas(canvas, strokes)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) {
        setStatus(t(lang, 'somethingWrong'))
        return
      }
      const form = new FormData()
      form.append('files', new File([blob], 'handwriting.png', { type: 'image/png' }))
      const result = await runTool('ocr', form)
      let next = ''
      if (result.downloads?.[0]?.url) {
        next = await fetchDownloadText(result.downloads[0].url)
      }
      if (!next) next = (result.message || '').trim()
      if (!next || /^ocr complete$/i.test(next)) {
        setStatus(t(lang, 'noteOcrEmpty'))
        return
      }
      setText((prev) => (prev.trim() ? `${prev.trim()}\n${next}` : next))
      setStatus(t(lang, 'noteOcrDone'))
    } catch (exc) {
      setStatus(formatApiError(exc, t(lang, 'noteOcrFailed')))
    } finally {
      setBusy(false)
    }
  }

  function useAsSearch() {
    const body = text.replace(/\s+/g, ' ').trim()
    if (!body) {
      setStatus(t(lang, 'noteNeedText'))
      return
    }
    if (!onUseAsSearch) {
      setStatus(t(lang, 'somethingWrong'))
      return
    }
    onUseAsSearch(body)
    setStatus(t(lang, 'noteSentToSearch'))
  }

  function applySpeechText(base: string, finalText: string, interim: string) {
    const spoken = [finalText, interim].filter((part) => part.trim()).join(' ').replace(/\s+/g, ' ').trim()
    const prior = base.trim()
    setText(prior && spoken ? `${prior}\n${spoken}` : (spoken || prior))
  }

  function restartSpeechRecognition(recognition: SpeechRec, session: SpeechSession) {
    if (session.stopped || speechSessionRef.current !== session) return
    const tryStart = () => {
      if (session.stopped || speechSessionRef.current !== session) return
      try {
        recognition.start()
      } catch {
        window.setTimeout(() => {
          if (session.stopped || speechSessionRef.current !== session) return
          try { recognition.start() } catch { /* keep Listening UI; user can Stop */ }
        }, 180)
      }
    }
    window.setTimeout(tryStart, 60)
  }

  function stopSpeechCapture() {
    const session = speechSessionRef.current
    if (session) session.stopped = true
    speechSessionRef.current = null
    setRecording(false)
    try { session?.rec.stop() } catch { /* ignore */ }
    try { session?.rec.abort?.() } catch { /* ignore */ }
  }

  function startRec() {
    if (recording) {
      stopSpeechCapture()
      setStatus(t(lang, 'noteTranscribed'))
      return
    }
    setStatus('')
    const ctor = (window as unknown as {
      SpeechRecognition?: new () => SpeechRec
      webkitSpeechRecognition?: new () => SpeechRec
    }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition

    if (!ctor) {
      setStatus(t(lang, 'speechUnsupported'))
      return
    }

    const recognition = new ctor()
    recognition.lang = speechLang(lang)
    recognition.continuous = true
    recognition.interimResults = true
    const session: SpeechSession = {
      rec: recognition,
      base: text,
      stopped: false,
    }
    speechSessionRef.current = session
    recognition.onresult = (event) => {
      let finalText = ''
      let interim = ''
      for (let i = 0; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += `${piece} `
        else interim += piece
      }
      applySpeechText(session.base, finalText, interim)
    }
    recognition.onerror = (event) => {
      if (session.stopped) return
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setStatus(t(lang, 'micDenied'))
        stopSpeechCapture()
        return
      }
      // Same as agent: Chrome ends turns with aborted/no-speech; keep listening.
      if (event.error === 'no-speech' || event.error === 'aborted') return
      if (event.error === 'network' || event.error === 'audio-capture') {
        setStatus(t(lang, 'voiceFailed'))
        stopSpeechCapture()
      }
    }
    recognition.onend = () => {
      restartSpeechRecognition(recognition, session)
    }
    try {
      recognition.start()
      setRecording(true)
      setStatus(t(lang, 'listening'))
    } catch {
      speechSessionRef.current = null
      setStatus(t(lang, 'voiceFailed'))
    }
  }

  function stopRec() {
    const hadSpeech = Boolean(speechSessionRef.current && !speechSessionRef.current.stopped)
    stopSpeechCapture()
    setStatus(hadSpeech ? t(lang, 'noteTranscribed') : t(lang, 'cancelled'))
  }

  const fileHint: ReactNode = fileLabel
    ? <p className="field-hint">{t(lang, 'noteOpenFile')}: {fileLabel}</p>
    : null

  const panelOpen = pinned || open

  const showPadHint = !strokes.length && !text.trim() && !recording

  const toolsBox = (
    <div className="note-tools-box" role="toolbar" aria-label={t(lang, 'notesTitle')}>
      <NoteButton icon="note_add" label={t(lang, 'noteNew')} onClick={onNew} disabled={busy} />
      <NoteButton icon="folder_open" label={t(lang, 'noteOpen')} onClick={() => void onOpen()} disabled={busy} />
      <NoteButton icon="save" label={t(lang, 'noteSave')} onClick={() => void onSave()} disabled={busy} />
      <NoteButton icon="search" label={t(lang, 'noteUseAsSearch')} onClick={useAsSearch} disabled={busy} />
      {!recording ? (
        <NoteButton
          icon="mic"
          label={t(lang, 'voice')}
          onClick={startRec}
          disabled={busy}
          primary
          accent={accent}
        />
      ) : (
        <NoteButton
          icon="stop"
          label={t(lang, 'stop')}
          onClick={stopRec}
          listening
        />
      )}
      <span className="note-pen-sep" aria-hidden="true" />
      <button
        type="button"
        className={`note-pen-tool${drawTool === 'pen' ? ' on' : ''}`}
        onClick={() => setDrawTool('pen')}
        title={t(lang, 'notePen')}
        aria-pressed={drawTool === 'pen'}
      >
        <MdIcon name="edit" />
        <span>{t(lang, 'notePen')}</span>
      </button>
      <button
        type="button"
        className={`note-pen-tool${drawTool === 'eraser' ? ' on' : ''}`}
        onClick={() => setDrawTool('eraser')}
        title={t(lang, 'noteEraser')}
        aria-pressed={drawTool === 'eraser'}
      >
        <MdIcon name="ink_eraser" />
        <span>{t(lang, 'noteEraser')}</span>
      </button>
      <div className="note-pen-colors" role="group" aria-label={t(lang, 'notePenColor')}>
        {PEN_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`note-pen-swatch${penColor === color && drawTool === 'pen' ? ' on' : ''}`}
            style={{ background: color }}
            onClick={() => {
              setPenColor(color)
              setDrawTool('pen')
            }}
            title={color}
            aria-label={color}
            aria-pressed={penColor === color && drawTool === 'pen'}
          />
        ))}
      </div>
      <div className="note-pen-widths" role="group" aria-label={t(lang, 'notePenSize')}>
        {PEN_WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            className={`note-pen-width${penWidth === width && drawTool === 'pen' ? ' on' : ''}`}
            onClick={() => {
              setPenWidth(width)
              setDrawTool('pen')
            }}
            title={`${t(lang, 'notePenSize')} ${width}`}
            aria-pressed={penWidth === width && drawTool === 'pen'}
          >
            <span className="note-pen-width-dot" style={{ width: `${width * 1.6}px`, height: `${width * 1.6}px` }} />
          </button>
        ))}
      </div>
      <span className="note-pen-sep" aria-hidden="true" />
      <button type="button" className="note-pen-tool" onClick={undoStroke} disabled={!undoStack.length} title={t(lang, 'noteUndo')}>
        <MdIcon name="undo" />
        <span>{t(lang, 'noteUndo')}</span>
      </button>
      <button type="button" className="note-pen-tool" onClick={redoStroke} disabled={!redoStack.length} title={t(lang, 'noteRedo')}>
        <MdIcon name="redo" />
        <span>{t(lang, 'noteRedo')}</span>
      </button>
      <button type="button" className="note-pen-tool" onClick={clearPad} disabled={!strokes.length} title={t(lang, 'noteClearPad')}>
        <MdIcon name="delete" />
        <span>{t(lang, 'noteClearPad')}</span>
      </button>
      <button
        type="button"
        className="note-pen-tool"
        onClick={() => void handwritingToText()}
        disabled={busy || !strokes.length}
        title={t(lang, 'noteHandwritingToText')}
      >
        <MdIcon name="gesture" />
        <span>{t(lang, 'noteHandwritingToText')}</span>
      </button>
    </div>
  )

  const canvasBlock = (
    <div className={`note-canvas-wrap${drawTool === 'eraser' ? ' is-eraser' : ''}`}>
      {showPadHint ? (
        <p className="note-pad-hint" aria-hidden="true">{t(lang, 'notesDesc')}</p>
      ) : null}
      <canvas
        ref={canvasRef}
        className="note-canvas"
        width={960}
        height={440}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  )

  return (
    <section
      className={`note-card${panelOpen ? ' is-open' : ' is-collapsed'}${pinned ? ' is-pinned' : ''}${fullscreen ? ' is-fullscreen' : ''}`}
      aria-modal={fullscreen || undefined}
      role={fullscreen ? 'dialog' : undefined}
      aria-label={fullscreen ? t(lang, 'notesFullscreen') : undefined}
    >
      <div className="note-card-bar">
        {fullscreen ? (
          <button
            type="button"
            className="note-pin-btn note-fullscreen-back"
            onClick={exitFullscreen}
            title={t(lang, 'notesFullscreenBack')}
          >
            <MdIcon name="arrow_back" />
            <span>{t(lang, 'notesFullscreenBack')}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="note-toggle"
          onClick={() => {
            if (!fullscreen) toggleOpen()
          }}
          aria-expanded={panelOpen}
          aria-controls="notes-panel-body"
          disabled={pinned || fullscreen}
          title={pinned ? t(lang, 'notesUnpinToCollapse') : (panelOpen ? t(lang, 'notesCollapse') : t(lang, 'notesExpand'))}
        >
          <MdIcon name={panelOpen ? 'expand_less' : 'expand_more'} />
          <span className="note-toggle-title">{t(lang, 'notesTitle')}</span>
        </button>
        {!fullscreen ? (
          <button
            type="button"
            className="note-pin-btn"
            onClick={enterFullscreen}
            title={t(lang, 'notesFullscreen')}
          >
            <MdIcon name="fullscreen" />
            <span>{t(lang, 'notesFullscreen')}</span>
          </button>
        ) : null}
        {!fullscreen ? (
          <button
            type="button"
            className={`note-pin-btn${pinned ? ' active' : ''}`}
            onClick={() => setPinnedPersist(!pinned)}
            aria-pressed={pinned}
            title={pinned ? t(lang, 'notesUnpin') : t(lang, 'notesPin')}
          >
            <MdIcon name="push_pin" />
            <span>{pinned ? t(lang, 'notesUnpin') : t(lang, 'notesPin')}</span>
          </button>
        ) : null}
      </div>
      {panelOpen ? (
        <div id="notes-panel-body" className="note-card-body" ref={bodyRef}>
          {fileHint}
          {toolsBox}
          {status ? <p className="field-hint note-status" style={{ color: accent }} role="status">{status}</p> : null}
          {fullscreen ? (
            <div className="note-handwrite-stage">{canvasBlock}</div>
          ) : (
            <>
              <div className="note-write-area">
                {canvasBlock}
                <textarea
                  className="note-text"
                  rows={11}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t(lang, 'noteTextPlaceholder')}
                />
              </div>
              <p className="field-hint">{t(lang, 'noteKeepOpenHint')}</p>
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}
