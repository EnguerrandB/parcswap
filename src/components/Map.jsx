// src/components/Map.jsx
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Check, X as XIcon } from 'lucide-react';
import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, appId } from '../firebase';
import i18n from '../i18n/i18n';
import carMarker from '../assets/car-marker.png';
import userCar1 from '../assets/user-car-1.png';
import userCar2 from '../assets/user-car-2.png';
import userCar3 from '../assets/user-car-3.png';
import userCar4 from '../assets/user-car-4.png';

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

const offsetCenter = (coord, bearingDeg, meters) => {
  const R = 6378137;
  const δ = meters / R;
  const θ = (bearingDeg * Math.PI) / 180;

  const φ1 = (coord[1] * Math.PI) / 180;
  const λ1 = (coord[0] * Math.PI) / 180;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );

  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );

  return [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI];
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

  const summaryRef = useRef(null);
  const [summaryHeight, setSummaryHeight] = useState(0);
  
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markerRef = useRef(null);
  const markerPopupRef = useRef(null);
  const destMarkerRef = useRef(null);
  const otherUserMarkersRef = useRef(new globalThis.Map());
  const otherUserIconsRef = useRef(new globalThis.Map());
  const otherUserPositionsRef = useRef(new globalThis.Map());
  const otherUserWrappersRef = useRef(new globalThis.Map());
  const otherUserProfilesRef = useRef(new globalThis.Map());
  const otherUserProfileFetchRef = useRef(new globalThis.Map());
  const watchIdRef = useRef(null);
  const OTHER_VISIBILITY_MIN_ZOOM = 13;

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
  }, [spot?.id, currentUserId]);

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
      const res = await onConfirmHostPlate?.(spot.id, formatted);
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

  const isDark =
    (typeof document !== 'undefined' && document.body?.dataset?.theme === 'dark') ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('theme') === 'dark');

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
    if (!showRoute) {
      setShowSteps(false);
      setConfirming(false);
      return undefined;
    }
    // Ensure the host is notified as soon as navigation starts
    console.log('[Map] showRoute true -> markBookerAccepted fallback');
    markBookerAccepted();
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

  const buildOtherUserPopupHTML = (name, lastSeen, opts = {}) => {
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

  // Adds a quick pop-in/out animation on all popups
  const enhancePopupAnimation = (popup) => {
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

  const instructionCardStyle = useMemo(
    () => ({
      // Apple Dark: Base noire translucide | Apple Light: Base blanche translucide
      background: isDark 
        ? 'rgba(30, 30, 30, 0.70)' 
        : 'rgba(255, 255, 255, 0.75)',
      
      // Bordure très fine : blanche légère en sombre / grise légère en clair
      border: isDark 
        ? '1px solid rgba(255, 255, 255, 0.12)' 
        : '1px solid rgba(255, 255, 255, 0.8)', // Effet "inner light"

      // Le secret d'Apple : Saturation élevée (180%+) + Blur fort
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      
      // Ombre plus douce et diffuse (Smooth shadow)
      boxShadow: isDark
        ? '0 8px 32px 0 rgba(0, 0, 0, 0.35)'
        : '0 8px 32px 0 rgba(31, 38, 135, 0.10)',
        
      borderRadius: '20px', // Apple utilise souvent des rayons larges
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

  const markBookerAccepted = async () => {
    if (!spot?.id || !currentUserId) return;
    console.log('[Map] markBookerAccepted called', {
      spotId: spot.id,
      bookerId: spot.bookerId || currentUserId,
      bookerName: spot.bookerName || currentUserName,
    });
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'spots', spot.id), {
        bookerAccepted: true,
        bookerAcceptedAt: serverTimestamp(),
        bookerId: spot.bookerId || currentUserId,
        bookerName: spot.bookerName || currentUserName || 'Seeker',
      });
      console.log('[Map] markBookerAccepted success', spot.id);
    } catch (err) {
      console.error('Error marking booker accepted navigation', err);
    }
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
  }, [navReady, shouldUseMapboxNav, spot, mapboxToken, navLanguage]);

  // --- Map Init ---
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return undefined;
    if (mapRef.current) return undefined;

    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: isValidCoord(spot?.lng, spot?.lat)
      ? [spot.lng, spot.lat]
      : getSafeCenter(),
      pitch: 0,
      zoom: 15,
      interactive: true,
      attributionControl: false,
    });

    map.on('load', () => { setMapLoaded(true); map.resize(); updateOtherMarkersVisibility(map.getZoom()); });
    map.on('error', () => setMapLoaded(false));
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
      map.remove();
      mapRef.current = null;
      if (destMarkerRef.current?._clickHandler && destMarkerRef.current?.getElement()) {
        destMarkerRef.current.getElement().removeEventListener('click', destMarkerRef.current._clickHandler);
      }
      destMarkerRef.current = null;
    };
  }, [mapboxToken]);

  // PREVIEW MODE: center ONLY on destination (before Accept)
