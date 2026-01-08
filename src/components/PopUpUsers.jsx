// src/components/PopUpUsers.jsx
export const buildOtherUserPopupHTML = (t, isDark, name, lastSeen, opts = {}) => {
  const { showBadge = true } = opts;
  const lastSeenText = typeof lastSeen === 'string' ? lastSeen : lastSeen?.text;
  const online = typeof lastSeen === 'object' ? !!lastSeen?.isOnline : false;
  const cardBg = isDark ? 'rgba(11, 17, 27, 0.94)' : 'rgba(255,255,255,0.94)';
  const border = isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.08)';
  const textColor = isDark ? '#e2e8f0' : '#0f172a';
  const muted = isDark ? '#94a3b8' : '#64748b';
  const badgeBg = online
    ? (isDark ? 'rgba(34, 197, 94, 0.18)' : 'rgba(16, 185, 129, 0.16)')
    : (isDark ? 'rgba(249, 115, 22, 0.18)' : 'rgba(249, 115, 22, 0.16)');
  const badgeText = online ? '#16a34a' : '#c2410c';
  const pulseColor = online ? 'rgba(34,197,94,0.25)' : 'rgba(249,115,22,0.25)';

  return `
      <div style="
        font-family:'Inter', system-ui, -apple-system, sans-serif;
        min-width:220px;
        color:${textColor};
      ">
        <div style="
          padding:14px 16px;
          border-radius:18px;
          background:${cardBg};
          border:${border};
          box-shadow:0 22px 60px -22px rgba(0,0,0,0.55);
          backdrop-filter: blur(18px) saturate(150%);
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="min-width:0;">
              <div style="font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name || t('user', 'User')}</div>
            </div>
            ${
              showBadge && online
                ? `<span style="
                    display:inline-flex;
                    align-items:center;
                    padding:6px 12px;
                    border-radius:999px;
                    background:${badgeBg};
                    color:${badgeText};
                    font-size:11px;
                    font-weight:800;
                    box-shadow:0 12px 22px -12px ${pulseColor};
                    white-space:nowrap;
                  ">
	                    ${t('online', 'Online')}
	                  </span>`
                : ''
            }
          </div>
          <div style="margin-top:12px;display:flex;align-items:center;gap:10px;color:${textColor};">
            <div style="
              width:10px;
              height:10px;
              border-radius:999px;
              background:${online ? '#22c55e' : '#f97316'};
              box-shadow:0 0 0 8px ${pulseColor};
              flex-shrink:0;
            "></div>
            <div style="font-size:13px;font-weight:700;line-height:1.3;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
	              ${lastSeenText || t('lastSeenUnknown', 'Last seen unknown')}
	            </div>
          </div>
        </div>
      </div>
    `;
};

export const buildSelfPopupHTML = (t, isDark, lastSeen) => {
  const lastSeenText = typeof lastSeen === 'string' ? lastSeen : lastSeen?.text;
  const online = typeof lastSeen === 'object' ? !!lastSeen?.isOnline : false;
  const cardBg = isDark ? 'rgba(14, 20, 30, 0.92)' : 'rgba(255,255,255,0.94)';
  const border = isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.10)';
  const textColor = isDark ? '#e2e8f0' : '#0f172a';
  const muted = isDark ? '#9aa4b2' : '#6b7280';
  const accent = '#3b82f6';
  const pulseColor = online ? 'rgba(59,130,246,0.28)' : 'rgba(148,163,184,0.25)';

  return `
      <div style="
        font-family:'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
        min-width:220px;
        color:${textColor};
      ">
        <div style="
          padding:14px 16px;
          border-radius:18px;
          background:${cardBg};
          border:${border};
          box-shadow:0 18px 48px -18px rgba(0,0,0,0.5);
          backdrop-filter: blur(20px) saturate(160%);
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div style="min-width:0;">
              <div style="font-weight:800;font-size:16px;letter-spacing:-0.01em;">
                ${t('yourLocation', 'Your location')}
              </div>
              <div style="margin-top:2px;font-size:12px;font-weight:600;color:${muted};">
                ${t('gpsActive', 'GPS active')}
              </div>
            </div>
            <div style="
              width:34px;
              height:34px;
              border-radius:12px;
              display:flex;
              align-items:center;
              justify-content:center;
              background:${isDark ? 'rgba(59,130,246,0.16)' : 'rgba(59,130,246,0.12)'};
              border:1px solid ${isDark ? 'rgba(59,130,246,0.28)' : 'rgba(59,130,246,0.2)'};
            ">
              <div style="
                width:10px;
                height:10px;
                border-radius:999px;
                background:${accent};
                box-shadow:0 0 0 6px ${pulseColor};
              "></div>
            </div>
          </div>
          <div style="margin-top:10px;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:${textColor};">
            <span style="
              display:inline-flex;
              align-items:center;
              padding:4px 10px;
              border-radius:999px;
              background:${isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.14)'};
              color:${accent};
            ">
              ${online ? t('online', 'Online') : t('offline', 'Offline')}
            </span>
            <span style="color:${muted};font-weight:600;">
              ${lastSeenText || t('lastSeenUnknown', 'Last seen unknown')}
            </span>
          </div>
        </div>
      </div>
    `;
};

// Adds a quick pop-in/out animation on all popups
export const enhancePopupAnimation = (popup) => {
  if (!popup || popup.__animated) return popup;
  const originalAddTo = popup.addTo.bind(popup);
  popup.addTo = (mapInstance) => {
    const res = originalAddTo(mapInstance);
    const el = popup.getElement();
    const content = el?.querySelector('.mapboxgl-popup-content');
    if (content) {
      content.classList.remove('popup-exit');
      content.classList.add('popup-enter');
    }
    return res;
  };
  const originalRemove = popup.remove.bind(popup);
  popup.remove = () => {
    const el = popup.getElement();
    const content = el?.querySelector('.mapboxgl-popup-content');
    if (content) {
      content.classList.remove('popup-enter');
      content.classList.add('popup-exit');
      setTimeout(() => originalRemove(), 170);
      return popup;
    }
    return originalRemove();
  };
  popup.__animated = true;
  return popup;
};

export const PopUpUsersStyles = () => (
  <style>{`
    .user-presence-popup .mapboxgl-popup-content {
      padding: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      border: none !important;
    }
    .user-presence-popup .mapboxgl-popup-tip {
      display: none;
    }
  `}</style>
);
