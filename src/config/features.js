// src/config/features.js
/**
 * Feature flags centralisés pour gérer les versions avec/sans paiement
 */

const parseEnvBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "")
    return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

// Feature flags principaux
export const PAYMENT_ENABLED = parseEnvBoolean(
  import.meta.env.VITE_PAYMENT_ENABLED,
  false,
);

export const SHOW_WALLET = parseEnvBoolean(
  import.meta.env.VITE_SHOW_WALLET,
  PAYMENT_ENABLED,
);

export const SHOW_PRICES = parseEnvBoolean(
  import.meta.env.VITE_SHOW_PRICES,
  PAYMENT_ENABLED,
);

// Fonctions utilitaires
export const isPaymentEnabled = () => PAYMENT_ENABLED;
export const shouldShowWallet = () => SHOW_WALLET;
export const shouldShowPrices = () => SHOW_PRICES;

// Configuration par défaut pour les spots gratuits
export const DEFAULT_FREE_SPOT_PRICE = 0;

// Log de debug pour vérifier la config au démarrage
if (typeof console !== "undefined" && import.meta.env.DEV) {
  console.info("[ParkSwap Config]", {
    PAYMENT_ENABLED,
    SHOW_WALLET,
    SHOW_PRICES,
    mode: PAYMENT_ENABLED ? "PAID" : "FREE",
  });
}
