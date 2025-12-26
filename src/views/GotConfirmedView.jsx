// src/views/GotConfirmedView.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, X, MapPin } from 'lucide-react';
import { createPortal } from "react-dom";
import { doc, onSnapshot } from 'firebase/firestore';
import { appId, db } from '../firebase';
import PremiumParksDeltaToast from '../components/PremiumParksDeltaToast';


const DEFAULT_CENTER = [2.295, 48.8738]; // Arc de Triomphe
const ROUTE_SOURCE_ID = 'parkswap-route';
const ROUTE_LAYER_ID = 'parkswap-route-line';
const APP_ROUTE_COLOR = '#f97316'; // app orange

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
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const miniMapRef = useRef(null);
  const [miniMapEl, setMiniMapEl] = useState(null);
  const setMiniMapNode = useCallback((node) => {
    miniMapRef.current = node;
    setMiniMapEl(node);
  }, []);
  const miniMapInstanceRef = useRef(null);
  const bookerMarkerRef = useRef(null);
  const bookerPopupRef = useRef(null);
  const bookerPopupContentElRef = useRef(null);
  const bookerPopupUiRef = useRef(null);
  const spotMarkerRef = useRef(null);
  const routeAbortRef = useRef(null);
  const [showPlateModal, setShowPlateModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [plateError, setPlateError] = useState(null);
  const [plateSubmitting, setPlateSubmitting] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [premiumParksToast, setPremiumParksToast] = useState(null);
  const premiumParksToastKeyRef = useRef(null);
  const autoPromptedRef = useRef(false);
  const isDark =
    (typeof document !== 'undefined' && document.body?.dataset?.theme === 'dark') ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('theme') === 'dark');
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

  useEffect(() => {
    const hostDelta = Number(spot?.premiumParksHostDelta);
    const hostAfterRaw = Number(spot?.premiumParksHostAfter);
    if (hostDelta !== 1 || !Number.isFinite(hostAfterRaw)) return;

    const appliedAt = spot?.premiumParksAppliedAt;
    const appliedAtKey = appliedAt?.toMillis ? String(appliedAt.toMillis()) : appliedAt ? String(appliedAt) : '';
    const key = spot?.id ? `${spot.id}:${appliedAtKey}` : null;
    if (!key) return;
    if (premiumParksToastKeyRef.current === key) return;
    premiumParksToastKeyRef.current = key;
    setPremiumParksToast({ from: hostAfterRaw - 1, to: hostAfterRaw });
  }, [spot?.id, spot?.premiumParksAppliedAt, spot?.premiumParksHostDelta, spot?.premiumParksHostAfter]);

  const ensureBookerPopupContentElement = useCallback(() => {
    if (bookerPopupContentElRef.current) return bookerPopupContentElRef.current;
    if (typeof document === 'undefined') return null;

    const root = document.createElement('div');
    root.className = 'pointer-events-none select-none min-w-[200px] max-w-[260px]';

    const nameEl = document.createElement('div');
    nameEl.className = 'text-base font-extrabold text-slate-900 truncate max-w-[240px]';

    const txRow = document.createElement('div');
    txRow.className = 'mt-1 flex items-center justify-between gap-3';
    const txLabelEl = document.createElement('span');
    txLabelEl.className = 'text-xs font-semibold text-slate-700';
    const txValueEl = document.createElement('span');
    txValueEl.className = 'text-xs font-extrabold text-slate-900';

    txRow.append(txLabelEl, txValueEl);
    root.append(nameEl, txRow);

    bookerPopupContentElRef.current = root;
    bookerPopupUiRef.current = { nameEl, txLabelEl, txValueEl };
    return root;
  }, []);

  const upsertRoute = useCallback((map, routeFeature) => {
      if (!map) return;

      const existing = map.getSource?.(ROUTE_SOURCE_ID);
      if (existing && typeof existing.setData === 'function') {
        existing.setData(routeFeature);
      } else {
        if (map.getLayer?.(ROUTE_LAYER_ID)) map.removeLayer?.(ROUTE_LAYER_ID);
        if (map.getSource?.(ROUTE_SOURCE_ID)) map.removeSource?.(ROUTE_SOURCE_ID);
        map.addSource?.(ROUTE_SOURCE_ID, { type: 'geojson', data: routeFeature });
      }

      if (!map.getLayer?.(ROUTE_LAYER_ID)) {
        map.addLayer?.({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': APP_ROUTE_COLOR,
            'line-width': 5,
            'line-opacity': 0.9,
          },
        });
      }
    },
    [],
  );

  const removeRoute = useCallback((map) => {
    if (!map) return;
    if (map.getLayer?.(ROUTE_LAYER_ID)) map.removeLayer?.(ROUTE_LAYER_ID);
    if (map.getSource?.(ROUTE_SOURCE_ID)) map.removeSource?.(ROUTE_SOURCE_ID);
  }, []);

  const getDirectionsRouteFeature = useCallback(async (startLngLat, endLngLat, token, signal) => {
    const coords = `${startLngLat[0]},${startLngLat[1]};${endLngLat[0]},${endLngLat[1]}`;
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}`);
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('overview', 'full');
    url.searchParams.set('steps', 'false');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString(), { signal });
    if (!res.ok) throw new Error(`Directions error: ${res.status}`);
    const json = await res.json();
    const routeCoords = json?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) throw new Error('No route geometry');
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: routeCoords },
    };
  }, []);

  const getFallbackLineFeature = useCallback((startLngLat, endLngLat) => {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [startLngLat, endLngLat] },
    };
  }, []);

  useEffect(() => {
    const ui = bookerPopupUiRef.current;
    if (!ui) return;
    ui.nameEl.textContent = bookerProfile.name || fallbackBookerName;
    ui.txLabelEl.textContent = t('transactionsLabel', { defaultValue: 'Transactions' });
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
  const openPlateModal = () => {
    setPlateError(null);
    setShowPlateModal(true);
  };
  const handleSubmitPlate = async () => {
    const formatted = formatPlate(plateInput);
    if (!isFullPlate(formatted)) return;
    setPlateSubmitting(true);
    setPlateError(null);
	    try {
	      const bookingSessionId = typeof spot?.bookingSessionId === 'string' ? spot.bookingSessionId : null;
	      const res = await onConfirmPlate?.(spot.id, formatted, { bookingSessionId });
	      if (res && res.ok === false) {
	        setPlateError(res.message || t('plateInvalid', { defaultValue: 'Invalid plate.' }));
	        return;
	      }
      closePlateModal();
    } catch (err) {
      setPlateError(t('plateConfirmError', { defaultValue: 'Error confirming. Please try again.' }));
    } finally {
      setPlateSubmitting(false);
    }
  };

  const openCancelModal = () => setShowCancelModal(true);
  const closeCancelModal = () => setShowCancelModal(false);
  const handleConfirmCancel = () => {
    onCancel?.(spot.id);
    closeCancelModal();
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
              : tRef.current('mapErrorGeneric', 'Map error');
      console.error('[GotConfirmedView] Mapbox error:', e);
      setMapError(msg);
    };

    try {
      setMapError(null);
      setMapReady(false);

      mapboxgl.accessToken = mapboxToken;

      const isSupported = typeof mapboxgl.supported === 'function' ? mapboxgl.supported() : true;
      if (!isSupported) {
        setMapError(tRef.current('webglNotSupported', 'WebGL not supported on this device/browser'));
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

        removeRoute(map);
        if (bookerPopupRef.current) {
          bookerPopupRef.current.remove();
          bookerPopupRef.current = null;
        }
        if (bookerMarkerRef.current) {
          bookerMarkerRef.current.remove();
          bookerMarkerRef.current = null;
        }
        bookerPopupContentElRef.current = null;
        bookerPopupUiRef.current = null;
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

  // Route (Directions API)
  useEffect(() => {
    const map = miniMapInstanceRef.current;
    if (!map || !mapReady) return;

    if (!mapboxToken || !hasSpotCoords || !hasBookerCoords) {
      removeRoute(map);
      return;
    }

    const startLngLat = [spotLng, spotLat];
    const endLngLat = [bookerLng, bookerLat];

    const controller = new AbortController();
    if (routeAbortRef.current) routeAbortRef.current.abort();
    routeAbortRef.current = controller;

    (async () => {
      try {
        const feature = await getDirectionsRouteFeature(startLngLat, endLngLat, mapboxToken, controller.signal);
        if (controller.signal.aborted) return;
        upsertRoute(map, feature);
      } catch (err) {
        if (controller.signal.aborted) return;
        upsertRoute(map, getFallbackLineFeature(startLngLat, endLngLat));
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    mapReady,
    mapboxToken,
    hasSpotCoords,
    hasBookerCoords,
    spotLng,
    spotLat,
    bookerLng,
    bookerLat,
    upsertRoute,
    removeRoute,
    getDirectionsRouteFeature,
    getFallbackLineFeature,
  ]);

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
        const dot = document.createElement('div');
        dot.className =
          'pointer-events-none w-4 h-4 rounded-full bg-blue-600 ring-4 ring-white shadow-[0_10px_25px_rgba(37,99,235,0.35)]';
        bookerMarkerRef.current = new mapboxgl.Marker({ element: dot, anchor: 'center' })
          .setLngLat([bookerLng, bookerLat])
          .addTo(map);
      } else {
        bookerMarkerRef.current.setLngLat([bookerLng, bookerLat]);
      }

      if (!bookerPopupRef.current) {
        const contentEl = ensureBookerPopupContentElement();
        if (contentEl) {
          bookerPopupRef.current = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            focusAfterOpen: false,
            offset: 18,
            maxWidth: '260px',
            className: 'driver-info-popup pointer-events-none',
          })
            .setDOMContent(contentEl)
            .setLngLat([bookerLng, bookerLat])
            .addTo(map);

          const ui = bookerPopupUiRef.current;
          if (ui) {
            ui.nameEl.textContent = bookerProfile.name || fallbackBookerName;
            ui.txLabelEl.textContent = t('transactionsLabel', { defaultValue: 'Transactions' });
            ui.txValueEl.textContent =
              bookerProfile.transactions == null ? '—' : String(Number(bookerProfile.transactions) || 0);
          }
        }
      } else {
        bookerPopupRef.current.setLngLat([bookerLng, bookerLat]);
      }
    } else if (bookerMarkerRef.current) {
      if (bookerPopupRef.current) {
        bookerPopupRef.current.remove();
        bookerPopupRef.current = null;
      }
      bookerMarkerRef.current.remove();
      bookerMarkerRef.current = null;
      bookerPopupContentElRef.current = null;
      bookerPopupUiRef.current = null;
    }

    if (hasSpotCoords && hasBookerCoords) {
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([spotLng, spotLat]);
      bounds.extend([bookerLng, bookerLat]);
      map.fitBounds(bounds, {
        padding: { top: 120, bottom: 260, left: 60, right: 60 },
        duration: 500,
        essential: true,
      });
      return;
    }
    if (hasSpotCoords) {
      map.easeTo({
        center: [spotLng, spotLat],
        zoom: 16,
        pitch: 0,
        bearing: 0,
        offset: [0, -120],
        duration: 600,
        essential: true,
      });
    }
  }, [
    mapReady,
    spotLng,
    spotLat,
    bookerLng,
    bookerLat,
    hasSpotCoords,
    hasBookerCoords,
    ensureBookerPopupContentElement,
  ]);

  // Auto-open plate modal when close to destination
  useEffect(() => {
    if (distanceMeters == null) return;
    if (distanceMeters <= 50 && !autoPromptedRef.current) {
      autoPromptedRef.current = true;
      setShowPlateModal(true);
    }
  }, [distanceMeters]);

  const content = (
    <div className="fixed inset-0 overflow-hidden bg-white" style={{ zIndex: 2147483647 }}>
      <style>{`
        .driver-info-popup {
          pointer-events: none;
        }
        .driver-info-popup .mapboxgl-popup-content {
          padding: 10px 12px;
          border-radius: 22px;
          border: 1px solid rgba(255, 255, 255, 0.55);
          background: rgba(255, 255, 255, 0.82);
          color: #0f172a;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
          backdrop-filter: blur(18px) saturate(180%);
          -webkit-backdrop-filter: blur(18px) saturate(180%);
        }
        .driver-info-popup .mapboxgl-popup-tip {
          filter: drop-shadow(0 10px 25px rgba(15, 23, 42, 0.12));
        }
        .driver-info-popup.mapboxgl-popup-anchor-top .mapboxgl-popup-tip,
        .driver-info-popup.mapboxgl-popup-anchor-top-left .mapboxgl-popup-tip,
        .driver-info-popup.mapboxgl-popup-anchor-top-right .mapboxgl-popup-tip {
          border-bottom-color: rgba(255, 255, 255, 0.82);
        }
        .driver-info-popup.mapboxgl-popup-anchor-bottom .mapboxgl-popup-tip,
        .driver-info-popup.mapboxgl-popup-anchor-bottom-left .mapboxgl-popup-tip,
        .driver-info-popup.mapboxgl-popup-anchor-bottom-right .mapboxgl-popup-tip {
          border-top-color: rgba(255, 255, 255, 0.82);
        }
        .driver-info-popup.mapboxgl-popup-anchor-left .mapboxgl-popup-tip {
          border-right-color: rgba(255, 255, 255, 0.82);
        }
        .driver-info-popup.mapboxgl-popup-anchor-right .mapboxgl-popup-tip {
          border-left-color: rgba(255, 255, 255, 0.82);
        }
      `}</style>
      {premiumParksToast ? (
        <PremiumParksDeltaToast
          fromCount={premiumParksToast.from}
          toCount={premiumParksToast.to}
          onDone={() => setPremiumParksToast(null)}
        />
      ) : null}
      <div ref={setMiniMapNode} className="absolute inset-0 z-0 w-full h-full bg-gray-100" />
      {!mapboxToken && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 text-white">
          {t('missingMapboxToken', 'Missing Mapbox Token')}
        </div>
      )}
      {mapboxToken && mapError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <div className="px-4 py-2 rounded-xl bg-black/80 text-white text-xs shadow max-w-[90vw]">{mapError}</div>
        </div>
      )}
      {mapboxToken && !mapError && !mapReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="px-4 py-2 rounded-full bg-white/90 text-gray-600 shadow">
            {t('loadingMap', 'Loading map...')}
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
	                onClick={openCancelModal}
                className="
                  h-12 rounded-2xl border border-white/50 bg-white/60
                  text-red-600 font-semibold shadow-sm
                  transition active:scale-[0.99]
                  hover:bg-white/80
                "
	              >
	                <span className="inline-flex items-center justify-center gap-2">
	                  <X className="w-4 h-4" />
	                  {t('cancel', { defaultValue: 'Cancel' })}
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

      {showCancelModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-md" onClick={closeCancelModal} />
          <div
            className="
              relative w-full max-w-md
              rounded-[28px] border border-white/25
              bg-white/60 backdrop-blur-2xl backdrop-saturate-200
              shadow-[0_30px_90px_rgba(15,23,42,0.35)]
              p-6
            "
            style={{ WebkitBackdropFilter: 'blur(24px) saturate(180%)' }}
            role="dialog"
            aria-modal="true"
            aria-label={t('cancelConfirmationTitle', { defaultValue: 'Confirm cancellation' })}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-2xl font-extrabold text-slate-900">
                  {t('cancelConfirmationTitle', { defaultValue: 'Confirm cancellation' })}
                </h3>
                <p className="mt-2 text-sm text-slate-700">
                  {t('cancelReputationWarning', {
                    defaultValue:
                      "Canceling now may hurt your reputation: the other user is already on the way.",
                  })}
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={closeCancelModal}
                className="
                  h-12 rounded-2xl border border-white/50 bg-white/60
                  text-slate-700 font-semibold shadow-sm
                  transition active:scale-[0.99]
                  hover:bg-white/80
                "
              >
                {t('keepTransaction', { defaultValue: 'Keep' })}
              </button>
              <button
                onClick={handleConfirmCancel}
                className="
                  h-12 rounded-2xl bg-gradient-to-r from-red-500 to-rose-500
                  text-white font-extrabold shadow-[0_12px_30px_rgba(239,68,68,0.35)]
                  hover:brightness-110 transition active:scale-[0.99]
                "
              >
                {t('confirmCancel', { defaultValue: 'Cancel anyway' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPlateModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-md" onClick={closePlateModal} />
          <div
            className="
              relative w-full max-w-md
              rounded-[28px] border
              backdrop-blur-2xl backdrop-saturate-200
              shadow-[0_30px_90px_rgba(15,23,42,0.35)]
              p-6
            "
            style={
              isDark
                ? { WebkitBackdropFilter: 'blur(24px) saturate(180%)', backgroundColor: 'rgba(15,23,42,0.72)', borderColor: 'rgba(255,255,255,0.12)' }
                : { WebkitBackdropFilter: 'blur(24px) saturate(180%)', backgroundColor: 'rgba(255,255,255,0.60)', borderColor: 'rgba(255,255,255,0.25)' }
            }
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className={`text-2xl font-extrabold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {t('platePromptNamed', {
                    name: bookerProfile.name || fallbackBookerName,
                    defaultValue: "Enter {{name}}'s plate",
                  })}
                </h3>
                <p className={`mt-2 text-sm ${isDark ? 'text-slate-200/80' : 'text-slate-600'}`}>
                  {t('plateSubtitleJoke', {
                    defaultValue: "Promise we won't set it as wallpaper.",
                  })}
                </p>
              </div>
            </div>
            <input
              type="text"
              placeholder={t('platePlaceholder', 'e.g., AB-123-CD')}
              className={`
                w-full rounded-2xl px-4 py-4
                text-center text-2xl font-mono uppercase tracking-widest
                border shadow-inner
                focus:outline-none focus:ring-4 focus:ring-orange-500/20 focus:border-orange-400
                transition
                ${
                  isDark
                    ? 'bg-white/10 border-white/15 text-white placeholder:text-slate-400'
                    : 'bg-white/70 border-white/70 text-slate-900 placeholder:text-slate-400'
                }
              `}
              value={plateInput}
              onChange={(e) => setPlateInput(formatPlate(e.target.value))}
            />
            {plateError && <p className={`mt-3 text-sm ${isDark ? 'text-red-300' : 'text-red-600'}`}>{plateError}</p>}
            <button
              onClick={handleSubmitPlate}
              className="
                w-full mt-4 h-12 rounded-2xl
                bg-gradient-to-r from-emerald-500 to-green-600
                text-white font-bold shadow-[0_12px_30px_rgba(16,185,129,0.35)]
                hover:brightness-110 transition disabled:opacity-50
              "
              disabled={plateSubmitting || !isFullPlate(formatPlate(plateInput))}
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
