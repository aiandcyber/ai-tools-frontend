/** Local user notes (handwritten strokes + text + audio transcript). */

const DB_NAME = 'ai-tools-notes'
const STORE = 'notes'

export type NoteStroke = { color: string; width: number; points: { x: number; y: number }[] }

export type UserNote = {
  id: string
  title: string
  text: string
  strokes: NoteStroke[]
  updatedAt: number
  kind: 'handwritten' | 'live_audio' | 'mixed'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function newNoteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function listNotes(): Promise<UserNote[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const rows = (req.result as UserNote[]) || []
      rows.sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(rows)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getNote(id: string): Promise<UserNote | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as UserNote) || null)
    req.onerror = () => reject(req.error)
  })
}

export async function saveNote(note: UserNote): Promise<UserNote> {
  const next = { ...note, updatedAt: Date.now() }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(next)
    tx.oncomplete = () => resolve(next)
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteNote(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export function downloadNoteFile(note: UserNote) {
  const payload = {
    title: note.title,
    text: note.text,
    strokes: note.strokes,
    kind: note.kind,
    updatedAt: note.updatedAt,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(note.title || 'note').replace(/[^\w\- ]+/g, '').trim() || 'note'}.json`
  a.click()
  URL.revokeObjectURL(url)
}
