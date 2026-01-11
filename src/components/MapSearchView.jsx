// src/components/MapSearchView.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { X as XIcon } from 'lucide-react';
import userCar1 from '../assets/user-car-1.png';
import userCar2 from '../assets/user-car-2.png';
import userCar3 from '../assets/user-car-3.png';
import userCar4 from '../assets/user-car-4.png';
import { buildOtherUserPopupHTML, enhancePopupAnimation, PopUpUsersStyles } from './PopUpUsers';

const isValidCoord = (lng, lat) =>
  typeof lng === 'number' &&
  typeof lat === 'number' &&
  !Number.isNaN(lng) &&
  !Number.isNaN(lat) &&
  Math.abs(lng) <= 180 &&
  Math.abs(lat) <= 90;

const CAR_ICONS = [userCar1, userCar2, userCar3, userCar4];

const formatPrice = (price) => {
  const n = Number(price);
  if (!Number.isFinite(n)) return '--';
  return n <= 0 ? 'Free' : `${n.toFixed(2)} €`;
};

const getRemainingMinutes = (spot) => {
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
  const remainingMs = createdMs + Number(time) * 60_000 - Date.now();
  if (!Number.isFinite(remainingMs)) return null;
  return Math.max(0, Math.round(remainingMs / 60_000));
};

const buildSpotPopupHTML = (t, isDark, spot) => {
  const name = spot?.hostName || spot?.host || spot?.displayName || t('user', 'User');
  const remainingMin = getRemainingMinutes(spot);
  const priceLabel = formatPrice(spot?.price);
  const cardBg = isDark ? 'rgba(11, 17, 27, 0.94)' : 'rgba(255,255,255,0.96)';
  const border = isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.08)';
  const textColor = isDark ? '#e2e8f0' : '#0f172a';
  const muted = isDark ? '#94a3b8' : '#64748b';
  return `
    <div style="font-family:'Inter', system-ui, -apple-system, sans-serif; min-width:220px; color:${textColor};">
      <div style="padding:14px 16px; border-radius:18px; background:${cardBg}; border:${border};
        box-shadow:0 22px 60px -22px rgba(0,0,0,0.55); backdrop-filter: blur(18px) saturate(150%);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="min-width:0;">
            <div style="font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
            <div style="margin-top:2px;font-size:12px;font-weight:600;color:${muted};">
              ${t('spotLabel', 'Spot available')}
            </div>
          </div>
          <span style="display:inline-flex;align-items:center;padding:6px 12px;border-radius:999px;
            background:${isDark ? 'rgba(34,197,94,0.16)' : 'rgba(16,185,129,0.16)'}; color:#16a34a;
            font-size:11px;font-weight:800;white-space:nowrap;">
            ${t('price', 'Price')}: ${priceLabel}
          </span>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;gap:10px;color:${textColor};">
          <div style="width:10px;height:10px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 8px rgba(34,197,94,0.2);"></div>
          <div style="font-size:13px;font-weight:700;line-height:1.3;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${t('timeRemaining', 'Time left')}: ${remainingMin == null ? '--' : `${remainingMin} min`}
          </div>
        </div>
      </div>
    </div>
  `;
};

const iconForKey = (key) => {
  const safe = String(key || '');
  let hash = 0;
  for (let i = 0; i < safe.length; i += 1) {
    hash = (hash * 31 + safe.charCodeAt(i)) | 0;
  }
  return CAR_ICONS[Math.abs(hash) % CAR_ICONS.length];
};

