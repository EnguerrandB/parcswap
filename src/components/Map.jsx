// src/components/Map.jsx
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import '@google/model-viewer';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Check, X as XIcon, Volume2, VolumeX } from 'lucide-react';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, appId } from '../firebase';
import i18n from '../i18n/i18n';
import PremiumParksDeltaToast from './PremiumParksDeltaToast';
import { newId } from '../utils/ids';
import carMarker from '../assets/car-marker.png';
import userDirectionArrow from '../assets/user-direction-arrow.svg';
import { buildOtherUserPopupHTML, enhancePopupAnimation, PopUpUsersStyles } from './PopUpUsers';
import { attachPersistentMapContainer, getPersistentMap, setPersistentMap } from '../utils/persistentMap';
import { applyMapLabelLanguage, patchSizerankInStyle } from '../utils/mapboxStylePatch';
import { clearLocationWatch, getCurrentLocationCoordinates, startLocationWatch } from '../utils/mobile';
import { getVoicePreference, pickPreferredVoice } from '../utils/voice';
import {
  formatStoredVehiclePlate,
  formatVehiclePlate,
  getDefaultPlateCountry,
  getPlateCountryMeta,
  inferPlateCountryFromPlate,
  isValidVehiclePlate,
} from '../utils/vehiclePlates';

// --- SAFE NUMERIC HELPERS ---
// These helpers prevent NaN/Infinity from being written to Firestore, which would cause 400 errors.
const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) && !Number.isNaN(n) ? n : fallback;
};

const safePrice = (value) => safeNumber(value, 0);

const safeCoord = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  // Clamp to reasonable bounds for coordinates
  if (Math.abs(n) > 180) return fallback;
  return n;
};

// --- Helpers ---
const PERSISTENT_MAP_KEY = 'main-map';
const ROUTE_FLOW_DASH_FRAMES = [
  [0, 1.5, 2.4, 6.5],
  [0.35, 1.5, 2.05, 6.5],
  [0.7, 1.5, 1.7, 6.5],
  [1.05, 1.5, 1.35, 6.5],
  [1.4, 1.5, 1.0, 6.5],
  [1.75, 1.5, 0.65, 6.5],
  [2.1, 1.5, 0.3, 6.5],
  [2.45, 1.5, 0.3, 6.15],
];
const ROUTE_FLOW_INTERVAL_MS = 140;

const OTHER_USER_3D_MARKER_CONFIG = {
  wrapperWidth: '150px',
  wrapperHeight: '150px',
  wrapperShadow: 'none',
  modelFieldOfView: '15deg',
  modelCameraTarget: '0m 0.1m 0m',
  modelOrientation: '0deg 18deg 0deg',
  modelShadowIntensity: '1',
  modelExposure: '1.05',
  modelTransform: 'scale(0.5)',
  markerOffsetY: 'none',
  rotationAlignment: 'viewport',
  pitchAlignment: 'viewport',
  cameraOrbitBaseTheta: 0,
  cameraOrbitRadius: '10m',
};

const buildOtherUserCameraOrbit = (bearing = 0, pitch = 45) => {
  const theta = OTHER_USER_3D_MARKER_CONFIG.cameraOrbitBaseTheta - bearing;
  const phi = Math.max(10, Math.min(78, pitch + 8));
  return `${theta}deg ${phi}deg ${OTHER_USER_3D_MARKER_CONFIG.cameraOrbitRadius}`;
};

const syncAllOtherUserModelViewerOrbits = (wrappersRef, bearing, pitch) => {
  const orbit = buildOtherUserCameraOrbit(bearing, pitch);
  for (const wrapper of wrappersRef.values()) {
    const mv = wrapper.querySelector('model-viewer');
    if (mv) mv.setAttribute('camera-orbit', orbit);
  }
};

const SUV_MODEL_HINTS = [
  'suv', 'crossover', 'cross', '4x4', 'pickup', 'x5', 'x6', 'x7', 'glc', 'gle', 'gla',
  'q3', 'q5', 'q7', 'q8', 'tiguan', 'touareg', 't-roc', 't roc', 'kodiaq', 'karoq', 'kamiq',
  '3008', '5008', '2008', 'captur', 'kadjar', 'arkana', 'scenic', 'koleos', 'mokka',
  'grandland', 'enyaq', 'yaris cross', 'c-hr', 'chr', 'rav4', 'highlander', 'land cruiser',
  'sportage', 'sorento', 'niro', 'stonic', 'kona', 'tucson', 'santa fe', 'cx-3', 'cx-5',
  'cx-30', 'cx-60', 'model x', 'model y', 'mustang mach-e', 'mach-e', 'e-tron', 'etron',
  'aygo x', 'countryman', 'defender', 'discovery', 'velar', 'cayenne', 'macan', 'urus',
  'dbx', 'levante', 'stelvio', 'compass', 'renegade', 'cherokee', 'wrangler',
];

const inferVehicleMarkerKind = (vehicleModel) => {
  const normalized = String(vehicleModel || '').trim().toLowerCase();
  if (!normalized) return 'sedan';
  return SUV_MODEL_HINTS.some((hint) => normalized.includes(hint)) ? 'suv' : 'sedan';
};

const getVehicleMarkerAsset = (vehicleModel) => {
  const kind = inferVehicleMarkerKind(vehicleModel);
  return { kind, src: kind === 'suv' ? '/gps-models/suv.glb' : '/gps-models/sedan.glb' };
};

