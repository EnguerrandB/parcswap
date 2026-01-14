// src/components/PublicParkingPopups.jsx

// --- Helpers (réutilisés ou adaptés) ---

const toRgba = (hex, alpha) => {
  if (typeof hex !== 'string') return `rgba(0,0,0,${alpha})`;
  const raw = hex.replace('#', '');
  if (raw.length === 3) {
    const r = parseInt(raw[0] + raw[0], 16);
    const g = parseInt(raw[1] + raw[1], 16);
    const b = parseInt(raw[2] + raw[2], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (raw.length === 6) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
};

const getContrastText = (hex) => {
  if (typeof hex !== 'string') return '#0b1220';
  const raw = hex.replace('#', '');
  if (raw.length !== 6) return '#0b1220';
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#0b1220' : '#ffffff';
};

const formatDistance = (meters) => {
  const n = Number(meters);
  if (!Number.isFinite(n)) return null;
  if (n < 1000) return `${Math.round(n)} m`;
  const km = n / 1000;
  return `${km < 10 ? km.toFixed(1) : km.toFixed(0)} km`;
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
    return `${display}m`;
  }
  return `${Math.round(cm)}cm`;
};

const formatCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
};

// --- Composants internes HTML ---

const buildMiniChip = (text, isDark, accent) => `
  <span style="
    display:inline-flex;
    align-items:center;
    padding:3px 8px;
    border-radius:6px;
    font-size:11px;
    font-weight:700;
    line-height:1;
    color:${isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'};
    background:${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'};
    white-space:nowrap;
  ">${text}</span>
`;

// --- Core Builder ---

const buildPublicParkingModel = (t, isDark, parking) => {
  const name = parking?.name || t('publicParking', { defaultValue: 'Parking Public' });
  
  // Data formatting
  const distanceLabel = formatDistance(parking?.distanceMeters);
  const heightLabel = formatHeight(parking?.heightMaxCm);
  const placesLabel = formatCount(parking?.nbPlaces);
  const priceVal = formatEuro(parking?.tarif1h);
  
  // Colors & Theme (Matching SpotPopups logic)
  // Blue accent for public parking typically
  const accent = '#3b82f6'; 
  
  const bg = isDark ? 'rgba(12,16,24,0.95)' : 'rgba(255,255,255,0.95)';
  const shadow = isDark
    ? '0 18px 50px rgba(0,0,0,0.55)'
    : '0 22px 60px rgba(15,23,42,0.18)';

  const text = isDark ? '#EAF0FF' : '#0B1220';
  const sub = isDark ? 'rgba(234,240,255,0.60)' : 'rgba(11,18,32,0.55)';

  const accentSoft = toRgba(accent, isDark ? 0.22 : 0.16);
  const accentBorder = toRgba(accent, isDark ? 0.45 : 0.3);
  const accentGlow = toRgba(accent, isDark ? 0.35 : 0.25);
  const priceColor = accent; // Or use text color if you prefer contrast

  // Bottom Metadata (Height, Places, etc.)
  const metas = [];
  if (heightLabel) metas.push(`Max ${heightLabel}`);
  if (placesLabel) metas.push(`${placesLabel} pl.`);
  // Add more if needed (PMR, EV)

  return {
    name,
    priceVal,
    distanceLabel,
    metas,
    styles: {
      bg, shadow, text, sub, accent, accentSoft, accentBorder, accentGlow, priceColor
    }
  };
};

