const LETTER_RE = /[A-Z]/;
const DIGIT_RE = /[0-9]/;

export const PLATE_COUNTRY_OPTIONS = [
  {
    code: "fr",
    flag: "🇫🇷",
    labelKey: "plateCountryFrance",
    fallbackLabel: "France",
    placeholder: "AB-123-CD",
    template: "AA-123-AA",
    inputMode: "text",
  },
  {
    code: "gb",
    flag: "🇬🇧",
    labelKey: "plateCountryUnitedKingdom",
    fallbackLabel: "United Kingdom",
    placeholder: "AB12 CDE",
    template: "AA12 AAA",
    inputMode: "text",
  },
  {
    code: "il",
    flag: "🇮🇱",
    labelKey: "plateCountryIsrael",
    fallbackLabel: "Israel",
    placeholder: "123-45-678",
    template: "123-45-678 / 12-345-67",
    inputMode: "numeric",
  },
];

export const normalizeVehiclePlate = (plate) =>
  String(plate || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export const resolvePlateCountry = (country) => {
  const code = String(country || "").toLowerCase();
  return PLATE_COUNTRY_OPTIONS.some((option) => option.code === code)
    ? code
    : "fr";
};

export const getPlateCountryMeta = (country) => {
  const code = resolvePlateCountry(country);
  return (
    PLATE_COUNTRY_OPTIONS.find((option) => option.code === code) ||
    PLATE_COUNTRY_OPTIONS[0]
  );
};

export const getDefaultPlateCountry = (language) => {
  const normalized = String(language || "")
    .split("-")[0]
    .toLowerCase();
  if (normalized === "he") return "il";
  if (normalized === "en") return "gb";
  return "fr";
};

export const inferPlateCountryFromPlate = (plate) => {
  const trimmed = String(plate || "")
    .trim()
    .toUpperCase();
  const normalized = normalizeVehiclePlate(trimmed);

  if (
    /^[A-Z]{2}-\d{3}-[A-Z]{2}$/.test(trimmed) ||
    /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(normalized)
  )
    return "fr";
  if (
    /^[A-Z]{2}\d{2}\s?[A-Z]{3}$/.test(trimmed) ||
    /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(normalized)
  )
    return "gb";
  if (
    /^(?:\d{2}-\d{3}-\d{2}|\d{3}-\d{2}-\d{3})$/.test(trimmed) ||
    /^\d{7,8}$/.test(normalized)
  )
    return "il";

  return null;
};

const joinGroups = (value, groups, separator) => {
  let cursor = 0;
  const parts = [];

  for (const size of groups) {
    const part = value.slice(cursor, cursor + size);
    if (!part) break;
    parts.push(part);
    cursor += size;
  }

  return parts.join(separator);
};

const formatFrenchPlate = (value) => {
  const cleaned = normalizeVehiclePlate(value);
  let letters1 = "";
  let digits = "";
  let letters2 = "";

  for (const ch of cleaned) {
    if (letters1.length < 2 && LETTER_RE.test(ch)) {
      letters1 += ch;
      continue;
    }
    if (letters1.length === 2 && digits.length < 3 && DIGIT_RE.test(ch)) {
      digits += ch;
      continue;
    }
    if (
      letters1.length === 2 &&
      digits.length === 3 &&
      letters2.length < 2 &&
      LETTER_RE.test(ch)
    ) {
      letters2 += ch;
    }
  }

  let formatted = letters1;
  if (letters1.length === 2 && (digits.length > 0 || cleaned.length > 2))
    formatted += "-";
  formatted += digits;
  if (digits.length === 3 && (letters2.length > 0 || cleaned.length > 5))
    formatted += "-";
  formatted += letters2;

  return formatted;
};

const formatUkPlate = (value) => {
  const cleaned = normalizeVehiclePlate(value);
  let letters = "";
  let digits = "";
  let suffix = "";

  for (const ch of cleaned) {
    if (letters.length < 2 && LETTER_RE.test(ch)) {
      letters += ch;
      continue;
    }
    if (letters.length === 2 && digits.length < 2 && DIGIT_RE.test(ch)) {
      digits += ch;
      continue;
    }
    if (
      letters.length === 2 &&
      digits.length === 2 &&
      suffix.length < 3 &&
      LETTER_RE.test(ch)
    ) {
      suffix += ch;
    }
  }

  let formatted = `${letters}${digits}`;
  if (digits.length === 2 && (suffix.length > 0 || cleaned.length > 4))
    formatted += " ";
  formatted += suffix;

  return formatted;
};

const formatIsraelPlate = (value) => {
  const cleaned = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 8);
  const groups = cleaned.length > 7 ? [3, 2, 3] : [2, 3, 2];
  return joinGroups(cleaned, groups, "-");
};

export const formatVehiclePlate = (value, country) => {
  const resolvedCountry = resolvePlateCountry(country);
  if (resolvedCountry === "gb") return formatUkPlate(value);
  if (resolvedCountry === "il") return formatIsraelPlate(value);
  return formatFrenchPlate(value);
};

export const isValidVehiclePlate = (value, country) => {
  const resolvedCountry = resolvePlateCountry(country);
  const formatted = formatVehiclePlate(value, resolvedCountry);

  if (resolvedCountry === "gb")
    return /^[A-Z]{2}\d{2}\s[A-Z]{3}$/.test(formatted);
  if (resolvedCountry === "il")
    return /^(?:\d{2}-\d{3}-\d{2}|\d{3}-\d{2}-\d{3})$/.test(formatted);
  return /^[A-Z]{2}-\d{3}-[A-Z]{2}$/.test(formatted);
};

export const formatStoredVehiclePlate = (plate, country) => {
  const inferredCountry = country || inferPlateCountryFromPlate(plate) || "fr";
  return formatVehiclePlate(plate, inferredCountry);
};
