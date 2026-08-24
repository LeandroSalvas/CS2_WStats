import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ptBR from "./pt-BR.json";
import enUS from "./en-US.json";

export const SUPPORTED_LANGS = ["pt-BR", "en-US"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

const STORAGE_KEY = "wstats_lang";

/** Resolve o idioma inicial: salvo > navegador > en-US. */
function detectLanguage(): SupportedLang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_LANGS as readonly string[]).includes(saved)) {
      return saved as SupportedLang;
    }
  } catch {
    /* localStorage indisponível — segue para detecção do navegador */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en-US";
  return nav.toLowerCase().startsWith("pt") ? "pt-BR" : "en-US";
}

export function currentLang(): SupportedLang {
  return (i18n.language as SupportedLang) ?? detectLanguage();
}

export function setLanguage(lang: SupportedLang): void {
  void i18n.changeLanguage(lang);
}

void i18n.use(initReactI18next).init({
  resources: {
    "pt-BR": { translation: ptBR },
    "en-US": { translation: enUS },
  },
  lng: detectLanguage(),
  fallbackLng: "en-US",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Persistência + <html lang> para acessibilidade.
i18n.on("languageChanged", (lng) => {
  const lang = (SUPPORTED_LANGS as readonly string[]).includes(lng)
    ? (lng as SupportedLang)
    : "en-US";
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* sem storage — só não persiste */
  }
});

document.documentElement.lang = currentLang();

export default i18n;
