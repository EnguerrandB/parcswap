// src/utils/mapboxStylePatch.js

const isSizerankExpr = (expr) =>
  Array.isArray(expr) && expr[0] === "get" && expr[1] === "sizerank";

const hasSizerank = (expr) =>
  Array.isArray(expr) &&
  (isSizerankExpr(expr) || expr.some((child) => hasSizerank(child)));

const patchSizerank = (expr) => {
  if (!Array.isArray(expr)) return expr;
  if (isSizerankExpr(expr)) return ["coalesce", ["get", "sizerank"], 0];
  return expr.map((child) => patchSizerank(child));
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
