// src/constants.js

export const MOCK_CARS = [{ id: 1, model: "???", plate: "??-???-??" }];

// Format currency
export const formatPrice = (price) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(price);
