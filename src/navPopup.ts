/** V1d popup nav only: column groups (scan top→bottom) + benefit blurbs for the popup. */

export type NavPopupGroup = { label: string; ids: string[] }

/** Categories that open the floating tool popup (Home and Need New Tool? do not). */
export const POPUP_NAV_CATEGORIES = ['media', 'safety', 'pdf', 'image'] as const
export type PopupNavCategory = (typeof POPUP_NAV_CATEGORIES)[number]

export function isPopupNavCategory(id: string): id is PopupNavCategory {
  return (POPUP_NAV_CATEGORIES as readonly string[]).includes(id)
}

export const NAV_POPUP_GROUPS: Record<PopupNavCategory, NavPopupGroup[]> = {
  media: [
    { label: 'YouTube', ids: ['youtube_download', 'youtube_summarize', 'youtube_translate'] },
    { label: 'Translate & speech', ids: ['video_translate', 'audio_translate', 'tts', 'stt'] },
    { label: 'Edit media', ids: ['extract_audio', 'media_compress', 'media_trim', 'media_convert'] },
  ],
  safety: [
    {
      label: 'Check & protect',
      ids: ['scan_file', 'scan_message', 'image_strip_exif', 'image_privacy_check'],
    },
  ],
  pdf: [
    { label: 'Combine & shrink', ids: ['pdf_merge', 'pdf_compress', 'images_to_pdf', 'generate_document'] },
    { label: 'Edit & secure', ids: ['pdf_pages', 'pdf_unlock', 'pdf_protect', 'pdf_decorate'] },
    { label: 'Get content out', ids: ['ocr', 'pdf_extract_text', 'pdf_extract_images', 'pdf_to_images'] },
  ],
  image: [
    {
      label: 'Photos',
      ids: ['image_compress', 'image_convert', 'image_watermark', 'image_remove_bg', 'favicon'],
    },
    { label: 'Codes', ids: ['qr_scan', 'qr_generate', 'barcode_scan', 'barcode_generate'] },
  ],
}

/** Popup-only benefit lines (does not change tool panel copy). */
export const NAV_POPUP_BLURBS: Record<string, string> = {
  youtube_download: 'Save any YouTube video, or just the audio as MP3, to keep offline',
  youtube_summarize: 'Get the key points of a long video without watching the whole thing',
  youtube_translate: 'Translate any YouTube video into your own language',
  video_translate: 'Understand a video you uploaded when it’s in another language',
  audio_translate: 'Hear or read an audio file in the language you prefer',
  tts: 'Listen to written text when you can’t or don’t want to read',
  stt: 'Turn a recording into text you can search, edit, or share',
  extract_audio: 'Keep only the sound from a video for listening or reuse',
  media_compress: 'Make a big video or audio file small enough to send or store',
  media_trim: 'Keep only the part of a clip you actually need',
  media_convert: 'Open or share a file in a format that works on your device',
  scan_file: 'Check a file before you open or share it',
  scan_message: 'Check a message or link that might be a scam',
  image_strip_exif: 'Stop photos from revealing where and when they were taken',
  image_privacy_check: 'See what personal details a photo may still be carrying',
  pdf_merge: 'Put several documents into one file that’s easier to send',
  pdf_compress: 'Shrink a large PDF so it fits email or upload limits',
  images_to_pdf: 'Turn photos or scans into one tidy PDF to share',
  generate_document: 'Draft a document or presentation from what you describe',
  pdf_pages: 'Fix page order or remove pages you don’t want others to see',
  pdf_unlock: 'Open a PDF again when you know the password',
  pdf_protect: 'Keep private files from being opened by anyone else',
  pdf_decorate: 'Mark pages as yours or add page numbers for printouts',
  ocr: 'Copy text from a scan or photo when you can’t select it',
  pdf_extract_text: 'Reuse wording from a PDF in your own notes or email',
  pdf_extract_images: 'Save pictures from a PDF to use elsewhere',
  pdf_to_images: 'Share or annotate pages as ordinary pictures',
  image_compress: 'Send or upload a photo without eating all your storage',
  image_convert: 'Change a picture into a format that opens where you need it',
  image_watermark: 'Show a photo is yours before you post or send it',
  image_remove_bg: 'Isolate a person or object for a clean cutout',
  favicon: 'Make a small icon that represents your site or app',
  qr_scan: 'Open a link or info from a QR without typing it',
  qr_generate: 'Let others reach your link by scanning a code',
  barcode_scan: 'Read a product code quickly from the package',
  barcode_generate: 'Print a code others can scan for your item or label',
}
