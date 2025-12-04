// src/components/Map.jsx
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// --- Helpers ---

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

const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; 
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// --- Icons ---
const getManeuverIcon = (instruction) => {
  const text = instruction?.toLowerCase() || '';
  let rotate = 0;
  let type = 'arrow'; 

  if (text.includes('left')) rotate = -90;
  else if (text.includes('right')) rotate = 90;
  else if (text.includes('u-turn')) type = 'uturn';
  else if (text.includes('continue') || text.includes('straight')) type = 'straight';
  else if (text.includes('arrive') || text.includes('destination')) type = 'finish';

  if (type === 'finish') {
    return (
      <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  }
  return (
    <svg 
      className="w-10 h-10 text-white transition-transform duration-500" 
      style={{ transform: `rotate(${rotate}deg)` }}
      fill="none" 
      viewBox="0 0 24 24" 
      stroke="currentColor" 
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
    </svg>
  );
};

const CAR_SVG = `
<svg width="60" height="60" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="55" rx="25" ry="40" fill="black" fill-opacity="0.4"/>
  <path d="M30 20 L70 20 Q80 20 80 40 L80 80 Q80 90 70 90 L30 90 Q20 90 20 80 L20 40 Q20 20 30 20" fill="#3b82f6" stroke="white" stroke-width="3"/>
  <path d="M30 35 L70 35 L65 50 L35 50 Z" fill="#1e3a8a"/>
  <path d="M35 75 L65 75 L68 85 L32 85 Z" fill="#1e3a8a"/>
  <rect x="25" y="22" width="10" height="5" rx="2" fill="#fef08a"/>
  <rect x="65" y="22" width="10" height="5" rx="2" fill="#fef08a"/>
</svg>
`;

class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Map error', error, info); }
  render() {
    if (this.state.error) return <div className="p-4 bg-red-100 text-red-800">Map Error</div>;
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
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const watchIdRef = useRef(null);
  
  // Ref to prevent double fetching
  const routeFetchedRef = useRef(false);

  const isValidCoord = (lng, lat) => (
    typeof lng === 'number' && typeof lat === 'number' &&
    !isNaN(lng) && !isNaN(lat) &&
    Math.abs(lng) <= 180 && Math.abs(lat) <= 90
  );

  const getSafeCenter = () => {
    if (userLoc && isValidCoord(userLoc.lng, userLoc.lat)) return [userLoc.lng, userLoc.lat];
    if (spot && isValidCoord(spot.lng, spot.lat)) return [spot.lng, spot.lat];
    return [2.295, 48.8738];
  };

  // Initial Location
  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (isValidCoord(pos.coords.longitude, pos.coords.latitude)) {
           setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      },
      (err) => setUserLoc(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  }, [spot?.id]);

  useEffect(() => {
    setShowRoute(false);
    setConfirming(false);
    setShowSteps(false);
    setNavReady(false);
    setNavGeometry([]);
    setNavSteps([]);
    setNavIndex(0);
    setMapLoaded(false);
    routeFetchedRef.current = false; // Reset fetch lock
    if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
    }
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
    return getDistanceFromLatLonInKm(origin.lat, origin.lng, dest.lat, dest.lng);
  };

  const distanceKm = useMemo(() => calculateDistanceKm(userLoc, spot), [userLoc, spot]);
  const etaMinutes = useMemo(() => {
    if (distanceKm == null) return null;
    return Math.round((distanceKm / 30) * 60);
  }, [distanceKm]);

  const arrivalTime = useMemo(() => {
    if (!etaMinutes) return null;
    const now = new Date();
    now.setMinutes(now.getMinutes() + etaMinutes);
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [etaMinutes]);

  const providedSteps = Array.isArray(spot?.turnByTurn) ? spot.turnByTurn : 
                        Array.isArray(spot?.routeSteps) ? spot.routeSteps : null;
      
  const fallbackSteps = useMemo(() => {
    if (!spot?.address) return [];
    return [`${t('stepHead', 'Head toward')} ${spot.address}`, `${t('stepArrive', 'Arrive at destination')}`];
  }, [spot?.address, t]);
  
  const stepsToShow = navReady && navSteps.length > 0 ? navSteps : 
                      providedSteps && providedSteps.length > 0 ? providedSteps : fallbackSteps;

  const shouldUseMapboxNav = !!mapboxToken && !!userLoc && isValidCoord(spot?.lng, spot?.lat);

  useEffect(() => {
    if (!showRoute || !shouldUseMapboxNav) {
      setNavReady(false);
      return undefined;
    }
    const timer = setTimeout(() => setNavReady(true), 2000); 
    return () => clearTimeout(timer);
  }, [showRoute, shouldUseMapboxNav]);

  // --- Fetch Directions ---
  useEffect(() => {
    // FIX 1: Prevent duplicate requests by checking ref and removing userLoc dependency
    if (!navReady || !shouldUseMapboxNav || !userLoc || routeFetchedRef.current) return undefined;
    
    const controller = new AbortController();
    
    const fetchDirections = async () => {
      routeFetchedRef.current = true;
      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${userLoc.lng},${userLoc.lat};${spot.lng},${spot.lat}?geometries=polyline6&steps=true&overview=full&access_token=${mapboxToken}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('Directions request failed');
        const data = await res.json();
        const route = data?.routes?.[0];
        const polyline = route?.geometry;
        if (!route || !polyline) throw new Error('No route');
        
        let geometry = decodePolyline(polyline, 6);
        // Prepend user location to ensure connection, but don't rely on it for bearing
        if (userLoc) geometry = [[userLoc.lng, userLoc.lat], ...geometry];
        geometry.push([spot.lng, spot.lat]);

        setNavGeometry(geometry);
        setNavSteps(route.legs?.[0]?.steps?.map(s => s.maneuver.instruction) || []);
        setNavIndex(0);
      } catch (err) {
        if (!controller.signal.aborted) {
             setNavError(err.message);
             setNavGeometry([]);
             routeFetchedRef.current = false;
        }
      }
    };
    fetchDirections();
    return () => controller.abort();
  }, [navReady, shouldUseMapboxNav, spot, mapboxToken]);

  // --- Map Init ---
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return undefined;
    if (mapRef.current) return undefined;

    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: getSafeCenter(),
      pitch: 0,
      zoom: 15,
      interactive: true,
      attributionControl: false,
    });

    map.on('load', () => { setMapLoaded(true); map.resize(); });
    map.on('error', () => setMapLoaded(false));
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, [mapboxToken]);

  // --- Real-Time Navigation Logic ---
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    
    // 1. Destination Marker
    if (isValidCoord(spot?.lng, spot?.lat)) {
       if (!destMarkerRef.current) {
          destMarkerRef.current = new mapboxgl.Marker({ color: '#111827' })
            .setLngLat([spot.lng, spot.lat]).addTo(mapRef.current);
       } else {
          destMarkerRef.current.setLngLat([spot.lng, spot.lat]);
       }
    }

    // 2. Navigation Mode
    if (navReady && navGeometry.length > 1) {
       const map = mapRef.current;
       
       if (!map.getSource('route')) {
         map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: navGeometry } } });
         map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#3b82f6', 'line-width': 8, 'line-opacity': 0.8 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
       } else {
         map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: navGeometry } });
       }

       if (!markerRef.current) {
         const el = document.createElement('div');
         // FIX 2: Smooth CSS transition for the car icon
         el.className = 'car-marker-container transition-transform duration-1000 linear'; 
         el.innerHTML = CAR_SVG;
         el.style.transformOrigin = 'center';
         
         markerRef.current = new mapboxgl.Marker({ element: el, rotationAlignment: 'map' })
             .setLngLat(userLoc ? [userLoc.lng, userLoc.lat] : navGeometry[0])
             .setRotation(0)
             .addTo(map);
       }

       // --- START TRACKING ---
       if (navigator.geolocation) {
           const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
           
           // FIX 3: Initialize prevCoords as null to prevent jumping/bad bearing calculation on start
           let prevCoords = null; 

           // Initial FlyTo - Align with the first route segment
           const startPoint = userLoc ? [userLoc.lng, userLoc.lat] : navGeometry[0];
           const initialBearing = computeBearing(startPoint, navGeometry[1] || navGeometry[navGeometry.length-1]);
           
           map.flyTo({ 
               center: startPoint, 
               zoom: 15, // FIX 4: Lower zoom level (15) reduces perceived speed/jitter
               pitch: 45, // FIX 5: Lower pitch (45) improves visibility of road ahead
               bearing: initialBearing, 
               padding: { top: 120, bottom: 20 }, // FIX 6: Moderate padding to keep car centered but lower
               duration: 2000 
            });

           watchIdRef.current = navigator.geolocation.watchPosition(
               (pos) => {
                   const { latitude, longitude, heading } = pos.coords;
                   const newCoords = [longitude, latitude];
                   
                   // If this is the first point, just set it and wait for next one to calculate bearing
                   if (!prevCoords) {
                       prevCoords = newCoords;
                       markerRef.current?.setLngLat(newCoords);
                       return;
                   }

                   // Calculate distance moved
                   const distMoved = getDistanceFromLatLonInKm(prevCoords[1], prevCoords[0], latitude, longitude);
                   
                   let bearingToUse = map.getBearing();

                   // FIX 7: Bearing Logic - Only update if moved > 2 meters.
                   // Prioritize GPS Heading if valid, otherwise compute from movement.
                   if (distMoved > 0.002) { 
                        if (heading && !isNaN(heading) && heading !== 0) {
                            bearingToUse = heading;
                        } else {
                            bearingToUse = computeBearing(prevCoords, newCoords);
                        }
                   }

                   // FIX 8: Consistent easeTo with linear easing for smooth "Course Up" tracking
                   map.easeTo({
                       center: newCoords,
                       zoom: 15,
                       pitch: 45,
                       bearing: bearingToUse,
                       padding: { top: 120, bottom: 20 },
                       duration: 1000, // Match typical GPS update freq (1Hz)
                       easing: t => t
                   });

                   if (markerRef.current) {
                       markerRef.current.setLngLat(newCoords);
                       markerRef.current.setRotation(bearingToUse);
                   }
                   
                   setUserLoc({ lat: latitude, lng: longitude });
                   prevCoords = newCoords;
               },
               (err) => console.warn('GPS Watch Error', err),
               options
           );
       }

       return () => {
           if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
       };
    }
  }, [navReady, navGeometry, mapLoaded]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center font-sans">
      <div className="relative w-full h-full bg-gray-900 overflow-hidden">
        
        {/* The Map */}
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
        
        {!mapboxToken && (
           <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">Missing Mapbox Token</div>
        )}

        {/* --- STEP 1: PREVIEW --- */}
        {!showSteps && (
           <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-3 pointer-events-none z-10">
              <div className="bg-white/90 rounded-xl shadow px-3 py-2 text-sm text-gray-800 pointer-events-auto">
                <p className="font-semibold">{spot?.address || t('unknown', 'Unknown')}</p>
                <p className="text-xs text-gray-600">
                  {distanceKm != null ? `${distanceKm.toFixed(1)} km • ${etaMinutes != null ? `${etaMinutes} min` : ''}` : t('distancePending', 'Fetching...')}
                </p>
              </div>
              
              {!showRoute && (
                <div className="flex items-center gap-2 pointer-events-auto">
                    <button
                      onClick={() => { if (onCancelBooking && spot) onCancelBooking(spot.id); onClose?.(); }}
                      className="bg-white/90 text-gray-900 px-3 py-2 rounded-lg shadow font-medium"
                    >
                      {t('decline', 'Decline')}
                    </button>
                    <button
                      onClick={() => setShowRoute(true)}
                      className="bg-orange-600 text-white px-3 py-2 rounded-lg shadow font-semibold hover:bg-orange-700"
                    >
                      {t('acceptRoute', 'Accept')}
                    </button>
                </div>
              )}
           </div>
        )}

        {/* --- STEP 2: REAL GPS --- */}
        {showRoute && showSteps && (
          <>
            {/* Top: Instructions */}
            <div className="absolute top-4 left-4 right-4 z-20 pointer-events-none animate-[slideDown_0.3s_ease-out]">
              <div className="bg-[#1c1c1e] text-white rounded-xl shadow-2xl overflow-hidden pointer-events-auto border border-gray-800">
                <div className="flex p-4 items-center gap-4">
                  <div className="shrink-0 bg-gray-700/50 p-2 rounded-lg">
                    {getManeuverIcon(stepsToShow[navIndex])}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xl font-bold leading-tight">
                      {stepsToShow[navIndex] || t('stepFollow', 'Follow route')}
                    </p>
                    {stepsToShow[navIndex + 1] && (
                       <p className="text-gray-400 text-sm mt-1 truncate">
                         {t('then', 'Then')}: {stepsToShow[navIndex + 1]}
                       </p>
                    )}
                  </div>
                </div>
                <div className="h-1 bg-gray-700 w-full">
                   <div className="h-full bg-orange-500 transition-all duration-1000" style={{ width: `${Math.min(100, (navIndex / Math.max(1, stepsToShow.length)) * 100)}%` }}></div>
                </div>
              </div>
            </div>

            {/* Bottom: Summary */}
            <div className="absolute bottom-6 left-4 right-4 z-20 pointer-events-none animate-[slideUp_0.3s_ease-out]">
              <div className="bg-white rounded-2xl shadow-xl p-4 flex items-center justify-between pointer-events-auto">
                 <div>
                    <div className="flex items-baseline gap-2">
                         <span className="text-green-600 font-bold text-2xl">{etaMinutes || '--'} min</span>
                         <span className="text-gray-500 font-medium">({distanceKm?.toFixed(1)} km)</span>
                    </div>
                    <p className="text-gray-400 text-sm font-medium">
                        {t('arrival', 'Arrival')} {arrivalTime}
                    </p>
                 </div>
                 
                 <button
                    onClick={() => setConfirming(true)}
                    className="bg-gray-100 hover:bg-red-50 text-red-600 p-3 rounded-full transition-colors border border-gray-200"
                 >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                 </button>
              </div>
            </div>
          </>
        )}

        {/* Exit Modal */}
        {confirming && (
          <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center px-6">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-[scaleIn_0.2s_ease-out]">
              <h3 className="font-bold text-lg text-center text-gray-900 mb-2">{t('exitNav', 'Exit Navigation?')}</h3>
              <div className="flex gap-3 mt-4">
                <button onClick={() => setConfirming(false)} className="flex-1 py-2.5 rounded-xl font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200">
                  {t('resume', 'Resume')}
                </button>
                <button onClick={() => { if (onCancelBooking && spot) onCancelBooking(spot.id); onClose?.(); }} className="flex-1 py-2.5 rounded-xl font-semibold bg-red-600 text-white hover:bg-red-700">
                  {t('end', 'Exit')}
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