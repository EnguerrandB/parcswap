// src/components/SpotPopups.jsx
const formatSpotPrice = (price) => {
  const n = Number(price);
  if (!Number.isFinite(n)) return '--';
  return n <= 0 ? 'Free' : `${n.toFixed(2)} €`;
};

const getRemainingMs = (spot, nowMs = Date.now()) => {
  if (!spot) return null;
  const { createdAt, time } = spot;
  if (time == null) return null;
  let createdMs = null;
  if (createdAt?.toMillis) createdMs = createdAt.toMillis();
  else if (typeof createdAt === 'number') createdMs = createdAt;
  else if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    createdMs = Number.isNaN(parsed) ? null : parsed;
  }
  if (!createdMs) return null;
  const remainingMs = createdMs + Number(time) * 60_000 - nowMs;
  if (!Number.isFinite(remainingMs)) return null;
  return remainingMs;
};

const formatDuration = (ms) => {
  if (ms == null) return null;
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

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

export const buildSpotPopupHTML = (t, isDark, spot, nowMs = Date.now(), accentColor = null) => {
  const name = spot?.hostName || spot?.host || spot?.displayName || t('user', 'User');
  const remainingMs = getRemainingMs(spot, nowMs);
  const remainingLabel = formatDuration(remainingMs) || '--:--';
  const priceLabel = formatSpotPrice(spot?.price);

  const bg = isDark ? 'rgba(12,16,24,0.78)' : 'rgba(255,255,255,0.75)';
  const shadow = isDark
    ? '0 18px 50px rgba(0,0,0,0.55)'
    : '0 22px 60px rgba(15,23,42,0.18)';

  const text = isDark ? '#EAF0FF' : '#0B1220';
  const sub = isDark ? 'rgba(234,240,255,0.60)' : 'rgba(11,18,32,0.55)';

  const accent = accentColor || (isDark ? '#38bdf8' : '#0ea5e9');
  const accentSoft = toRgba(accent, isDark ? 0.22 : 0.16);
  const accentBorder = toRgba(accent, isDark ? 0.45 : 0.3);
  const accentGlow = toRgba(accent, isDark ? 0.35 : 0.25);
  const priceColor = accent;

  return `
    <div style="
      font-family: ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'SF Pro Text', Inter, sans-serif;
      min-width: 240px;
      color: ${text};
      -webkit-font-smoothing: antialiased;
    ">
      <div data-spot-popup-root="info" style="
        border-radius: 24px;
        background: linear-gradient(145deg, ${accentSoft} 0%, rgba(0,0,0,0) 58%), ${bg};
        border: 1px solid ${accentBorder};
        box-shadow: ${shadow}, 0 0 0 1px ${accentBorder}, 0 14px 34px -22px ${accentGlow};
        backdrop-filter: blur(22px) saturate(170%);
        -webkit-backdrop-filter: blur(22px) saturate(170%);
        cursor: pointer;
      ">

        <!-- name -->
        <div style="
          padding: 10px 14px 4px;
          font-size: 12px;
          font-weight: 600;
          color: ${sub};
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        ">
          ${name}
        </div>

        <!-- price -->
        <div style="
          padding: 6px 14px 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            font-size: 34px;
            font-weight: 900;
            letter-spacing: -0.04em;
            line-height: 1;
            color: ${priceColor};
          ">
            ${priceLabel}
          </div>
        </div>

        <!-- divider -->
        <div style="
          height: 1px;
          background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'};
          margin: 0 14px;
        "></div>

        <!-- time -->
        <div style="
          padding: 8px 14px 12px;
          display: flex;
          justify-content: center;
        ">
          <div style="
            font-size: 16px;
            font-weight: 700;
            letter-spacing: -0.02em;
          ">
            ${remainingLabel}
          </div>
        </div>
      </div>
    </div>
  `;
};

export const buildSpotActionPopupHTML = (
  t,
  isDark,
  spot,
  accentColor = null,
  labelOverride = null,
  sizeKey = 'spot',
) => {
  const name = spot?.hostName || spot?.host || spot?.displayName || t('user', 'User');
  const priceLabel = formatSpotPrice(spot?.price);
  const accent = accentColor || (isDark ? '#38bdf8' : '#0ea5e9');
  const accentSoft = toRgba(accent, isDark ? 0.2 : 0.14);
  const accentBorder = toRgba(accent, isDark ? 0.45 : 0.3);
  const accentGlow = toRgba(accent, isDark ? 0.35 : 0.25);
  const buttonText = getContrastText(accent);
  const buttonBg = `linear-gradient(135deg, ${accent} 0%, ${toRgba(accent, 0.8)} 100%)`;
  const label = labelOverride || t('takeSpot', { defaultValue: 'Prendre sa place' });
  const sub = isDark ? 'rgba(234,240,255,0.60)' : 'rgba(11,18,32,0.55)';
  const timePlaceholder = '0:00';
  const minWidth = sizeKey === 'parking' ? '260px' : '240px';
  const maxWidth = sizeKey === 'parking' ? '260px' : '240px';
  return `
    <div style="
      font-family: ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'SF Pro Text', Inter, sans-serif;
      min-width: ${minWidth};
      max-width: ${maxWidth};
      -webkit-font-smoothing: antialiased;
    ">
      <div data-spot-popup-root="action" style="
        border-radius: 24px;
        background: linear-gradient(145deg, ${accentSoft} 0%, rgba(0,0,0,0) 58%), ${isDark ? 'rgba(12,16,24,0.78)' : 'rgba(255,255,255,0.75)'};
        border: 1px solid ${accentBorder};
        box-shadow: 0 18px 50px rgba(0,0,0,0.4), 0 0 0 1px ${accentBorder}, 0 14px 34px -22px ${accentGlow};
        backdrop-filter: blur(22px) saturate(170%);
        -webkit-backdrop-filter: blur(22px) saturate(170%);
        position: relative;
        overflow: hidden;
      ">
        <div style="visibility: hidden;">
          <div style="
            padding: 10px 14px 4px;
            font-size: 12px;
            font-weight: 600;
            color: ${sub};
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          ">
            ${name}
          </div>
          <div style="
            padding: 6px 14px 10px;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <div style="
              font-size: 34px;
              font-weight: 900;
              letter-spacing: -0.04em;
              line-height: 1;
            ">
              ${priceLabel}
            </div>
          </div>
          <div style="
            height: 1px;
            background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'};
            margin: 0 14px;
          "></div>
          <div style="
            padding: 8px 14px 12px;
            display: flex;
            justify-content: center;
          ">
            <div style="
              font-size: 16px;
              font-weight: 700;
              letter-spacing: -0.02em;
            ">
              ${timePlaceholder}
            </div>
          </div>
        </div>
        <button data-spot-popup-action type="button" style="
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
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 18px 40px -22px ${accentGlow};
        ">
          ${label}
        </button>
      </div>
    </div>
  `;
};
