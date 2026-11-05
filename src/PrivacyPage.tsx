import { SiteFooter } from './SiteFooter'
import { t, type Lang } from './i18n'

export function PrivacyPage({
  lang,
  onContact,
  onPrivacy,
}: {
  lang: Lang
  onContact: () => void
  onPrivacy: () => void
}) {
  return (
    <div className="privacy-page">
      <div className="privacy-page-inner">
        <h1>{t(lang, 'privacyTitle')}</h1>
        <p className="privacy-lead">
          {t(lang, 'privacyLead')}{' '}
          <a href="https://ai-forall.org/">https://ai-forall.org</a>
          {t(lang, 'privacyLeadAndTools')}
        </p>

        <h2>{t(lang, 'privacyWhoTitle')}</h2>
        <p>
          {t(lang, 'privacyWhoBody')}{' '}
          <a href="https://ai-forall.org/">https://ai-forall.org</a>.{' '}
          {t(lang, 'privacyWhoEmail')}{' '}
          <a href="mailto:Contact@ai-forall.org">Contact@ai-forall.org</a>.
        </p>

        <h2>{t(lang, 'privacyCollectTitle')}</h2>
        <p>{t(lang, 'privacyCollectIntro')}</p>
        <ul>
          <li>{t(lang, 'privacyCollectContact')}</li>
          <li>{t(lang, 'privacyCollectSignIn')}</li>
          <li>{t(lang, 'privacyCollectTechnical')}</li>
        </ul>

        <h2>{t(lang, 'privacyUseTitle')}</h2>
        <p>{t(lang, 'privacyUseBody')}</p>

        <h2>{t(lang, 'privacyCookiesTitle')}</h2>
        <p>{t(lang, 'privacyCookiesBody')}</p>

        <h2>{t(lang, 'privacyEmbedTitle')}</h2>
        <p>{t(lang, 'privacyEmbedBody')}</p>

        <h2>{t(lang, 'privacyShareTitle')}</h2>
        <p>{t(lang, 'privacyShareIntro')}</p>
        <ul>
          <li>{t(lang, 'privacyShareCloudflare')}</li>
          <li>{t(lang, 'privacyShareAuth0')}</li>
          <li>{t(lang, 'privacyShareGoogle')}</li>
        </ul>
        <p>{t(lang, 'privacyShareEmail')}</p>

        <h2>{t(lang, 'privacyKeepTitle')}</h2>
        <p>{t(lang, 'privacyKeepBody')}</p>

        <h2>{t(lang, 'privacyRightsTitle')}</h2>
        <p>
          {t(lang, 'privacyRightsBody')}{' '}
          <a href="mailto:Contact@ai-forall.org">Contact@ai-forall.org</a>.{' '}
          {t(lang, 'privacyRightsTail')}
        </p>

        <h2>{t(lang, 'privacyWhereTitle')}</h2>
        <p>{t(lang, 'privacyWhereBody')}</p>

        <h2>{t(lang, 'privacyChildrenTitle')}</h2>
        <p>{t(lang, 'privacyChildrenBody')}</p>

        <h2>{t(lang, 'privacyChangesTitle')}</h2>
        <p>{t(lang, 'privacyChangesBody')}</p>

        <h2>{t(lang, 'privacyContactTitle')}</h2>
        <p>
          {t(lang, 'privacyContactBody')}{' '}
          <a href="mailto:Contact@ai-forall.org">Contact@ai-forall.org</a>.
        </p>
        <p>
          <button type="button" className="btn-secondary" onClick={onContact}>
            {t(lang, 'contactUs')}
          </button>
        </p>
      </div>
      <SiteFooter lang={lang} onPrivacy={onPrivacy} />
    </div>
  )
}
