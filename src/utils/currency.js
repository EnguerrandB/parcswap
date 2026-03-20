const CURRENCY_CONFIG = {
  EUR: { code: "EUR", locale: "fr-FR", rateFromEur: 1 },
  GBP: { code: "GBP", locale: "en-GB", rateFromEur: 0.86 },
  USD: { code: "USD", locale: "en-US", rateFromEur: 1.09 },
  ILS: { code: "ILS", locale: "he-IL", rateFromEur: 4.02 },
  AED: { code: "AED", locale: "ar-AE", rateFromEur: 3.98 },
  RUB: { code: "RUB", locale: "ru-RU", rateFromEur: 95.4 },
};

export const normalizeCurrency = (currency) => {
  const code = String(currency || "EUR").toUpperCase();
  return CURRENCY_CONFIG[code] ? code : "EUR";
};

export const getDefaultCurrencyForLanguage = (language) => {
  const normalized = String(language || "")
    .split("-")[0]
    .toLowerCase();
  if (normalized === "fr") return "EUR";
  if (normalized === "he") return "ILS";
  if (normalized === "ar") return "AED";
  if (normalized === "ru") return "RUB";
  if (normalized === "en") return "GBP";
  return "EUR";
};

export const getCurrencySymbol = (currency) => {
  const code = normalizeCurrency(currency);
  return (
    new Intl.NumberFormat(CURRENCY_CONFIG[code].locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value || code
  );
};

export const convertFromEur = (amount, currency) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  const code = normalizeCurrency(currency);
  return n * CURRENCY_CONFIG[code].rateFromEur;
};

export const convertToEur = (amount, currency) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  const code = normalizeCurrency(currency);
  return n / CURRENCY_CONFIG[code].rateFromEur;
};

export const formatCurrencyAmount = (
  amountEur,
  currency = "EUR",
  options = {},
) => {
  const code = normalizeCurrency(currency);
  const locale = CURRENCY_CONFIG[code].locale;
  const amount = convertFromEur(amountEur, code);
  const { minimumFractionDigits = 2, maximumFractionDigits = 2 } = options;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount);
};

export const formatCurrencyNumber = (
  amountEur,
  currency = "EUR",
  options = {},
) => {
  const code = normalizeCurrency(currency);
  const locale = CURRENCY_CONFIG[code].locale;
  const amount = convertFromEur(amountEur, code);
  const { minimumFractionDigits = 0, maximumFractionDigits = 2 } = options;

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount);
};