useEffect(() => {
  if (!mapLoaded || !mapRef.current) return;
  if (showRoute) return;
  if (!isValidCoord(spot?.lng, spot?.lat)) return;

  mapRef.current.easeTo({
    center: [spot.lng, spot.lat],
    zoom: 17,
    pitch: 0,
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
    if (navReady && navGeometry.length > 1) {
       const map = mapRef.current;
       const updateRouteProgress = (lng, lat) => {
         if (!navGeometry.length || !map) return null;
         const { index: closestIdx, distanceKm } = findClosestPointIndex(navGeometry, lng, lat);
         if (map.getSource('route')) {
           const remaining = navGeometry.slice(closestIdx);
           const coordinates = remaining.length ? [[lng, lat], ...remaining] : [[lng, lat]];
           map.getSource('route').setData({
             type: 'Feature',
             geometry: { type: 'LineString', coordinates },
           });
         }
         if (navSteps.length > 0) {
           const progressRatio = closestIdx / Math.max(1, navGeometry.length - 1);
           const nextIdx = Math.min(navSteps.length - 1, Math.floor(progressRatio * navSteps.length));
           setNavIndex((prev) => (Number.isFinite(nextIdx) ? nextIdx : prev));
         }
         return { closestIdx, distanceKm };
       };
       
        if (!map.getSource('route')) {
          map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: navGeometry } } });
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
            paint: {
              'line-color': '#f97316',
              'line-width': 8,
              'line-opacity': 0.9,
              'line-dasharray': [1.2, 1.8],
            },
          });

          map.addLayer({
  id: 'route-glow',
  type: 'line',
  source: 'route',
  paint: {
    'line-color': '#fb923c',
   'line-width': 18,
'line-opacity': 0.25,
'line-blur': 12,
  },
}, 'route-line');

map.addLayer({
  id: 'route-flow',
  type: 'line',
  source: 'route',
  paint: {
    'line-color': '#fdba74', // orange clair
    'line-width': 4,
    'line-opacity': 0.8,
    'line-dasharray': [0, 2],
  },
}, 'route-line');


let dashPhase = 0;

const animateRoute = () => {
  if (!map.getLayer('route-flow')) return;

  dashPhase = (dashPhase + 0.04) % 3;

  map.setPaintProperty('route-flow', 'line-dasharray', [
    0.3,
    2.8 + dashPhase,
  ]);

  routeAnimRef.current = requestAnimationFrame(animateRoute);
};

