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

class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Map boundary caught', error, info);
    this.setState({ error, info });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[90] bg-black/70 text-white flex items-center justify-center px-6 text-center">
          <div className="bg-white text-red-700 rounded-2xl shadow-xl px-5 py-4 max-w-md w-full">
            <p className="font-bold mb-1">Map failed to load</p>
            <p className="text-sm mb-2">{this.state.error?.message || String(this.state.error)}</p>
            <p className="text-xs text-gray-600">Check console for details; try closing and reopening the map.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const MapInner = ({ spot, onClose, onCancelBooking }) => {
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
  const [fatalError, setFatalError] = useState(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markerRef = useRef(null);
  const destMarkerRef = useRef(null);

  // --- 1. Robust Coordinate Validator ---
  const isValidCoord = (lng, lat) => {
    return (
      typeof lng === 'number' &&
      typeof lat === 'number' &&
      !isNaN(lng) &&
      !isNaN(lat) &&
      Math.abs(lng) <= 180 &&
      Math.abs(lat) <= 90
    );
  };

  // --- 2. Safe Center Calculation ---
  const getSafeCenter = () => {
    // 1. Try User Location
    if (userLoc && isValidCoord(userLoc.lng, userLoc.lat)) {
      return [userLoc.lng, userLoc.lat];
    }
    // 2. Try Spot Location
    if (spot && isValidCoord(spot.lng, spot.lat)) {
      return [spot.lng, spot.lat];
    }
    // 3. Fallback (Paris) to prevent black screen
    console.warn('Map: Defaulting to fallback center (Paris)');
    return [2.295, 48.8738];
  };

  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Only update if coordinates are valid numbers
        if (isValidCoord(pos.coords.longitude, pos.coords.latitude)) {
           setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      },
      (err) => {
        console.warn('Geolocation failed', err);
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
    if (!origin || !dest) return null;
    if (!isValidCoord(origin.lng, origin.lat) || !isValidCoord(dest.lng, dest.lat)) return null;

    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371; 
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
    const avgSpeedKmh = 30; 
    return Math.round((distanceKm / avgSpeedKmh) * 60);
  }, [distanceKm]);

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

  const shouldUseMapboxNav = !!mapboxToken && !!userLoc && isValidCoord(spot?.lng, spot?.lat);

  useEffect(() => {
    if (!showRoute || !shouldUseMapboxNav) {
      setNavReady(false);
      return undefined;
    }
    const timer = setTimeout(() => setNavReady(true), 2000);
    return () => clearTimeout(timer);
  }, [showRoute, shouldUseMapboxNav]);

  useEffect(() => {
    if (!navReady || !shouldUseMapboxNav || !userLoc) return undefined;
    const controller = new AbortController();
    
    const fetchDirections = async () => {
      try {
        if (!isValidCoord(userLoc.lng, userLoc.lat) || !isValidCoord(spot.lng, spot.lat)) {
             throw new Error('Invalid coordinates for navigation');
        }

        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${userLoc.lng},${userLoc.lat};${spot.lng},${spot.lat}?geometries=polyline6&steps=true&overview=full&access_token=${mapboxToken}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('Directions request failed');
        const data = await res.json();
        const route = data?.routes?.[0];
        const leg = route?.legs?.[0];
        const polyline = route?.geometry;
        if (!route || !polyline) throw new Error('No route geometry');
        const decoded = decodePolyline(polyline, 6);
        if (!decoded || decoded.length === 0) {
          throw new Error('Empty route geometry');
        }
        
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
        
        if (userLoc) {
          if (geometry.length === 1) {
            geometry = [[userLoc.lng, userLoc.lat], [spot.lng, spot.lat]];
          } else {
            geometry = [[userLoc.lng, userLoc.lat], ...geometry.slice(1)];
          }
        }
        if (isValidCoord(spot.lng, spot.lat) && geometry.length > 0) {
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
        console.error('Nav fetch error:', err);
        setNavError(err?.message || 'Unable to load navigation');
        setNavGeometry([]);
        setNavSteps([]);
        setNavReady(false);
      }
    };
    fetchDirections();
    return () => controller.abort();
  }, [navReady, shouldUseMapboxNav, userLoc, spot?.lat, spot?.lng, mapboxToken]);

  // --- 3. Initialize Mapbox map (FIXED) ---
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return undefined;
    if (mapRef.current) return undefined; // Map already exists

    mapboxgl.accessToken = mapboxToken;
    const center = getSafeCenter(); // Use the safe center function

    console.log('Map: Initializing at', center);

    let map;
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center,
        pitch: 60,
        bearing: 0,
        zoom: 15.2,
        interactive: true,
      });
    } catch (err) {
      console.error('Mapbox init failed', err);
      setFatalError(`Map init failed: ${err?.message || err}`);
      return undefined;
    }

    mapRef.current = map;
    
    const handleLoad = () => {
      console.log('Map: Loaded successfully');
      setMapLoaded(true);
      map.resize(); // Force resize to ensure canvas fills container
    };
    
    const handleError = (e) => {
      console.error('Mapbox fatal error:', e?.error || e);
      setNavError(t('navLoadError', 'Navigation failed to load.'));
      setMapLoaded(false);
    };

    map.on('load', handleLoad);
    map.on('error', handleError);

    return () => {
      map.off('load', handleLoad);
      map.off('error', handleError);
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken, userLoc, spot?.lat, spot?.lng]); // Removed t from dependency to prevent re-init on language change

  // Destination marker for preview
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    if (!isValidCoord(spot?.lng, spot?.lat)) return;

    try {
      if (!destMarkerRef.current) {
        destMarkerRef.current = new mapboxgl.Marker({ color: '#111827' })
          .setLngLat([spot.lng, spot.lat])
          .addTo(mapRef.current);
      } else {
        destMarkerRef.current.setLngLat([spot.lng, spot.lat]);
      }
    } catch (err) {
      console.error('Dest marker error', err);
    }
  }, [mapLoaded, spot?.lng, spot?.lat]);

  // Route rendering
  useEffect(() => {
    if (!navReady || !mapLoaded || !mapRef.current) return;
    if (!Array.isArray(navGeometry) || navGeometry.length < 2) return;
    
    // Safety Check: Ensure the first point is valid
    if (!isValidCoord(navGeometry[0][0], navGeometry[0][1])) return;

    let animationId;
    try {
      const map = mapRef.current;

      if (!map.getSource('route')) {
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
      } else {
        const src = map.getSource('route');
        src.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: navGeometry },
        });
      }

      if (!markerRef.current) {
        markerRef.current = new mapboxgl.Marker({ color: '#f97316', rotationAlignment: 'map' })
          .setLngLat(navGeometry[0])
          .addTo(map);
      } else {
        markerRef.current.setLngLat(navGeometry[0]).setRotation(0);
      }

      map.flyTo({ center: navGeometry[0], zoom: 15.4, pitch: 60, bearing: 0, speed: 0.8 });

      let idx = 0;
      const tick = () => {
        idx = Math.min(idx + 1, navGeometry.length - 1);
        const nextIdx = Math.min(idx + 1, navGeometry.length - 1);
        const currentPos = navGeometry[idx];

        // IMPORTANT: Prevent crash during animation loop
        if (!currentPos || !isValidCoord(currentPos[0], currentPos[1])) {
             animationId = requestAnimationFrame(tick);
             return;
        }

        const bearing = computeBearing(navGeometry[idx], navGeometry[nextIdx]);
        map.easeTo({
          center: currentPos,
          bearing,
          duration: 900,
          pitch: 60,
          zoom: 15.4,
          easing: (t) => t,
        });
        if (markerRef.current) {
          markerRef.current.setLngLat(currentPos).setRotation(bearing);
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

      animationId = requestAnimationFrame(tick);
    } catch (err) {
      console.error('Map navigation render failed', err);
    }

    return () => {
      cancelAnimationFrame(animationId);
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (mapRef.current) {
        if (mapRef.current.getLayer('route-line')) {
          mapRef.current.removeLayer('route-line');
        }
        if (mapRef.current.getSource('route')) {
          mapRef.current.removeSource('route');
        }
      }
    };
  }, [navReady, navGeometry, navSteps.length, mapLoaded]);

  // Keep centering the map
  useEffect(() => {
    if (!navReady || !mapLoaded || !mapRef.current || !navigator?.geolocation) return undefined;
    const map = mapRef.current;
    let cancelled = false;
    const logAndCenter = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          try {
            if(isValidCoord(coords.lng, coords.lat)) {
                map.easeTo({
                    center: [coords.lng, coords.lat],
                    duration: 500,
                    essential: true,
                });
            }
          } catch (err) {
            console.error('Map recenter failed', err);
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 },
      );
    };
    logAndCenter();
    const id = setInterval(logAndCenter, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [navReady, mapLoaded]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center">
      <div className="relative w-full h-full bg-black">
        {mapboxToken ? (
          <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white bg-black/70 text-sm px-6 text-center">
            {t('navMissingToken', 'Map navigation requires a Mapbox token.')}
          </div>
        )}
        
        {/* Loading Overlay */}
        {navReady && shouldUseMapboxNav && !mapLoaded && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
             <div className="text-white bg-black/80 px-4 py-2 rounded-lg">Loading Map...</div>
          </div>
        )}

        {fatalError ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6 z-[100]">
            <div className="pointer-events-auto bg-white/95 border border-red-200 text-red-700 rounded-2xl shadow-xl px-4 py-3 max-w-md text-center text-sm">
              <p className="font-semibold mb-1">{t('navFatal', 'Navigation error')}</p>
              <p className="mb-1">{fatalError}</p>
            </div>
          </div>
        ) : null}

        {/* UI Controls */}
        <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-3 pointer-events-none z-10">
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

        {/* Turn by turn */}
        {showRoute && showSteps && stepsToShow.length > 0 && (
          <div className="absolute bottom-4 left-4 right-4 pointer-events-auto z-10">
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
          </div>
        )}

        {/* Cancel Confirmation */}
        {confirming && (
          <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-6">
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

const Map = (props) => (
  <MapErrorBoundary>
    <MapInner {...props} />
  </MapErrorBoundary>
);

export default Map;
