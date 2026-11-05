import { t, type Lang } from './i18n'

export function SiteFooter({
  lang,
  onPrivacy,
}: {
  lang: Lang
  onPrivacy: () => void
}) {
  return (
    <footer className="afa-footer">
      <div className="afa-footer-inner">
        <span>{t(lang, 'footerCompany')}</span>
        <button type="button" className="afa-footer-link" onClick={onPrivacy}>
          {t(lang, 'footerPrivacy')}
        </button>
      </div>
    </footer>
  )
}
