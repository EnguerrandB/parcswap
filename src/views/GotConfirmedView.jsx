// src/views/GotConfirmedView.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, X, MapPin } from 'lucide-react';
import { createPortal } from "react-dom";
import { doc, onSnapshot } from 'firebase/firestore';
import { appId, db } from '../firebase';


const DEFAULT_CENTER = [2.295, 48.8738]; // Arc de Triomphe

const GotConfirmedView = ({
  spot,
  bookerCoords,
  distanceText,
  mapboxToken,
  onCancel,
  onConfirmPlate,
  plateInput,
  setPlateInput,
  formatPlate,
  isFullPlate,
  isValidCoord,
}) => {
  const { t } = useTranslation('common');
  const miniMapRef = useRef(null);
  const [miniMapEl, setMiniMapEl] = useState(null);
  const setMiniMapNode = useCallback((node) => {
    miniMapRef.current = node;
    setMiniMapEl(node);
  }, []);
  const miniMapInstanceRef = useRef(null);
  const bookerMarkerRef = useRef(null);
  const bookerMarkerElRef = useRef(null);
  const bookerMarkerUiRef = useRef(null);
  const spotMarkerRef = useRef(null);
  const [showPlateModal, setShowPlateModal] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const autoPromptedRef = useRef(false);
  const spotLng = spot?.lng != null ? Number(spot.lng) : null;
  const spotLat = spot?.lat != null ? Number(spot.lat) : null;
  const bookerLng = bookerCoords?.lng != null ? Number(bookerCoords.lng) : null;
  const bookerLat = bookerCoords?.lat != null ? Number(bookerCoords.lat) : null;
  const hasSpotCoords = isValidCoord(spotLng, spotLat);
  const hasBookerCoords = isValidCoord(bookerLng, bookerLat);
  const fallbackBookerName = spot?.bookerName || t('seeker', 'Seeker');
  const [bookerProfile, setBookerProfile] = useState(() => ({
    name: fallbackBookerName,
    transactions: spot?.bookerTransactions ?? spot?.bookerTx ?? null,
  }));

  const ensureBookerMarkerElement = useCallback(() => {
    if (bookerMarkerElRef.current) return bookerMarkerElRef.current;
    if (typeof document === 'undefined') return null;

    const root = document.createElement('div');
    root.className = 'pointer-events-none select-none';

    const stack = document.createElement('div');
    stack.className = 'flex flex-col items-center';
    stack.style.transform = 'translateY(-10px)';

    const card = document.createElement('div');
    card.className =
      'min-w-[200px] max-w-[260px] rounded-[22px] border border-white/35 bg-white/70 backdrop-blur-2xl px-3 py-2 shadow-[0_18px_45px_rgba(15,23,42,0.18)]';
    card.style.backdropFilter = 'blur(18px) saturate(180%)';
    card.style.WebkitBackdropFilter = 'blur(18px) saturate(180%)';

    const labelEl = document.createElement('div');
    labelEl.className = 'text-[10px] uppercase tracking-[0.18em] font-semibold text-gray-500';

    const nameEl = document.createElement('div');
    nameEl.className = 'mt-0.5 text-base font-bold text-slate-900 truncate max-w-[240px]';

    const txRow = document.createElement('div');
    txRow.className = 'mt-1 flex items-center justify-between gap-3';
    const txLabelEl = document.createElement('span');
    txLabelEl.className = 'text-xs font-semibold text-gray-600';
    const txValueEl = document.createElement('span');
    txValueEl.className = 'text-xs font-bold text-slate-900';

    txRow.append(txLabelEl, txValueEl);
    card.append(labelEl, nameEl, txRow);

    const caret = document.createElement('div');
    caret.className =
      'w-3 h-3 bg-white/70 border border-white/35 rotate-45 -mt-1 shadow-[0_10px_25px_rgba(15,23,42,0.12)]';
    caret.style.backdropFilter = 'blur(18px) saturate(180%)';
    caret.style.WebkitBackdropFilter = 'blur(18px) saturate(180%)';

    const dot = document.createElement('div');
    dot.className =
      'mt-1 w-4 h-4 rounded-full bg-blue-600 ring-4 ring-white shadow-[0_10px_25px_rgba(37,99,235,0.35)]';

    stack.append(card, caret, dot);
    root.append(stack);

    bookerMarkerElRef.current = root;
    bookerMarkerUiRef.current = { labelEl, nameEl, txLabelEl, txValueEl };
    return root;
  }, []);

  useEffect(() => {
    const ui = bookerMarkerUiRef.current;
    if (!ui) return;
    ui.labelEl.textContent = t('driver', { defaultValue: 'Driver' });
    ui.nameEl.textContent = bookerProfile.name || fallbackBookerName;
    ui.txLabelEl.textContent = t('Transactions', { defaultValue: 'Transactions' });
    ui.txValueEl.textContent =
      bookerProfile.transactions == null ? '—' : String(Number(bookerProfile.transactions) || 0);
  }, [bookerProfile, fallbackBookerName, t]);

  const distanceMeters = (() => {
    if (!hasSpotCoords || !hasBookerCoords) return null;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371e3;
    const dLat = toRad(bookerLat - spotLat);
    const dLon = toRad(bookerLng - spotLng);
    const lat1 = toRad(spotLat);
    const lat2 = toRad(bookerLat);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  })();

  const closePlateModal = () => setShowPlateModal(false);
  const openPlateModal = () => setShowPlateModal(true);
  const handleSubmitPlate = () => {
    const formatted = formatPlate(plateInput);
    if (!isFullPlate(formatted)) return;
    onConfirmPlate?.(spot.id, formatted);
    closePlateModal();
  };

  // Subscribe to the other user's profile (name + transactions)
  useEffect(() => {
    if (!spot?.bookerId) {
      setBookerProfile((prev) => ({
        ...prev,
        name: fallbackBookerName,
        transactions: spot?.bookerTransactions ?? spot?.bookerTx ?? prev.transactions ?? null,
      }));
      return undefined;
    }

    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', spot.bookerId);
    const unsub = onSnapshot(
      userRef,
      (snap) => {
        const data = snap.data?.() || snap.data() || {};
        const txCountRaw = data.transactions ?? spot?.bookerTransactions ?? spot?.bookerTx ?? null;
        const txCount = Number.isFinite(Number(txCountRaw)) ? Number(txCountRaw) : null;
        const displayName = data.displayName || spot?.bookerName || fallbackBookerName;
        setBookerProfile({ name: displayName, transactions: txCount });
      },
      (err) => console.error('[GotConfirmedView] Error subscribing to booker profile:', err),
    );
    return () => unsub();
  }, [spot?.bookerId, spot?.bookerName, spot?.bookerTransactions, spot?.bookerTx, fallbackBookerName]);

  // Init map (same pattern as src/components/Map.jsx)
  // Init map (Robust version)
  useEffect(() => {
    if (!mapboxToken || !miniMapEl) return undefined;
    if (miniMapInstanceRef.current) return undefined;

    let resizeObserver = null;
    let removeWindowResizeListener = null;
    let rafId = null;
    let resizeTimeoutId = null;
    let readyMarked = false;

    const markReady = (map) => {
      if (readyMarked) return;
      readyMarked = true;
      setMapReady(true);
      map.resize();
    };

    const handleError = (e) => {
      const raw = e?.error;
      const msg =
        typeof raw === 'string'
          ? raw
          : raw?.message
            ? raw.message
            : raw?.toString?.()
              ? raw.toString()
              : 'Map error';
      console.error('[GotConfirmedView] Mapbox error:', e);
      setMapError(msg);
    };

    try {
      setMapError(null);
      setMapReady(false);

      mapboxgl.accessToken = mapboxToken;

      const isSupported = typeof mapboxgl.supported === 'function' ? mapboxgl.supported() : true;
      if (!isSupported) {
        setMapError('WebGL not supported on this device/browser');
        return undefined;
      }

      const initialCenter =
        hasSpotCoords && Number.isFinite(spotLng) && Number.isFinite(spotLat) ? [spotLng, spotLat] : DEFAULT_CENTER;

      const map = new mapboxgl.Map({
        container: miniMapEl,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: initialCenter,
        zoom: 15,
        pitch: 0,
        interactive: true,
        attributionControl: false,
      });

      miniMapInstanceRef.current = map;

      const handleLoad = () => markReady(map);
      const handleStyleLoad = () => markReady(map);

      map.on('load', handleLoad);
      map.on('style.load', handleStyleLoad);
      map.on('error', handleError);

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (map && typeof map.resize === 'function') map.resize();
        });
        resizeObserver.observe(miniMapEl);
      } else if (typeof window !== 'undefined') {
        const onResize = () => map.resize();
        window.addEventListener('resize', onResize);
        removeWindowResizeListener = () => window.removeEventListener('resize', onResize);
      }

      // Some browsers need an extra resize after the portal + fixed layout settles.
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(() => map.resize());
      }
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        resizeTimeoutId = window.setTimeout(() => map.resize(), 0);
      }

      return () => {
        if (resizeObserver) resizeObserver.disconnect();
        if (removeWindowResizeListener) removeWindowResizeListener();
        if (rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
        if (resizeTimeoutId != null && typeof window !== 'undefined') window.clearTimeout(resizeTimeoutId);

        map.off('load', handleLoad);
        map.off('style.load', handleStyleLoad);
        map.off('error', handleError);

        if (bookerMarkerRef.current) {
          bookerMarkerRef.current.remove();
          bookerMarkerRef.current = null;
        }
        bookerMarkerElRef.current = null;
        bookerMarkerUiRef.current = null;
        if (spotMarkerRef.current) {
          spotMarkerRef.current.remove();
          spotMarkerRef.current = null;
        }

        map.remove();
        miniMapInstanceRef.current = null;
        setMapReady(false);
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMapError(msg);
      return undefined;
    }
  }, [mapboxToken, miniMapEl, hasSpotCoords, spotLng, spotLat]);

  // Update markers & camera (no re-init)
  useEffect(() => {
    const map = miniMapInstanceRef.current;
    if (!map || !mapReady) return;

    if (hasSpotCoords) {
      if (!spotMarkerRef.current) {
        spotMarkerRef.current = new mapboxgl.Marker({ color: '#f97316' })
          .setLngLat([spotLng, spotLat])
          .addTo(map);
      } else {
        spotMarkerRef.current.setLngLat([spotLng, spotLat]);
      }
    } else if (spotMarkerRef.current) {
      spotMarkerRef.current.remove();
      spotMarkerRef.current = null;
    }

    if (hasBookerCoords) {
      if (!bookerMarkerRef.current) {
        const el = ensureBookerMarkerElement();
        if (el) {
          bookerMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([bookerLng, bookerLat])
            .addTo(map);
          const ui = bookerMarkerUiRef.current;
          if (ui) {
            ui.labelEl.textContent = t('driver', { defaultValue: 'Driver' });
            ui.nameEl.textContent = bookerProfile.name || fallbackBookerName;
            ui.txLabelEl.textContent = t('Transactions', { defaultValue: 'Transactions' });
            ui.txValueEl.textContent =
              bookerProfile.transactions == null ? '—' : String(Number(bookerProfile.transactions) || 0);
          }
        }
      } else {
        bookerMarkerRef.current.setLngLat([bookerLng, bookerLat]);
      }
    } else if (bookerMarkerRef.current) {
      bookerMarkerRef.current.remove();
      bookerMarkerRef.current = null;
      bookerMarkerElRef.current = null;
      bookerMarkerUiRef.current = null;
    }

    if (hasSpotCoords && hasBookerCoords) {
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([spotLng, spotLat]);
      bounds.extend([bookerLng, bookerLat]);
      map.fitBounds(bounds, { padding: 36, duration: 500, essential: true });
      return;
    }
    if (hasSpotCoords) {
      map.easeTo({
        center: [spotLng, spotLat],
        zoom: 16,
        pitch: 0,
        bearing: 0,
        duration: 600,
        essential: true,
      });
    }
  }, [mapReady, spotLng, spotLat, bookerLng, bookerLat, hasSpotCoords, hasBookerCoords, ensureBookerMarkerElement]);

  // Auto-open plate modal when close to destination
  useEffect(() => {
    if (distanceMeters == null) return;
    if (distanceMeters <= 50 && !autoPromptedRef.current) {
      autoPromptedRef.current = true;
      setShowPlateModal(true);
    }
  }, [distanceMeters]);

  
    const content = (
    <div
  className="fixed inset-0 overflow-hidden bg-white"
  style={{ zIndex: 2147483647 }}
>
      <div ref={setMiniMapNode} className="absolute inset-0 z-0 w-full h-full bg-gray-100" />
      {!mapboxToken && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 text-white">
          {t('missingMapboxToken', 'Missing Mapbox Token')}
        </div>
      )}
      {mapboxToken && mapError && (
  <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
    <div className="px-4 py-2 rounded-xl bg-black/80 text-white text-xs shadow max-w-[90vw]">
      {mapError}
    </div>
  </div>
)}
      {mapboxToken && !mapError && !mapReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="px-4 py-2 rounded-full bg-white/90 text-gray-600 shadow">
            {t('loadingMap', 'Chargement de la carte...')}
          </div>
        </div>
      )}

      {/* Bottom glass card (Apple-like) */}
      <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none p-4">
        <div
          className="
            pointer-events-auto mx-auto w-full max-w-[420px]
            rounded-[28px] border border-white/35
            bg-white/55 backdrop-blur-2xl backdrop-saturate-200
            shadow-[0_20px_60px_rgba(15,23,42,0.20)]
            p-4
          "
          style={{
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/60 border border-white/60 shadow-inner flex items-center justify-center text-orange-700">
              <MapPin className="w-6 h-6" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-gray-500">
                {t('distanceLabel', { defaultValue: 'Distance' })}
              </p>
              <p className="text-xl font-extrabold text-slate-900">
                {typeof distanceText === 'string' && distanceText.trim() && distanceText !== '--'
                  ? distanceText
                  : distanceMeters != null
                    ? `${distanceMeters} m`
                    : '—'}
              </p>
            </div>

            {distanceMeters != null &&
              typeof distanceText === 'string' &&
              distanceText.includes('km') && (
                <span className="inline-flex items-center rounded-full bg-orange-50 border border-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
                  {distanceMeters} m
                </span>
              )}
          </div>

          <div className={`mt-4 grid gap-3 ${onCancel ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {onCancel && (
              <button
                onClick={() => onCancel(spot.id)}
                className="
                  h-12 rounded-2xl border border-white/50 bg-white/60
                  text-red-600 font-semibold shadow-sm
                  transition active:scale-[0.99]
                  hover:bg-white/80
                "
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <X className="w-4 h-4" />
                  {t('cancelTransaction', { defaultValue: 'Annuler' })}
                </span>
              </button>
            )}
            <button
              onClick={openPlateModal}
              className="
                h-12 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500
                text-white font-bold shadow-[0_10px_30px_rgba(249,115,22,0.35)]
                transition active:scale-[0.99]
                hover:brightness-110
              "
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Car className="w-4 h-4" />
                {t('arrivedQuestion', 'Arrived ?')}
              </span>
            </button>
          </div>
        </div>
      </div>

      {showPlateModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-md" onClick={closePlateModal} />
          <div
            className="
              relative w-full max-w-md
              rounded-[28px] border border-white/25
              bg-white/60 backdrop-blur-2xl backdrop-saturate-200
              shadow-[0_30px_90px_rgba(15,23,42,0.35)]
              p-6
            "
            style={{ WebkitBackdropFilter: 'blur(24px) saturate(180%)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-gray-500">
                  {t('driver', { defaultValue: 'Driver' })}
                </p>
                <h3 className="text-2xl font-extrabold text-slate-900">
                  {t('verifyLicensePlate', { defaultValue: "Plaque d'immatriculation" })}
                </h3>
              </div>
              <button
                onClick={closePlateModal}
                className="w-10 h-10 rounded-full bg-white/70 border border-white/70 shadow-sm text-gray-500 hover:text-gray-700 hover:bg-white/90 transition"
                aria-label={t('close', { defaultValue: 'Close' })}
              >
                <X className="w-5 h-5 mx-auto" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              {t('platePrompt', { defaultValue: "Saisis la plaque de l'autre utilisateur quand tu es arrivé." })}
            </p>
            <input
              type="text"
              placeholder={t('platePlaceholder', 'e.g., AB-123-CD')}
              className="
                w-full rounded-2xl px-4 py-4
                text-center text-2xl font-mono uppercase tracking-widest
                bg-white/70 border border-white/70 shadow-inner
                focus:outline-none focus:ring-4 focus:ring-orange-500/20 focus:border-orange-400
                transition
              "
              value={plateInput}
              onChange={(e) => setPlateInput(formatPlate(e.target.value))}
            />
            <button
              onClick={handleSubmitPlate}
              className="
                w-full mt-4 h-12 rounded-2xl
                bg-gradient-to-r from-emerald-500 to-green-600
                text-white font-bold shadow-[0_12px_30px_rgba(16,185,129,0.35)]
                hover:brightness-110 transition disabled:opacity-50
              "
              disabled={!isFullPlate(formatPlate(plateInput))}
            >
              {t('confirmPlate', 'Confirm Plate')}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
};

export default GotConfirmedView;
