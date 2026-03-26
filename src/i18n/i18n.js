import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import HttpBackend from "i18next-http-backend";

const APP_DIRECTION = "ltr";

const syncDocumentLanguage = (language) => {
  if (typeof document === "undefined") return;

  const normalized = String(language || "en")
    .split("-")[0]
    .toLowerCase();
  const dir = APP_DIRECTION;

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
        useSuspense: false,
      },
      load: "languageOnly",
      debug: false,
    });

  i18n.dir = () => APP_DIRECTION;

  syncDocumentLanguage(i18n.resolvedLanguage || i18n.language);
  i18n.on("languageChanged", syncDocumentLanguage);
}

export default i18n;
