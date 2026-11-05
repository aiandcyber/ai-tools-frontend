import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { runTool, transcribeAudio } from './api'
import { t, type Lang } from './i18n'
import { type NoteStroke } from './notesStore'
import { useRequireAuth } from './useRequireAuth'

type Props = {
  lang: Lang
  accent: string
  onUseAsSearch?: (text: string) => void
}

type FileHandle = FileSystemFileHandle

function defaultNoteName(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `note-${y}-${m}-${day}.txt`
}

function supportsFilePicker(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window
}

export function NotesPanel({ lang, accent, onUseAsSearch }: Props) {
  const ensureAuth = useRequireAuth()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const current = useRef<NoteStroke | null>(null)
  const fileHandleRef = useRef<FileHandle | null>(null)
  const [fileLabel, setFileLabel] = useState('')
  const [text, setText] = useState('')
  const [strokes, setStrokes] = useState<NoteStroke[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

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

  function onNew() {
    fileHandleRef.current = null
    setFileLabel('')
    setText('')
    setStrokes([])
    setStatus(t(lang, 'noteNew'))
  }

  async function writeToHandle(handle: FileHandle, contents: string) {
    const writable = await handle.createWritable()
    await writable.write(contents)
    await writable.close()
  }

  async function onSave() {
    const payload = text
    const suggested = fileLabel || defaultNoteName()
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
            types: [{ description: 'Text note', accept: { 'text/plain': ['.txt'] } }],
          }) as FileHandle
          await writeToHandle(handle, payload)
          fileHandleRef.current = handle
          setFileLabel(handle.name || suggested)
          setStatus(t(lang, 'noteSavedFile').replace('{name}', handle.name || suggested))
          return
        } catch (exc) {
          if (exc instanceof DOMException && exc.name === 'AbortError') {
            setStatus(t(lang, 'cancelled'))
            return
          }
        }
      }
      // Fallback: browser download with default name
      const blob = new Blob([payload], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = suggested
      a.click()
      URL.revokeObjectURL(url)
      setFileLabel(suggested)
      setStatus(t(lang, 'noteSavedDownload').replace('{name}', suggested))
    } catch (exc) {
      setStatus(exc instanceof Error ? exc.message : t(lang, 'somethingWrong'))
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
        types: [{ description: 'Text note', accept: { 'text/plain': ['.txt', '.md'] } }],
      }) as FileHandle[]
      const file = await handle.getFile()
      const contents = await file.text()
      fileHandleRef.current = handle
      setFileLabel(handle.name || file.name)
      setText(contents)
      setStrokes([])
      setStatus(t(lang, 'noteOpenedFile').replace('{name}', handle.name || file.name))
    } catch (exc) {
      if (exc instanceof DOMException && exc.name === 'AbortError') {
        setStatus(t(lang, 'cancelled'))
        return
      }
      setStatus(exc instanceof Error ? exc.message : t(lang, 'somethingWrong'))
    }
  }

  async function runOnText(toolId: 'summarize' | 'translate') {
    const body = text.trim()
    if (!body) {
      setStatus(t(lang, 'noteNeedText'))
      return
    }
    if (!(await ensureAuth())) {
      setStatus(t(lang, 'signIn'))
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
      let next = (result.message || '').trim()
      if (!next && result.downloads?.[0]?.url) {
        const res = await fetch(result.downloads[0].url)
        next = (await res.text()).trim()
      }
      if (!next) {
        setStatus(t(lang, 'somethingWrong'))
        return
      }
      setText(next)
      setStatus(t(lang, toolId === 'summarize' ? 'noteSummarized' : 'noteTranslated'))
    } catch (exc) {
      setStatus(exc instanceof Error ? exc.message : t(lang, 'somethingWrong'))
    } finally {
      setBusy(false)
    }
  }

  async function handwritingToText() {
    const canvas = canvasRef.current
    if (!canvas || !strokes.length) {
      setStatus(t(lang, 'noteNeedHandwriting'))
      return
    }
    if (!(await ensureAuth())) {
      setStatus(t(lang, 'signIn'))
      return
    }
    setBusy(true)
    setStatus(t(lang, 'noteOcrWorking'))
    try {
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
        const res = await fetch(result.downloads[0].url)
        next = (await res.text()).trim()
      }
      if (!next) next = (result.message || '').trim()
      if (!next || /^ocr complete$/i.test(next)) {
        setStatus(t(lang, 'noteOcrEmpty'))
        return
      }
      setText((prev) => (prev.trim() ? `${prev.trim()}\n${next}` : next))
      setStatus(t(lang, 'noteOcrDone'))
    } catch (exc) {
      setStatus(exc instanceof Error ? exc.message : t(lang, 'somethingWrong'))
    } finally {
      setBusy(false)
    }
  }

  function useAsSearch() {
    const body = text.trim()
    if (!body) {
      setStatus(t(lang, 'noteNeedText'))
      return
    }
    onUseAsSearch?.(body)
    setStatus(t(lang, 'noteSentToSearch'))
  }

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
      if (!(await ensureAuth())) {
        setStatus(t(lang, 'signIn'))
        return
      }
      const heard = await transcribeAudio(blob, lang)
      setText((prev) => (prev ? `${prev}\n${heard}` : heard))
      setStatus(t(lang, 'noteTranscribed'))
    } catch (exc) {
      setStatus(exc instanceof Error ? exc.message : t(lang, 'voiceFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="note-card">
      <h3>{t(lang, 'notesTitle')}</h3>
      <p>{t(lang, 'notesDesc')}</p>
      {fileLabel ? <p className="field-hint">{t(lang, 'noteOpenFile')}: {fileLabel}</p> : null}
      <div className="note-toolbar">
        <button type="button" className="btn-secondary" onClick={onNew} disabled={busy}>{t(lang, 'noteNew')}</button>
        <button type="button" className="btn-secondary" onClick={() => void onOpen()} disabled={busy}>{t(lang, 'noteOpen')}</button>
        <button type="button" className="btn-secondary" onClick={() => void onSave()} disabled={busy}>{t(lang, 'noteSave')}</button>
        <button type="button" className="btn-secondary" onClick={() => void runOnText('summarize')} disabled={busy}>{t(lang, 'noteSummarize')}</button>
        <button type="button" className="btn-secondary" onClick={() => void runOnText('translate')} disabled={busy}>{t(lang, 'noteTranslate')}</button>
        <button type="button" className="btn-secondary" onClick={() => void handwritingToText()} disabled={busy}>{t(lang, 'noteHandwritingToText')}</button>
        <button type="button" className="btn-secondary" onClick={useAsSearch} disabled={busy}>{t(lang, 'noteUseAsSearch')}</button>
        {!recording ? (
          <button type="button" className="btn-primary" style={{ background: accent }} onClick={() => void startRec()} disabled={busy}>
            {t(lang, 'noteStartListen')}
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={stopRec}>{t(lang, 'noteStopListen')}</button>
        )}
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
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t(lang, 'noteTextPlaceholder')}
      />
      {status ? <p className="field-hint note-status" style={{ color: accent }} role="status">{status}</p> : null}
      <p className="field-hint">{t(lang, 'noteKeepOpenHint')}</p>
    </section>
  )
}
