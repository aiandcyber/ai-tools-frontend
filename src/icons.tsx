export const CATEGORIES = ['search', 'pdf', 'office', 'image', 'media', 'utility', 'ai'] as const

/** Top category tabs — AI is home (shows search). No separate Search tab. */
export const NAV_CATEGORIES = ['ai', 'media', 'pdf', 'office', 'image', 'utility'] as const

export type CategoryId = (typeof CATEGORIES)[number]
export type NavCategoryId = (typeof NAV_CATEGORIES)[number]

export const CATEGORY_META: Record<CategoryId, { accent: string; soft: string }> = {
  search: { accent: '#0e7490', soft: '#cffafe' },
  pdf: { accent: '#0f766e', soft: '#ccfbf1' },
  office: { accent: '#1d4ed8', soft: '#dbeafe' },
  image: { accent: '#c2410c', soft: '#ffedd5' },
  media: { accent: '#FF0000', soft: '#ffe4e4' },
  utility: { accent: '#155e75', soft: '#e0f2fe' },
  ai: { accent: '#115e59', soft: '#a7f3d0' },
}

export function CategoryIcon({ id }: { id: CategoryId }) {
  const stroke = 'currentColor'
  const common = { fill: 'none', stroke, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (id === 'search') {
    return (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <circle cx="11" cy="11" r="6" {...common} />
        <path {...common} d="M20 20l-3.5-3.5" />
      </svg>
    )
  }
  if (id === 'pdf') {
    return (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <path {...common} d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path {...common} d="M14 3v5h5M9 13h6M9 17h4" />
      </svg>
    )
  }
  if (id === 'office') {
    return (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <path {...common} d="M4 5h10v14H4zM14 8h6v11h-6" />
        <path {...common} d="M7 9h4M7 13h4M7 17h3" />
      </svg>
    )
  }
  if (id === 'image') {
    return (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" {...common} />
        <circle cx="9" cy="10" r="1.5" fill={stroke} stroke="none" />
        <path {...common} d="M3 16l5-4 4 3 3-2 6 4" />
      </svg>
    )
  }
  if (id === 'media') {
    return (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" stroke="none" />
        <path d="M10 9.2v5.6L15.5 12 10 9.2z" fill="#fff" stroke="none" />
      </svg>
    )
  }
  if (id === 'utility') {
    return (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <path {...common} d="M14.7 6.3a4 4 0 0 0-5.6 5.6L3 18v3h3l6.1-6.1" />
        <path {...common} d="M16 4l4 4" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <circle cx="12" cy="12" r="3" {...common} />
      <path {...common} d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  )
}

export function ToolGlyph({ category }: { category: string }) {
  const id = (CATEGORIES.includes(category as CategoryId) ? category : 'utility') as CategoryId
  return (
    <span className="tool-glyph" style={{ background: CATEGORY_META[id].soft, color: CATEGORY_META[id].accent }}>
      <CategoryIcon id={id} />
    </span>
  )
}
