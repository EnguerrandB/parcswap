// src/utils/mapboxStylePatch.js

const isSizerankExpr = (expr) =>
  Array.isArray(expr) && expr[0] === "get" && expr[1] === "sizerank";

const MAPBOX_LANGUAGE_FIELDS = {
  en: "name_en",
  fr: "name_fr",
  ar: "name_ar",
  he: "name_he",
  ru: "name_ru",
};

const MAPBOX_NAME_FIELDS = new Set([
  "name",
  "name_en",
  "name_fr",
  "name_ar",
  "name_he",
  "name_ru",
]);

const hasSizerank = (expr) =>
  Array.isArray(expr) &&
  (isSizerankExpr(expr) || expr.some((child) => hasSizerank(child)));

const patchSizerank = (expr) => {
  if (!Array.isArray(expr)) return expr;
  if (isSizerankExpr(expr)) return ["coalesce", ["get", "sizerank"], 0];
  return expr.map((child) => patchSizerank(child));
};

const normalizeMapLanguage = (language) => {
  const normalized = String(language || "en")
    .split("-")[0]
    .toLowerCase();
  return MAPBOX_LANGUAGE_FIELDS[normalized] ? normalized : "en";
};

const localizedNameExpr = (fieldName) => [
  "coalesce",
  ["get", fieldName],
  ["get", "name_en"],
  ["get", "name"],
];

const hasNameField = (value) => {
  if (typeof value === "string") {
    return /\{name(?:_[a-z]{2})?\}/.test(value);
  }
  if (!Array.isArray(value)) return false;
  if (value[0] === "get" && MAPBOX_NAME_FIELDS.has(value[1])) return true;
  return value.some((child) => hasNameField(child));
};

const patchMapLabelField = (value, fieldName) => {
  if (typeof value === "string") {
    return value.replace(/\{name(?:_[a-z]{2})?\}/g, `{${fieldName}}`);
  }
  if (!Array.isArray(value)) return value;
  if (value[0] === "get" && MAPBOX_NAME_FIELDS.has(value[1])) {
    return localizedNameExpr(fieldName);
  }
  return value.map((child) => patchMapLabelField(child, fieldName));
};

// Original patchProps moved to global scope
const patchProps = (map, layerId, props, setter) => {
  if (!props) return 0;
  let count = 0;
  Object.entries(props).forEach(([key, value]) => {
    if (!Array.isArray(value)) return;
    if (!hasSizerank(value)) return;
    try {
      setter(layerId, key, patchSizerank(value));
      count++;
      console.log(`Patched ${layerId}.${key}`);
    } catch (e) {
      console.warn(`Failed to patch ${layerId}.${key}:`, e);
    }
  });
  return count;
};

export const patchSizerankInStyle = (map) => {
  console.group("🔧 ParkSwap: Patching sizerank");
  if (!map || typeof map.getStyle !== "function") {
    console.warn("Map not ready for patching");
    console.groupEnd();
    return;
  }
  const style = map.getStyle();
  const layers = style?.layers;
  if (!Array.isArray(layers)) {
    console.warn("No layers found");
    console.groupEnd();
    return;
  }
  let patched = 0;
  layers.forEach((layer) => {
    if (!layer?.id) return;
    const propsPatched = patchProps(
      map,
      layer.id,
      layer.layout,
      map.setLayoutProperty.bind(map),
    );
    patched += propsPatched;
    const paintPatched = patchProps(
      map,
      layer.id,
      layer.paint,
      map.setPaintProperty.bind(map),
    );
    patched += paintPatched;
  });
  console.log(`✅ Patched ${patched} expressions in ${layers.length} layers`);
  console.groupEnd();
};

export const applyMapLabelLanguage = (map, language) => {
  console.group("🌍 ParkSwap: Applying map label language");
  if (!map || typeof map.getStyle !== "function") {
    console.warn("Map not ready for localization");
    console.groupEnd();
    return;
  }
  const style = map.getStyle();
  const layers = style?.layers;
  if (!Array.isArray(layers)) {
    console.warn("No layers found");
    console.groupEnd();
    return;
  }

  const normalizedLanguage = normalizeMapLanguage(language);
  const fieldName = MAPBOX_LANGUAGE_FIELDS[normalizedLanguage];
  let patched = 0;

  layers.forEach((layer) => {
    if (!layer?.id || layer.type !== "symbol") return;
    const textField = layer.layout?.["text-field"];
    if (!hasNameField(textField)) return;
    try {
      map.setLayoutProperty(layer.id, "text-field", patchMapLabelField(textField, fieldName));
      patched += 1;
    } catch (error) {
      console.warn(`Failed to localize ${layer.id}.text-field:`, error);
    }
  });

  console.log(`✅ Applied ${normalizedLanguage} labels to ${patched} layers`);
  console.groupEnd();
};