const buildPublicParkingInnerHTML = (model, isDark) => {
  const { name, priceVal, distanceLabel, metas, styles } = model;
  
  const priceDisplay = priceVal 
    ? `${priceVal} €<span style="font-size:16px; font-weight:600; opacity:0.6; margin-left:4px;">/h</span>`
    : '<span style="font-size:20px; opacity:0.5;">-- €</span>';

  const metaHtml = metas.map(m => buildMiniChip(m, isDark, styles.accent)).join('<div style="width:4px"></div>');

  return `
    <div style="
      padding: 10px 14px 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    ">
      <div style="
        font-size: 12px;
        font-weight: 600;
        color: ${styles.sub};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 70%;
      ">
        ${name}
      </div>
      ${distanceLabel ? `
        <div style="
          font-size: 11px;
          font-weight: 700;
          color: ${styles.accent};
          background: ${styles.accentSoft};
          padding: 2px 6px;
          border-radius: 6px;
        ">${distanceLabel}</div>
      ` : ''}
    </div>

    <div style="
      padding: 6px 14px 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 40px; 
    ">
      <div style="
        font-size: 34px;
        font-weight: 900;
        letter-spacing: -0.04em;
        line-height: 1;
        color: ${styles.priceColor};
        display: flex; 
        align-items: baseline;
      ">
        ${priceDisplay}
      </div>
    </div>

    <div style="
      height: 1px;
      background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'};
      margin: 0 14px;
    "></div>

    <div style="
      padding: 10px 14px 12px;
      display: flex;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
    ">
      ${metaHtml || `<span style="font-size:12px; color:${styles.sub};">Information indisponible</span>`}
    </div>
  `;
};

// --- Exports ---

export const buildPublicParkingPopupHTML = (t, isDark, parking) => {
  const model = buildPublicParkingModel(t, isDark, parking);
  const inner = buildPublicParkingInnerHTML(model, isDark);
  const s = model.styles;

  return `
    <div style="
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      min-width: 240px;
      color: ${s.text};
      -webkit-font-smoothing: antialiased;
    ">
      <div data-parking-popup-root="info" style="
        border-radius: 24px;
        background: linear-gradient(145deg, ${s.accentSoft} 0%, rgba(0,0,0,0) 58%), ${s.bg};
        border: 1px solid ${s.accentBorder};
        box-shadow: ${s.shadow}, 0 0 0 1px ${s.accentBorder}, 0 14px 34px -22px ${s.accentGlow};
        backdrop-filter: blur(22px) saturate(170%);
        -webkit-backdrop-filter: blur(22px) saturate(170%);
        cursor: pointer;
      ">
        ${inner}
      </div>
    </div>
  `;
};

export const buildPublicParkingActionPopupHTML = (t, isDark, parking, labelOverride = null) => {
  const model = buildPublicParkingModel(t, isDark, parking);
  const inner = buildPublicParkingInnerHTML(model, isDark);
  const s = model.styles;

  const label = labelOverride || t('navigate', { defaultValue: 'Y aller' });
  const buttonText = getContrastText(s.accent);
  const buttonBg = `linear-gradient(135deg, ${s.accent} 0%, ${toRgba(s.accent, 0.8)} 100%)`;

  return `
    <div style="
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      min-width: 240px; 
      /* Fixe la width pour éviter le layout shift entre info et action */
      width: max-content;
      -webkit-font-smoothing: antialiased;
    ">
      <div data-parking-popup-root="action" style="
        border-radius: 24px;
        background: linear-gradient(145deg, ${s.accentSoft} 0%, rgba(0,0,0,0) 58%), ${s.bg};
        border: 1px solid ${s.accentBorder};
        box-shadow: 0 18px 50px rgba(0,0,0,0.4), 0 0 0 1px ${s.accentBorder}, 0 14px 34px -22px ${s.accentGlow};
        backdrop-filter: blur(22px) saturate(170%);
        -webkit-backdrop-filter: blur(22px) saturate(170%);
        position: relative;
        overflow: hidden;
      ">
        <div style="visibility: hidden;">
          ${inner}
        </div>

        <button data-parking-popup-action type="button" style="
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border-radius: 24px;
          border: none;
          outline: none;
          cursor: pointer;
          background: ${buttonBg};
          color: ${buttonText};
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.01em;
          display: flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
          box-shadow: 0 18px 40px -22px ${s.accentGlow};
        ">
          ${label}
        </button>
      </div>
    </div>
  `;
};
