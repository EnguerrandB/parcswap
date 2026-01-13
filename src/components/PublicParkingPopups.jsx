// src/components/PublicParkingPopups.jsx
const formatDistance = (meters) => {
  const n = Number(meters);
  if (!Number.isFinite(n)) return null;
  if (n < 1000) return `${Math.round(n)} m`;
  const km = n / 1000;
  const rounded = km < 10 ? km.toFixed(1) : km.toFixed(0);
  return `${rounded} km`;
};

const formatEuro = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2).replace('.', ',');
};

const formatHeight = (heightCm) => {
  const cm = Number(heightCm);
  if (!Number.isFinite(cm) || cm <= 0) return null;
  if (cm >= 100) {
    const meters = cm / 100;
    const display = meters % 1 === 0 ? meters.toFixed(0) : meters.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${display} m`;
  }
  return `${Math.round(cm)} cm`;
};

const formatCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
};

const buildChip = (text, styles) => `
  <span style="
    display:inline-flex;
    align-items:center;
    padding:5px 10px;
    border-radius:999px;
    font-size:11px;
    font-weight:700;
    line-height:1;
    letter-spacing:-0.01em;
    color:${styles.color};
    background:${styles.bg};
    border:1px solid ${styles.border};
    white-space:nowrap;
  ">${text}</span>
`;

export const buildPublicParkingPopupHTML = (t, isDark, parking) => {
  const name = parking?.name || t('publicParking', { defaultValue: 'Public parking' });

  const distanceLabel = formatDistance(parking?.distanceMeters);
  const heightLabel = formatHeight(parking?.heightMaxCm);
  const totalPlaces = formatCount(parking?.nbPlaces);
  const pmrPlaces = formatCount(parking?.nbPmr);
  const evPlaces = formatCount(parking?.nbEv);

  const price1h = formatEuro(parking?.tarif1h);

  // ---- theme tokens (Apple-like glass) ----
  const cardBg = isDark ? 'rgba(12,16,24,0.78)' : 'rgba(255,255,255,0.74)';
  const cardBorder = isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(15,23,42,0.10)';
  const shadow = isDark
    ? '0 18px 50px rgba(0,0,0,0.55)'
    : '0 22px 60px rgba(15,23,42,0.18)';

  const text = isDark ? '#EAF0FF' : '#0B1220';
  const muted = isDark ? 'rgba(234,240,255,0.62)' : 'rgba(11,18,32,0.55)';

  const pillBg = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.06)';
  const pillBorder = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.10)';

  const accent = '#2563eb';
  const chipBase = {
    color: text,
    bg: pillBg,
    border: pillBorder,
  };
  const chipAccent = {
    color: accent,
    bg: isDark ? 'rgba(37,99,235,0.20)' : 'rgba(37,99,235,0.12)',
    border: isDark ? 'rgba(37,99,235,0.40)' : 'rgba(37,99,235,0.22)',
  };

  // ---- build chips (meta) ----
  const metaChips = [];
  if (distanceLabel) metaChips.push(buildChip(distanceLabel, chipAccent));

  const specChips = [];
  if (heightLabel) specChips.push(buildChip(`${t('height', { defaultValue: 'Height' })} ${heightLabel}`, chipBase));
  if (totalPlaces != null) specChips.push(buildChip(`${t('places', { defaultValue: 'Places' })} ${totalPlaces}`, chipBase));
  if (pmrPlaces != null) specChips.push(buildChip(`PMR ${pmrPlaces}`, chipBase));
  if (evPlaces != null) specChips.push(buildChip(`EV ${evPlaces}`, chipBase));

  // ---- first hour price ----
  const priceBlock =
    price1h != null
      ? `
      <div style="margin-top: 10px;">
        <div style="
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          color: ${muted};
          text-transform: uppercase;
        ">
          ${t('firstHour', { defaultValue: '1h' })}
        </div>
        <div style="
          margin-top: 8px;
          padding: 10px 14px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(37,99,235,0.98), rgba(59,130,246,0.82));
          color: #ffffff;
          font-weight: 900;
          font-size: 18px;
          letter-spacing: -0.02em;
          display:flex;
          align-items:center;
          justify-content:center;
          box-shadow: 0 18px 36px -18px rgba(37,99,235,0.6);
        ">
          <span>${price1h}€</span>
        </div>
      </div>
      `
      : `
      <div style="
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 16px;
        background: ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)'};
        border: 1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'};
        color: ${muted};
        font-size: 12px;
        font-weight: 700;
        display:flex;
        align-items:center;
        justify-content:center;
      ">
        ${t('pricesUnavailable', { defaultValue: 'Prices unavailable' })}
      </div>
      `;

  return `
    <div style="
      font-family: ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'SF Pro Text', Inter, sans-serif;
      min-width: 260px;
      color: ${text};
      -webkit-font-smoothing: antialiased;
    ">
      <div style="
        padding: 12px 12px 12px;
        border-radius: 24px;
        background: ${cardBg};
        border: ${cardBorder};
        box-shadow: ${shadow};
        backdrop-filter: blur(22px) saturate(170%);
        -webkit-backdrop-filter: blur(22px) saturate(170%);
      ">
        <!-- header (name) -->
        <div style="padding: 2px 2px 0;">
          <div style="
            font-weight: 850;
            font-size: 14px;
            letter-spacing: -0.02em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          ">${name}</div>
        </div>

        <!-- meta chips -->
        ${
          metaChips.length
            ? `<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:6px;">${metaChips.join('')}</div>`
            : ''
        }

        <!-- price range -->
        ${priceBlock}

        <!-- specs -->
        ${
          specChips.length
            ? `<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:6px;">${specChips.join('')}</div>`
            : ''
        }
      </div>
    </div>
  `;
};
