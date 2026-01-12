// src/utils/spotColors.js
export const CARD_COLORS = [
  '#ff3b30', // vivid red
  '#ffcc00', // vivid yellow
  '#007aff', // vivid blue
  '#34c759', // vivid green
  '#5856d6', // vivid indigo
  '#ff9500', // vivid orange
  '#af52de', // vivid purple
  '#0fb9b1', // vivid teal
];
export const FREE_CARD_COLOR = '#d4af37'; // gold
export const CARD_COLOR_SALT = Math.floor(Math.random() * 10_000);

export const isFreeSpot = (spot) => {
  const price = Number(spot?.price ?? 0);
  return Number.isFinite(price) && price <= 0;
};

export const colorForSpot = (spot, salt = 0) => {
  if (isFreeSpot(spot)) return FREE_CARD_COLOR;
  if (!spot?.id) return CARD_COLORS[0];
  let hash = 0;
  for (let i = 0; i < spot.id.length; i += 1) {
    hash = (hash * 31 + spot.id.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash + salt) % CARD_COLORS.length;
  return CARD_COLORS[idx];
};

export const colorsForOrderedSpots = (spots, salt = 0) => {
  const assigned = [];
  let lastColor = null;
  spots.forEach((spot) => {
    if (isFreeSpot(spot)) {
      assigned.push(FREE_CARD_COLOR);
      lastColor = FREE_CARD_COLOR;
      return;
    }
    let color = colorForSpot(spot, salt);
    if (color === lastColor) {
      const rotated = CARD_COLORS.slice(1).concat(CARD_COLORS[0]);
      color = rotated.find((c) => c !== lastColor) || color;
    }
    assigned.push(color);
    lastColor = color;
  });
  return assigned;
};

export const getCreatedMs = (spot) => {
  const createdAt = spot?.createdAt;
  if (createdAt?.toMillis) return createdAt.toMillis();
  if (typeof createdAt === 'number') return createdAt;
  if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

export const hostKeyForSpot = (spot) => spot?.hostId || spot?.hostName || spot?.id;

export const uniqueSpotsByHost = (spots = []) => {
  const byHost = new Map();
  spots.forEach((spot) => {
    const key = hostKeyForSpot(spot);
    if (!key) return;
    const prev = byHost.get(key);
    if (!prev) {
      byHost.set(key, spot);
      return;
    }
    const prevCreated = getCreatedMs(prev);
    const nextCreated = getCreatedMs(spot);
    if (nextCreated > prevCreated) {
      byHost.set(key, spot);
      return;
    }
    if (nextCreated === prevCreated) {
      const prevPrice = Number(prev?.price);
      const nextPrice = Number(spot?.price);
      if (Number.isFinite(prevPrice) && Number.isFinite(nextPrice) && nextPrice < prevPrice) {
        byHost.set(key, spot);
      }
    }
  });
  return Array.from(byHost.values());
};
