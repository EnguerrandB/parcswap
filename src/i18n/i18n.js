import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import HttpBackend from "i18next-http-backend";

const RTL_LANGUAGES = new Set(["ar", "he"]);

const syncDocumentLanguage = (language) => {
  if (typeof document === "undefined") return;

  const normalized = String(language || "en")
    .split("-")[0]
    .toLowerCase();
  const dir = RTL_LANGUAGES.has(normalized) ? "rtl" : "ltr";

  document.documentElement.lang = normalized || "en";
  document.documentElement.dir = dir;
  if (document.body) {
    document.body.dir = dir;
  }
};

if (!i18n.isInitialized) {
  i18n
    .use(HttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      fallbackLng: "en",
      supportedLngs: ["en", "fr", "he", "ar", "ru"],
      nonExplicitSupportedLngs: true,
      ns: ["common"],
      defaultNS: "common",
      fallbackNS: "common",
      interpolation: {
        escapeValue: false,
      },
      backend: {
        loadPath: "/locales/{{lng}}/{{ns}}.json",
      },
      detection: {
        order: ["querystring", "localStorage", "navigator"],
        caches: ["localStorage"],
      },
      react: {
        useSuspense: true,
      },
      load: "languageOnly",
      debug: false,
    });

  syncDocumentLanguage(i18n.resolvedLanguage || i18n.language);
  i18n.on("languageChanged", syncDocumentLanguage);
}

export default i18n;
