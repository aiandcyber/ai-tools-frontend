import { useEffect, useRef, useState } from 'react'
import { t, type Lang } from './i18n'

export type CaptureHit = {
  query?: string
  barcode?: string
  mode: 'people' | 'product' | 'topic'
  file?: File
}

type Tab = 'scan' | 'photo' | 'album'
export type PhotoTarget = 'face' | 'product'

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

function modeFromTarget(target: PhotoTarget): 'people' | 'product' {
  return target === 'face' ? 'people' : 'product'
}

async function frameFromVideo(video: HTMLVideoElement): Promise<File | null> {
  if (video.readyState < 2) return null
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 1280
  canvas.height = video.videoHeight || 720
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) return null
  return new File([blob], 'capture.jpg', { type: 'image/jpeg' })
}

export function SearchCapture({
  lang,
  initialTab = 'scan',
  initialPhotoTarget = null,
  variant = 'search',
  onClose,
  onHit,
}: {
  lang: Lang
  initialTab?: Exclude<Tab, 'album'>
  initialPhotoTarget?: PhotoTarget | null
  /** search = Face/Product flow; code = QR/barcode camera reuse without Face/Product */
  variant?: 'search' | 'code'
  onClose: () => void
  onHit: (hit: CaptureHit) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const albumRef = useRef<HTMLInputElement | null>(null)
  const onHitRef = useRef(onHit)
  onHitRef.current = onHit
  const [tab, setTab] = useState<Tab>(initialTab)
  const [photoTarget, setPhotoTarget] = useState<PhotoTarget | null>(
    variant === 'code' ? 'product' : initialPhotoTarget,
  )
  const facing = variant === 'code' ? 'environment' : (photoTarget === 'face' ? 'user' : 'environment')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const needsTarget = variant === 'search' && (tab === 'photo' || tab === 'album')
  const scanTabLabel = variant === 'code' ? t(lang, 'captureScan') : t(lang, 'searchScan')

  function choosePhotoTarget(next: PhotoTarget) {
    setPhotoTarget(next)
    setError('')
  }

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
      if (tab === 'album') {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (videoRef.current) videoRef.current.srcObject = null
        return
      }
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
        setError((current) => (current === t(lang, 'searchChooseFaceOrProduct') ? current : ''))
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
            const file = await frameFromVideo(video)
            onHitRef.current({ ...hitFromCode(codes[0].rawValue, codes[0].format), file: file || undefined })
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

  useEffect(() => {
    if (tab !== 'album') return
    if (variant === 'search' && !photoTarget) return
    const id = window.setTimeout(() => albumRef.current?.click(), 0)
    return () => window.clearTimeout(id)
  }, [tab, photoTarget, variant])

  async function onShutter() {
    if (variant === 'search' && !photoTarget) {
      setError(t(lang, 'searchChooseFaceOrProduct'))
      return
    }
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      setError(t(lang, 'searchCameraNeed'))
      return
    }
    setBusy(true)
    try {
      const file = await frameFromVideo(video)
      if (!file) return
      const bitmap = await createImageBitmap(file)
      const codes = await detectCodes(bitmap)
      bitmap.close()
      if (codes[0]) {
        onHit({ ...hitFromCode(codes[0].rawValue, codes[0].format), file })
        return
      }
      if (variant === 'code') {
        onHit({ file, mode: 'product' })
        return
      }
      onHit({ file, mode: modeFromTarget(photoTarget!) })
    } finally {
      setBusy(false)
    }
  }

  async function onAlbum(file: File | undefined) {
    if (!file) {
      if (tab === 'album') setTab(variant === 'code' ? 'scan' : 'photo')
      return
    }
    if (variant === 'search' && !photoTarget) {
      setError(t(lang, 'searchChooseFaceOrProduct'))
      return
    }
    setBusy(true)
    try {
      const bitmap = await createImageBitmap(file)
      const codes = await detectCodes(bitmap)
      bitmap.close()
      if (codes[0]) {
        onHit({ ...hitFromCode(codes[0].rawValue, codes[0].format), file })
        return
      }
      if (variant === 'code') {
        onHit({ file, mode: 'product' })
        return
      }
      onHit({ file, mode: modeFromTarget(photoTarget!) })
    } finally {
      setBusy(false)
    }
  }

  function openAlbumTab() {
    setTab('album')
    if (variant === 'search' && !photoTarget) setError(t(lang, 'searchChooseFaceOrProduct'))
    else setError('')
  }

  return (
    <div className="search-capture" role="dialog" aria-modal="true" aria-label={t(lang, 'searchCamera')}>
      <div className="search-capture-stage">
        {tab === 'album' ? (
          <div className="search-capture-album-empty">
            <p>
              {variant === 'code' || photoTarget
                ? t(lang, 'searchAlbumHint')
                : t(lang, 'searchChooseFaceOrProduct')}
            </p>
            <button
              type="button"
              className="search-capture-album-cta"
              disabled={busy || (variant === 'search' && !photoTarget)}
              onClick={() => albumRef.current?.click()}
            >
              {t(lang, 'searchAlbum')}
            </button>
          </div>
        ) : (
          <video ref={videoRef} playsInline muted autoPlay />
        )}
        {tab === 'scan' ? <div className="search-capture-frame" aria-hidden="true" /> : null}
        <div className="search-capture-top">
          <span className="search-capture-top-spacer" aria-hidden="true" />
          <button
            type="button"
            className="search-capture-close"
            aria-label={t(lang, 'searchClose')}
            title={t(lang, 'searchClose')}
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </div>
        {tab === 'scan' ? <p className="search-capture-hint">{t(lang, 'searchScanning')}</p> : null}
        {error ? <p className="search-capture-error">{error}</p> : null}
      </div>

      <div className="search-capture-chrome">
        <div className="search-capture-bar" role={needsTarget ? 'group' : undefined} aria-label={needsTarget ? t(lang, 'searchChooseFaceOrProduct') : undefined}>
          {needsTarget ? (
            <button
              type="button"
              className={`search-capture-target${photoTarget === 'face' ? ' on' : ''}`}
              aria-pressed={photoTarget === 'face'}
              onClick={() => choosePhotoTarget('face')}
            >
              {t(lang, 'searchFace')}
            </button>
          ) : (
            <span className="search-capture-side" aria-hidden="true" />
          )}
          {tab === 'photo' ? (
            <button type="button" className="search-shutter" aria-label={t(lang, 'searchPhoto')} disabled={busy} onClick={() => void onShutter()} />
          ) : tab === 'album' ? (
            <button
              type="button"
              className="search-capture-album-shutter"
              disabled={busy || (variant === 'search' && !photoTarget)}
              onClick={() => albumRef.current?.click()}
            >
              {t(lang, 'searchAlbum')}
            </button>
          ) : (
            <span className="search-shutter ghost" aria-hidden="true" />
          )}
          {needsTarget ? (
            <button
              type="button"
              className={`search-capture-target${photoTarget === 'product' ? ' on' : ''}`}
              aria-pressed={photoTarget === 'product'}
              onClick={() => choosePhotoTarget('product')}
            >
              {t(lang, 'searchProductCam')}
            </button>
          ) : (
            <span className="search-capture-side end" aria-hidden="true" />
          )}
        </div>

        <div className="search-capture-tabs" role="tablist" aria-label={t(lang, 'searchCamera')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'scan'}
            className={tab === 'scan' ? 'on' : ''}
            onClick={() => { setTab('scan'); setError('') }}
          >
            {scanTabLabel}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'photo'}
            className={tab === 'photo' ? 'on' : ''}
            onClick={() => { setTab('photo'); setError('') }}
          >
            {t(lang, 'searchPhoto')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'album'}
            className={tab === 'album' ? 'on' : ''}
            onClick={openAlbumTab}
          >
            {t(lang, 'searchAlbum')}
          </button>
        </div>
      </div>

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
    </div>
  )
}
