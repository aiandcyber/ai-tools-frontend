/** Remember where the user saved tool outputs (File System Access API). No server recreate. */

const DB_NAME = 'ai-tools-output-memory'
const STORE = 'handles'
const META_KEY = 'ai-tools-output-meta'

export type OutputMeta = {
  toolId: string
  name: string
  savedAt: number
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function supportsFilePicker(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

export function readOutputMeta(toolId: string): OutputMeta | null {
  try {
    const raw = localStorage.getItem(`${META_KEY}:${toolId}`)
    if (!raw) return null
    return JSON.parse(raw) as OutputMeta
  } catch {
    return null
  }
}

function writeOutputMeta(meta: OutputMeta) {
  localStorage.setItem(`${META_KEY}:${meta.toolId}`, JSON.stringify(meta))
}

export async function saveOutputAndRemember(
  toolId: string,
  downloadUrl: string,
  suggestedName: string,
): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const res = await fetch(downloadUrl)
  if (!res.ok) return { ok: false, reason: 'download_failed' }
  const blob = await res.blob()

  if (supportsFilePicker()) {
    try {
      // @ts-expect-error File System Access API
      const handle = await window.showSaveFilePicker({
        suggestedName,
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      const db = await idb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(handle, toolId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      writeOutputMeta({ toolId, name: handle.name || suggestedName, savedAt: Date.now() })
      return { ok: true, name: handle.name || suggestedName }
    } catch (exc) {
      if (exc instanceof DOMException && exc.name === 'AbortError') {
        return { ok: false, reason: 'cancelled' }
      }
      // Fall through to anchor download without handle memory.
    }
  }

  // Fallback browsers: trigger download; cannot reopen a path later.
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(objectUrl)
  writeOutputMeta({ toolId, name: suggestedName, savedAt: Date.now() })
  return { ok: false, reason: 'no_path_memory' }
}

export async function openRememberedOutput(
  toolId: string,
): Promise<{ ok: true; name: string } | { ok: false; reason: 'missing' | 'unsupported' | 'denied' }> {
  if (!supportsFilePicker()) return { ok: false, reason: 'unsupported' }
  try {
    const db = await idb()
    const handle = await new Promise<FileSystemFileHandle | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(toolId)
      req.onsuccess = () => resolve(req.result as FileSystemFileHandle | undefined)
      req.onerror = () => reject(req.error)
    })
    if (!handle) return { ok: false, reason: 'missing' }
    // @ts-expect-error queryPermission / requestPermission on file handles
    const q = await handle.queryPermission({ mode: 'read' })
    // @ts-expect-error requestPermission
    if (q !== 'granted' && (await handle.requestPermission({ mode: 'read' })) !== 'granted') {
      return { ok: false, reason: 'denied' }
    }
    const file = await handle.getFile()
    // Prove the file still exists by reading size; then open via object URL for viewing/download.
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
    return { ok: true, name: file.name }
  } catch {
    localStorage.removeItem(`${META_KEY}:${toolId}`)
    return { ok: false, reason: 'missing' }
  }
}
