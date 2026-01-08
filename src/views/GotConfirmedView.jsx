// src/views/GotConfirmedView.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, X } from 'lucide-react';
import { createPortal } from "react-dom";
import { doc, onSnapshot } from 'firebase/firestore';
import { appId, db } from '../firebase';
import PremiumParksDeltaToast from '../components/PremiumParksDeltaToast';
import BottomNav from '../components/BottomNav';


const DEFAULT_CENTER = [2.295, 48.8738]; // Arc de Triomphe
const ROUTE_SOURCE_ID = 'parkswap-route';
const ROUTE_LAYER_ID = 'parkswap-route-line';
const ROUTE_GLOW_ID = 'parkswap-route-glow';
const ROUTE_OUTLINE_ID = 'parkswap-route-outline';
const ROUTE_DOTS_SOURCE_ID = 'parkswap-route-dots';
const ROUTE_DOTS_LAYER_ID = 'parkswap-route-dots-layer';
const ROUTE_DOTS_GLOW_ID = 'parkswap-route-dots-glow';

const getPathPoints = (geometry, spacingMeters, offsetMeters) => {
  const points = [];
  let accumulatedDist = 0;
  let nextPointDist = offsetMeters;

  for (let i = 0; i < geometry.length - 1; i += 1) {
    const start = geometry[i];
    const end = geometry[i + 1];
    const dLat = end[1] - start[1];
    const dLng = (end[0] - start[0]) * Math.cos((start[1] * Math.PI) / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111000;

    while (nextPointDist <= accumulatedDist + dist) {
      const ratio = (nextPointDist - accumulatedDist) / dist;
      const lng = start[0] + (end[0] - start[0]) * ratio;
      const lat = start[1] + (end[1] - start[1]) * ratio;
      points.push([lng, lat]);
      nextPointDist += spacingMeters;
    }
    accumulatedDist += dist;
  }
  return points;
};

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
  const spotMarkerRef = useRef(null);
  const routeAbortRef = useRef(null);
  const routeAnimRef = useRef(null);
  const routeCoordsRef = useRef([]);
  const routeCoordsReverseRef = useRef([]);
  const [mapMoved, setMapMoved] = useState(false);
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

  const applyDayNightPreset = useCallback((map) => {
    if (!map || typeof map.setConfigProperty !== 'function') return;
    try {
      map.setConfigProperty('basemap', 'lightPreset', isDark ? 'dusk' : 'day');
    } catch {
      // ignore: style might not support config properties
    }
  }, [isDark]);

  useEffect(() => {
    const hostDelta = Number(spot?.premiumParksHostDelta);
    const hostAfterRaw = Number(spot?.premiumParksHostAfter);
    if (!Number.isFinite(hostDelta) || hostDelta === 0 || !Number.isFinite(hostAfterRaw)) return;

    const appliedAt = spot?.premiumParksAppliedAt;
    const appliedAtKey = appliedAt?.toMillis ? String(appliedAt.toMillis()) : appliedAt ? String(appliedAt) : '';
    const key = spot?.id ? `${spot.id}:${appliedAtKey}` : null;
    if (!key) return;
    if (premiumParksToastKeyRef.current === key) return;
    premiumParksToastKeyRef.current = key;
    setPremiumParksToast({ from: hostAfterRaw - hostDelta, to: hostAfterRaw });
  }, [spot?.id, spot?.premiumParksAppliedAt, spot?.premiumParksHostDelta, spot?.premiumParksHostAfter]);

  const upsertRoute = useCallback((map, routeFeature) => {
      if (!map) return;

      const existing = map.getSource?.(ROUTE_SOURCE_ID);
      if (existing && typeof existing.setData === 'function') {
        existing.setData(routeFeature);
      } else {
        if (map.getLayer?.(ROUTE_LAYER_ID)) map.removeLayer?.(ROUTE_LAYER_ID);
        if (map.getLayer?.(ROUTE_GLOW_ID)) map.removeLayer?.(ROUTE_GLOW_ID);
        if (map.getLayer?.(ROUTE_OUTLINE_ID)) map.removeLayer?.(ROUTE_OUTLINE_ID);
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
            'line-color': '#ffffff',
            'line-width': 6,
            'line-opacity': 0.45,
            'line-emissive-strength': 1,
          },
        });
      }

      if (!map.getLayer?.(ROUTE_GLOW_ID)) {
        map.addLayer?.({
          id: ROUTE_GLOW_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          paint: {
            'line-color': '#ffffff',
            'line-width': 14,
            'line-opacity': 0.25,
            'line-blur': 12,
            'line-emissive-strength': 1,
          },
        }, ROUTE_LAYER_ID);
      }

      if (!map.getLayer?.(ROUTE_OUTLINE_ID)) {
        map.addLayer?.({
          id: ROUTE_OUTLINE_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': 'rgba(0, 0, 0, 0.35)',
            'line-width': 10,
            'line-opacity': 1,
            'line-emissive-strength': 1,
          },
        }, ROUTE_LAYER_ID);
      }

      if (!map.hasImage?.('3d-sphere')) {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const grad = ctx.createRadialGradient(
            size * 0.35, size * 0.35, size * 0.05,
            size * 0.5, size * 0.5, size * 0.5
          );
          grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
          grad.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
          grad.addColorStop(1, 'rgba(200, 200, 200, 1)');

          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();

          map.addImage('3d-sphere', ctx.getImageData(0, 0, size, size));
        }
      }

      if (!map.getSource?.(ROUTE_DOTS_SOURCE_ID)) {
        map.addSource?.(ROUTE_DOTS_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }

      if (!map.getLayer?.(ROUTE_DOTS_GLOW_ID)) {
        map.addLayer?.({
          id: ROUTE_DOTS_GLOW_ID,
          type: 'circle',
          source: ROUTE_DOTS_SOURCE_ID,
          paint: {
            'circle-color': '#ff7a00',
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              10, 2,
              15, 6,
              22, 15
            ],
            'circle-opacity': 0.55,
            'circle-blur': 1,
            'circle-pitch-alignment': 'map',
            'circle-emissive-strength': 1,
          },
        });
      }

      if (!map.getLayer?.(ROUTE_DOTS_LAYER_ID)) {
        map.addLayer?.({
          id: ROUTE_DOTS_LAYER_ID,
          type: 'symbol',
          source: ROUTE_DOTS_SOURCE_ID,
          layout: {
            'icon-image': '3d-sphere',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-pitch-alignment': 'viewport',
            'icon-size': [
              'interpolate', ['linear'], ['zoom'],
              13, 0.1,
              16, 0.25,
              20, 0.6
            ],
          },
          paint: {
            'icon-opacity': 1,
            'icon-emissive-strength': 1,
          },
        });
      }
    },
    [],
  );

  const removeRoute = useCallback((map) => {
    if (!map) return;
    if (routeAnimRef.current) {
      cancelAnimationFrame(routeAnimRef.current);
      routeAnimRef.current = null;
    }
    routeCoordsRef.current = [];
    routeCoordsReverseRef.current = [];
    if (map.getLayer?.(ROUTE_DOTS_LAYER_ID)) map.removeLayer?.(ROUTE_DOTS_LAYER_ID);
    if (map.getLayer?.(ROUTE_DOTS_GLOW_ID)) map.removeLayer?.(ROUTE_DOTS_GLOW_ID);
    if (map.getSource?.(ROUTE_DOTS_SOURCE_ID)) map.removeSource?.(ROUTE_DOTS_SOURCE_ID);
    if (map.getLayer?.(ROUTE_OUTLINE_ID)) map.removeLayer?.(ROUTE_OUTLINE_ID);
    if (map.getLayer?.(ROUTE_GLOW_ID)) map.removeLayer?.(ROUTE_GLOW_ID);
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
        style: 'mapbox://styles/louloupark/cmjb7kixg005z01qy4cztc9ce',
        center: initialCenter,
        zoom: 15,
        pitch: 0,
        bearing: 0,
        interactive: true,
        attributionControl: false,
      });

      miniMapInstanceRef.current = map;

      const handleLoad = () => {
        applyDayNightPreset(map);
        markReady(map);
      };
      const handleStyleLoad = () => {
        applyDayNightPreset(map);
        markReady(map);
      };

      map.on('load', handleLoad);
      map.on('style.load', handleStyleLoad);
      map.on('error', handleError);
      const handleMoveStart = (e) => {
        if (e?.originalEvent) setMapMoved(true);
      };
      map.on('movestart', handleMoveStart);

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
        map.off('movestart', handleMoveStart);

        if (bookerMarkerRef.current) {
          bookerMarkerRef.current.remove();
          bookerMarkerRef.current = null;
        }
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
  }, [mapboxToken, miniMapEl, hasSpotCoords, spotLng, spotLat, applyDayNightPreset]);

  useEffect(() => {
    const map = miniMapInstanceRef.current;
    if (!map) return;
    applyDayNightPreset(map);
  }, [applyDayNightPreset]);

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
        const coords = feature.geometry?.coordinates || [];
        routeCoordsRef.current = coords;
        routeCoordsReverseRef.current = coords.length > 1 ? [...coords].reverse() : [];
        upsertRoute(map, feature);
      } catch (err) {
        if (controller.signal.aborted) return;
        const fallback = getFallbackLineFeature(startLngLat, endLngLat);
        const coords = fallback.geometry?.coordinates || [];
        routeCoordsRef.current = coords;
        routeCoordsReverseRef.current = coords.length > 1 ? [...coords].reverse() : [];
        upsertRoute(map, fallback);
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

  useEffect(() => {
    const map = miniMapInstanceRef.current;
    if (!map || !mapReady) return undefined;

    const speed = 25;
    const spacing = 14;
    let startTimestamp = null;

    const animateDots = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const coords = routeCoordsReverseRef.current.length
        ? routeCoordsReverseRef.current
        : routeCoordsRef.current;
      if (!Array.isArray(coords) || coords.length < 2) {
        routeAnimRef.current = requestAnimationFrame(animateDots);
        return;
      }
      const progress = (timestamp - startTimestamp) / 1000;
      const currentOffset = (progress * speed) % spacing;
      const dotCoords = getPathPoints(coords, spacing, currentOffset);
      const source = map.getSource?.(ROUTE_DOTS_SOURCE_ID);
      if (source && typeof source.setData === 'function') {
        source.setData({
          type: 'FeatureCollection',
          features: dotCoords.map((coord) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coord },
          })),
        });
      }
      routeAnimRef.current = requestAnimationFrame(animateDots);
    };

    if (!routeAnimRef.current) {
      routeAnimRef.current = requestAnimationFrame(animateDots);
    }

    return () => {
      if (routeAnimRef.current) {
        cancelAnimationFrame(routeAnimRef.current);
        routeAnimRef.current = null;
      }
    };
  }, [mapReady]);

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
        const el = document.createElement('div');
        el.className = 'car-marker-container';
        el.style.width = '52px';
        el.style.height = '52px';
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
        bookerMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([bookerLng, bookerLat])
          .addTo(map);
      } else {
        bookerMarkerRef.current.setLngLat([bookerLng, bookerLat]);
      }
    } else if (bookerMarkerRef.current) {
      bookerMarkerRef.current.remove();
      bookerMarkerRef.current = null;
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
      map.setPitch(0);
      map.setBearing(0);
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
        .car-marker-container {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
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

      {distanceMeters != null && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom,0px)+110px)] z-10 pointer-events-none">
          <div
            className="
              px-4 py-2 rounded-full
              bg-white/80 backdrop-blur-2xl border border-white/60
              shadow-[0_10px_28px_rgba(15,23,42,0.18)]
              text-slate-900 text-sm font-semibold
            "
            style={{ WebkitBackdropFilter: 'blur(18px) saturate(160%)' }}
          >
            {t('distanceLabel', { defaultValue: 'Distance' })}: {distanceMeters} m
          </div>
        </div>
      )}

      {mapMoved && (
        <div
          className="absolute right-6 z-30 pointer-events-auto"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 128px)' }}
        >
          <button
            type="button"
            aria-label="Recenter on me"
            onClick={() => {
              const target =
                hasBookerCoords
                  ? [bookerLng, bookerLat]
                  : hasSpotCoords
                    ? [spotLng, spotLat]
                    : null;
              const map = miniMapInstanceRef.current;
              if (!map || !target || !isValidCoord(target[0], target[1])) return;
              map.easeTo({
                center: target,
                duration: 600,
                pitch: 0,
                zoom: 16,
                bearing: 0,
                essential: true,
              });
              setMapMoved(false);
            }}
            className="
              group
              flex items-center justify-center
              w-12 h-12 rounded-full
              bg-slate-900/80 backdrop-blur-xl
              border border-white/10
              shadow-[0_8px_20px_-6px_rgba(0,0,0,0.25)]
              text-white
              transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)
              hover:scale-110
              active:scale-90 active:bg-slate-900/90
            "
          >
            <svg className="w-6 h-6 drop-shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.414 10.866a2 2 0 0 1 .463-2.618l9.16-7.073c1.378-1.063 3.327.18 2.96 1.886l-2.628 12.228a2 2 0 0 1-2.64 1.488l-3.326-.95-3.088 2.872a1 1 0 0 1-1.636-.98l1.014-4.884-1.226-.922a1 1 0 0 1 .943-1.047Z" />
            </svg>
          </button>
        </div>
      )}

      <BottomNav
        customActions={{
          activeTab: 'propose',
          left: { label: t('cancel', { defaultValue: 'Cancel' }), icon: X, onClick: openCancelModal },
          right: { label: t('arrivedQuestion', 'Arrived ?'), icon: Car, onClick: openPlateModal },
        }}
      />

      {showCancelModal && (
        <div className="fixed inset-0 z-[10050] flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-md" onClick={closeCancelModal} />
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
                ? { WebkitBackdropFilter: 'blur(24px) saturate(180%)', backgroundColor: 'rgba(15,23,42,0.78)', borderColor: 'rgba(255,255,255,0.12)' }
                : { WebkitBackdropFilter: 'blur(24px) saturate(180%)', backgroundColor: 'rgba(255,255,255,0.85)', borderColor: 'rgba(255,255,255,0.6)' }
            }
            role="dialog"
            aria-modal="true"
            aria-label={t('cancelConfirmationTitle', { defaultValue: 'Confirm cancellation' })}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className={`text-2xl font-extrabold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {t('cancelConfirmationTitle', { defaultValue: 'Confirm cancellation' })}
                </h3>
                <p className={`mt-2 text-sm ${isDark ? 'text-slate-200/80' : 'text-slate-700'}`}>
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
                className={`
                  h-12 rounded-2xl border font-semibold shadow-sm
                  transition active:scale-[0.99]
                  ${isDark
                    ? 'border-white/10 bg-white/10 text-slate-100 hover:bg-white/15'
                    : 'border-white/60 bg-white/70 text-slate-700 hover:bg-white/90'}
                `}
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
