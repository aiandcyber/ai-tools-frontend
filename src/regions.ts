/** Product regions — same set as Senior (HK / China / India / USA / Other). */
export type RegionOption = { code: string; label: string }

/** Curated profiles that get stronger ranking when selected. */
export const PROFILE_REGIONS: RegionOption[] = [
  { code: 'HK', label: 'Hong Kong' },
  { code: 'CN', label: 'China' },
  { code: 'IN', label: 'India' },
  { code: 'US', label: 'USA' },
  { code: 'OTHER', label: 'Other' },
]

export const PROFILE_CODES = new Set(PROFILE_REGIONS.map((item) => item.code))

export function regionLabel(code: string): string | undefined {
  return PROFILE_REGIONS.find((item) => item.code === code)?.label
}
