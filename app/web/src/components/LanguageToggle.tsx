import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGS, currentLang, setLanguage, type SupportedLang } from "../i18n";

const LABELS: Record<SupportedLang, string> = {
  "pt-BR": "PT",
  "en-US": "EN",
};

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const active = currentLang();

  return (
    <span className="lang-toggle" role="group" aria-label="Language">
      {SUPPORTED_LANGS.map((lang) => (
        <button
          key={lang}
          type="button"
          className={lang === active ? "lang-btn active" : "lang-btn"}
          disabled={i18n.language === lang}
          onClick={() => setLanguage(lang)}
        >
          {LABELS[lang]}
        </button>
      ))}
    </span>
  );
}
