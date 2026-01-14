// src/utils/mapboxStylePatch.js

const isSizerankExpr = (expr) => Array.isArray(expr) && expr[0] === 'get' && expr[1] === 'sizerank';

const hasSizerank = (expr) =>
  Array.isArray(expr) && (isSizerankExpr(expr) || expr.some((child) => hasSizerank(child)));

const patchSizerank = (expr) => {
  if (!Array.isArray(expr)) return expr;
  if (isSizerankExpr(expr)) return ['coalesce', ['get', 'sizerank'], 0];
  return expr.map((child) => patchSizerank(child));
};

const patchProps = (map, layerId, props, setter) => {
  if (!props) return;
  Object.entries(props).forEach(([key, value]) => {
    if (!Array.isArray(value)) return;
    if (!hasSizerank(value)) return;
    try {
      setter(layerId, key, patchSizerank(value));
    } catch {
      // ignore layers that cannot be patched
    }
  });
};

export const patchSizerankInStyle = (map) => {
  if (!map || typeof map.getStyle !== 'function') return;
  const layers = map.getStyle()?.layers;
  if (!Array.isArray(layers)) return;
  layers.forEach((layer) => {
    if (!layer?.id) return;
    patchProps(map, layer.id, layer.layout, map.setLayoutProperty.bind(map));
    patchProps(map, layer.id, layer.paint, map.setPaintProperty.bind(map));
  });
};