const createOtherUserFallbackVehicle = (label) => {
  const img = document.createElement('img');
  img.src = carMarker;
  img.alt = label;
  img.style.width = '36px';
  img.style.height = '36px';
  img.style.transformOrigin = 'center';
  img.draggable = false;
  img.style.filter = 'drop-shadow(0 6px 8px rgba(0,0,0,0.25))';
  img.style.zIndex = '1';
  img.style.opacity = '1';
  return img;
};

const syncOtherUserVehicleVisual = (wrapper, vehicleModel, label) => {
  if (!wrapper) return;

  const { kind, src } = getVehicleMarkerAsset(vehicleModel);
  if (wrapper.dataset.vehicleKind === kind && wrapper.querySelector('.user-marker-vehicle-visual')) return;

  wrapper.dataset.vehicleKind = kind;
  wrapper.querySelector('.user-marker-vehicle-visual')?.remove();

  const visual = document.createElement('div');
  visual.className = 'user-marker-vehicle-visual';
  visual.style.width = OTHER_USER_3D_MARKER_CONFIG.wrapperWidth;
  visual.style.height = OTHER_USER_3D_MARKER_CONFIG.wrapperHeight;
  visual.style.display = 'flex';
  visual.style.alignItems = 'center';
  visual.style.justifyContent = 'center';
  visual.style.pointerEvents = 'none';
  visual.style.overflow = 'visible';
  visual.style.filter = OTHER_USER_3D_MARKER_CONFIG.wrapperShadow;

  const fallback = () => {
    if (!visual.isConnected) return;
    visual.replaceChildren(createOtherUserFallbackVehicle(label));
  };

  if (customElements.get('model-viewer')) {
    const modelViewer = document.createElement('model-viewer');
    modelViewer.setAttribute('src', src);
    modelViewer.setAttribute('alt', label);
    modelViewer.setAttribute('camera-orbit', buildOtherUserCameraOrbit(0, 45));
    modelViewer.setAttribute('field-of-view', OTHER_USER_3D_MARKER_CONFIG.modelFieldOfView);
    modelViewer.setAttribute('camera-target', OTHER_USER_3D_MARKER_CONFIG.modelCameraTarget);
    modelViewer.setAttribute('orientation', OTHER_USER_3D_MARKER_CONFIG.modelOrientation);
    modelViewer.setAttribute('shadow-intensity', OTHER_USER_3D_MARKER_CONFIG.modelShadowIntensity);
    modelViewer.setAttribute('exposure', OTHER_USER_3D_MARKER_CONFIG.modelExposure);
    modelViewer.setAttribute('interaction-prompt', 'none');
    modelViewer.setAttribute('disable-zoom', '');
    modelViewer.setAttribute('disable-pan', '');
    modelViewer.style.width = '100%';
    modelViewer.style.height = '100%';
    modelViewer.style.background = 'transparent';
    modelViewer.style.pointerEvents = 'none';
    modelViewer.style.overflow = 'visible';
    modelViewer.style.transform = OTHER_USER_3D_MARKER_CONFIG.modelTransform;
    modelViewer.style.setProperty('--poster-color', 'transparent');
    modelViewer.style.setProperty('--progress-bar-color', 'transparent');
    modelViewer.addEventListener('error', fallback, { once: true });
    visual.appendChild(modelViewer);
  } else {
    visual.appendChild(createOtherUserFallbackVehicle(label));
  }

  wrapper.prepend(visual);
};

