import { useEffect, useRef, useState } from 'react'
import { t, type Lang } from './i18n'

export type CaptureHit = {
  query?: string
  barcode?: string
  mode: 'people' | 'product' | 'topic'
  file?: File
}

type Tab = 'scan' | 'photo'

const BARCODE_FORMATS = new Set([
  'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar',
])

function detector(): BarcodeDetector | null {
  if (typeof window === 'undefined' || !window.BarcodeDetector) return null
  try {
    return new window.BarcodeDetector({
      formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix'],
    })
  } catch {
    return null
  }
}

export async function detectCodes(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]> {
  const det = detector()
  if (!det) return []
  try {
    const found = await det.detect(source)
    return found.filter((item) => item.rawValue).map((item) => ({ rawValue: item.rawValue, format: item.format }))
  } catch {
    return []
  }
}

export function hitFromCode(rawValue: string, format: string): CaptureHit {
  const value = rawValue.trim()
  const digits = value.replace(/\D/g, '')
  if (BARCODE_FORMATS.has(format) || (digits.length >= 8 && digits.length <= 14 && digits === value.replace(/\s/g, ''))) {
    return { barcode: digits || value, mode: 'product' }
  }
  return { query: value, mode: 'people' }
}

export function SearchCapture({
  lang,
  initialTab = 'scan',
  onClose,
  onHit,
}: {
  lang: Lang
  initialTab?: Tab
  onClose: () => void
  onHit: (hit: CaptureHit) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const albumRef = useRef<HTMLInputElement | null>(null)
  const onHitRef = useRef(onHit)
  onHitRef.current = onHit
  const [tab, setTab] = useState<Tab>(initialTab)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    let timer = 0
    async function start() {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
        }
        setError('')
      } catch {
        setError(t(lang, 'searchCameraNeed'))
      }
    }
    void start()

    if (tab === 'scan') {
      const tick = async () => {
        const video = videoRef.current
        if (video && video.readyState >= 2) {
          const codes = await detectCodes(video)
          if (cancelled) return
          if (codes[0]) {
            onHitRef.current(hitFromCode(codes[0].rawValue, codes[0].format))
            return
          }
        }
        timer = window.setTimeout(() => void tick(), 350)
      }
      timer = window.setTimeout(() => void tick(), 400)
    }

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [facing, tab, lang])

  async function onShutter() {
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      setError(t(lang, 'searchCameraNeed'))
      return
    }
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      if (!blob) return
      const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' })
      const bitmap = await createImageBitmap(file)
      const codes = await detectCodes(bitmap)
      bitmap.close()
      if (codes[0]) {
        onHit({ ...hitFromCode(codes[0].rawValue, codes[0].format), file })
        return
      }
      onHit({
        file,
        mode: facing === 'user' ? 'people' : 'product',
      })
    } finally {
      setBusy(false)
    }
  }

  async function onAlbum(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const bitmap = await createImageBitmap(file)
      const codes = await detectCodes(bitmap)
      bitmap.close()
      if (codes[0]) {
        onHit({ ...hitFromCode(codes[0].rawValue, codes[0].format), file })
        return
      }
      onHit({ file, mode: 'product' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="search-capture" role="dialog" aria-modal="true" aria-label={t(lang, 'searchCamera')}>
      <div className="search-capture-stage">
        <video ref={videoRef} playsInline muted autoPlay />
        {tab === 'scan' ? <div className="search-capture-frame" aria-hidden="true" /> : null}
        <div className="search-capture-top">
          <button type="button" className="search-capture-x" onClick={onClose}>{t(lang, 'searchClose')}</button>
          {tab === 'photo' ? (
            <button
              type="button"
              className="search-capture-face"
              onClick={() => setFacing((current) => (current === 'user' ? 'environment' : 'user'))}
            >
              {facing === 'user' ? t(lang, 'searchFace') : t(lang, 'searchProductCam')}
            </button>
          ) : null}
        </div>
        {tab === 'scan' ? <p className="search-capture-hint">{t(lang, 'searchScanning')}</p> : null}
        {error ? <p className="search-capture-error">{error}</p> : null}
      </div>
      <div className="search-capture-bar">
        <button type="button" className="search-capture-album" onClick={() => albumRef.current?.click()} disabled={busy}>
          {t(lang, 'searchAlbum')}
        </button>
        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void onAlbum(file)
          }}
        />
        {tab === 'photo' ? (
          <button type="button" className="search-shutter" aria-label={t(lang, 'searchPhoto')} disabled={busy} onClick={() => void onShutter()} />
        ) : (
          <span className="search-shutter ghost" aria-hidden="true" />
        )}
        <span className="search-capture-album spacer" />
      </div>
      <div className="search-capture-tabs">
        <button type="button" className={tab === 'scan' ? 'on' : ''} onClick={() => { setTab('scan'); setFacing('environment') }}>
          {t(lang, 'searchScan')}
        </button>
        <button type="button" className={tab === 'photo' ? 'on' : ''} onClick={() => setTab('photo')}>
          {t(lang, 'searchPhoto')}
        </button>
      </div>
    </div>
  )
}