if (!routeAnimRef.current) {
  animateRoute();
}


        } else {
          map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: navGeometry } });
        }

       if (!markerRef.current) {
         const el = document.createElement('img');
         // FIX 2: Smooth CSS transition for the car icon
         el.className = 'car-marker-container transition-transform duration-1000 linear';
         el.src = carMarker;
         el.alt = 'Car';
         el.style.width = '48px';
         el.style.height = '48px';
         el.style.transformOrigin = 'center center';
         el.draggable = false;

         const popup = new mapboxgl.Popup({ offset: 18, closeButton: false, className: 'user-presence-popup' }).setHTML(
           buildOtherUserPopupHTML(
             currentUserName || t('user', 'User'),
             { text: t('online', 'Online'), isOnline: true },
             { showBadge: false },
           ),
         );
         enhancePopupAnimation(popup);

          markerRef.current = new mapboxgl.Marker({
            element: el,
            rotationAlignment: 'viewport',
            pitchAlignment: 'viewport',
           })
             .setLngLat(userLoc ? [userLoc.lng, userLoc.lat] : navGeometry[0])
             .setRotation(0)
             .setPopup(popup)
             .addTo(map);
         markerPopupRef.current = popup;
      }

       // --- START TRACKING ---
       if (navigator.geolocation) {
           const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
           
           // FIX 3: Initialize prevCoords as null to prevent jumping/bad bearing calculation on start
           let prevCoords = null; 

           // Initial FlyTo - Center on destination (parking spot)
           const destPoint = navGeometry[navGeometry.length - 1] || navGeometry[0];
           const prevPoint = navGeometry.length > 1 ? navGeometry[navGeometry.length - 2] : destPoint;
           const initialBearing = computeBearing(destPoint, prevPoint);
           
           map.flyTo({ 
               center: destPoint, 
               zoom: 17, // Focus on the spot right after accept
               pitch: 45,
               bearing: isNaN(initialBearing) ? 0 : initialBearing, 
               padding: { top: 120, bottom: 20 },
               duration: 2000 
            });

           watchIdRef.current = navigator.geolocation.watchPosition(
               (pos) => {
                   const { latitude, longitude, heading } = pos.coords;
                   const newCoords = [longitude, latitude];
                   updateRouteProgress(longitude, latitude);
                   
                   // If this is the first point, just set it and wait for next one to calculate bearing
                   if (!prevCoords) {
                       prevCoords = newCoords;
                       markerRef.current?.setLngLat(newCoords);
                       if (markerPopupRef.current) {
                         markerPopupRef.current.setHTML(
                           buildOtherUserPopupHTML(
                             currentUserName || t('user', 'User'),
                             { text: t('online', 'Online'), isOnline: true },
                             { showBadge: false },
                           ),
                         );
                       }
                       const coordObj = { lat: latitude, lng: longitude };
                       setUserLoc(coordObj);
                       persistUserLocation(coordObj);
                       return;
                   }

                   // Calculate distance moved
                   const distMoved = getDistanceFromLatLonInKm(prevCoords[1], prevCoords[0], latitude, longitude);
                   
                   const bearingToDestination = computeBearing(
                    newCoords,
                    [spot.lng, spot.lat]
                  );

                 const CAMERA_OFFSET_METERS = 140; // 👈 ajuste entre 90 et 160

                  const shiftedCenter = offsetCenter(
                    newCoords,
                    bearingToDestination, // 👈 même direction que la route
                    CAMERA_OFFSET_METERS
                  );

                    map.easeTo({
                      center: shiftedCenter,
                      zoom: 16.6,
                      pitch: 48,
                      bearing: bearingToDestination,
                      padding: {
                        top: 120,
                        bottom: 0,
                        left: 40,
                        right: 40,
                      },
                      duration: 900,
                      easing: t => t,
                    });

                  if (markerRef.current) {
                    markerRef.current.getElement().style.zIndex = '10';
                    markerRef.current.setLngLat(newCoords);
                    markerRef.current.setRotation(bearingToDestination);
                    if (markerPopupRef.current) {
                      markerPopupRef.current.setHTML(
                        buildOtherUserPopupHTML(
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
  // 🧹 STOP animation route
  if (routeAnimRef.current) {
    cancelAnimationFrame(routeAnimRef.current);
    routeAnimRef.current = null;
  }

  // 🧹 STOP GPS
  if (watchIdRef.current) {
    navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
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
        const seen = new Set();
        const allLocations = snap.docs.map((docSnap) => ({
          uid: docSnap.id,
          ...docSnap.data(),
        }));
        updateSelfPopup();
        snap.docs.forEach((docSnap) => {
          const uid = docSnap.id;
          const data = docSnap.data();
          if (uid === currentUserId) return;
          const lng = Number(data.lng);
          const lat = Number(data.lat);
          if (!isValidCoord(lng, lat)) return;
          seen.add(uid);

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
            const prevPos = previousDisplayPos || displayPos;
            const bearing = computeBearing([prevPos.lng, prevPos.lat], [displayPos.lng, displayPos.lat]);
            existing.setLngLat([displayPos.lng, displayPos.lat]);
            const wrapper = otherUserWrappersRef.current.get(uid);
            if (wrapper && Number.isFinite(bearing)) {
              wrapper.style.transform = `rotate(${bearing}deg)`;
            }
            const popup = existing.getPopup();
            if (popup) {
              enhancePopupAnimation(popup);
	              popup.setHTML(buildOtherUserPopupHTML(displayName, lastSeen));
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
          img.style.opacity = '0.85';

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
	            buildOtherUserPopupHTML(displayName, lastSeen),
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
          const initialBearing = Number.isFinite(
            computeBearing(
              previousDisplayPos
                ? [previousDisplayPos.lng, previousDisplayPos.lat]
                : [displayPos.lng, displayPos.lat],
              [displayPos.lng, displayPos.lat],
            ),
          )
            ? computeBearing(
                previousDisplayPos
                  ? [previousDisplayPos.lng, previousDisplayPos.lat]
                  : [displayPos.lng, displayPos.lat],
                [displayPos.lng, displayPos.lat],
              )
            : 0;
          imgWrapper.style.transform = `rotate(${initialBearing}deg)`;
          otherUserPositionsRef.current.set(uid, displayPos);
          return;
        });
        // Cleanup markers not in snapshot
        for (const [uid, marker] of otherUserMarkersRef.current.entries()) {
          if (!seen.has(uid)) {
            marker.remove();
            otherUserMarkersRef.current.delete(uid);
            otherUserIconsRef.current.delete(uid);
            otherUserPositionsRef.current.delete(uid);
            otherUserWrappersRef.current.delete(uid);
            otherUserProfilesRef.current.delete(uid);
          }
        }
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
  }, [mapLoaded, currentUserId]);

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
        
        {/* The Map */}
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
        
        {!mapboxToken && (
           <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">Missing Mapbox Token</div>
        )}

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
                      onClick={() => {
                        markBookerAccepted();
                        setShowRoute(true);
                        setShowSteps(true);
                        console.log('[Map] Accept clicked -> nav_started');
                        onSelectionStep?.('nav_started', spot);
                      }}
                      className="
                        flex-1 relative z-10 flex items-center justify-center gap-2 h-12 rounded-full
                        text-white transition-colors duration-300 active:scale-95
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
                className="rounded-2xl overflow-hidden pointer-events-auto backdrop-blur-2xl"
                style={{ ...instructionCardStyle, color: instructionTextColor }}
              >
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="shrink-0 bg-white/20 border border-white/30 p-2.5 rounded-2xl shadow-inner shadow-white/10">
                    {getManeuverIcon(stepsToShow[navIndex])}
                  </div>
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
                </div>
                <div className="h-[3px] bg-white/10 w-full">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 shadow-[0_0_14px_rgba(59,130,246,0.55)] transition-all duration-1000"
                    style={{ width: `${Math.min(100, (navIndex / Math.max(1, stepsToShow.length)) * 100)}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Bottom: Summary */}
            <div
            ref={summaryRef}
              className="absolute left-4 right-4 z-20 pointer-events-none animate-[slideUp_0.3s_ease-out]"
              style={{ bottom: '20px' }}
            >
              <div className="bg-white rounded-3xl shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)] p-4 flex items-center justify-between pointer-events-auto border border-orange-100/70">
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

                {/* FIX ADDED HERE: type="button" and explicit click handler */}
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
              </div>
            </div>
          </>
        )}

        {/* Exit Modal */}
        {confirming && (
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
                      onCancelBooking(spot.id);
                    }
                    setConfirming(false);
                    onClose?.();
                    onSelectionStep?.('cleared', null);
                  }}
                  className="flex-1 py-2.5 rounded-xl font-semibold bg-orange-600 text-white hover:bg-orange-700"
                >
                  {t('end', 'Exit')}
                </button>
              </div>
            </div>
          </div>
        )}

        {showPlateNotice && (
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
            className="absolute right-6 z-30 pointer-events-auto"
            style={{
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
                  duration: 600,
                  pitch: 45,
                  zoom: 17,
                  essential: true,
                });
                setMapMoved(false);
              }}
              className="rounded-3xl shadow-[0_22px_46px_-12px_rgba(0,0,0,0.55)] border border-orange-200 bg-gradient-to-br from-orange-500 to-amber-400 p-4 flex items-center justify-center hover:translate-y-[-3px] active:translate-y-[1px] transition transform-gpu"
            >
              <div className="relative w-9 h-9 flex items-center justify-center bg-white rounded-full shadow-inner shadow-orange-900/20">
                <svg className="w-6 h-6 text-orange-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3.25c-.35 0-.66.2-.8.52l-3 7a.88.88 0 0 0 1.02 1.18l2.43-.52.13 8.07c.01.44.37.8.82.8s.81-.36.82-.8l.13-8.07 2.43.52a.88.88 0 0 0 1.02-1.18l-3-7a.86.86 0 0 0-.79-.52Z" />
                </svg>
              </div>
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
