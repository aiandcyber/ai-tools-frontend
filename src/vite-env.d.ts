/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_AUTH0_DOMAIN?: string
  readonly VITE_AUTH0_CLIENT_ID?: string
  readonly VITE_AUTH0_AUDIENCE?: string
  readonly VITE_AUTH_REQUIRED?: string
  readonly VITE_PORTAL_URL?: string
  readonly VITE_SCAN_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface BarcodeDetector {
  detect(image: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetector
}

interface Window {
  BarcodeDetector?: BarcodeDetectorConstructor
}
