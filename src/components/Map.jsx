// src/components/Map.jsx
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Decode polyline with configurable precision (Mapbox uses polyline6)
const decodePolyline = (str, precision = 6) => {
  let index = 0;
  const coordinates = [];
  let lat = 0;
  let lng = 0;
  const factor = 10 ** precision;

  while (index < str.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
};

const computeBearing = (from, to) => {
  if (!from || !to) return 0;
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const λ1 = (lng1 * Math.PI) / 180;
  const λ2 = (lng2 * Math.PI) / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

const buildMapUrl = (spot, userLoc, mapsKey, showRoute) => {
  const destination = spot?.lat != null && spot?.lng != null ? `${spot.lat},${spot.lng}` : (spot?.address || 'Paris');
  const origin = userLoc?.lat != null && userLoc?.lng != null ? `${userLoc.lat},${userLoc.lng}` : null;
  const destQuery = encodeURIComponent(destination);
  const originQuery = origin ? encodeURIComponent(origin) : null;
  if (!destQuery) return 'about:blank';
  // If an embed API key is provided and the route was accepted, request a directions embed (origin -> destination).
  if (mapsKey && originQuery && showRoute) {
    return `https://www.google.com/maps/embed/v1/directions?key=${mapsKey}&origin=${originQuery}&destination=${destQuery}&mode=driving&zoom=15`;
  }
  // Fallback: use a directions URL embed (often still draws a route) after acceptance.
  if (originQuery && showRoute) {
    return `https://www.google.com/maps/dir/?api=1&origin=${originQuery}&destination=${destQuery}&travelmode=driving&output=embed&zoom=15`;
  }
  // Preview: only show destination location.
  return `https://www.google.com/maps?q=${destQuery}&output=embed&zoom=15`;
};

const Map = ({ spot, onClose, onCancelBooking }) => {
  const { t } = useTranslation('common');
  const [userLoc, setUserLoc] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const [navGeometry, setNavGeometry] = useState([]);
  const [navSteps, setNavSteps] = useState([]);
  const [navError, setNavError] = useState('');
  const [navIndex, setNavIndex] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY;
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setUserLoc(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  }, [spot?.id]);

  useEffect(() => {
    setShowRoute(false);
    setConfirming(false);
    setShowSteps(false);
    setNavReady(false);
    setNavGeometry([]);
    setNavSteps([]);
    setNavError('');
    setNavIndex(0);
    setMapLoaded(false);
  }, [spot?.id]);

  useEffect(() => {
    if (!showRoute) {
      setShowSteps(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowSteps(true), 2600);
    return () => clearTimeout(timer);
  }, [showRoute, spot?.id]);

  const calculateDistanceKm = (origin, dest) => {
    if (!origin || dest?.lat == null || dest?.lng == null) return null;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(dest.lat - origin.lat);
    const dLon = toRad(dest.lng - origin.lng);
    const lat1 = toRad(origin.lat);
    const lat2 = toRad(dest.lat);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const distanceKm = useMemo(() => calculateDistanceKm(userLoc, spot), [userLoc, spot]);
  const etaMinutes = useMemo(() => {
    if (distanceKm == null) return null;
    const avgSpeedKmh = 30; // conservative city driving
    return Math.round((distanceKm / avgSpeedKmh) * 60);
  }, [distanceKm]);

  const embedUrl = useMemo(
    () => buildMapUrl(spot, userLoc, mapsKey, showRoute),
    [spot, userLoc, mapsKey, showRoute],
  );

  const providedSteps = Array.isArray(spot?.turnByTurn)
    ? spot.turnByTurn
    : Array.isArray(spot?.routeSteps)
      ? spot.routeSteps
      : null;
  const fallbackSteps = useMemo(() => {
    if (!spot?.address) return [];
    const estDistance = distanceKm != null ? `${distanceKm.toFixed(1)} km` : t('distancePending', 'Nearby');
    const estEta = etaMinutes != null ? `${etaMinutes} min` : t('etaFallback', 'A few min');
    return [
      `${t('stepHead', 'Head toward')} ${spot.address}`,
      `${t('stepContinue', 'Continue straight for')} ${estDistance}`,
      `${t('stepArrive', 'Arrive at destination')} • ${estEta}`,
    ];
  }, [spot?.address, distanceKm, etaMinutes, t]);
  const stepsToShow =
    navReady && navSteps.length > 0
      ? navSteps
      : providedSteps && providedSteps.length > 0
        ? providedSteps
        : fallbackSteps;
  const navBlockReason = useMemo(() => {
    if (!mapboxToken) return t('navMissingToken', 'Map navigation requires a Mapbox token.');
    if (!userLoc) return t('navNeedsLocation', 'Allow location to start live navigation.');
    return '';
  }, [mapboxToken, userLoc, t]);

  const shouldUseMapboxNav = !!mapboxToken && !!userLoc && spot?.lat != null && spot?.lng != null;

  // Delay before switching to Mapbox navigation view
  useEffect(() => {
    if (!showRoute || !shouldUseMapboxNav) {
      setNavReady(false);
      return undefined;
    }
    const timer = setTimeout(() => setNavReady(true), 2000);
    return () => clearTimeout(timer);
  }, [showRoute, shouldUseMapboxNav]);

  // Fetch Mapbox directions when ready
  useEffect(() => {
    if (!navReady || !shouldUseMapboxNav) return undefined;
    const controller = new AbortController();
    const fetchDirections = async () => {
      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${userLoc.lng},${userLoc.lat};${spot.lng},${spot.lat}?geometries=polyline6&steps=true&overview=full&access_token=${mapboxToken}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('Directions request failed');
        const data = await res.json();
        const route = data?.routes?.[0];
        const leg = route?.legs?.[0];
        const polyline = route?.geometry;
        if (!route || !polyline) throw new Error('No route geometry');
        const decoded = decodePolyline(polyline, 6);
        // Ensure the geometry starts at the user's origin (some providers may return reversed coords)
        const distFromStartToUser = calculateDistanceKm(
          { lat: decoded[0]?.[1], lng: decoded[0]?.[0] },
          userLoc,
        );
        const distFromStartToSpot = calculateDistanceKm(
          { lat: decoded[0]?.[1], lng: decoded[0]?.[0] },
          { lat: spot.lat, lng: spot.lng },
        );
        let geometry = distFromStartToUser != null && distFromStartToSpot != null && distFromStartToUser > distFromStartToSpot
          ? [...decoded].reverse()
          : decoded;
        // Force start/end to be user and destination to avoid starting at the target
        if (userLoc) {
          geometry = [[userLoc.lng, userLoc.lat], ...geometry.slice(1)];
        }
        if (spot?.lng != null && spot?.lat != null) {
          geometry[geometry.length - 1] = [spot.lng, spot.lat];
        }
        setNavGeometry(geometry);
        const instructions =
          leg?.steps?.map((s) => s?.maneuver?.instruction || s?.name || '')?.filter(Boolean) || [];
        setNavSteps(instructions);
        setNavIndex(0);
        setNavError('');
      } catch (err) {
        if (controller.signal.aborted) return;
        setNavError(err?.message || 'Unable to load navigation');
        setNavGeometry([]);
        setNavSteps([]);
        setNavReady(false);
      }
    };
    fetchDirections();
    return () => controller.abort();
  }, [navReady, shouldUseMapboxNav, userLoc, spot?.lat, spot?.lng, mapboxToken]);

  // Mapbox rendering and marker animation
  useEffect(() => {
    if (!navReady || navGeometry.length === 0 || !mapContainerRef.current) return undefined;
    setMapLoaded(false);
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: navGeometry[0] || (userLoc ? [userLoc.lng, userLoc.lat] : undefined),
      pitch: 60,
      bearing: 0,
      zoom: 15.2,
      interactive: true,
    });
    mapRef.current = map;
    const handleLoad = () => {
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: navGeometry,
          },
        },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#f97316',
          'line-width': 6,
          'line-opacity': 0.9,
        },
      });
      const marker = new mapboxgl.Marker({ color: '#f97316' }).setLngLat(navGeometry[0]).addTo(map);
      markerRef.current = marker;
      setMapLoaded(true);
    };
    const handleError = (e) => {
      console.error('Mapbox navigation error', e?.error || e);
      setNavError(t('navLoadError', 'Navigation failed to load.'));
      setMapLoaded(false);
      setNavReady(false);
    };
    map.on('load', handleLoad);
    map.on('error', handleError);

    let idx = 0;
    const tick = () => {
      idx = Math.min(idx + 1, navGeometry.length - 1);
      const nextIdx = Math.min(idx + 1, navGeometry.length - 1);
      const bearing = computeBearing(navGeometry[idx], navGeometry[nextIdx]);
      map.easeTo({
        center: navGeometry[idx],
        bearing,
        duration: 900,
        pitch: 60,
        zoom: 15.4,
        easing: (t) => t,
      });
      if (markerRef.current) {
        markerRef.current.setLngLat(navGeometry[idx]).setRotation(bearing);
      }
      const stepIdx =
        navSteps.length > 0
          ? Math.min(
              navSteps.length - 1,
              Math.floor((idx / Math.max(navGeometry.length - 1, 1)) * navSteps.length),
            )
          : 0;
      setNavIndex(stepIdx);
      if (idx >= navGeometry.length - 1) return;
      animationId = requestAnimationFrame(tick);
    };

    let animationId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationId);
      map.off('load', handleLoad);
      map.off('error', handleError);
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      map.remove();
    };
  }, [navReady, navGeometry, navSteps.length, mapboxToken]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center">
      <div className="relative w-full h-full bg-black">
        {!(navReady && shouldUseMapboxNav && navGeometry.length > 0 && mapLoaded) && (
          <iframe
            title="map"
            src={embedUrl}
            className="w-full h-full border-0"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
        {navReady && shouldUseMapboxNav && navGeometry.length > 0 ? (
          <div
  ref={mapContainerRef}
  className="absolute inset-0"
  style={{ minHeight: "100%", minWidth: "100%" }}
></div>
        ) : null}
        {navReady && shouldUseMapboxNav && !mapLoaded ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/60 text-white px-4 py-3 rounded-xl shadow">
              {t('navLoading', 'Loading navigation...')}
            </div>
          </div>
        ) : null}
        <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-3 pointer-events-none">
          <div className="bg-white/90 rounded-xl shadow px-3 py-2 text-sm text-gray-800 pointer-events-auto">
            <p className="font-semibold">{spot?.address || t('unknown', 'Unknown')}</p>
            <p className="text-xs text-gray-600">
              {distanceKm != null
                ? `${distanceKm.toFixed(1)} km • ${etaMinutes != null ? `${etaMinutes} min` : ''}`
                : t('distancePending', 'Fetching distance...')}
            </p>
          </div>
          <div className="flex items-center gap-2 pointer-events-auto">
            {!showRoute && (
              <>
                <button
                  onClick={() => {
                    if (onCancelBooking && spot) {
                      onCancelBooking(spot.id);
                    }
                    onClose?.();
                  }}
                  className="bg-white/90 text-gray-900 px-3 py-2 rounded-lg shadow"
                >
                  {t('decline', 'Decline')}
                </button>
                <button
                  onClick={() => setShowRoute(true)}
                  className="bg-orange-600 text-white px-3 py-2 rounded-lg shadow font-semibold"
                >
                  {t('acceptRoute', 'Accept')}
                </button>
              </>
            )}
            {showRoute && (
              <button
                onClick={() => {
                  if (!spot) {
                    onClose?.();
                    return;
                  }
                  setConfirming(true);
                }}
                className="bg-white/90 text-gray-900 px-3 py-2 rounded-lg shadow"
              >
                {t('cancel', 'Close')}
              </button>
            )}
          </div>
        </div>
        {showRoute && showSteps && stepsToShow.length > 0 && (
          <div className="absolute bottom-4 left-4 right-4 pointer-events-auto">
            <div className="bg-white/90 rounded-2xl shadow px-4 py-3 border border-orange-100">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs uppercase tracking-[0.14em] text-orange-500 font-semibold">
                  {t('turnByTurn', 'Turn-by-turn')}
                </p>
                <p className="text-[11px] text-gray-500">
                  {navReady && shouldUseMapboxNav
                    ? t('liveNavigation', 'Live navigation')
                    : t('staticPreview', 'Preview')}
                </p>
              </div>
              <p className="text-sm font-semibold text-gray-900 mb-1">
                {stepsToShow[navIndex] || stepsToShow[stepsToShow.length - 1]}
              </p>
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>
                  {t('stepLabel', 'Step')} {navIndex + 1} / {stepsToShow.length}
                </span>
              </div>
            </div>
            {navError ? (
              <p className="mt-2 text-xs text-red-500 text-center bg-white/80 rounded-xl py-1">{navError}</p>
            ) : null}
            {!shouldUseMapboxNav && navBlockReason ? (
              <p className="mt-2 text-xs text-gray-600 text-center bg-white/80 rounded-xl py-1 px-2">
                {navBlockReason}
              </p>
            ) : null}
          </div>
        )}
        {confirming && (
          <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex items-center justify-center px-6">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm p-6 animate-[fadeIn_200ms_ease-out]">
              <p className="font-semibold text-gray-900 mb-4 text-center">
                {t('confirmCancel', 'The parking spot will be listed again')}
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={async () => {
                    if (onCancelBooking && spot) {
                      await onCancelBooking(spot.id);
                    }
                    setConfirming(false);
                    onClose?.();
                  }}
                  className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3 rounded-xl font-semibold shadow hover:scale-[1.01] transition"
                >
                  {t('yes', 'Yes')}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex-1 bg-gray-100 text-gray-800 py-3 rounded-xl font-semibold border border-gray-200 shadow hover:bg-gray-200 transition"
                >
                  {t('no', 'No')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Map;
