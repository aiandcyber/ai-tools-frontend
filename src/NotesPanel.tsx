import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { runTool, transcribeAudio } from './api'
import { t, type Lang } from './i18n'
import {
  deleteNote,
  downloadNoteFile,
  getNote,
  listNotes,
  newNoteId,
  saveNote,
  type NoteStroke,
  type UserNote,
} from './notesStore'

type Props = {
  lang: Lang
  accent: string
}

export function NotesPanel({ lang, accent }: Props) {
  return (
    <div className="notes-panel">
      <HandwrittenNotes lang={lang} accent={accent} />
      <LiveAudioNotes lang={lang} accent={accent} />
    </div>
  )
}

function HandwrittenNotes({ lang, accent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const current = useRef<NoteStroke | null>(null)
  const [noteId, setNoteId] = useState(() => newNoteId())
  const [title, setTitle] = useState('Untitled note')
  const [text, setText] = useState('')
  const [strokes, setStrokes] = useState<NoteStroke[]>([])
  const [notes, setNotes] = useState<UserNote[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function refreshList() {
    setNotes(await listNotes())
  }

  useEffect(() => {
    void refreshList()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
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
  }, [strokes])

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
    const stroke = { color: '#111827', width: 2.4, points: [pointFromEvent(event)] }
    current.current = stroke
    setStrokes((prev) => [...prev, stroke])
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !current.current) return
    current.current.points.push(pointFromEvent(event))
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

  async function onSave() {
    const note: UserNote = {
      id: noteId,
      title: title.trim() || 'Untitled note',
      text,
      strokes,
      updatedAt: Date.now(),
      kind: strokes.length ? 'handwritten' : 'mixed',
    }
    await saveNote(note)
    setStatus(t(lang, 'noteSaved'))
    await refreshList()
  }

  async function onOpen(id: string) {
    const note = await getNote(id)
    if (!note) {
      setStatus(t(lang, 'noteMissing'))
      return
    }
    setNoteId(note.id)
    setTitle(note.title)
    setText(note.text)
    setStrokes(note.strokes || [])
    setStatus(t(lang, 'noteOpened'))
  }

  function onNew() {
    setNoteId(newNoteId())
    setTitle('Untitled note')
    setText('')
    setStrokes([])
    setStatus(t(lang, 'noteNew'))
  }

  async function runOnText(toolId: 'summarize' | 'translate') {
    const body = text.trim()
    if (!body) {
      setStatus(t(lang, 'noteNeedText'))
      return
    }
    setBusy(true)
    setStatus(t(lang, 'working'))
    try {
      const form = new FormData()
      form.set('text', body)
      if (toolId === 'translate') {
        form.set('source_language', 'auto')
        form.set('language', lang === 'yue' ? 'yue' : lang === 'zh' ? 'zh' : 'en')
      }
      const result = await runTool(toolId, form)
      const next = result.message || body
      setText(next)
      setStatus(result.message || t(lang, 'result'))
    } catch (exc) {
      setStatus(exc instanceof Error ? exc.message : t(lang, 'somethingWrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="note-card">
      <h3>{t(lang, 'handwrittenNotes')}</h3>
      <p>{t(lang, 'handwrittenNotesDesc')}</p>
      <div className="note-toolbar">
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t(lang, 'noteTitle')} />
        <button type="button" className="btn-secondary" onClick={onNew}>{t(lang, 'noteNew')}</button>
        <button type="button" className="btn-secondary" onClick={() => void onSave()} disabled={busy}>{t(lang, 'noteSave')}</button>
        <button type="button" className="btn-secondary" onClick={() => void runOnText('summarize')} disabled={busy}>{t(lang, 'noteSummarize')}</button>
        <button type="button" className="btn-secondary" onClick={() => void runOnText('translate')} disabled={busy}>{t(lang, 'noteTranslate')}</button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => downloadNoteFile({
            id: noteId, title, text, strokes, updatedAt: Date.now(), kind: 'handwritten',
          })}
        >
          {t(lang, 'noteExport')}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="note-canvas"
        width={900}
        height={320}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <textarea
        className="note-text"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t(lang, 'noteTextPlaceholder')}
      />
      <div className="note-list">
        <strong>{t(lang, 'noteLibrary')}</strong>
        <ul>
          {notes.map((note) => (
            <li key={note.id}>
              <button type="button" className="linkish" onClick={() => void onOpen(note.id)}>{note.title}</button>
              <button type="button" className="linkish" onClick={() => void deleteNote(note.id).then(refreshList)}>{t(lang, 'noteDelete')}</button>
            </li>
          ))}
        </ul>
      </div>
      {status ? <p className="field-hint" style={{ color: accent }}>{status}</p> : null}
    </section>
  )
}

function LiveAudioNotes({ lang, accent }: Props) {
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [title, setTitle] = useState('Live audio note')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [noteId, setNoteId] = useState(() => newNoteId())
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function startRec() {
    setStatus('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        void finishRec()
      }
      mediaRef.current = rec
      rec.start()
      setRecording(true)
      setStatus(t(lang, 'listening'))
    } catch {
      setStatus(t(lang, 'micDenied'))
    }
  }

  function stopRec() {
    mediaRef.current?.stop()
    setRecording(false)
  }

  async function finishRec() {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    if (!blob.size) {
      setStatus(t(lang, 'voiceFailed'))
      return
    }
    setBusy(true)
    setStatus(t(lang, 'uploadCheckScan'))
    try {
      const heard = await transcribeAudio(blob, lang)
      setTranscript((prev) => (prev ? `${prev}\n${heard}` : heard))
      setStatus(t(lang, 'noteTranscribed'))
    } catch (exc) {
      setStatus(exc instanceof Error ? exc.message : t(lang, 'voiceFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function onSave() {
    const note: UserNote = {
      id: noteId,
      title: title.trim() || 'Live audio note',
      text: transcript,
      strokes: [],
      updatedAt: Date.now(),
      kind: 'live_audio',
    }
    await saveNote(note)
    setStatus(t(lang, 'noteSaved'))
  }

  async function act(toolId: 'summarize' | 'translate') {
    if (!transcript.trim()) {
      setStatus(t(lang, 'noteNeedText'))
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.set('text', transcript)
      if (toolId === 'translate') {
        form.set('source_language', 'auto')
        form.set('language', lang === 'yue' ? 'yue' : lang === 'zh' ? 'zh' : 'en')
      }
      const result = await runTool(toolId, form)
      setTranscript(result.message || transcript)
      setStatus(result.message || t(lang, 'result'))
    } catch (exc) {
      setStatus(exc instanceof Error ? exc.message : t(lang, 'somethingWrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="note-card">
      <h3>{t(lang, 'liveAudioNotes')}</h3>
      <p>{t(lang, 'liveAudioNotesDesc')}</p>
      <div className="note-toolbar">
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t(lang, 'noteTitle')} />
        {!recording ? (
          <button type="button" className="btn-primary" style={{ background: accent }} onClick={() => void startRec()} disabled={busy}>
            {t(lang, 'noteStartListen')}
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={stopRec}>{t(lang, 'noteStopListen')}</button>
        )}
        <button type="button" className="btn-secondary" onClick={() => void onSave()} disabled={busy}>{t(lang, 'noteSave')}</button>
        <button type="button" className="btn-secondary" onClick={() => void act('summarize')} disabled={busy}>{t(lang, 'noteSummarize')}</button>
        <button type="button" className="btn-secondary" onClick={() => void act('translate')} disabled={busy}>{t(lang, 'noteTranslate')}</button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setNoteId(newNoteId())
            setTitle('Live audio note')
            setTranscript('')
            setStatus(t(lang, 'noteNew'))
          }}
        >
          {t(lang, 'noteNew')}
        </button>
      </div>
      <textarea
        className="note-text"
        rows={6}
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder={t(lang, 'liveAudioPlaceholder')}
      />
      {status ? <p className="field-hint" style={{ color: accent }}>{status}</p> : null}
    </section>
  )
}
