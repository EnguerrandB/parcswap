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

const isFiniteCoord = (value) => typeof value === 'number' && Number.isFinite(value);

const isFiniteRect = (value) =>
  value &&
  isFiniteCoord(value.left) &&
  isFiniteCoord(value.top) &&
  isFiniteCoord(value.width) &&
  isFiniteCoord(value.height);

const rectFromElement = (element) => {
  if (!(element instanceof Element)) return null;
  const rect = element.getBoundingClientRect();
  if (!isFiniteRect(rect)) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
};

const buildGhostStartRect = (origin, targetRect) => {
  if (isFiniteRect(origin)) return origin;
  if (origin?.element instanceof Element) {
    const elementRect = rectFromElement(origin.element);
    if (elementRect) return elementRect;
  }
  if (origin && isFiniteCoord(origin.x) && isFiniteCoord(origin.y) && isFiniteRect(targetRect)) {
    const width = Math.max(44, Math.round(targetRect.width * 0.42));
    const height = Math.max(36, Math.round(targetRect.height * 0.42));
    return {
      left: origin.x - width / 2,
      top: origin.y - height / 2,
      width,
      height,
    };
  }
  return null;
};

const animatePopupGhost = ({ liveContent, origin }) => {
  if (!(liveContent instanceof Element)) return null;
  const targetRect = rectFromElement(liveContent);
  if (!targetRect) return null;

  const startRect = buildGhostStartRect(origin, targetRect);
  if (!startRect) return null;

  const deltaX = startRect.left + startRect.width / 2 - (targetRect.left + targetRect.width / 2);
  const deltaY = startRect.top + startRect.height / 2 - (targetRect.top + targetRect.height / 2);
  const distance = Math.hypot(deltaX, deltaY);
  const duration = Math.max(420, Math.min(760, 420 + distance * 0.2));
  const startScaleX = Math.max(0.72, Math.min(1, startRect.width / Math.max(targetRect.width, 1)));
  const startScaleY = Math.max(0.72, Math.min(1, startRect.height / Math.max(targetRect.height, 1)));

  const ghost = (origin?.element instanceof Element ? origin.element : liveContent).cloneNode(true);
  ghost.classList.remove('popup-enter', 'popup-exit');
  ghost.classList.add('popup-ghost');
  ghost.style.position = 'fixed';
  ghost.style.left = `${targetRect.left}px`;
  ghost.style.top = `${targetRect.top}px`;
  ghost.style.width = `${targetRect.width}px`;
  ghost.style.height = `${targetRect.height}px`;
  ghost.style.margin = '0';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '99999';
  ghost.style.opacity = '0.98';
  ghost.style.transformOrigin = 'center center';
  ghost.style.transform = `translate(${Math.round(deltaX)}px, ${Math.round(deltaY)}px) scale(${startScaleX}, ${startScaleY})`;
  ghost.style.transition = `transform ${Math.round(duration)}ms cubic-bezier(0.2, 0.72, 0.2, 1), opacity ${Math.round(Math.min(220, duration * 0.42))}ms ease`;
  ghost.style.willChange = 'transform, opacity';

  document.body.appendChild(ghost);

  liveContent.style.opacity = '0';
  liveContent.style.transition = 'opacity 180ms ease';

  const revealDelay = Math.max(140, Math.round(duration * 0.55));
  const revealTimer = window.setTimeout(() => {
    liveContent.style.opacity = '1';
  }, revealDelay);

  requestAnimationFrame(() => {
    ghost.style.transform = 'translate(0px, 0px) scale(1, 1)';
  });

  const cleanup = () => {
    window.clearTimeout(revealTimer);
    ghost.remove();
  };

  const removeTimer = window.setTimeout(cleanup, duration + 80);

  return () => {
    window.clearTimeout(revealTimer);
    window.clearTimeout(removeTimer);
    ghost.remove();
  };
};

// Adds a quick pop-in/out animation on all popups
export const enhancePopupAnimation = (popup, options = {}) => {
  if (!popup) return popup;
  popup.__animationOptions = options;
  if (popup.__animated) return popup;
  const originalAddTo = popup.addTo.bind(popup);
  popup.addTo = (mapInstance) => {
    const animationOptions = popup.__animationOptions || {};
    const origin =
      typeof animationOptions.getEnterOrigin === 'function'
        ? animationOptions.getEnterOrigin({ popup, mapInstance })
        : null;
    const res = originalAddTo(mapInstance);
    const el = popup.getElement();
    const content = el?.querySelector('.mapboxgl-popup-content');
    if (content) {
      content.classList.remove('popup-exit');
      content.classList.remove('popup-enter');
      if (typeof popup.__ghostCleanup === 'function') {
        popup.__ghostCleanup();
        popup.__ghostCleanup = null;
      }
      requestAnimationFrame(() => {
        const liveContent = popup.getElement()?.querySelector('.mapboxgl-popup-content');
        if (!liveContent) return;
        popup.__ghostCleanup = animatePopupGhost({ liveContent, origin });
        if (!popup.__ghostCleanup) {
          liveContent.style.opacity = '';
          liveContent.classList.add('popup-enter');
        }
      });
    }
    if (!popup.__autoCloseTimer) {
      popup.__autoCloseTimer = setTimeout(() => {
        popup.remove();
      }, 10_000);
    }
    return res;
  };
  const originalRemove = popup.remove.bind(popup);
  popup.remove = () => {
    const el = popup.getElement();
    const content = el?.querySelector('.mapboxgl-popup-content');
    if (popup.__skipExitAnimation) {
      if (typeof popup.__ghostCleanup === 'function') {
        popup.__ghostCleanup();
        popup.__ghostCleanup = null;
      }
      if (popup.__autoCloseTimer) {
        clearTimeout(popup.__autoCloseTimer);
        popup.__autoCloseTimer = null;
      }
      popup.__skipExitAnimation = false;
      return originalRemove();
    }
    if (content) {
      content.classList.remove('popup-enter');
      content.classList.add('popup-exit');
      if (typeof popup.__ghostCleanup === 'function') {
        popup.__ghostCleanup();
        popup.__ghostCleanup = null;
      }
      if (popup.__autoCloseTimer) {
        clearTimeout(popup.__autoCloseTimer);
        popup.__autoCloseTimer = null;
      }
      setTimeout(() => originalRemove(), 220);
      return popup;
    }
    if (popup.__autoCloseTimer) {
      clearTimeout(popup.__autoCloseTimer);
      popup.__autoCloseTimer = null;
    }
    return originalRemove();
  };
  popup.__animated = true;
  return popup;
};

export const PopUpUsersStyles = () => (
  <style>{`
    @keyframes popupEnter {
      from { opacity: 0.25; }
      to { opacity: 1; }
    }
    @keyframes popupExit {
      from { transform: scale(1) translateY(0); opacity: 1; }
      to { transform: scale(0.92) translateY(4px); opacity: 0; }
    }
    .mapboxgl-popup-content.popup-enter {
      animation: popupEnter 0.18s ease forwards;
      will-change: opacity;
    }
    .mapboxgl-popup-content.popup-exit { animation: popupExit 0.16s ease forwards; }
    .popup-ghost {
      overflow: hidden;
    }
    .user-presence-popup {
      transition: transform 0.16s ease-out;
      will-change: transform;
    }
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