const MapSearchView = ({ spots = [], userCoords = null, onClose }) => {
  const { t } = useTranslation('common');
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markersRef = useRef(new Map());
  const userMarkerRef = useRef(null);
  const popupRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== 'undefined') {
      const domTheme = document.body?.dataset?.theme;
      if (domTheme === 'dark') return true;
      if (domTheme === 'light') return false;
    }
    if (typeof window !== 'undefined') {
      const stored = window.localStorage?.getItem('theme');
      if (stored === 'dark') return true;
      if (stored === 'light') return false;
      return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
    }
    return false;
  });

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = () => {
      const domTheme = document.body?.dataset?.theme;
      if (domTheme === 'dark') setIsDark(true);
      else if (domTheme === 'light') setIsDark(false);
      else if (typeof window !== 'undefined') {
        const stored = window.localStorage?.getItem('theme');
        if (stored === 'dark') setIsDark(true);
        else if (stored === 'light') setIsDark(false);
        else setIsDark(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false);
      }
    };
    const observer = new MutationObserver(update);
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('storage', update);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMediaChange = () => update();
    media?.addEventListener?.('change', onMediaChange);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', update);
      media?.removeEventListener?.('change', onMediaChange);
    };
  }, []);

  const getSafeCenter = () => {
    if (userCoords && isValidCoord(userCoords.lng, userCoords.lat)) {
      return [userCoords.lng, userCoords.lat];
    }
    const first = spots.find((spot) => isValidCoord(spot?.lng, spot?.lat));
    if (first) return [first.lng, first.lat];
    return [2.295, 48.8738];
  };

  const applyDayNightPreset = (map) => {
    if (!map || typeof map.setConfigProperty !== 'function') return;
    try {
      map.setConfigProperty('basemap', 'lightPreset', isDark ? 'dusk' : 'day');
    } catch {
      // ignore: style might not support config properties
    }
  };

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return undefined;
    if (mapRef.current) return undefined;

    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/louloupark/cmjb7kixg005z01qy4cztc9ce',
      center: getSafeCenter(),
      zoom: 14.5,
      pitch: 0,
      bearing: 0,
      antialias: true,
      interactive: true,
      attributionControl: false,
    });

    const handleStyleLoad = () => applyDayNightPreset(map);
    map.on('style.load', handleStyleLoad);
    applyDayNightPreset(map);
    map.on('load', () => {
      setMapLoaded(true);
      map.resize();
    });
    map.on('error', () => setMapLoaded(false));

    mapRef.current = map;
    return () => {
      map.off('style.load', handleStyleLoad);
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [mapboxToken]);

  useEffect(() => {
    if (!mapRef.current) return;
    applyDayNightPreset(mapRef.current);
  }, [isDark]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    if (userCoords && isValidCoord(userCoords.lng, userCoords.lat)) {
      mapRef.current.easeTo({
        center: [userCoords.lng, userCoords.lat],
        duration: 900,
        zoom: 15.2,
        pitch: 0,
        bearing: 0,
        essential: true,
      });
    }
  }, [mapLoaded, userCoords?.lng, userCoords?.lat]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const nextIds = new Set();
    spots.forEach((spot, idx) => {
      const lng = Number(spot?.lng);
      const lat = Number(spot?.lat);
      if (!isValidCoord(lng, lat)) return;
      const id = spot?.id || `spot-${idx}`;
      nextIds.add(id);
      const popupHtml = buildSpotPopupHTML(t, isDark, spot);
      if (!markersRef.current.has(id)) {
        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.transform = 'translateY(-6px)';
        el.style.pointerEvents = 'auto';
        el.style.transformOrigin = 'center center';

        const imgWrapper = document.createElement('div');
        imgWrapper.style.position = 'relative';
        imgWrapper.style.display = 'inline-flex';
        imgWrapper.style.alignItems = 'center';
        imgWrapper.style.justifyContent = 'center';
        imgWrapper.style.transformOrigin = 'center center';

        const img = document.createElement('img');
        img.src = iconForKey(spot?.hostId || spot?.hostName || id);
        img.alt = t('otherUser', 'Other user');
        img.style.width = '36px';
        img.style.height = '36px';
        img.style.transformOrigin = 'center';
        img.draggable = false;
        img.style.filter = 'drop-shadow(0 6px 8px rgba(0,0,0,0.25))';
        img.style.zIndex = '1';
        img.style.opacity = '1';

        const presenceDot = document.createElement('span');
        presenceDot.className = 'user-marker-presence-dot';
        presenceDot.style.position = 'absolute';
        presenceDot.style.left = '50%';
        presenceDot.style.top = '0px';
        presenceDot.style.transform = 'translate(-50%, -50%)';
        presenceDot.style.width = '12px';
        presenceDot.style.height = '12px';
        presenceDot.style.borderRadius = '999px';
        presenceDot.style.background = '#22c55e';
        presenceDot.style.border = '2px solid #ffffff';
        presenceDot.style.boxShadow = '0 0 0 6px rgba(34,197,94,0.18)';
        presenceDot.style.animation = 'searchSpotPulse 1.8s ease-in-out infinite';

        imgWrapper.appendChild(img);
        imgWrapper.appendChild(presenceDot);
        el.appendChild(imgWrapper);

        const popup = new mapboxgl.Popup({ offset: 14, closeButton: false, className: 'user-presence-popup' }).setHTML(
          popupHtml,
        );
        enhancePopupAnimation(popup);
        const marker = new mapboxgl.Marker({
          element: el,
          rotationAlignment: 'viewport',
          pitchAlignment: 'viewport',
          anchor: 'bottom',
        })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(mapRef.current);
        markersRef.current.set(id, marker);
      } else {
        const marker = markersRef.current.get(id);
        marker.setLngLat([lng, lat]);
        const popup = marker.getPopup();
        if (popup) {
          enhancePopupAnimation(popup);
          popup.setHTML(popupHtml);
        }
      }
    });
    for (const [id, marker] of markersRef.current.entries()) {
      if (!nextIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [mapLoaded, spots, isDark, t]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    if (userCoords && isValidCoord(userCoords.lng, userCoords.lat)) {
      const popupHtml = buildOtherUserPopupHTML(
        t,
        isDark,
        t('yourLocation', 'Your location'),
        { text: t('online', 'Online'), isOnline: true },
        { showBadge: false },
      );
      if (!userMarkerRef.current) {
        const el = document.createElement('div');
        el.className = 'car-marker-container transition-transform duration-100 linear';
        el.style.width = '52px';
        el.style.height = '52px';
        el.style.transformOrigin = 'center center';
        el.draggable = false;
        el.innerHTML = `
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform-origin: center;">
            <defs>
              <filter id="wazeGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="rgba(0, 0, 0, 0.3)" />
              </filter>
            </defs>
            <g filter="url(#wazeGlow)">
              <path
                d="M26 6L44 46L26 36L8 46L26 6Z"
                fill="#33CCFF"
                stroke="white"
                stroke-width="4"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            </g>
          </svg>
        `;
        const popup = new mapboxgl.Popup({ offset: 18, closeButton: false, className: 'user-presence-popup' }).setHTML(
          popupHtml,
        );
        enhancePopupAnimation(popup);
        popupRef.current = popup;
        userMarkerRef.current = new mapboxgl.Marker({
          element: el,
          rotationAlignment: 'map',
          pitchAlignment: 'map',
        })
          .setLngLat([userCoords.lng, userCoords.lat])
          .setRotation(0)
          .setPopup(popup)
          .addTo(mapRef.current);
      } else {
        userMarkerRef.current.setLngLat([userCoords.lng, userCoords.lat]);
        if (popupRef.current) {
          popupRef.current.setHTML(popupHtml);
        }
      }
    } else if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
      popupRef.current = null;
    }
  }, [mapLoaded, userCoords?.lng, userCoords?.lat, isDark, t]);

  return (
    <div className="fixed inset-0 z-[60]">
      <PopUpUsersStyles />
      <style>{`
        @keyframes searchSpotPulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 6px rgba(34,197,94,0.18); }
          50% { transform: translate(-50%, -50%) scale(1.08); box-shadow: 0 0 0 10px rgba(34,197,94,0.08); }
        }
      `}</style>
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
      {!mapboxToken && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
          Missing Mapbox Token
        </div>
      )}
      <div
        className="absolute left-0 right-0 z-10 px-6 pt-5 pb-2 flex items-center justify-between"
        style={{ top: 'env(safe-area-inset-top)' }}
      >
        <div className="w-10" />
        <div
          className={`px-4 py-2 rounded-full text-sm font-semibold border shadow-sm flex items-center gap-2 ${
            isDark
              ? 'bg-gradient-to-r from-slate-900/90 to-slate-800/90 border-white/10 text-slate-100'
              : 'bg-white/90 border-white/70 text-slate-900'
          }`}
          style={{ boxShadow: isDark ? '0 10px 24px rgba(0,0,0,0.35)' : '0 12px 28px rgba(15,23,42,0.12)' }}
        >
          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${
            isDark ? 'bg-white/10 text-orange-200' : 'bg-orange-50 text-orange-500'
          }`}>
            <XIcon size={14} strokeWidth={2.5} />
          </span>
          {t('mapTitle', { defaultValue: 'Carte' })}
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`text-sm font-semibold rounded-full px-3 py-1 border shadow-sm transition ${
            isDark
              ? 'text-slate-50 bg-slate-800/80 border-white/10 hover:bg-slate-800'
              : 'text-slate-900 bg-white/70 border-white/60 hover:bg-white'
          }`}
        >
          {t('close', 'Close')}
        </button>
      </div>
    </div>
  );
};

export default MapSearchView;