const ensureRouteChevronImage = (map) => {
  if (map.hasImage('route-chevron')) return;

  const width = 56;
  const height = 28;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);

  ctx.shadowColor = 'rgba(56, 189, 248, 0.35)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawChevron = (offsetX, stroke, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(offsetX + 8, 6);
    ctx.lineTo(offsetX + 18, 14);
    ctx.lineTo(offsetX + 8, 22);
    ctx.stroke();
    ctx.restore();
  };

  drawChevron(0, '#ffffff', 0.98);
  drawChevron(18, '#e0f2fe', 0.82);

  map.addImage('route-chevron', ctx.getImageData(0, 0, width, height));
};

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
  selectedVehiclePlate,
  selectedVehicleModel,
  userCoords,
}) => {
  const { t, i18n: i18nInstance } = useTranslation('common');
  const [userLoc, setUserLoc] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showPlateNotice, setShowPlateNotice] = useState(false);
  const [showArrivalPopup, setShowArrivalPopup] = useState(false);
  const [plateConfirmInput, setPlateConfirmInput] = useState('');
  const [plateConfirmError, setPlateConfirmError] = useState(null);
  const [plateConfirmSubmitting, setPlateConfirmSubmitting] = useState(false);
  const plateNoticeSeenRef = useRef(new Set());
  const arrivalSeenRef = useRef(null);
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
  const otherUserPositionsRef = useRef(new globalThis.Map());
  const otherUserWrappersRef = useRef(new globalThis.Map());
  const otherUserProfilesRef = useRef(new globalThis.Map());
  const otherUserProfileFetchRef = useRef(new globalThis.Map());
  const watchIdRef = useRef(null);
  const previewMarkerRef = useRef(null);
  const speechStateRef = useRef({ text: '', index: -1, at: 0 });
  const speechVoicesRef = useRef([]);
  const speechPrimedRef = useRef(false);
  const OTHER_VISIBILITY_MIN_ZOOM = 13;
  const OTHER_USERS_MAX_DISTANCE_KM = 5;
  const OTHER_USERS_MAX_VISIBLE = 25;
  const viewerCoordsRef = useRef(null);

  useEffect(() => {
    const candidate = userLoc || userCoords;
    viewerCoordsRef.current =
      candidate && isValidCoord(candidate.lng, candidate.lat) ? { lng: candidate.lng, lat: candidate.lat } : null;
  }, [userLoc?.lat, userLoc?.lng, userCoords?.lat, userCoords?.lng]);

  const effectiveUserCoords = useMemo(() => {
    const candidate = userLoc || userCoords;
    return candidate && isValidCoord(candidate.lng, candidate.lat) ? candidate : null;
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

  const defaultPlateCountry = getDefaultPlateCountry(i18n.resolvedLanguage || i18n.language);
  const hostPlateCountry = useMemo(
    () => inferPlateCountryFromPlate(spot?.hostVehiclePlate) || defaultPlateCountry,
    [defaultPlateCountry, spot?.hostVehiclePlate],
  );
  const hostPlateMeta = useMemo(() => getPlateCountryMeta(hostPlateCountry), [hostPlateCountry]);
  const activeVehiclePlate = useMemo(() => {
    if (!selectedVehiclePlate) return '';
    const selectedCountry = inferPlateCountryFromPlate(selectedVehiclePlate) || defaultPlateCountry;
    const formatted = formatStoredVehiclePlate(selectedVehiclePlate, selectedCountry);
    return isValidVehiclePlate(formatted, selectedCountry) ? formatted : selectedVehiclePlate;
  }, [defaultPlateCountry, selectedVehiclePlate]);

  const buildSelfMarkerPopupHTML = useCallback(
    () => buildOtherUserPopupHTML(
      t,
      isDark,
      currentUserName || t('user', 'User'),
      { text: t('online', 'Online'), isOnline: true },
      { showBadge: false, metaText: activeVehiclePlate },
    ),
    [activeVehiclePlate, currentUserName, isDark, t],
  );

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
    const formatted = formatVehiclePlate(plateConfirmInput, hostPlateCountry);
    if (!isValidVehiclePlate(formatted, hostPlateCountry)) return;
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

  function isValidCoord(lng, lat) {
    return typeof lng === 'number' && typeof lat === 'number'
      && !isNaN(lng) && !isNaN(lat)
      && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
  }

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
    let cancelled = false;

    const syncInitialLocation = async () => {
      const coords = await getCurrentLocationCoordinates({
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0,
      });

      if (cancelled) return;
      if (coords && isValidCoord(coords.lng, coords.lat)) {
        setUserLoc(coords);
        persistUserLocation(coords);
        return;
      }
      setUserLoc(null);
    };

    void syncInitialLocation();

    return () => {
      cancelled = true;
    };
  }, [spot?.id]);

  useEffect(() => {
    setShowRoute(false);
    setConfirming(false);
    setShowSteps(false);
    setShowArrivalPopup(false);
    arrivalSeenRef.current = null;
    setNavReady(false);
    setNavGeometry([]);
    setNavSteps([]);
    setNavIndex(0);
    setMapLoaded(false);
    setMapMoved(false);
    setDestInfo(null);
    routeFetchedRef.current = false; // Reset fetch lock
    if (watchIdRef.current) {
      void clearLocationWatch(watchIdRef.current);
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

  const distanceKm = useMemo(
    () => calculateDistanceKm(userLoc || userCoords, spot),
    [userLoc?.lat, userLoc?.lng, userCoords?.lat, userCoords?.lng, spot?.lat, spot?.lng],
  );
  const distanceMeters = useMemo(
    () => (distanceKm == null ? null : distanceKm * 1000),
    [distanceKm],
  );
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
    if (etaMinutes == null) return null;
    const now = new Date();
    now.setMinutes(now.getMinutes() + etaMinutes);
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [etaMinutes]);

  useEffect(() => {
    if (!showRoute || !showSteps) return;
    if (distanceMeters == null) return;
    if (distanceMeters > 20) return;
    if (arrivalSeenRef.current === spot?.id) return;
    arrivalSeenRef.current = spot?.id || 'arrived';
    setShowArrivalPopup(true);
  }, [showRoute, showSteps, distanceMeters, spot?.id]);

  const locationName = spot?.placeName || spot?.name || spot?.parkingName || null;
  const locationAddress = spot?.address || '';
  const destinationLabel = locationName || locationAddress;

  const providedSteps = Array.isArray(spot?.turnByTurn) ? spot.turnByTurn : 
                        Array.isArray(spot?.routeSteps) ? spot.routeSteps : null;
      
  const fallbackSteps = useMemo(() => {
    if (!destinationLabel) return [];
    return [`${t('stepHead', 'Head toward')} ${destinationLabel}`, `${t('stepArrive', 'Arrive at destination')}`];
  }, [destinationLabel, t]);
  
  const stepsToShow = navReady && navSteps.length > 0
    ? navSteps
    : providedSteps && providedSteps.length > 0
      ? providedSteps
      : fallbackSteps;
  const currentInstruction = useMemo(
    () => stepsToShow?.[navIndex] || t('stepFollow', 'Follow route'),
    [stepsToShow, navIndex, t],
  );
  const nextInstruction = stepsToShow?.[navIndex + 1] || null;

  const navLanguage = i18nInstance?.language || 'en';
  const mapLabelLanguage = i18nInstance?.resolvedLanguage || i18nInstance?.language || 'en';
  const mapLabelLanguageRef = useRef(mapLabelLanguage);
  const canSpeakNav = typeof window !== 'undefined' && !!window.speechSynthesis;
  const [navVoiceEnabled, setNavVoiceEnabled] = useState(true);
  const shouldUseMapboxNav = !!mapboxToken && !!effectiveUserCoords && isValidCoord(spot?.lng, spot?.lat);
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

  useEffect(() => {
    mapLabelLanguageRef.current = mapLabelLanguage;
  }, [mapLabelLanguage]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      try {
        speechVoicesRef.current = synth.getVoices?.() || [];
      } catch (_) {
        speechVoicesRef.current = [];
      }
    };
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      synth.removeEventListener?.('voiceschanged', loadVoices);
    };
  }, []);

  const primeSpeechSynthesis = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    try {
      if (synth.paused) synth.resume();
      const voices = speechVoicesRef.current.length ? speechVoicesRef.current : synth.getVoices?.() || [];
      const pref = getVoicePreference();
      const voice = pickPreferredVoice(voices, navLanguage, pref);
      const utterance = new SpeechSynthesisUtterance(' ');
      if (navLanguage) utterance.lang = navLanguage;
      utterance.volume = 0;
      if (voice) utterance.voice = voice;
      synth.speak(utterance);
      window.setTimeout(() => synth.cancel(), 40);
    } catch (_) {
      // ignore
    }
    speechPrimedRef.current = true;
  }, [navLanguage]);

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
      if (force) primeSpeechSynthesis();
      const text = String(instruction ?? '')
        .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return;
      const last = speechStateRef.current;
      if (!force && last.text === text && last.index === navIndex) return;
      try {
        const synth = window.speechSynthesis;
        if (synth.paused) synth.resume();
        const utterance = new SpeechSynthesisUtterance(text);
        if (navLanguage) utterance.lang = navLanguage;
        const voices = speechVoicesRef.current.length
          ? speechVoicesRef.current
          : window.speechSynthesis.getVoices?.() || [];
        const pref = getVoicePreference();
        const voice = pickPreferredVoice(voices, navLanguage, pref);
        if (voice) utterance.voice = voice;
        utterance.volume = 1;
        utterance.rate = 1;
        utterance.pitch = 1;
        speechStateRef.current = { text, index: navIndex, at: Date.now() };
        const speak = () => synth.speak(utterance);
        if (synth.speaking || synth.pending) {
          synth.cancel();
          window.setTimeout(speak, 0);
        } else {
          speak();
        }
      } catch (err) {
        console.warn('[Map] SpeechSynthesis failed:', err);
      }
    },
    [navLanguage, navVoiceEnabled, navIndex, primeSpeechSynthesis],
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
    speakNavInstruction(currentInstruction);
  }, [showRoute, showSteps, navIndex, currentInstruction, navVoiceEnabled, speakNavInstruction]);

  const buildOtherUserPresencePopup = useCallback(
    (displayName, lastSeen, vehicleModel = '') => buildOtherUserPopupHTML(
      t,
      isDark,
      displayName,
      lastSeen,
      { metaText: vehicleModel || '' },
    ),
    [isDark, t],
  );

  const ensureUserProfile = (uid) => {
    if (!uid) return;
    if (otherUserProfilesRef.current.has(uid) || otherUserProfileFetchRef.current.has(uid)) return;
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', uid);
    const vehiclesRef = collection(db, 'artifacts', appId, 'public', 'data', 'users', uid, 'vehicles');
    const fetchPromise = Promise.all([
      getDoc(userRef),
      getDocs(query(vehiclesRef, where('isDefault', '==', true), limit(1))),
      getDocs(query(vehiclesRef, limit(1))),
    ])
      .then(([userSnap, defaultVehicleSnap, fallbackVehicleSnap]) => {
        const userData = userSnap.exists() ? userSnap.data() || {} : {};
        const defaultVehicle = defaultVehicleSnap.docs?.[0]?.data?.() || null;
        const fallbackVehicle = fallbackVehicleSnap.docs?.[0]?.data?.() || null;
        const vehicleModel = defaultVehicle?.model || fallbackVehicle?.model || null;
        const previous = otherUserProfilesRef.current.get(uid) || {};
        const nextProfile = {
          displayName: userData.displayName || previous.displayName || t('user', 'User'),
          lastSeen: userData.updatedAt?.toDate?.() || previous.lastSeen || null,
          vehicleModel: vehicleModel || previous.vehicleModel || null,
        };

        otherUserProfilesRef.current.set(uid, nextProfile);

        const wrapper = otherUserWrappersRef.current.get(uid);
        syncOtherUserVehicleVisual(wrapper, nextProfile.vehicleModel, t('otherUser', 'Other user'));

        const marker = otherUserMarkersRef.current.get(uid);
        const popup = marker?.getPopup?.();
        if (popup) {
          popup.setHTML(
            buildOtherUserPresencePopup(
              nextProfile.displayName,
              formatLastSeen(t, nextProfile.lastSeen),
              nextProfile.vehicleModel,
            ),
          );
        }
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

  const handleDeclinePreview = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (onCancelBooking && spot && !isPublicParking) {
      const bookingSessionId = typeof spot?.bookingSessionId === 'string' ? spot.bookingSessionId : null;
      await onCancelBooking(spot.id, { bookingSessionId, opId: newId() });
    }
    onSelectionStep?.('cleared', null);
    onClose?.();
  };

  const handleAcceptNav = async () => {
    if (!spot) return;
    if (acceptingNav) return;
    if (navVoiceEnabled) {
      primeSpeechSynthesis();
    }
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
console.group('🚀 LoloPark:NavStart');
console.log('Accept nav - proceeding to nav_started');
console.groupEnd();
setAcceptingNav(false);
  };

  const persistUserLocation = async (coords) => {
    if (!currentUserId || !coords) return;
    const now = Date.now();
    if (now - lastPersistTsRef.current < 3000) return; // throttle
    lastPersistTsRef.current = now;
    // Use safe numeric helpers to prevent NaN values that would cause Firestore 400 errors
    const safeLat = safeCoord(coords?.lat, 48.8738);
    const safeLng = safeCoord(coords?.lng, 2.295);
    try {
      await setDoc(
        doc(db, 'artifacts', appId, 'public', 'data', 'userLocations', currentUserId),
        {
          lat: safeLat,
          lng: safeLng,
          displayName: currentUserName || 'User',
          vehicleModel: selectedVehicleModel || null,
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
    if (!navReady || !shouldUseMapboxNav || !effectiveUserCoords || routeFetchedRef.current) return undefined;
    
    const controller = new AbortController();
    
    const fetchDirections = async () => {
      routeFetchedRef.current = true;
      try {
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${effectiveUserCoords.lng},${effectiveUserCoords.lat};${spot.lng},${spot.lat}?geometries=polyline6&steps=true&overview=full&language=${encodeURIComponent(navLanguage)}&access_token=${mapboxToken}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('Directions request failed');
        const data = await res.json();
        const route = data?.routes?.[0];
        const polyline = route?.geometry;
        if (!route || !polyline) throw new Error('No route');
        
        let geometry = decodePolyline(polyline, 6);
        geometry = [[effectiveUserCoords.lng, effectiveUserCoords.lat], ...geometry];
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
  }, [navReady, shouldUseMapboxNav, effectiveUserCoords?.lat, effectiveUserCoords?.lng, spot, mapboxToken, navLanguage]);

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
  console.group('🗺️ LoloPark: Style loaded');
  applyDayNightPreset(map);
  patchSizerankInStyle(map);
  applyMapLabelLanguage(map, mapLabelLanguageRef.current);
  
  // Load missing images for place-labels
  const rankImages = [
    { id: 'icon', path: '/ranks/rank1.png' },
    { id: 'background', path: '/ranks/rank2.png' },
    { id: 'background-stroke', path: '/ranks/rank3.png' },
  ];
  rankImages.forEach(({ id, path }) => {
    if (!map.hasImage(id)) {
      const imgUrl = new URL(path, window.location.origin).href;
      map.loadImage(imgUrl, (err, imgData) => {
        if (err) {
          console.warn(`Failed to load image ${id}:`, err);
        } else {
          map.addImage(id, imgData);
          console.log(`✅ Loaded image: ${id}`);
        }
      });
    }
  });
  
  const last = lastRainCheckRef.current?.isRaining;
  if (last === true) enableRainEffect(map);
  add3DBuildings();
  console.groupEnd();
};

    const handleLoad = () => {
      setMapLoaded(true);
      map.resize();
      updateOtherMarkersVisibility(map.getZoom());
    };

    const handleError = () => setMapLoaded(false);

    map.on('style.load', handleStyleLoad);
    map.on('idle', () => {
      console.log('🛋️ LoloPark: Map idle - repatching sizerank');
      patchSizerankInStyle(map);
    });
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
    const handleMapCamera = () => {
      syncAllOtherUserModelViewerOrbits(otherUserWrappersRef.current, map.getBearing(), map.getPitch());
    };
    map.on('movestart', handleMoveStart);
    map.on('zoom', handleZoom);
    map.on('rotate', handleMapCamera);
    map.on('pitch', handleMapCamera);
    mapRef.current = map;

    return () => {
      map.off('movestart', handleMoveStart);
      map.off('zoom', handleZoom);
      map.off('rotate', handleMapCamera);
      map.off('pitch', handleMapCamera);
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
    if (typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : false) {
      applyMapLabelLanguage(map, mapLabelLanguage);
      return undefined;
    }
    const handleStyleLoad = () => applyMapLabelLanguage(map, mapLabelLanguageRef.current);
    map.once('style.load', handleStyleLoad);
    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [mapLabelLanguage]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return undefined;

    if (showRoute || !effectiveUserCoords) {
      if (previewMarkerRef.current) {
        previewMarkerRef.current.remove();
        previewMarkerRef.current = null;
      }
      return undefined;
    }

    if (!previewMarkerRef.current) {
      const el = document.createElement('div');
      el.style.width = '18px';
      el.style.height = '18px';
      el.style.borderRadius = '9999px';
      el.style.background = '#2563eb';
      el.style.border = '3px solid white';
      el.style.boxShadow = '0 0 0 6px rgba(37, 99, 235, 0.22)';

      previewMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([effectiveUserCoords.lng, effectiveUserCoords.lat])
        .addTo(map);
    } else {
      previewMarkerRef.current.setLngLat([effectiveUserCoords.lng, effectiveUserCoords.lat]);
    }

    return undefined;
  }, [effectiveUserCoords?.lat, effectiveUserCoords?.lng, mapLoaded, showRoute]);

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

      if (previewMarkerRef.current) {
        previewMarkerRef.current.remove();
        previewMarkerRef.current = null;
      }

      if (routeAnimRef.current) {
        window.clearInterval(routeAnimRef.current);
        routeAnimRef.current = null;
      }

      // --- Ajout des sources et layers ---
      const routeData = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: navGeometry },
      };

      ['route-arrows', 'route-flow', 'route-line', 'route-glow', 'route-outline', 'route-dots-layer', 'route-dots-glow'].forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      });
      ['route-dots', 'route'].forEach((sourceId) => {
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      });

      map.addSource('route', {
        type: 'geojson',
        data: routeData,
        lineMetrics: true,
      });

      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#7dd3fc',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 14,
            15, 18,
            19, 24,
          ],
          'line-opacity': 0.24,
          'line-blur': 14,
          'line-emissive-strength': 1,
        },
      });

      map.addLayer({
        id: 'route-outline',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': 'rgba(255, 255, 255, 0.92)',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 8,
            15, 10,
            19, 14,
          ],
          'line-opacity': 1,
          'line-emissive-strength': 1,
        },
      });

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 4,
            15, 5.4,
            19, 7,
          ],
          'line-opacity': 0.96,
          'line-emissive-strength': 1,
        },
      });

      map.addLayer({
        id: 'route-flow',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 2.4,
            15, 2.8,
            19, 3.8,
          ],
          'line-opacity': 1,
          'line-blur': 0.1,
          'line-dasharray': ROUTE_FLOW_DASH_FRAMES[0],
          'line-gradient': [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            '#ffffff',
            0.14,
            '#ffffff',
            0.34,
            '#e0f2fe',
            0.5,
            '#7dd3fc',
            0.8,
            '#38bdf8',
            1,
            '#22c55e',
          ],
          'line-emissive-strength': 1,
        },
      });

      ensureRouteChevronImage(map);
      map.addLayer({
        id: 'route-arrows',
        type: 'symbol',
        source: 'route',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': [
            'interpolate', ['linear'], ['zoom'],
            11, 72,
            15, 58,
            19, 46,
          ],
          'icon-image': 'route-chevron',
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            11, 0.38,
            15, 0.48,
            19, 0.62,
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'symbol-z-order': 'source',
        },
        paint: {
          'icon-opacity': 0.98,
          'icon-emissive-strength': 1,
        },
      });

      let dashFrameIndex = 0;
      routeAnimRef.current = window.setInterval(() => {
        const currentMap = mapRef.current;
        if (!currentMap || !currentMap.getLayer('route-flow')) {
          return;
        }
        dashFrameIndex = (dashFrameIndex + 1) % ROUTE_FLOW_DASH_FRAMES.length;
        currentMap.setPaintProperty('route-flow', 'line-dasharray', ROUTE_FLOW_DASH_FRAMES[dashFrameIndex]);
      }, ROUTE_FLOW_INTERVAL_MS);




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
           buildSelfMarkerPopupHTML(),
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
      
      let trackingCancelled = false;
      const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
      let prevCoords = null;
      let currentBearing = 0;

      const startPoint = navGeometry[0] || [spot.lng, spot.lat];
      const startBearing =
        navGeometry.length > 1 ? computeBearing(navGeometry[0], navGeometry[1]) : 0;
      map.flyTo({
        center: startPoint,
        zoom: 19.2,
        pitch: 50,
        bearing: startBearing,
        padding: getUserAnchorPadding(),
        duration: 2000,
      });

      const startTracking = async () => {
        const watchHandle = await startLocationWatch(
          (pos, coordObj) => {
            if (trackingCancelled || !pos?.coords) return;

            const { latitude, longitude, heading, speed } = pos.coords;
            const newCoords = [longitude, latitude];
            const { index: closestIdx } = findClosestPointIndex(navGeometry, longitude, latitude);

            let routeBearing = null;
            if (closestIdx < navGeometry.length - 1) {
              const p1 = navGeometry[closestIdx];
              const p2 = navGeometry[closestIdx + 1];
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
                markerPopupRef.current.setHTML(buildSelfMarkerPopupHTML());
              }
              setUserLoc(coordObj);
              persistUserLocation(coordObj);

              if (routeBearing !== null) currentBearing = routeBearing;
              else if (heading !== null && !Number.isNaN(heading)) currentBearing = heading;
              return;
            }

            const distMoved = getDistanceFromLatLonInKm(prevCoords[1], prevCoords[0], latitude, longitude);

            if (routeBearing !== null) {
              currentBearing = routeBearing;
            } else if (heading !== null && !Number.isNaN(heading) && (speed === null || speed > 1)) {
              currentBearing = heading;
            } else if (distMoved > 0.003) {
              currentBearing = computeBearing(prevCoords, newCoords);
            }

            const mapBearing = routeBearing !== null ? routeBearing : currentBearing;
            map.easeTo({
              center: newCoords,
              zoom: 19.4,
              pitch: 55,
              bearing: mapBearing,
              padding: getUserAnchorPadding(),
              duration: 1000,
              easing: (t) => t,
            });

            if (markerRef.current) {
              markerRef.current.setLngLat(newCoords);
              markerRef.current.setRotation(mapBearing);
              if (markerPopupRef.current) {
                markerPopupRef.current.setHTML(buildSelfMarkerPopupHTML());
              }
            }

            setUserLoc(coordObj);
            persistUserLocation(coordObj);
            prevCoords = newCoords;
          },
          (err) => {
            if (trackingCancelled) return;
            console.warn('GPS Watch Error', err);
          },
          options,
        );

        if (trackingCancelled) {
          if (watchHandle) {
            void clearLocationWatch(watchHandle);
          }
          return;
        }

        watchIdRef.current = watchHandle;
      };

      void startTracking();

       return () => {
        trackingCancelled = true;
        if (routeAnimRef.current) {
          window.clearInterval(routeAnimRef.current);
          routeAnimRef.current = null;
        }
        // ... (votre nettoyage existant GPS)
       if (watchIdRef.current) {
          void clearLocationWatch(watchIdRef.current);
          watchIdRef.current = null;
       }

        // Nettoyage des layers/sources si nécessaire lors du démontage complet
           if (mapRef.current && mapRef.current.getLayer('route-line')) {
             mapRef.current.removeLayer('route-line');
            }
           if (mapRef.current && mapRef.current.getLayer('route-glow')) {
             mapRef.current.removeLayer('route-glow');
            }
        if (mapRef.current && mapRef.current.getLayer('route-dots-layer')) {
             mapRef.current.removeLayer('route-dots-layer');
            }
        if (mapRef.current && mapRef.current.getLayer('route-dots-glow')) {
             mapRef.current.removeLayer('route-dots-glow');
            }
           if (mapRef.current && mapRef.current.getLayer('route-arrows')) {
             mapRef.current.removeLayer('route-arrows');
            }
             if (mapRef.current && mapRef.current.getLayer('route-flow')) {
               mapRef.current.removeLayer('route-flow');
              }
        if (mapRef.current && mapRef.current.getLayer('route-outline')) {
             mapRef.current.removeLayer('route-outline');
            }
        if (mapRef.current && mapRef.current.getSource('route-dots')) {
             mapRef.current.removeSource('route-dots');
            }
        if (mapRef.current && mapRef.current.getSource('route')) {
             mapRef.current.removeSource('route');
            }
      };
    }
  }, [navReady, navGeometry, navSteps, mapLoaded, buildSelfMarkerPopupHTML]);

  // --- Subscribe to other users' locations and render markers ---
	  useEffect(() => {
	    if (!mapLoaded || !mapRef.current) return undefined;
	    const updateSelfPopup = () => {
	      if (markerPopupRef.current) {
	        markerPopupRef.current.setHTML(buildSelfMarkerPopupHTML());
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
          const vehicleModel = data.vehicleModel || cachedProfile.vehicleModel || null;
          const lastSeen = formatLastSeen(t, updatedAtDate || cachedProfile.lastSeen || null);
          const isOnline = !!lastSeen?.isOnline;

          otherUserProfilesRef.current.set(uid, {
            displayName,
            lastSeen: updatedAtDate || cachedProfile.lastSeen || null,
            vehicleModel,
          });
          ensureUserProfile(uid);

          // Determine display position (jitter off Arc de Triomphe if needed) and stick to it
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
              syncOtherUserVehicleVisual(wrapper, vehicleModel, t('otherUser', 'Other user'));
            }
            const popup = existing.getPopup();
            if (popup) {
              enhancePopupAnimation(popup);
              popup.setHTML(buildOtherUserPresencePopup(displayName, lastSeen, vehicleModel));
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

          const el = document.createElement('div');
          el.style.display = 'flex';
          el.style.alignItems = 'center';
          el.style.justifyContent = 'center';
          el.style.transform = OTHER_USER_3D_MARKER_CONFIG.markerOffsetY;
          el.style.pointerEvents = 'auto';
          el.style.transformOrigin = 'center center';

          const imgWrapper = document.createElement('div');
          imgWrapper.style.position = 'relative';
          imgWrapper.style.display = 'inline-flex';
          imgWrapper.style.alignItems = 'center';
          imgWrapper.style.justifyContent = 'center';
          imgWrapper.style.transformOrigin = 'center center';
          imgWrapper.style.width = OTHER_USER_3D_MARKER_CONFIG.wrapperWidth;
          imgWrapper.style.height = OTHER_USER_3D_MARKER_CONFIG.wrapperHeight;

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

          syncOtherUserVehicleVisual(imgWrapper, vehicleModel, t('otherUser', 'Other user'));
          imgWrapper.appendChild(presenceDot);
          el.appendChild(imgWrapper);

         const popup = new mapboxgl.Popup({ offset: 14, closeButton: false, className: 'user-presence-popup' }).setHTML(
            buildOtherUserPresencePopup(displayName, lastSeen, vehicleModel),
          );
          enhancePopupAnimation(popup);
          const marker = new mapboxgl.Marker({
            element: el,
            rotationAlignment: OTHER_USER_3D_MARKER_CONFIG.rotationAlignment,
            pitchAlignment: OTHER_USER_3D_MARKER_CONFIG.pitchAlignment,
            anchor: 'center',
          })
            .setLngLat([displayPos.lng, displayPos.lat])
            .setPopup(popup)
            .addTo(mapRef.current);
          otherUserMarkersRef.current.set(uid, marker);
          otherUserWrappersRef.current.set(uid, imgWrapper);
          updateOtherMarkersVisibility(mapRef.current?.getZoom());
          if (mapRef.current) {
            const mv = imgWrapper.querySelector('model-viewer');
            if (mv) mv.setAttribute('camera-orbit', buildOtherUserCameraOrbit(mapRef.current.getBearing(), mapRef.current.getPitch()));
          }
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
      otherUserPositionsRef.current.clear();
      otherUserWrappersRef.current.clear();
      otherUserProfilesRef.current.clear();
      otherUserProfileFetchRef.current.clear();
    };
  }, [mapLoaded, currentUserId, spot?.id, buildOtherUserPresencePopup, buildSelfMarkerPopupHTML, t]);

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
                      onClick={handleDeclinePreview}
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
                    onClick={() => {
                      primeSpeechSynthesis();
                      speakNavInstruction(currentInstruction, { force: true });
                    }}
                    className="shrink-0 bg-orange-50 border border-orange-100 p-2.5 rounded-2xl shadow-inner text-orange-500 transition active:scale-95"
                    aria-label={t('repeatInstruction', { defaultValue: 'Repeat instruction' })}
                  >
                    {getManeuverIcon(stepsToShow[navIndex])}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-semibold leading-tight tracking-tight drop-shadow-sm">
                      {currentInstruction}
                    </p>
                    {nextInstruction && (
                      <p
                        className="text-sm mt-1 truncate"
                        style={{ color: instructionSubTextColor }}
                      >
                        {t('then', 'Then')}: {nextInstruction}
                      </p>
                    )}
                  </div>
                  {canSpeakNav && (
                    <button
                      type="button"
                      onClick={() =>
                        setNavVoiceEnabled((prev) => {
                          const next = !prev;
                          if (next) primeSpeechSynthesis();
                          return next;
                        })
                      }
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
                    <span className="text-green-600 font-extrabold text-3xl drop-shadow-sm">
                      {etaMinutes == null ? '--' : etaMinutes} min
                    </span>
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

        {showArrivalPopup && (
          <div className="absolute inset-0 z-[140] flex items-center justify-center px-6">
            <div
              className={`absolute inset-0 backdrop-blur-sm ${
                isDark ? 'bg-black/70' : 'bg-black/40'
              }`}
              onClick={() => setShowArrivalPopup(false)}
            />
            <div
              className="
                relative w-full max-w-sm
                rounded-[28px] border
                shadow-[0_30px_90px_rgba(15,23,42,0.35)]
                p-6 text-center
              "
              style={
                isDark
                  ? {
                      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                      backgroundColor: 'rgba(15,23,42,0.82)',
                      borderColor: 'rgba(255,255,255,0.12)',
                    }
                  : {
                      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                      backgroundColor: 'rgba(255,255,255,0.88)',
                      borderColor: 'rgba(255,255,255,0.7)',
                    }
              }
              role="dialog"
              aria-modal="true"
              aria-label={t('arrivedTitle', { defaultValue: "Vous êtes arrivé" })}
            >
              <p
                className={`text-xs uppercase tracking-[0.18em] font-semibold mb-2 ${
                  isDark ? 'text-orange-300' : 'text-orange-600'
                }`}
              >
                {t('arrivedBadge', { defaultValue: 'Arrivée' })}
              </p>
              <h3 className={`text-2xl font-extrabold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {t('arrivedTitle', { defaultValue: "Vous êtes arrivé" })}
              </h3>
              <p className={`mt-3 text-sm ${isDark ? 'text-slate-200/80' : 'text-slate-700'}`}>
                {t('arrivedMessage', { defaultValue: 'Destination atteinte.' })}
              </p>
              {isPublicParking ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowArrivalPopup(false);
                    onSelectionStep?.('cleared', null);
                    onClose?.();
                  }}
                  className={`
                    mt-5 w-full h-12 rounded-2xl
                    text-white font-extrabold shadow-[0_12px_30px_rgba(16,185,129,0.35)]
                    hover:brightness-110 transition active:scale-[0.99]
                    ${isDark ? 'bg-emerald-400' : 'bg-emerald-500'}
                  `}
                >
                  {t('arrived', { defaultValue: 'Arrivé' })}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowArrivalPopup(false)}
                  className={`
                    mt-5 w-full h-12 rounded-2xl
                    text-white font-extrabold shadow-[0_12px_30px_rgba(249,115,22,0.35)]
                    hover:brightness-110 transition active:scale-[0.99]
                    ${isDark ? 'bg-gradient-to-r from-orange-400 to-amber-400' : 'bg-gradient-to-r from-orange-500 to-amber-500'}
                  `}
                >
                  OK
                </button>
              )}
            </div>
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
                  onChange={(ev) => setPlateConfirmInput(formatVehiclePlate(ev.target.value, hostPlateCountry))}
                  placeholder={hostPlateMeta.placeholder}
                  className="
                    w-full rounded-2xl px-4 py-4
                    text-center text-2xl font-mono uppercase tracking-widest
                    bg-white/70 border border-white/70 shadow-inner
                    text-slate-900 placeholder:text-slate-400
                    focus:outline-none focus:ring-4 focus:ring-orange-500/20 focus:border-orange-400
                    transition
                  "
                  inputMode={hostPlateMeta.inputMode}
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
                    disabled={plateConfirmSubmitting || !isValidVehiclePlate(plateConfirmInput, hostPlateCountry)}
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
