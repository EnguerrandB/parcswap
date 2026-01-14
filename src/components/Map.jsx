// src/components/Map.jsx
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Check, X as XIcon, Volume2, VolumeX } from 'lucide-react';
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, appId } from '../firebase';
import i18n from '../i18n/i18n';
import PremiumParksDeltaToast from './PremiumParksDeltaToast';
import { newId } from '../utils/ids';
import carMarker from '../assets/car-marker.png';
import userCar1 from '../assets/user-car-1.png';
import userCar2 from '../assets/user-car-2.png';
import userCar3 from '../assets/user-car-3.png';
import userCar4 from '../assets/user-car-4.png';
import userDirectionArrow from '../assets/user-direction-arrow.svg';
import { buildOtherUserPopupHTML, enhancePopupAnimation, PopUpUsersStyles } from './PopUpUsers';
import { attachPersistentMapContainer, getPersistentMap, setPersistentMap } from '../utils/persistentMap';
import { patchSizerankInStyle } from '../utils/mapboxStylePatch';

// --- Helpers ---
const PERSISTENT_MAP_KEY = 'main-map';

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

const getUserAnchorPadding = () => {
  if (typeof window === 'undefined') {
    return { top: 200, bottom: 0, left: 0, right: 0 };
  }
  const h = window.innerHeight || 800;
  const top = Math.round(Math.min(340, Math.max(240, h * 0.42)));
  return { top, bottom: 0, left: 0, right: 0 };
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

// Find closest point of the route to the user to drive progress/trim logic
const findClosestPointIndex = (geometry, lng, lat) => {
  if (!Array.isArray(geometry) || geometry.length === 0) {
    return { index: 0, distanceKm: null };
  }
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < geometry.length; i += 1) {
    const point = geometry[i];
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const dist = getDistanceFromLatLonInKm(lat, lng, point[1], point[0]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return { index: bestIdx, distanceKm: bestDist };
};

const formatLastSeen = (t, date) => {
  if (!date) return { text: t('lastSeenUnknown', 'Last seen unknown'), isOnline: false };
  const diffMs = Date.now() - date.getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 30) return { text: t('online', 'Online'), isOnline: true };
  if (sec < 90) return { text: t('lastSeen1Min', '1 min ago'), isOnline: false };
  const min = Math.round(sec / 60);
  if (min < 60) return { text: t('lastSeenMinutes', '{{count}} min ago', { count: min }), isOnline: false };
  const hrs = Math.round(min / 60);
  if (hrs < 24) return { text: t('lastSeenHours', '{{count}} h ago', { count: hrs }), isOnline: false };
  const days = Math.round(hrs / 24);
  return { text: t('lastSeenDays', '{{count}} d ago', { count: days }), isOnline: false };
};

const pseudoRandomFromString = (str) => {
  const s = String(str || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // force 32-bit
  }
  return Math.abs(h);
};

const jitterCoordinate = (lng, lat, uid, meters = 30) => {
  const seed = pseudoRandomFromString(uid || `${lng},${lat}`) || 1;
  const angle = (seed % 360) * (Math.PI / 180);
  // radius between 40% and 100% of meters
  const radius = meters * (0.4 + ((seed % 1000) / 1000) * 0.6);
  const earthRadiusMeters = 111_111; // rough conversion for lat
  const deltaLat = (radius * Math.cos(angle)) / earthRadiusMeters;
  const denom = earthRadiusMeters * Math.cos((lat * Math.PI) / 180);
  const deltaLng = denom !== 0 ? (radius * Math.sin(angle)) / denom : 0;
  return { lng: lng + deltaLng, lat: lat + deltaLat };
};

const separateIfTooClose = (pos, othersMap, uid, minMeters = 14) => {
  let { lng, lat } = pos;

  for (const [otherUid, otherPos] of othersMap.entries()) {
    if (otherUid === uid || !otherPos) continue;

    const dMeters =
      getDistanceFromLatLonInKm(lat, lng, otherPos.lat, otherPos.lng) * 1000;

    if (dMeters < minMeters) {
      const angle =
        (pseudoRandomFromString(uid + otherUid) % 360) * (Math.PI / 180);
      const offset = minMeters - dMeters + 2;
      const earth = 111111;

      lat += (offset * Math.cos(angle)) / earth;
      lng +=
        (offset * Math.sin(angle)) /
        (earth * Math.cos((lat * Math.PI) / 180));
    }
  }

  return { lng, lat };
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
      <svg className="w-8 h-8 text-current" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  }
  return (
    <svg 
      className="w-10 h-10 text-current transition-transform duration-500" 
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

class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Map error', error, info); }
  render() {
    if (this.state.error) return <div className="p-4 bg-red-100 text-red-800">{i18n.t('mapErrorTitle', 'Map Error')}</div>;
    return this.props.children;
  }
}

const MapInner = ({
  spot,
  onClose,
  onCancelBooking,
  onConfirmHostPlate,
  onNavStateChange,
  onSelectionStep,
  initialStep,
  currentUserId,
  currentUserName,
  userCoords,
}) => {
  const { t, i18n: i18nInstance } = useTranslation('common');
  const [userLoc, setUserLoc] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showPlateNotice, setShowPlateNotice] = useState(false);
  const [plateConfirmInput, setPlateConfirmInput] = useState('');
  const [plateConfirmError, setPlateConfirmError] = useState(null);
  const [plateConfirmSubmitting, setPlateConfirmSubmitting] = useState(false);
  const plateNoticeSeenRef = useRef(new Set());
  const [acceptingNav, setAcceptingNav] = useState(false);
  const [actionToast, setActionToast] = useState('');
  const [premiumParksToast, setPremiumParksToast] = useState(null);
  const [showRoute, setShowRoute] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const [navGeometry, setNavGeometry] = useState([]);
  const [navSteps, setNavSteps] = useState([]);
  const [navError, setNavError] = useState('');
  const routeAnimRef = useRef(null);
  const [navIndex, setNavIndex] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const [mapMoved, setMapMoved] = useState(false);
  const [destInfo, setDestInfo] = useState(null);
  const isBrowseOnly = !!spot?.mapOnly && !spot?.isPublicParking;
  const isPublicParking = !!spot?.isPublicParking;
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

  const summaryRef = useRef(null);
  const [summaryHeight, setSummaryHeight] = useState(0);
  
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markerRef = useRef(null);
  const markerPopupRef = useRef(null);
  const destMarkerRef = useRef(null);
  const rainAbortRef = useRef(null);
  const rainZoomHandlerRef = useRef(null);
  const lastRainCheckRef = useRef({ at: 0, key: null, isRaining: null });
  const otherUserMarkersRef = useRef(new globalThis.Map());
  const otherUserIconsRef = useRef(new globalThis.Map());
  const otherUserPositionsRef = useRef(new globalThis.Map());
  const otherUserWrappersRef = useRef(new globalThis.Map());
  const otherUserProfilesRef = useRef(new globalThis.Map());
  const otherUserProfileFetchRef = useRef(new globalThis.Map());
  const watchIdRef = useRef(null);
  const speechStateRef = useRef({ text: '', index: -1, at: 0 });
  const OTHER_VISIBILITY_MIN_ZOOM = 13;
  const OTHER_USERS_MAX_DISTANCE_KM = 5;
  const OTHER_USERS_MAX_VISIBLE = 25;
  const viewerCoordsRef = useRef(null);

  useEffect(() => {
    const candidate = userLoc || userCoords;
    viewerCoordsRef.current =
      candidate && isValidCoord(candidate.lng, candidate.lat) ? { lng: candidate.lng, lat: candidate.lat } : null;
  }, [userLoc?.lat, userLoc?.lng, userCoords?.lat, userCoords?.lng]);


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

  const formatPlate = (value) => {
    const cleaned = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let letters1 = '';
    let digits = '';
    let letters2 = '';
    for (const ch of cleaned) {
      if (letters1.length < 2 && /[A-Z]/.test(ch)) {
        letters1 += ch;
        continue;
      }
      if (letters1.length === 2 && digits.length < 3 && /[0-9]/.test(ch)) {
        digits += ch;
        continue;
      }
      if (letters1.length === 2 && digits.length === 3 && letters2.length < 2 && /[A-Z]/.test(ch)) {
        letters2 += ch;
      }
    }
    return [letters1, digits, letters2].filter(Boolean).join('-');
  };
  const isFullPlate = (plate) => /^[A-Z]{2}-\d{3}-[A-Z]{2}$/.test(plate || '');

  useEffect(() => {
    if (isPublicParking) return undefined;
    if (!spot?.id || !currentUserId) return undefined;
    const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spot.id);
    const unsub = onSnapshot(
      spotRef,
      (snap) => {
        const data = snap.data?.() || snap.data() || {};
        if (!data) return;
        if (data.bookerId !== currentUserId) return;
        if (!data.hostVerifiedBookerPlate) return;
        if (data.plateConfirmed || data.status === 'confirmed') return;
        if (plateNoticeSeenRef.current.has(spot.id)) return;
        plateNoticeSeenRef.current.add(spot.id);
        setPlateConfirmInput('');
        setPlateConfirmError(null);
        setShowPlateNotice(true);
      },
      () => {},
    );
    return () => unsub();
  }, [spot?.id, currentUserId, isPublicParking]);

  const closePlateNotice = () => {
    setShowPlateNotice(false);
    setPlateConfirmError(null);
  };

  const handleSubmitConfirmHostPlate = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!spot?.id) return;
    const formatted = formatPlate(plateConfirmInput);
    if (!isFullPlate(formatted)) return;
    setPlateConfirmSubmitting(true);
    setPlateConfirmError(null);
	    try {
	      const bookingSessionId = typeof spot?.bookingSessionId === 'string' ? spot.bookingSessionId : null;
	      const res = await onConfirmHostPlate?.(spot.id, formatted, { bookingSessionId });
	      if (res && res.ok === false) {
	        setPlateConfirmError(res.message || t('plateInvalid', { defaultValue: 'Invalid plate.' }));
	        return;
	      }
      closePlateNotice();
    } finally {
      setPlateConfirmSubmitting(false);
    }
  };
  
  // Ref to prevent double fetching
  const routeFetchedRef = useRef(false);
  const lastPersistTsRef = useRef(0);

  const isValidCoord = (lng, lat) => (
    typeof lng === 'number' && typeof lat === 'number' &&
    !isNaN(lng) && !isNaN(lat) &&
    Math.abs(lng) <= 180 && Math.abs(lat) <= 90
  );

  const getSafeCenter = () => {
    const candidate = userLoc || userCoords;
    if (candidate && isValidCoord(candidate.lng, candidate.lat)) return [candidate.lng, candidate.lat];
    if (spot && isValidCoord(spot.lng, spot.lat)) return [spot.lng, spot.lat];
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

  const enableRainEffect = (map) => {
    if (!map || typeof map.setRain !== 'function') return;
    if (rainZoomHandlerRef.current) return;

    const zoomBasedReveal = (value) => {
      const z = typeof map.getZoom === 'function' ? map.getZoom() : 0;
      const t = Math.max(0, Math.min(1, (z - 11) / 5));
      return value * t;
    };

    const updateRain = () => {
      try {
        map.setRain({
          density: zoomBasedReveal(0.5),
          intensity: 1.0,
          color: '#a8adbc',
          opacity: 0.25,
          vignette: 0,
          'vignette-color': '#6b6b6b',
          direction: [0, 80],
          'droplet-size': [2.6, 18.2],
          'distortion-strength': 0.7,
          'center-thinning': 0,
        });
      } catch (_) {
        // ignore
      }
    };

    rainZoomHandlerRef.current = updateRain;
    map.on('zoom', updateRain);
    updateRain();
  };

  const disableRainEffect = (map) => {
    if (!map || typeof map.setRain !== 'function') return;
    const handler = rainZoomHandlerRef.current;
    if (handler) {
      map.off('zoom', handler);
      rainZoomHandlerRef.current = null;
    }
    try {
      map.setRain(null);
    } catch (_) {
      try {
        map.setRain({ density: 0, intensity: 0, opacity: 0, vignette: 0, 'center-thinning': 0 });
      } catch {
        // ignore
      }
    }
  };

useEffect(() => {
  if (!showRoute || !showSteps) return;
  if (!summaryRef.current) return;

  const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      setSummaryHeight(entry.contentRect.height);
    }
  });

  observer.observe(summaryRef.current);

  return () => observer.disconnect();
}, [showRoute, showSteps]); 

  // Initial Location
  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (isValidCoord(pos.coords.longitude, pos.coords.latitude)) {
           setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
           persistUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
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
    setMapMoved(false);
    setDestInfo(null);
    routeFetchedRef.current = false; // Reset fetch lock
    if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
    }
  }, [spot?.id]);

  // Auto-resume navigation if a persisted step indicates it was started
  useEffect(() => {
    if (initialStep === 'nav_started') {
      setShowRoute(true);
      setShowSteps(true);
    }
  }, [initialStep, spot?.id]);

  useEffect(() => {
    if (!isPublicParking || !spot?.autoStartNav) return;
    setShowRoute(true);
    setShowSteps(true);
  }, [isPublicParking, spot?.autoStartNav, spot?.id]);

  useEffect(() => {
    if (!showRoute) {
      setShowSteps(false);
      setConfirming(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowSteps(true), 0);
    return () => clearTimeout(timer);
  }, [showRoute, spot?.id]);

  // Notify parent when navigation state changes (to hide/show nav)
  useEffect(() => {
    onNavStateChange?.(showRoute);
    return () => onNavStateChange?.(false);
  }, [showRoute, onNavStateChange]);

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

  const formatDistanceText = (km) => {
    if (km == null || Number.isNaN(km)) return '--';
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
  };

  const arrivalTime = useMemo(() => {
    if (!etaMinutes) return null;
    const now = new Date();
    now.setMinutes(now.getMinutes() + etaMinutes);
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [etaMinutes]);

  const locationName = spot?.placeName || spot?.name || spot?.parkingName || null;
  const locationAddress = spot?.address || '';
  const destinationLabel = locationName || locationAddress;

  const providedSteps = Array.isArray(spot?.turnByTurn) ? spot.turnByTurn : 
                        Array.isArray(spot?.routeSteps) ? spot.routeSteps : null;
      
  const fallbackSteps = useMemo(() => {
    if (!destinationLabel) return [];
    return [`${t('stepHead', 'Head toward')} ${destinationLabel}`, `${t('stepArrive', 'Arrive at destination')}`];
  }, [destinationLabel, t]);
  
  const stepsToShow = navReady && navSteps.length > 0 ? navSteps : 
                      providedSteps && providedSteps.length > 0 ? providedSteps : fallbackSteps;

  const navLanguage = i18nInstance?.language || 'en';
  const canSpeakNav = typeof window !== 'undefined' && !!window.speechSynthesis;
  const [navVoiceEnabled, setNavVoiceEnabled] = useState(true);
  const shouldUseMapboxNav = !!mapboxToken && !!userLoc && isValidCoord(spot?.lng, spot?.lat);
  const fallbackOtherPositions = useMemo(
    () => [
      { lng: 2.2945, lat: 48.8584 }, // Tour Eiffel
      { lng: 2.3499, lat: 48.8530 }, // Notre-Dame / Cité
      { lng: 2.3730, lat: 48.8529 }, // Bastille
      { lng: 2.3364, lat: 48.8606 }, // Louvre
      { lng: 2.3212, lat: 48.8403 }, // Montparnasse
      { lng: 2.3908, lat: 48.8339 }, // Bercy
      { lng: 2.376, lat: 48.8976 }, // Parc de la Villette
      { lng: 2.295, lat: 48.8790 }, // Ternes (un peu au nord)
    ],
    [],
  );

  const updateRouteProgress = useCallback(
    (lng, lat) => {
      if (!Array.isArray(navGeometry) || navGeometry.length === 0) return;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const stepCount = Array.isArray(stepsToShow) ? stepsToShow.length : 0;
      if (stepCount === 0) return;
      const { index: closestIdx } = findClosestPointIndex(navGeometry, lng, lat);
      const ratio = navGeometry.length > 1 ? closestIdx / (navGeometry.length - 1) : 0;
      const nextIndex = Math.min(stepCount - 1, Math.max(0, Math.floor(ratio * stepCount)));
      if (!Number.isFinite(nextIndex)) return;
      setNavIndex((prev) => (nextIndex > prev ? nextIndex : prev));
    },
    [navGeometry, stepsToShow],
  );

  const speakNavInstruction = useCallback(
    (instruction, { force = false } = {}) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      if (!navVoiceEnabled) return;
      const text = String(instruction ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const last = speechStateRef.current;
      if (!force && last.text === text && last.index === navIndex) return;
      speechStateRef.current = { text, index: navIndex, at: Date.now() };
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        if (navLanguage) utterance.lang = navLanguage;
        const voices = window.speechSynthesis.getVoices?.() || [];
        const targetLang = String(navLanguage || '').toLowerCase();
        const voice =
          voices.find((v) => v.lang && v.lang.toLowerCase() === targetLang) ||
          voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(targetLang));
        if (voice) utterance.voice = voice;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[Map] SpeechSynthesis failed:', err);
      }
    },
    [navLanguage, navVoiceEnabled, navIndex],
  );

  useEffect(() => {
    if (navVoiceEnabled) {
      speechStateRef.current = { text: '', index: -1, at: 0 };
      return;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, [navVoiceEnabled]);

  useEffect(() => {
    if (!showRoute || !showSteps) {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      speechStateRef.current = { text: '', index: -1, at: 0 };
      return;
    }
    speakNavInstruction(stepsToShow?.[navIndex]);
  }, [showRoute, showSteps, navIndex, stepsToShow, speakNavInstruction]);

  const ensureUserProfile = (uid) => {
    if (!uid) return;
    if (otherUserProfilesRef.current.has(uid) || otherUserProfileFetchRef.current.has(uid)) return;
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
    const fetchPromise = getDoc(userRef)
      .then((snap) => {
        if (!snap.exists()) return;
        const data = snap.data() || {};
        otherUserProfilesRef.current.set(uid, {
          displayName: data.displayName || t('user', 'User'),
          lastSeen: data.updatedAt?.toDate?.() || null,
        });
      })
      .catch((err) => console.error('Error fetching user profile', err))
      .finally(() => {
        otherUserProfileFetchRef.current.delete(uid);
      });
    otherUserProfileFetchRef.current.set(uid, fetchPromise);
  };


  const instructionCardStyle = useMemo(
    () => ({
      background: isDark ? 'rgba(15, 23, 42, 0.6)' : 'rgba(255, 255, 255, 0.86)',
      border: isDark ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgb(243 244 246)',
      backdropFilter: 'blur(16px) saturate(160%)',
      WebkitBackdropFilter: 'blur(16px) saturate(160%)',
      boxShadow: isDark
        ? '0 10px 30px rgba(0, 0, 0, 0.35)'
        : '0 8px 30px rgba(0, 0, 0, 0.04)',
      borderRadius: '2rem',
    }),
    [isDark],
  );

  const instructionTextColor = useMemo(
    () => (isDark ? 'rgba(255, 255, 255, 0.92)' : 'rgba(0, 0, 0, 0.88)'),
    [isDark],
  );

  const instructionSubTextColor = useMemo(
    // Couleurs "System Gray" standard d'Apple
    () => (isDark ? 'rgba(235, 235, 245, 0.6)' : 'rgba(60, 60, 67, 0.6)'),
    [isDark],
  );

  const updateOtherMarkersVisibility = (zoomValue) => {
    const z = Number.isFinite(zoomValue)
      ? zoomValue
      : mapRef.current?.getZoom?.();
    if (!Number.isFinite(z)) return;
    const visible = z >= OTHER_VISIBILITY_MIN_ZOOM;
    for (const marker of otherUserMarkersRef.current.values()) {
      const el = marker?.getElement?.();
      if (el) el.style.display = visible ? 'flex' : 'none';
    }
  };

  const showTapToast = (message) => {
    if (!message) return;
    setActionToast(message);
    window.setTimeout(() => setActionToast(''), 2200);
  };

  const handleAcceptNav = async () => {
    if (!spot) return;
    if (acceptingNav) return;
    setAcceptingNav(true);

    if (isPublicParking) {
      setShowRoute(true);
      setShowSteps(true);
      setAcceptingNav(false);
      return;
    }

    const bookingSessionId = typeof spot?.bookingSessionId === 'string' ? spot.bookingSessionId : null;
    const res = await onSelectionStep?.('nav_started', spot, { bookingSessionId, opId: newId() });
    if (res && res.ok === false) {
      if (res.code === 'no_premium_parks') {
        showTapToast(t('premiumParksEmpty', 'No Premium Parks left.'));
      } else if (res.code === 'spot_not_booked') {
        showTapToast(t('spotNotReady', { defaultValue: 'Just a sec…' }));
      } else {
        showTapToast(t('somethingWentWrong', { defaultValue: 'Something went wrong.' }));
      }
      setAcceptingNav(false);
      return;
    }

    if (
      res?.premiumParksDeltaApplied &&
      Number.isFinite(Number(res.bookerBefore)) &&
      Number.isFinite(Number(res.bookerAfter))
    ) {
      setPremiumParksToast({ from: Number(res.bookerBefore), to: Number(res.bookerAfter) });
    }

    setShowRoute(true);
    setShowSteps(true);
    console.log('[Map] Accept clicked -> nav_started');
    setAcceptingNav(false);
  };

  const persistUserLocation = async (coords) => {
    if (!currentUserId || !coords) return;
    const now = Date.now();
    if (now - lastPersistTsRef.current < 3000) return; // throttle
    lastPersistTsRef.current = now;
    try {
      await setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', 'userLocations', currentUserId),
        {
          lat: coords.lat,
          lng: coords.lng,
          displayName: currentUserName || 'User',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.error('Error saving user location', err);
    }
  };

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
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${userLoc.lng},${userLoc.lat};${spot.lng},${spot.lat}?geometries=polyline6&steps=true&overview=full&language=${encodeURIComponent(navLanguage)}&access_token=${mapboxToken}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('Directions request failed');
        const data = await res.json();
        const route = data?.routes?.[0];
        const polyline = route?.geometry;
        if (!route || !polyline) throw new Error('No route');
        
        let geometry = decodePolyline(polyline, 6);
        // Prepend user location to ensure connection, but don't rely on it for bearing
        // if (userLoc) geometry = [[userLoc.lng, userLoc.lat], ...geometry];
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
  }, [navReady, shouldUseMapboxNav, spot, mapboxToken, navLanguage]);

  // --- Map Init ---
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return undefined;
    if (mapRef.current) return undefined;
    const container = attachPersistentMapContainer(PERSISTENT_MAP_KEY, mapContainerRef.current);
    if (!container) return undefined;

    mapboxgl.accessToken = mapboxToken;
    const cachedMap = getPersistentMap(PERSISTENT_MAP_KEY);
    const map = cachedMap
      ? cachedMap
      : new mapboxgl.Map({
          container,
          style: 'mapbox://styles/louloupark/cmjb7kixg005z01qy4cztc9ce',
          center: isValidCoord(spot?.lng, spot?.lat) ? [spot.lng, spot.lat] : getSafeCenter(),
          zoom: 15.5,
          pitch: 45,
          bearing: -17.6,
          antialias: true,
          interactive: true,
          attributionControl: false,
        });

    if (!cachedMap) {
      setPersistentMap(PERSISTENT_MAP_KEY, map);
    }

    const add3DBuildings = () => {
      const layers = map.getStyle()?.layers || [];
      const labelLayerId = layers.find(
        (layer) => layer.type === 'symbol' && layer.layout && layer.layout['text-field'],
      )?.id;

      if (map.getLayer('add-3d-buildings')) return;

      map.addLayer(
        {
          id: 'add-3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 15,
          paint: {
            'fill-extrusion-color': '#aaa',
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              15, 0,
              15.05, ['get', 'height'],
            ],
            'fill-extrusion-base': [
              'interpolate',
              ['linear'],
              ['zoom'],
              15, 0,
              15.05, ['get', 'min_height'],
            ],
            'fill-extrusion-opacity': 0.6,
          },
        },
        labelLayerId,
      );
    };

    const handleStyleLoad = () => {
      applyDayNightPreset(map);
      patchSizerankInStyle(map);
      const last = lastRainCheckRef.current?.isRaining;
      if (last === true) enableRainEffect(map);
      add3DBuildings();
    };

    const handleLoad = () => {
      setMapLoaded(true);
      map.resize();
      updateOtherMarkersVisibility(map.getZoom());
    };

    const handleError = () => setMapLoaded(false);

    map.on('style.load', handleStyleLoad);
    map.on('error', handleError);
    if (map.loaded()) {
      handleLoad();
    } else {
      map.on('load', handleLoad);
    }
    if (typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : map.loaded()) {
      handleStyleLoad();
    }
    const handleMoveStart = (e) => {
      if (e?.originalEvent) {
        setMapMoved(true);
      }
    };
    const handleZoom = () => updateOtherMarkersVisibility(map.getZoom());
    map.on('movestart', handleMoveStart);
    map.on('zoom', handleZoom);
    mapRef.current = map;

    return () => {
      map.off('movestart', handleMoveStart);
      map.off('zoom', handleZoom);
      map.off('style.load', handleStyleLoad);
      map.off('load', handleLoad);
      map.off('error', handleError);
      if (map.getLayer('add-3d-buildings')) map.removeLayer('add-3d-buildings');
      disableRainEffect(map);
      mapRef.current = null;
      if (destMarkerRef.current?._clickHandler && destMarkerRef.current?.getElement()) {
        destMarkerRef.current.getElement().removeEventListener('click', destMarkerRef.current._clickHandler);
      }
      destMarkerRef.current = null;
    };
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyDayNightPreset(map);
  }, [isDark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return undefined;

    const coords = userLoc || userCoords;
    if (!coords || !isValidCoord(coords.lng, coords.lat)) return undefined;

    const roundKey = `${coords.lat.toFixed(2)}:${coords.lng.toFixed(2)}`;
    const checkRain = async () => {
      const now = Date.now();
      const { at: lastAt, key: lastKey, isRaining: lastIsRaining } = lastRainCheckRef.current;

      if (lastKey === roundKey && now - lastAt < 10 * 60 * 1000 && typeof lastIsRaining === 'boolean') {
        if (lastIsRaining) enableRainEffect(map);
        else disableRainEffect(map);
        return;
      }

      const controller = new AbortController();
      if (rainAbortRef.current) rainAbortRef.current.abort();
      rainAbortRef.current = controller;

      try {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', String(coords.lat));
        url.searchParams.set('longitude', String(coords.lng));
        url.searchParams.set('current', 'precipitation,rain');
        url.searchParams.set('timezone', 'auto');

        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
        const data = await res.json();
        const cur = data?.current || {};
        const precipitation = Number(cur.precipitation);
        const rain = Number(cur.rain);
        const isRaining = (Number.isFinite(rain) ? rain : 0) > 0 || (Number.isFinite(precipitation) ? precipitation : 0) > 0;

        lastRainCheckRef.current = { at: now, key: roundKey, isRaining };
        if (isRaining) enableRainEffect(map);
        else disableRainEffect(map);
      } catch (err) {
        if (controller.signal.aborted) return;
        // Keep last known effect; don't hard-disable on transient network errors.
        console.warn('[Map] Weather check failed:', err);
      }
    };

    checkRain();
    const id = window.setInterval(checkRain, 10 * 60 * 1000);
    return () => {
      window.clearInterval(id);
      if (rainAbortRef.current) rainAbortRef.current.abort();
    };
  }, [mapLoaded, userLoc?.lat, userLoc?.lng, userCoords?.lat, userCoords?.lng]);

  // PREVIEW MODE: center ONLY on destination (before Accept)
useEffect(() => {
  if (!mapLoaded || !mapRef.current) return;
  if (showRoute) return;
  if (!isValidCoord(spot?.lng, spot?.lat)) return;

  mapRef.current.easeTo({
    center: [spot.lng, spot.lat],
    zoom: 17,
    pitch: 45,
    bearing: 0,
    duration: 800,
    essential: true,
  });
}, [mapLoaded, showRoute, spot?.lng, spot?.lat]);

// --- Destination Marker & Modern Popup (AJOUT) ---
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !spot || !isValidCoord(spot.lng, spot.lat)) return;

    const distanceText = formatDistanceText(distanceKm);
    const ownerName =
      spot.proposedByName ||
      spot.hostName ||
      spot.ownerName ||
      spot.username ||
      spot.displayName ||
      t('user', 'User');
    const carModel =
      spot.vehicleModel ||
      spot.carModel ||
      spot.vehicle ||
      spot.model ||
      t('carLabel', 'Car');

    const cardBg = isDark ? 'rgba(15,23,42,0.94)' : 'rgba(255,255,255,0.9)';
    const textColor = isDark ? '#e5e7eb' : '#0f172a';
    const subColor = isDark ? '#cbd5e1' : '#6b7280';
    const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.5)';
    const headerFrom = isDark ? '#1f2937' : '#e5e7eb';
    const headerTo = isDark ? '#0f172a' : '#ffffff';

    // HTML de la pop-up moderne (style "Apple-like" verre dépoli)
    const popupHTML = `
      <div class="font-sans select-none">
        <div style="
          backdrop-filter: blur(18px);
          background:${cardBg};
          color:${textColor};
          border:1px solid ${borderColor};
          border-radius:18px;
          box-shadow:0 18px 50px -18px rgba(0,0,0,0.35);
          overflow:hidden;
        ">
          <div style="
            display:flex;
            align-items:center;
            gap:12px;
            padding:14px 16px;
            background:linear-gradient(120deg, ${headerFrom}, ${headerTo});
          ">
            <div style="
              width:48px;
              height:48px;
              border-radius:16px;
              background:linear-gradient(135deg, #22c55e, #16a34a);
              display:flex;
              align-items:center;
              justify-content:center;
              color:white;
              font-weight:700;
              font-size:16px;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.4);
            ">
              ${ownerName.charAt(0).toUpperCase()}
            </div>
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ownerName}</div>
              <div style="font-size:12px;font-weight:500;color:${subColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${carModel}</div>
            </div>
          </div>
          <div style="
            padding:12px 16px;
            display:flex;
            align-items:center;
            justify-content:space-between;
          ">
            <span style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;color:${subColor};">Distance</span>
            <span style="font-size:14px;font-weight:700;color:${textColor};">${distanceText}</span>
          </div>
        </div>
      </div>
    `;

    // Création ou mise à jour du marqueur
    if (!destMarkerRef.current) {
      const popup = new mapboxgl.Popup({ 
        offset: 25, 
        closeButton: false, 
        className: 'modern-popup',
        maxWidth: '240px' 
      }).setHTML(popupHTML);
      enhancePopupAnimation(popup);

      destMarkerRef.current = new mapboxgl.Marker({ color: '#ea580c' }) // Orange
        .setLngLat([spot.lng, spot.lat])
        .setPopup(popup)
        .addTo(mapRef.current);
    } else {
      destMarkerRef.current.setLngLat([spot.lng, spot.lat]);
      const popup = destMarkerRef.current.getPopup();
      if (popup) {
        enhancePopupAnimation(popup);
        popup.setHTML(popupHTML); // Mise à jour de la distance en temps réel
      }
    }
  }, [mapLoaded, spot, distanceKm, t, isDark]);

  // --- Real-Time Navigation Logic ---
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    


    // 2. Navigation Mode
    // 2. Navigation Mode
    if (navReady && navGeometry.length > 1) {
      const map = mapRef.current;

      // --- Fonction utilitaire pour interpoler des points le long de la ligne ---
      const getPathPoints = (geometry, spacingMeters, offsetMeters) => {
        const points = [];
        let accumulatedDist = 0;
        let nextPointDist = offsetMeters;
        
        for (let i = 0; i < geometry.length - 1; i++) {
          const start = geometry[i];
          const end = geometry[i + 1];
          // Distance approximative simple (suffisante pour l'animation visuelle)
          // 1 degré lat ~= 111km -> 111000m. 
          const dLat = end[1] - start[1];
          const dLng = (end[0] - start[0]) * Math.cos(start[1] * Math.PI / 180);
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

      // --- Ajout des sources et layers ---
      
      // 1. La ligne de route statique (orange)
      if (!map.getSource('route')) {
        map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: navGeometry } } });
        
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': 6,
            'line-opacity': 0.45,
            'line-emissive-strength': 1,
          },
        });

        // Glow effect (below the core line)
        map.addLayer({
          id: 'route-glow',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': '#ffffff',
            'line-width': 14,
            'line-opacity': 0.25,
            'line-blur': 12,
            'line-emissive-strength': 1,
          },
        }, 'route-line');

        // Dark outline to keep the white line visible over light buildings
        map.addLayer({
          id: 'route-outline',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': 'rgba(0, 0, 0, 0.35)',
            'line-width': 10,
            'line-opacity': 1,
            'line-emissive-strength': 1,
          },
        }, 'route-line');
      }

      // 2. La source pour les boules animées

      
      if (!map.getSource('route-dots')) {

        if (!map.hasImage('3d-sphere')) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

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


        map.addSource('route-dots', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        map.addLayer({
          id: 'route-dots-glow',
          type: 'circle',
          source: 'route-dots',
          paint: {
            'circle-color': '#ff7a00',
            'circle-radius': [
      'interpolate', ['linear'], ['zoom'],
      10, 2,  // Si dézoomé (vue ville) -> tout petit (2px)
      15, 6,  // Zoom moyen (ton réglage actuel) -> 6px
      22, 15  // Zoom max (très proche) -> gros (15px)
      ],
            'circle-opacity': 0.55,
            'circle-blur': 1,
            'circle-pitch-alignment': 'map',
            'circle-emissive-strength': 1,
          }
        });

        map.addLayer({
    id: 'route-dots-layer',
    type: 'symbol', // Type symbol pour afficher l'image
    source: 'route-dots',
    layout: {
      'icon-image': '3d-sphere',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-pitch-alignment': 'viewport', // La bille reste ronde face écran
      'icon-size': [
        'interpolate', ['linear'], ['zoom'],
        13, 0.1,
        16, 0.25,
        20, 0.6
      ]
    },
    paint: {
      'icon-opacity': 1,
      'icon-emissive-strength': 1
    }
  });

        
      }

	      // --- Animation Loop ---
	      let startTimestamp = null;
	      const speed = 25; // Mètres par seconde (vitesse de l'animation)
	      const spacing = 14; // Beaucoup plus rapprochées

      const animateDots = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = (timestamp - startTimestamp) / 1000; // secondes
        
        // Calcul du décalage actuel (boucle infinie grâce au modulo)
        const currentOffset = (progress * speed) % spacing;

        // Génération des points
        const dotCoords = getPathPoints(navGeometry, spacing, currentOffset);

        // Mise à jour de la source GeoJSON
        if (map.getSource('route-dots')) {
          map.getSource('route-dots').setData({
            type: 'FeatureCollection',
            features: dotCoords.map(coord => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: coord }
            }))
          });
        }

        routeAnimRef.current = requestAnimationFrame(animateDots);
      };

      if (!routeAnimRef.current) {
        routeAnimRef.current = requestAnimationFrame(animateDots);
      }




       if (!markerRef.current) {
          // Création du marqueur (Flèche Waze)
         const el = document.createElement('div');
         el.className = 'car-marker-container transition-transform duration-100 linear';
         el.style.width = '52px';
         el.style.height = '52px';
         el.style.transformOrigin = 'center center';
         el.draggable = false;
         
         // SVG Flèche Waze
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
           buildOtherUserPopupHTML(
             t,
             isDark,
             currentUserName || t('user', 'User'),
             { text: t('online', 'Online'), isOnline: true },
             { showBadge: false },
           ),
         );
         enhancePopupAnimation(popup);

          markerRef.current = new mapboxgl.Marker({
            element: el,
            rotationAlignment: 'map', // 'map' pour que la flèche suive la rotation de la carte correctement
            pitchAlignment: 'map',
           })
             .setLngLat(userLoc ? [userLoc.lng, userLoc.lat] : navGeometry[0])
             .setRotation(0)
             .setPopup(popup)
             .addTo(map);
         markerPopupRef.current = popup;
      }
      
      // ... suite du code (watchPosition, etc.) ...


       // --- START TRACKING ---
       if (navigator.geolocation) {
           const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
           
           let prevCoords = null; 
           let currentBearing = 0; // Stocke le dernier cap connu pour éviter les sauts

           // FlyTo initial pour se placer
           const startPoint = navGeometry[0] || [spot.lng, spot.lat];
           const startBearing =
             navGeometry.length > 1 ? computeBearing(navGeometry[0], navGeometry[1]) : 0;
           map.flyTo({ 
               center: startPoint, 
               zoom: 19.2, 
               pitch: 50,
               bearing: startBearing,
               padding: getUserAnchorPadding(),
               duration: 2000 
            });

           watchIdRef.current = navigator.geolocation.watchPosition(
  (pos) => {
    // 1. AJOUT : Récupérer heading et speed ici
    const { latitude, longitude, heading, speed } = pos.coords;
    const newCoords = [longitude, latitude];

    const { index: closestIdx } = findClosestPointIndex(navGeometry, longitude, latitude);

    // Variable temporaire pour stocker l'angle de la route
    let routeBearing = null;

    // 2. Calculer l'angle "idéal" de la route (Lignée de la route)
    if (closestIdx < navGeometry.length - 1) {
      const p1 = navGeometry[closestIdx];
      const p2 = navGeometry[closestIdx + 1];
      // On calcule l'angle du segment actuel vers le prochain point
      routeBearing = computeBearing(p1, p2);
    } else if (navGeometry.length > 1) {
      const p1 = navGeometry[navGeometry.length - 2];
      const p2 = navGeometry[navGeometry.length - 1];
      routeBearing = computeBearing(p1, p2);
    }

    updateRouteProgress(longitude, latitude);

    if (!prevCoords) {
      prevCoords = newCoords;
                       markerRef.current?.setLngLat(newCoords);
                       if (markerPopupRef.current) {
                       markerPopupRef.current.setHTML(
                         buildOtherUserPopupHTML(
                           t,
                           isDark,
                           currentUserName || t('user', 'User'),
                           { text: t('online', 'Online'), isOnline: true },
                           { showBadge: false },
                         ),
                       );
                       }
                       const coordObj = { lat: latitude, lng: longitude };
                       setUserLoc(coordObj);
                       persistUserLocation(coordObj);
                       
                       // Si on a déjà un heading GPS valide au démarrage, on l'utilise
                       if (routeBearing !== null) currentBearing = routeBearing;
      else if (heading !== null && !isNaN(heading)) currentBearing = heading;
                       return;
                   }

                   // Calcul de la distance parcourue depuis le dernier point
                   const distMoved = getDistanceFromLatLonInKm(prevCoords[1], prevCoords[0], latitude, longitude);
                   
                   // --- LOGIQUE WAZE : Orientation basée sur le Cap (Heading) ---
                   
                   // 1. Priorité au Heading GPS natif si disponible et qu'on bouge un peu
                   // (Le heading GPS est souvent null à l'arrêt ou imprécis)
    if (routeBearing !== null) {
      // CAS 1 (Le plus important) : On force l'alignement sur la ligne de la route
      // Cela donne l'effet "Rail" fluide comme sur Waze/Google Maps
      currentBearing = routeBearing;
    } 
    else if (heading !== null && !isNaN(heading) && (speed === null || speed > 1)) {
      // CAS 2 : Fallback GPS (si on est hors route ou à la toute fin)
      currentBearing = heading;
    } 
    else if (distMoved > 0.003) {
      // CAS 3 : Fallback Mouvement calculé
      currentBearing = computeBearing(prevCoords, newCoords);
    }
    // Sinon on garde le dernier currentBearing connu pour éviter que la carte ne tourne à l'arrêt.

    const mapBearing = routeBearing !== null ? routeBearing : currentBearing;
    map.easeTo({
      center: newCoords,
      zoom: 19.4,
      pitch: 55,
      bearing: mapBearing, // Aligne la caméra sur l'axe de la route
      padding: getUserAnchorPadding(),
      duration: 1000,
      easing: (t) => t,
    });

    if (markerRef.current) {
      markerRef.current.setLngLat(newCoords);
      // Optionnel : Vous pouvez laisser la voiture tourner selon le GPS (heading) 
      // même si la carte suit la route, pour voir si la voiture "drifte".
      // Mais pour un rendu propre, utilisez aussi currentBearing :
      markerRef.current.setRotation(mapBearing);
                    
                    if (markerPopupRef.current) {
                      markerPopupRef.current.setHTML(
                        buildOtherUserPopupHTML(
                          t,
                          isDark,
                          currentUserName || t('user', 'User'),
                          { text: t('online', 'Online'), isOnline: true },
                          { showBadge: false },
                        ),
                      );
                    }
                  }
                   
                   const coordObj = { lat: latitude, lng: longitude };
    setUserLoc(coordObj);
    persistUserLocation(coordObj);
    prevCoords = newCoords;
  },
  (err) => console.warn('GPS Watch Error', err),
  options
);
       }

       return () => {
        if (routeAnimRef.current) {
          cancelAnimationFrame(routeAnimRef.current);
          routeAnimRef.current = null;
        }
        // ... (votre nettoyage existant GPS)
       if (watchIdRef.current) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
       }

        // Nettoyage des layers/sources si nécessaire lors du démontage complet
        if (mapRef.current && mapRef.current.getLayer('route-dots-layer')) {
             mapRef.current.removeLayer('route-dots-layer');
            }
        if (mapRef.current && mapRef.current.getLayer('route-dots-glow')) {
             mapRef.current.removeLayer('route-dots-glow');
            }
        if (mapRef.current && mapRef.current.getLayer('route-outline')) {
             mapRef.current.removeLayer('route-outline');
            }
        if (mapRef.current && mapRef.current.getSource('route-dots')) {
             mapRef.current.removeSource('route-dots');
            }
      };
    }
  }, [navReady, navGeometry, navSteps, mapLoaded]);

  // --- Subscribe to other users' locations and render markers ---
	  useEffect(() => {
	    if (!mapLoaded || !mapRef.current) return undefined;
	    const updateSelfPopup = () => {
	      if (markerPopupRef.current) {
            markerPopupRef.current.setHTML(
              buildOtherUserPopupHTML(
                t,
                isDark,
                currentUserName || t('user', 'User'),
                { text: t('online', 'Online'), isOnline: true },
                { showBadge: false },
              ),
            );
	      }
	    };
    const locRef = collection(db, 'artifacts', appId, 'public', 'data', 'userLocations');
    const unsubscribe = onSnapshot(
      locRef,
      (snap) => {
        updateSelfPopup();

        const anchor =
          viewerCoordsRef.current ||
          (spot && isValidCoord(Number(spot.lng), Number(spot.lat))
            ? { lng: Number(spot.lng), lat: Number(spot.lat) }
            : { lng: 2.295, lat: 48.8738 });

        const candidates = snap.docs
          .map((docSnap) => {
            const uid = docSnap.id;
            const data = docSnap.data();
            if (!uid || uid === currentUserId) return null;
            const lng = Number(data.lng);
            const lat = Number(data.lat);
            if (!isValidCoord(lng, lat)) return null;
            const distanceKm = getDistanceFromLatLonInKm(anchor.lat, anchor.lng, lat, lng);
            return { uid, data, lng, lat, distanceKm };
          })
          .filter(Boolean)
          .filter((row) => Number.isFinite(row.distanceKm) && row.distanceKm <= OTHER_USERS_MAX_DISTANCE_KM)
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, OTHER_USERS_MAX_VISIBLE);

        const allowed = new Set(candidates.map((c) => c.uid));

        // Remove markers that are now out of range / overflow
        for (const [uid, marker] of otherUserMarkersRef.current.entries()) {
          if (!allowed.has(uid)) {
            marker.remove();
            otherUserMarkersRef.current.delete(uid);
            otherUserIconsRef.current.delete(uid);
            otherUserPositionsRef.current.delete(uid);
            otherUserWrappersRef.current.delete(uid);
            otherUserProfilesRef.current.delete(uid);
            otherUserProfileFetchRef.current.delete(uid);
          }
        }

        candidates.forEach(({ uid, data, lng, lat }) => {
          if (!allowed.has(uid)) return;

          const updatedAtDate = data.updatedAt?.toDate?.() || null;
          const cachedProfile = otherUserProfilesRef.current.get(uid) || {};
          const displayName = data.displayName || cachedProfile.displayName || t('user', 'User');
	          const lastSeen = formatLastSeen(t, updatedAtDate || cachedProfile.lastSeen || null);
	          const isOnline = !!lastSeen?.isOnline;

          otherUserProfilesRef.current.set(uid, {
            displayName,
            lastSeen: updatedAtDate || cachedProfile.lastSeen || null,
          });
          ensureUserProfile(uid);

          // Determine display position (jitter off Arc de Triomphe if needed) and stick to it
          const previousDisplayPos = otherUserPositionsRef.current.get(uid);
          let displayPos = jitterCoordinate(lng, lat, uid, 25);

          displayPos = separateIfTooClose(
            displayPos,
            otherUserPositionsRef.current,
            uid,
            14
          );

          const existing = otherUserMarkersRef.current.get(uid);
          if (existing) {
            existing.setLngLat([displayPos.lng, displayPos.lat]);
            const wrapper = otherUserWrappersRef.current.get(uid);
            if (wrapper) {
              wrapper.style.transform = 'rotate(0deg)';
            }
            const popup = existing.getPopup();
            if (popup) {
              enhancePopupAnimation(popup);
              popup.setHTML(buildOtherUserPopupHTML(t, isDark, displayName, lastSeen));
	            }
            const statusDot = existing.getElement()?.querySelector('.user-marker-presence-dot');
            if (statusDot) {
              statusDot.style.left = '50%';
              statusDot.style.top = '0px';
              statusDot.style.right = 'auto';
              statusDot.style.bottom = 'auto';
              statusDot.style.transform = 'translate(-50%, -50%)';
              statusDot.style.background = isOnline ? '#22c55e' : '#f59e0b';
              statusDot.style.boxShadow = `0 0 0 6px ${isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(249,115,22,0.12)'}`;
            }
            otherUserPositionsRef.current.set(uid, displayPos);
            return;
          }

          // pick or reuse a random icon for this user
          let icon = otherUserIconsRef.current.get(uid);
          if (!icon) {
            const pool = [userCar1, userCar2, userCar3, userCar4];
            icon = pool[Math.floor(Math.random() * pool.length)];
            otherUserIconsRef.current.set(uid, icon);
          }

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
          img.src = icon;
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
          presenceDot.style.background = isOnline ? '#22c55e' : '#f59e0b';
          presenceDot.style.border = '2px solid #ffffff';
          presenceDot.style.boxShadow = `0 0 0 6px ${isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(249,115,22,0.12)'}`;

          imgWrapper.appendChild(img);
          imgWrapper.appendChild(presenceDot);
          el.appendChild(imgWrapper);

         const popup = new mapboxgl.Popup({ offset: 14, closeButton: false, className: 'user-presence-popup' }).setHTML(
            buildOtherUserPopupHTML(t, isDark, displayName, lastSeen),
          );
          enhancePopupAnimation(popup);
          const marker = new mapboxgl.Marker({
            element: el,
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport',
            anchor: 'bottom',
          })
            .setLngLat([displayPos.lng, displayPos.lat])
            .setPopup(popup)
            .addTo(mapRef.current);
          otherUserMarkersRef.current.set(uid, marker);
          otherUserWrappersRef.current.set(uid, imgWrapper);
          updateOtherMarkersVisibility(mapRef.current?.getZoom());
          imgWrapper.style.transform = 'rotate(0deg)';
          otherUserPositionsRef.current.set(uid, displayPos);
          return;
        });

      },
      (err) => console.error('Error watching user locations', err),
    );

    return () => {
      unsubscribe();
      for (const marker of otherUserMarkersRef.current.values()) {
        marker.remove();
      }
      otherUserMarkersRef.current.clear();
      otherUserIconsRef.current.clear();
      otherUserPositionsRef.current.clear();
      otherUserWrappersRef.current.clear();
      otherUserProfilesRef.current.clear();
      otherUserProfileFetchRef.current.clear();
    };
  }, [mapLoaded, currentUserId, spot?.id]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center font-sans">
      <div
        className="relative w-full h-full bg-gray-900 overflow-hidden"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 0 }}
      >
        {/* Style injection for Custom Popup (AJOUT) */}
        <style>{`
          @keyframes popupEnter {
            from { transform: scale(0.9) translateY(4px); opacity: 0; }
            to { transform: scale(1) translateY(0); opacity: 1; }
          }
          @keyframes popupExit {
            from { transform: scale(1) translateY(0); opacity: 1; }
            to { transform: scale(0.92) translateY(4px); opacity: 0; }
          }
          .mapboxgl-popup-content.popup-enter { animation: popupEnter 0.18s ease forwards; }
          .mapboxgl-popup-content.popup-exit { animation: popupExit 0.16s ease forwards; }
          .modern-popup .mapboxgl-popup-content {
            padding: 12px !important;
            border-radius: 20px !important;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
            border: 1px solid rgba(229, 231, 235, 0.5);
          }
          .modern-popup .mapboxgl-popup-tip {
            border-top-color: #ffffff !important;
            margin-bottom: -1px;
          }
        `}</style>
        <PopUpUsersStyles />
        
        {/* The Map */}
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
        
        {!mapboxToken && (
           <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">Missing Mapbox Token</div>
        )}

        {premiumParksToast ? (
          <PremiumParksDeltaToast
            fromCount={premiumParksToast.from}
            toCount={premiumParksToast.to}
            onDone={() => setPremiumParksToast(null)}
          />
        ) : null}

        {actionToast ? (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className="bg-black/75 text-white px-4 py-2 rounded-full text-sm shadow-lg backdrop-blur-md">
              {actionToast}
            </div>
          </div>
        ) : null}

        {!isBrowseOnly && (
          <>
        {/* --- STEP 1: PREVIEW --- */}
        {!showSteps && (
          <div
            className="absolute inset-0 flex flex-col justify-end px-6 z-20 pointer-events-none"
           style={{
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)'
            }}
          >
            {!showRoute && (
              <div className="pointer-events-auto flex justify-center">
                <div className="relative w-[90%] max-w-[320px]">
                  <div
                    className="
                      absolute rounded-full halo-pulse scale-115
                      bg-white/35
                      -inset-0
                      blur-lg
                    "
                    style={{ opacity: 0.02, transform: 'scale(1.01)' }}
                  />

                  <div
                    className="
                      relative flex items-center p-1.5
                      bg-white/80 backdrop-blur-2xl
                      border border-white/60
                      shadow-[0_8px_32px_rgba(0,0,0,0.12)]
                      rounded-full w-full
                      overflow-hidden
                    "
                  >
                    <div
                      className="
                        absolute top-1.5 bottom-1.5 rounded-full
                        bg-orange-500
                        shadow-[0_2px_10px_rgba(249,115,22,0.3)]
                        transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
                        w-[calc(50%-9px)]
                        left-[calc(50%+3px)]
                      "
                    />

                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectionStep?.('cleared', null);
                        onClose?.();
                      }}
                      className="
                        flex-1 relative z-10 flex items-center justify-center gap-2 h-12 rounded-full
                        text-gray-500 hover:text-gray-700 transition-colors duration-300 active:scale-95
                      "
                    >
                      <XIcon
                        size={20}
                        strokeWidth={2.5}
                        className="transition-transform duration-300"
                      />
                      <span className="text-sm font-semibold tracking-wide">
                        {t('decline', 'Decline')}
                      </span>
                    </button>

                    <button
                      onClick={handleAcceptNav}
                      disabled={acceptingNav}
                      className="
                        flex-1 relative z-10 flex items-center justify-center gap-2 h-12 rounded-full
                        text-white transition-colors duration-300 active:scale-95
                        disabled:opacity-60
                      "
                    >
                      <Check
                        size={20}
                        strokeWidth={2.5}
                        className="transition-transform duration-300 scale-105"
                      />
                      <span className="text-sm font-semibold tracking-wide">
                        {t('acceptRoute', 'Accept')}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- STEP 2: REAL GPS --- */}
        {showRoute && showSteps && (
          <>
            {/* Top: Instructions */}
            <div
              
              className="absolute left-4 right-4 z-20 pointer-events-none animate-[slideDown_0.3s_ease-out]"
              style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
            >
              <div
                className="rounded-[2rem] overflow-hidden pointer-events-auto backdrop-blur-2xl border border-orange-100/70"
                style={{ ...instructionCardStyle, color: instructionTextColor }}
              >
                <div className="flex items-center gap-4 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => speakNavInstruction(stepsToShow?.[navIndex], { force: true })}
                    className="shrink-0 bg-orange-50 border border-orange-100 p-2.5 rounded-2xl shadow-inner text-orange-500 transition active:scale-95"
                    aria-label={t('repeatInstruction', { defaultValue: 'Repeat instruction' })}
                  >
                    {getManeuverIcon(stepsToShow[navIndex])}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-semibold leading-tight tracking-tight drop-shadow-sm">
                      {stepsToShow[navIndex] || t('stepFollow', 'Follow route')}
                    </p>
                    {stepsToShow[navIndex + 1] && (
                      <p
                        className="text-sm mt-1 truncate"
                        style={{ color: instructionSubTextColor }}
                      >
                        {t('then', 'Then')}: {stepsToShow[navIndex + 1]}
                      </p>
                    )}
                  </div>
                  {canSpeakNav && (
                    <button
                      type="button"
                      onClick={() => setNavVoiceEnabled((prev) => !prev)}
                      aria-pressed={navVoiceEnabled}
                      aria-label={
                        navVoiceEnabled
                          ? t('voiceOn', { defaultValue: 'Voice on' })
                          : t('voiceOff', { defaultValue: 'Voice off' })
                      }
                      className={`shrink-0 w-11 h-11 rounded-2xl border flex items-center justify-center transition ${
                        navVoiceEnabled
                          ? 'bg-orange-50 border-orange-200 text-orange-500'
                          : 'bg-slate-100 border-slate-200 text-slate-500'
                      }`}
                    >
                      {navVoiceEnabled ? <Volume2 size={18} strokeWidth={2.4} /> : <VolumeX size={18} strokeWidth={2.4} />}
                    </button>
                  )}
                </div>
                <div className="px-4 pb-3">
                  <div className="h-2 rounded-full bg-orange-100/70 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-orange-400 to-amber-400 shadow-[0_0_14px_rgba(249,115,22,0.35)] transition-all duration-1000"
                      style={{ width: `${Math.min(100, (navIndex / Math.max(1, stepsToShow.length)) * 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom: Summary */}
            <div
            ref={summaryRef}
              className="absolute left-4 right-4 z-20 pointer-events-none animate-[slideUp_0.3s_ease-out]"
              style={{ bottom: '20px' }}
            >
              <div className="bg-white rounded-[2rem] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)] p-4 flex items-center justify-between pointer-events-auto border border-orange-100/70">
                <div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-green-600 font-extrabold text-3xl drop-shadow-sm">{etaMinutes || '--'} min</span>
                    <span className="text-gray-700 font-semibold bg-gray-100 px-3 py-1 rounded-xl shadow-sm border border-white/60">
                      {formatDistanceText(distanceKm)}
                    </span>
                  </div>
                  <p className="text-gray-500 text-sm font-medium mt-1">
                    {t('arrival', 'Arrival')} {arrivalTime || '--:--'}
                  </p>
                </div>

                {isPublicParking ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectionStep?.('cleared', null);
                      onClose?.();
                    }}
                    className="
                      px-4 py-2 rounded-full
                      bg-emerald-500 hover:bg-emerald-600
                      text-white font-semibold
                      shadow-md transition-colors
                    "
                  >
                    {t('arrived', { defaultValue: 'Arrivé' })}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setConfirming(true);
                    }}
                    className="bg-gray-100 hover:bg-red-50 text-red-600 p-3 rounded-full transition-colors border border-gray-200 shadow-md"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
          </>
        )}

        {isBrowseOnly && (
          <div className="absolute top-5 left-5 z-30 pointer-events-auto">
            <button
              type="button"
              onClick={() => {
                onSelectionStep?.('cleared', null);
                onClose?.();
              }}
              className="flex items-center justify-center w-11 h-11 rounded-full bg-black/50 text-white border border-white/20 backdrop-blur-md shadow-lg transition hover:scale-105 active:scale-95"
              aria-label={t('close', 'Close')}
            >
              <XIcon size={20} strokeWidth={2.5} />
            </button>
          </div>
        )}

        {/* Exit Modal */}
        {!isBrowseOnly && confirming && (
          <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center px-6">
            {/* Removed custom animate-[scaleIn] and used standard Tailwind scale transition */}
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 transform transition-all animate-none scale-100">
              <h3 className="font-bold text-lg text-center text-gray-900 mb-2">
                {t('confirmCancelNav', 'Stop Navigation?')}
              </h3>
              <p className="text-sm text-gray-500 text-center mb-4">
                {t('confirmCancelSub', 'The spot will be made available to other users.')}
              </p>
              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="flex-1 py-2.5 rounded-xl font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  {t('resume', 'Resume')}
                </button>
                <button
                  type="button"
	                  onClick={() => {
	                    if (onCancelBooking && spot) {
	                      const bookingSessionId =
	                        typeof spot?.bookingSessionId === 'string' ? spot.bookingSessionId : null;
	                      onCancelBooking(spot.id, { bookingSessionId, opId: newId() });
	                    }
	                    setConfirming(false);
	                    onSelectionStep?.('cleared', null);
	                    onClose?.();
	                  }}
                  className="flex-1 py-2.5 rounded-xl font-semibold bg-orange-600 text-white hover:bg-orange-700"
                >
                  {t('end', 'Exit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {!isBrowseOnly && showPlateNotice && (
          <div className="absolute inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center px-6">
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
              aria-label={t('plateConfirmedByOtherTitle', 'Your plate is confirmed')}
            >
              <h3 className="text-2xl font-extrabold text-slate-900">
                {t('plateConfirmedByOtherTitle', 'Your plate is confirmed')}
              </h3>
              <p className="mt-2 text-sm text-slate-700">
                {t(
                  'plateNowConfirmOther',
                  'The other user confirmed your plate. Now confirm theirs.',
                )}
              </p>
              {spot?.hostName && (
                <p className="mt-3 text-sm text-slate-700">
                  {t('confirmPlateFor', { defaultValue: 'Plate of' })}{' '}
                  <span className="font-semibold">{spot.hostName}</span>
                  {spot?.hostVehiclePlate ? (
                    <>
                      {' '}— {t('announced', { defaultValue: 'announced' })}:{' '}
                      <span className="font-semibold">{spot.hostVehiclePlate}</span>
                    </>
                  ) : null}
                </p>
              )}

              <form onSubmit={handleSubmitConfirmHostPlate} className="mt-5">
                <input
                  type="text"
                  value={plateConfirmInput}
                  onChange={(ev) => setPlateConfirmInput(formatPlate(ev.target.value))}
                  placeholder={t('platePlaceholder', 'e.g., AB-123-CD')}
                  className="
                    w-full rounded-2xl px-4 py-4
                    text-center text-2xl font-mono uppercase tracking-widest
                    bg-white/70 border border-white/70 shadow-inner
                    text-slate-900 placeholder:text-slate-400
                    focus:outline-none focus:ring-4 focus:ring-orange-500/20 focus:border-orange-400
                    transition
                  "
                />
                {plateConfirmError && <p className="mt-2 text-sm text-red-600">{plateConfirmError}</p>}

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={closePlateNotice}
                    className="
                      h-12 rounded-2xl border border-white/50 bg-white/60
                      text-slate-700 font-semibold shadow-sm
                      transition active:scale-[0.99]
                      hover:bg-white/80
                    "
                  >
                    {t('later', 'Later')}
                  </button>
                  <button
                    type="submit"
                    disabled={plateConfirmSubmitting || !isFullPlate(formatPlate(plateConfirmInput))}
                    className="
                      h-12 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500
                      text-white font-extrabold shadow-[0_12px_30px_rgba(249,115,22,0.35)]
                      hover:brightness-110 transition active:scale-[0.99] disabled:opacity-50
                    "
                  >
                    {t('confirmPlate', 'Confirm Plate')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Recenter control */}
{mapLoaded && mapMoved && showRoute && showSteps && (
  <div
    className="absolute right-4 z-30 pointer-events-auto transition-all duration-500 ease-out"
    style={{
      // On garde ton calcul de position dynamique
      bottom: `${20 + summaryHeight + 16}px`, 
    }}
  >
    <button
      type="button"
      aria-label="Recenter on me"
      onClick={() => {
        const candidate =
          userLoc && isValidCoord(userLoc.lng, userLoc.lat)
            ? [userLoc.lng, userLoc.lat]
            : navGeometry?.[0];
        if (!candidate || !isValidCoord(candidate[0], candidate[1]) || !mapRef.current) return;
        
        mapRef.current.easeTo({
          center: candidate,
          duration: 800, // Un peu plus lent pour un effet plus "premium"
          pitch: 55,     // On remet la vue 3D inclinée
          zoom: 17.5,
          bearing: 0,    // Optionnel : remet le nord ou le cap
          padding: getUserAnchorPadding(),
          essential: true,
          easing: (t) => t * (2 - t) // Ease-out quad plus naturel
        });
        setMapMoved(false);
      }}
      className="
        group
        flex items-center justify-center
        w-12 h-12
        rounded-full
        bg-slate-900/80 backdrop-blur-xl
        border border-white/10
        shadow-[0_8px_20px_-6px_rgba(0,0,0,0.25)]
        text-white
        transition-all duration-300 cubic-bezier(0.34, 1.56, 0.64, 1)
        hover:scale-110
        active:scale-90 active:bg-slate-900/90
      "
    >
      <svg 
        className="w-6 h-6 drop-shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" 
        viewBox="0 0 24 24" 
        fill="currentColor"
      >
        <path d="M4.414 10.866a2 2 0 0 1 .463-2.618l9.16-7.073c1.378-1.063 3.327.18 2.96 1.886l-2.628 12.228a2 2 0 0 1-2.64 1.488l-3.326-.95-3.088 2.872a1 1 0 0 1-1.636-.98l1.014-4.884-1.226-.922a1 1 0 0 1 .943-1.047Z" />
      </svg>
    </button>
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
