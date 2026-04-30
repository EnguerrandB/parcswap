// src/components/MapSearchView.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import userCar1 from '../assets/user-car-1.png';
import userCar2 from '../assets/user-car-2.png';
import userCar3 from '../assets/user-car-3.png';
import userCar4 from '../assets/user-car-4.png';
import { buildOtherUserPopupHTML, enhancePopupAnimation, PopUpUsersStyles } from './PopUpUsers';
import { buildPublicParkingActionPopupHTML, buildPublicParkingPopupHTML } from './PublicParkingPopups';
import { buildSpotActionPopupHTML, buildSpotPopupHTML } from './SpotPopups';
import { newId } from '../utils/ids';
import useFiltersAnimation from '../hooks/useFiltersAnimation';
import { attachPersistentMapContainer, getPersistentMap, setPersistentMap } from '../utils/persistentMap';
import { applyMapLabelLanguage, patchSizerankInStyle } from '../utils/mapboxStylePatch';
import {
  CARD_COLOR_SALT,
  colorForSpot,
  colorsForOrderedSpots,
  getCreatedMs,
  isFreeSpot,
  hostKeyForSpot,
  uniqueSpotsByHost,
} from '../utils/spotColors';
import { appId, db } from '../firebase';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { formatCurrencyNumber, getCurrencySymbol } from '../utils/currency';
import { fetchNearbyPublicParkings } from '../utils/publicParkingApi';
import { SHOW_PRICES } from '../config/features';

const isValidCoord = (lng, lat) =>
  typeof lng === 'number' &&
  typeof lat === 'number' &&
  !Number.isNaN(lng) &&
  !Number.isNaN(lat) &&
  Math.abs(lng) <= 180 &&
  Math.abs(lat) <= 90;

const CAR_ICONS = [userCar1, userCar2, userCar3, userCar4];
const RADIUS_MIN_KM = 0;
const RADIUS_MAX_KM = 2;
const DEFAULT_RADIUS_KM = 2;
const PARKING_FETCH_MIN_INTERVAL_MS = 60_000;
const PARKING_FETCH_MIN_DISTANCE_M = 250;
const PARKING_FETCH_RADIUS_M = 2000;
const PERSISTENT_MAP_KEY = 'map-search';
const PARKING_CACHE_KEY_PREFIX = 'lolopark_parking_cache_';
const LEGACY_PARKING_CACHE_KEY_PREFIX = 'parkswap_parking_cache_';
const PARKING_CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const SEARCH_PRESENCE_COLLECTION = 'mapSearchPresence';
const SEARCH_PRESENCE_STALE_MS = 3 * 60 * 1000;
const SEARCH_PRESENCE_HEARTBEAT_MS = 45 * 1000;
const SEARCH_DEMAND_GRID_DEGREES = 0.0045;
const SEARCH_DEMAND_SOURCE_ID = 'search-demand-zones';
const SEARCH_DEMAND_GLOW_LAYER_ID = 'search-demand-zones-glow';
const SEARCH_DEMAND_CORE_LAYER_ID = 'search-demand-zones-core';
const SEARCH_DEMAND_MAX_VISIBLE_ZONES = 12;
const SEARCH_DEMAND_SPOT_RADIUS_M = 450;
const SEARCH_DEMAND_CLUSTER_RADIUS_M = 160;
const SEARCH_DEMAND_MARKER_TRANSLATE_Y = -18;
const SEARCH_DEMAND_TEST_VEHICLES_ENABLED = true;
const SEARCH_DEMAND_TEST_VEHICLES_MIN = 1;
const SEARCH_DEMAND_TEST_VEHICLES_MAX = 20;
const SEARCH_DEMAND_TEST_VEHICLES_RADIUS_M = 110;
const SEARCH_DEMAND_TEST_VEHICLES_STEP_INTERVAL_MS = 3_000;

const formatEuro = (value, currency = 'EUR') => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return formatCurrencyNumber(n, currency);
};

const getParkingCacheKey = (lng, lat) => {
  const roundedLng = Math.round(lng * 100) / 100;
  const roundedLat = Math.round(lat * 100) / 100;
  return `${PARKING_CACHE_KEY_PREFIX}${roundedLng}_${roundedLat}`;
};

const getLegacyParkingCacheKey = (lng, lat) => {
  const roundedLng = Math.round(lng * 100) / 100;
  const roundedLat = Math.round(lat * 100) / 100;
  return `${LEGACY_PARKING_CACHE_KEY_PREFIX}${roundedLng}_${roundedLat}`;
};

const saveParkingCache = (lng, lat, parkings) => {
  try {
    const key = getParkingCacheKey(lng, lat);
    const data = {
      parkings,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    // ignore
  }
};

const loadParkingCache = (lng, lat) => {
  try {
    const key = getParkingCacheKey(lng, lat);
    const raw = localStorage.getItem(key) || localStorage.getItem(getLegacyParkingCacheKey(lng, lat));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.parkings) || !data.timestamp) return null;
    if (Date.now() - data.timestamp > PARKING_CACHE_DURATION_MS) return null;
    return data.parkings;
  } catch (e) {
    return null;
  }
};

const normalizeFiniteNumberOrNull = (value) => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const roundToStep = (value, step) => Math.round(value / step) * step;

const hashString = (value) => {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

const seededUnit = (seed, offset = 0) => {
  const raw = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
};

const getDemandZone = (lng, lat) => {
  const zoneLng = Number(roundToStep(lng, SEARCH_DEMAND_GRID_DEGREES).toFixed(4));
  const zoneLat = Number(roundToStep(lat, SEARCH_DEMAND_GRID_DEGREES).toFixed(4));
  return {
    key: `${zoneLng.toFixed(4)}:${zoneLat.toFixed(4)}`,
    lng: zoneLng,
    lat: zoneLat,
  };
};

const projectMeters = (lng, lat, originLng, originLat) => {
  const latRad = (originLat * Math.PI) / 180;
  return {
    x: (lng - originLng) * 111111 * Math.cos(latRad),
    y: (lat - originLat) * 111111,
  };
};

const unprojectMeters = (x, y, originLng, originLat) => {
  const latRad = (originLat * Math.PI) / 180;
  const metersPerDegLng = Math.max(1, 111111 * Math.cos(latRad));
  return {
    lng: originLng + x / metersPerDegLng,
    lat: originLat + y / 111111,
  };
};

const buildCirclePolygon = (lng, lat, radiusMeters, steps = 36) => {
  const ring = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps;
    const point = unprojectMeters(
      Math.cos(angle) * radiusMeters,
      Math.sin(angle) * radiusMeters,
      lng,
      lat,
    );
    ring.push([point.lng, point.lat]);
  }
  ring.push(ring[0]);
  return ring;
};

const buildFreeformPolygon = (points, paddingMeters) => {
  if (points.length === 1) {
    return buildCirclePolygon(points[0].lng, points[0].lat, paddingMeters);
  }

  const centroid = points.reduce(
    (acc, point) => ({ lng: acc.lng + point.lng, lat: acc.lat + point.lat }),
    { lng: 0, lat: 0 },
  );
  centroid.lng /= points.length;
  centroid.lat /= points.length;

  const projected = points.map((point) => {
    const projectedPoint = projectMeters(point.lng, point.lat, centroid.lng, centroid.lat);
    return {
      ...projectedPoint,
      distance: Math.hypot(projectedPoint.x, projectedPoint.y),
    };
  });
  const orderedDistances = projected.map((point) => point.distance).sort((a, b) => a - b);
  const percentileIndex = Math.max(0, Math.floor((orderedDistances.length - 1) * 0.78));
  const distanceLimit = orderedDistances[percentileIndex] + paddingMeters * 0.55;
  const keptProjected = projected.filter((point) => point.distance <= distanceLimit);
  const blobPoints = keptProjected.length >= 2 ? keptProjected : projected;

  if (blobPoints.length < 2) {
    const fallbackRadius = Math.max(26, orderedDistances[orderedDistances.length - 1] + paddingMeters * 0.55);
    return buildCirclePolygon(centroid.lng, centroid.lat, fallbackRadius);
  }

  const sampleCount = 56;
  const baseRadius = Math.max(24, orderedDistances[Math.floor((orderedDistances.length - 1) * 0.35)] + paddingMeters * 0.25);
  const maxRadius = Math.max(baseRadius + 10, orderedDistances[orderedDistances.length - 1] + paddingMeters * 0.72);
  let radii = Array.from({ length: sampleCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / sampleCount;
    const unitX = Math.cos(angle);
    const unitY = Math.sin(angle);
    let radius = baseRadius;

    blobPoints.forEach((point) => {
      const along = point.x * unitX + point.y * unitY;
      const lateral = Math.abs(-unitY * point.x + unitX * point.y);
      const influence = along + paddingMeters * 0.62 - lateral * 0.52;
      if (influence > radius) radius = influence;
    });

    return clamp(radius, baseRadius, maxRadius);
  });

  for (let pass = 0; pass < 4; pass += 1) {
    radii = radii.map((radius, index) => {
      const prev = radii[(index - 1 + sampleCount) % sampleCount];
      const next = radii[(index + 1) % sampleCount];
      const prevFar = radii[(index - 2 + sampleCount) % sampleCount];
      const nextFar = radii[(index + 2) % sampleCount];
      const smoothed = prevFar * 0.08 + prev * 0.24 + radius * 0.36 + next * 0.24 + nextFar * 0.08;
      return clamp(smoothed, baseRadius, maxRadius);
    });
  }

  const coordinates = radii.map((radius, index) => {
    const angle = (Math.PI * 2 * index) / sampleCount;
    const point = unprojectMeters(Math.cos(angle) * radius, Math.sin(angle) * radius, centroid.lng, centroid.lat);
    return [point.lng, point.lat];
  });
  coordinates.push(coordinates[0]);
  return coordinates;
};

const clusterDemandZones = (zones, maxDistanceMeters) => {
  const remaining = [...zones];
  const clusters = [];

  while (remaining.length) {
    const seed = remaining.shift();
    const cluster = [seed];
    let expanded = true;

    while (expanded) {
      expanded = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        const touchesCluster = cluster.some(
          (member) =>
            getDistanceMetersBetween(
              { lng: member.lng, lat: member.lat },
              { lng: candidate.lng, lat: candidate.lat },
            ) <= maxDistanceMeters,
        );
        if (!touchesCluster) continue;
        cluster.push(candidate);
        remaining.splice(index, 1);
        expanded = true;
      }
    }

    clusters.push(cluster);
  }

  return clusters;
};

const getSpotMarkerId = (spot, idx) => spot?.id || `spot-${idx}`;

const getDistanceMetersBetween = (a, b) => {
  if (!a || !b) return Infinity;
  if (!isValidCoord(a.lng, a.lat) || !isValidCoord(b.lng, b.lat)) return Infinity;
  const R = 6371e3;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const c =
    2 *
    Math.atan2(
      Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2),
      Math.sqrt(1 - (Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2)),
    );
  return R * c;
};

const getDistanceMeters = (spot, userPosition = null) => {
  if (!spot) return Infinity;
  if (userPosition && spot.lat != null && spot.lng != null) {
    const R = 6371e3;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(spot.lat - userPosition.lat);
    const dLon = toRad(spot.lng - userPosition.lng);
    const lat1 = toRad(userPosition.lat);
    const lat2 = toRad(spot.lat);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  if (spot.distanceMeters != null) return Number(spot.distanceMeters);
  if (spot.distance != null) return Number(spot.distance);
  if (spot.distanceKm != null) return Number(spot.distanceKm) * 1000;
  return 0;
};

const spreadSpotPositions = (spots = []) => {
  const grouped = new Map();
  const precision = 5;
  spots.forEach((spot, idx) => {
    const lng = Number(spot?.lng);
    const lat = Number(spot?.lat);
    if (!isValidCoord(lng, lat)) return;
    const id = getSpotMarkerId(spot, idx);
    const key = `${lng.toFixed(precision)}:${lat.toFixed(precision)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ id, lng, lat });
  });

  const results = new Map();
  const metersPerDegLat = 111111;
  const baseRadius = 8;
  const ringStep = 6;
  const pointsPerRing = 6;

  grouped.forEach((items) => {
    if (items.length === 1) {
      const only = items[0];
      results.set(only.id, { lng: only.lng, lat: only.lat });
      return;
    }

    const sorted = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    sorted.forEach((item, index) => {
      const ring = Math.floor(index / pointsPerRing);
      const ringCount = Math.min(pointsPerRing, sorted.length - ring * pointsPerRing);
      const angle = (2 * Math.PI * (index - ring * pointsPerRing)) / Math.max(1, ringCount);
      const radius = baseRadius + ring * ringStep;
      const latRad = (item.lat * Math.PI) / 180;
      const metersPerDegLng = Math.max(1, metersPerDegLat * Math.cos(latRad));
      const dLat = (radius / metersPerDegLat) * Math.cos(angle);
      const dLng = (radius / metersPerDegLng) * Math.sin(angle);
      results.set(item.id, { lng: item.lng + dLng, lat: item.lat + dLat });
    });
  });

  return results;
};

const iconForKey = (key) => {
  const safe = String(key || '');
  let hash = 0;
  for (let i = 0; i < safe.length; i += 1) {
    hash = (hash * 31 + safe.charCodeAt(i)) | 0;
  }
  return CAR_ICONS[Math.abs(hash) % CAR_ICONS.length];
};

const MapSearchView = ({
  spots = [],
  currency = 'EUR',
  userCoords = null,
  currentUserId = null,
  showPublicParkings = true,
  testModeEnabled = false,
  onBookSpot,
  onSelectionStep,
  setSelectedSpot,
  premiumParks = 0,
  onFiltersOpenChange,
}) => {
  const { t, i18n } = useTranslation('common');
  const isRtl = i18n.dir(i18n.resolvedLanguage || i18n.language) === 'rtl';
  const mapLabelLanguage = i18n.resolvedLanguage || i18n.language || 'en';
  const mapLabelLanguageRef = useRef(mapLabelLanguage);
  const currencySymbol = getCurrencySymbol(currency);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const viewRef = useRef(null);
  const filtersPanelRef = useRef(null);
  const filtersRailRef = useRef(null);
const [filtersRailRect, setFiltersRailRect] = useState(null);
const [kmInnerX, setKmInnerX] = useState(0); // anim interne (dans le rail)
  const radiusSliderRef = useRef(null);
  const priceSliderRef = useRef(null);
  const markersRef = useRef(new Map());
  const parkingMarkersRef = useRef(new Map());
  const userMarkerRef = useRef(null);
  const popupRef = useRef(null);
  const popupModeRef = useRef(new Map());
  const parkingPopupModeRef = useRef(new Map());
  const activePopupRef = useRef(null);
  const colorSaltRef = useRef(CARD_COLOR_SALT);
  const parkingFetchInFlightRef = useRef(false);
  const parkingFetchQueuedRef = useRef(null);
  const searchPresenceWriteInFlightRef = useRef(false);
  const searchPresenceWriteQueuedRef = useRef(null);
  const lastSearchPresenceSignatureRef = useRef('');
  const isMountedRef = useRef(true);
  const lastParkingFetchRef = useRef({ at: 0, lat: null, lng: null });
  const lastParkingZoomRef = useRef(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [mapLoaded, setMapLoaded] = useState(false);
  const [syntheticVehicleCount, setSyntheticVehicleCount] = useState(SEARCH_DEMAND_TEST_VEHICLES_MIN);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_KM);
  const [priceMax, setPriceMax] = useState(null);
  const {
    showRadiusPicker,
    setShowRadiusPicker,
    filtersButtonRef,
    filtersPanelTopPx,
  } = useFiltersAnimation({ viewRef, onFiltersOpenChange });
  const bottomNavEdgeOffset = 'calc((100% - min(90%, 320px)) / 2)';
  const prefsHydratedRef = useRef(false);
  const prefsTouchedRef = useRef(false);
  const prefsWriteInFlightRef = useRef(false);
  const prefsWriteQueuedRef = useRef(null);
  const prefsFlushRequestedRef = useRef(false);
  const prefsLastSavedRef = useRef({ radius: null, priceMax: null });
  const [actionToast, setActionToast] = useState('');
  const [parkingLoading, setParkingLoading] = useState(false);
  const [publicParkings, setPublicParkings] = useState([]);
  const [searchDemandZones, setSearchDemandZones] = useState([]);
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
  const anyLabel = t('any', { defaultValue: 'Any' });

  useEffect(() => {
    mapLabelLanguageRef.current = mapLabelLanguage;
  }, [mapLabelLanguage]);

  const premiumParksCount = Number.isFinite(Number(premiumParks)) ? Number(premiumParks) : 0;
  const canAcceptFreeSpot = premiumParksCount > 0;
  const syntheticDemandEnabled = testModeEnabled && SEARCH_DEMAND_TEST_VEHICLES_ENABLED;
  const showPublicParkingsRef = useRef(showPublicParkings);
  const maxSpotPrice = useMemo(() => {
    const values = (spots || []).map((s) => Number(s?.price)).filter((n) => Number.isFinite(n) && n >= 0);
    const max = values.length ? Math.max(...values) : 0;
    return Math.max(10, Math.ceil(max));
  }, [spots]);

  const setRadiusFromRange = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    prefsTouchedRef.current = true;
    if (n >= RADIUS_MAX_KM - 1e-6) {
      setRadius(null);
    } else {
      setRadius(n);
    }
  };

  const setPriceMaxFromRange = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    prefsTouchedRef.current = true;
    if (n >= maxSpotPrice - 1e-6) {
      setPriceMax(null);
    } else {
      setPriceMax(n);
    }
  };

  const showPremiumToast = () => {
    const msg = t('premiumParksEmpty', { defaultValue: 'No Premium Parks left.' });
    setActionToast(msg);
  };

  const handleReserveSpot = async (spot) => {
    if (!spot) return;
    if (isFreeSpot(spot) && !canAcceptFreeSpot) {
      showPremiumToast();
      return;
    }
    const bookingSessionId = newId();
    const spotWithSession = { ...spot, bookingSessionId };
    onSelectionStep?.('selected', spotWithSession, { bookingSessionId });
    setSelectedSpot?.(spotWithSession);
    const bookRes = await onBookSpot?.(spot, { bookingSessionId, opId: bookingSessionId });
    if (bookRes && bookRes.ok === false) {
      if (bookRes.code === 'no_premium_parks') {
        showPremiumToast();
      } else if (bookRes.code === 'insufficient_funds') {
        setActionToast(t('walletInsufficient', { defaultValue: 'Insufficient wallet balance.' }));
      } else if (bookRes.code === 'spot_not_available') {
        setActionToast(t('spotNotAvailable', { defaultValue: 'Spot no longer available.' }));
      } else {
        setActionToast(t('somethingWentWrong', { defaultValue: 'Something went wrong.' }));
      }
      onSelectionStep?.('cleared', null);
      setSelectedSpot?.(null);
      return;
    }
  };

  const handleGoToParking = (parking) => {
    if (!parking || !isValidCoord(Number(parking.lng), Number(parking.lat))) return;
    const parkingSpot = {
      id: `public-parking-${parking.id || `${parking.lng}:${parking.lat}`}`,
      lng: Number(parking.lng),
      lat: Number(parking.lat),
      name: parking.name || t('publicParking', { defaultValue: 'Parking' }),
      parkingName: parking.name || '',
      address: parking.address || '',
      mapOnly: true,
      isPublicParking: true,
      autoStartNav: true,
    };
    onSelectionStep?.('selected', parkingSpot, { mapOnly: true });
    setSelectedSpot?.(parkingSpot);
  };

  const startRangeDrag = (e, ref, min, max, step, setter) => {
    if (!ref?.current) return;
    e.preventDefault();
    const updateValue = (clientX) => {
      const rect = ref.current.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + pct * (max - min);
      const value = Math.round(raw / step) * step;
      setter(value);
      ref.current.value = value;
    };
    updateValue(e.clientX);
    const onMove = (ev) => updateValue(ev.clientX);
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  // Restore + persist user preferences (radius + price filter)
  useEffect(() => {
    if (!currentUserId) return undefined;
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'userSearchPrefs', currentUserId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        if (!data) {
          prefsHydratedRef.current = true;
          return;
        }
        const nextRadiusRaw = data.radiusKm == null ? null : Number(data.radiusKm);
        const nextRadius =
          nextRadiusRaw == null || !Number.isFinite(nextRadiusRaw)
            ? null
            : nextRadiusRaw >= RADIUS_MAX_KM - 1e-6
              ? null
              : Math.max(RADIUS_MIN_KM, Math.min(RADIUS_MAX_KM, nextRadiusRaw));
        const nextPriceMax = normalizeFiniteNumberOrNull(data.priceMax);

        if (!prefsTouchedRef.current) {
          if (nextRadius == null || (Number.isFinite(nextRadius) && nextRadius > 0)) {
            setRadius(nextRadius);
          }
          if (nextPriceMax == null || Number.isFinite(nextPriceMax)) {
            setPriceMax(nextPriceMax);
          }
        }

        prefsLastSavedRef.current = {
          radius: nextRadius == null || Number.isFinite(nextRadius) ? nextRadius : prefsLastSavedRef.current.radius,
          priceMax: nextPriceMax,
        };
        prefsHydratedRef.current = true;
      },
      (err) => {
        console.error('Error watching search prefs:', err);
        prefsHydratedRef.current = true;
      },
    );
    return () => unsub();
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return undefined;
    if (!prefsHydratedRef.current && !prefsTouchedRef.current) return undefined;

    const radiusNumber = normalizeFiniteNumberOrNull(radius);
    const safeRadius =
      radiusNumber == null
        ? null
        : Math.max(RADIUS_MIN_KM, Math.min(RADIUS_MAX_KM, radiusNumber));
    const safePriceMax = normalizeFiniteNumberOrNull(priceMax);

    const last = prefsLastSavedRef.current;
    if (last.radius === safeRadius && last.priceMax === safePriceMax) return undefined;

    prefsWriteQueuedRef.current = { radiusKm: safeRadius, priceMax: safePriceMax };
    prefsFlushRequestedRef.current = true;

    const flush = async () => {
      if (prefsWriteInFlightRef.current) return;
      prefsWriteInFlightRef.current = true;
      try {
        while (prefsWriteQueuedRef.current) {
          const next = prefsWriteQueuedRef.current;
          prefsWriteQueuedRef.current = null;
          try {
            const ref = doc(db, 'artifacts', appId, 'public', 'data', 'userSearchPrefs', currentUserId);
            await setDoc(
              ref,
              { ...next, updatedAt: serverTimestamp() },
              { merge: true },
            );
            prefsLastSavedRef.current = { radius: next.radiusKm ?? null, priceMax: next.priceMax ?? null };
          } catch (err) {
            console.error('Error persisting search prefs:', err);
            if (!prefsWriteQueuedRef.current) prefsWriteQueuedRef.current = next;
            break;
          }
        }
      } finally {
        prefsWriteInFlightRef.current = false;
        if (prefsWriteQueuedRef.current || prefsFlushRequestedRef.current) {
          prefsFlushRequestedRef.current = false;
          Promise.resolve().then(() => flush());
        }
      }
    };
    flush();

    return undefined;
  }, [currentUserId, radius, priceMax]);

  const sortedSpots = useMemo(
    () => [...(spots || [])].sort((a, b) => getCreatedMs(a) - getCreatedMs(b)),
    [spots],
  );
  const filteredSpots = useMemo(() => {
    return sortedSpots.filter((spot) => {
      const withinRadius = radius == null ? true : getDistanceMeters(spot, userCoords) <= radius * 1000;
      if (!withinRadius) return false;
      if (priceMax == null) return true;
      const p = Number(spot?.price ?? 0);
      return Number.isFinite(p) ? p <= priceMax : true;
    });
  }, [sortedSpots, radius, priceMax, userCoords]);
  const availableSpots = useMemo(
    () => uniqueSpotsByHost(filteredSpots).sort((a, b) => getCreatedMs(a) - getCreatedMs(b)),
    [filteredSpots],
  );
  const availableColors = useMemo(
    () => colorsForOrderedSpots(availableSpots, colorSaltRef.current),
    [availableSpots],
  );
  const popupAccentByHost = useMemo(() => {
    const map = new Map();
    availableSpots.forEach((spot, idx) => {
      const key = hostKeyForSpot(spot);
      if (!key) return;
      map.set(key, availableColors[idx]);
    });
    return map;
  }, [availableSpots, availableColors]);
  useEffect(() => {
    if (!syntheticDemandEnabled) return undefined;

    const updateSyntheticVehicleCount = () => {
      const nextCount =
        SEARCH_DEMAND_TEST_VEHICLES_MIN +
        Math.floor(Math.random() * (SEARCH_DEMAND_TEST_VEHICLES_MAX - SEARCH_DEMAND_TEST_VEHICLES_MIN + 1));
      setSyntheticVehicleCount(nextCount);
    };

    updateSyntheticVehicleCount();
    const timer = window.setInterval(updateSyntheticVehicleCount, SEARCH_DEMAND_TEST_VEHICLES_STEP_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [syntheticDemandEnabled]);
  const syntheticDemandZones = useMemo(() => {
    if (!syntheticDemandEnabled || !availableSpots.length) return [];

    const anchorSpot = availableSpots[0];
    const anchorLng = Number(anchorSpot?.lng);
    const anchorLat = Number(anchorSpot?.lat);
    if (!isValidCoord(anchorLng, anchorLat)) return [];

    const seed = hashString(anchorSpot.id || `${anchorLng}:${anchorLat}`);
  const count = syntheticVehicleCount;
  const maxCount = Math.max(SEARCH_DEMAND_TEST_VEHICLES_MAX, 1);
  const baseLevel = count >= Math.max(4, Math.round(maxCount * 0.55)) ? 'red' : 'orange';

    return Array.from({ length: count }, (_, index) => {
      const angle = seededUnit(seed, index + 11) * Math.PI * 2;
      const distance = 28 + seededUnit(seed, index + 23) * SEARCH_DEMAND_TEST_VEHICLES_RADIUS_M;
      const point = unprojectMeters(
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        anchorLng,
        anchorLat,
      );

      return {
        key: `synthetic-${anchorSpot.id || 'spot'}-${index}`,
        lng: point.lng,
        lat: point.lat,
        count: 1,
        growthPct: Math.round((count / maxCount) * 100),
        intensity: Number(clamp(0.38 + (count / maxCount) * 0.62, 0.35, 1).toFixed(3)),
        level: baseLevel,
      };
    });
  }, [availableSpots, syntheticDemandEnabled, syntheticVehicleCount]);
  const syntheticDisplaySpots = useMemo(() => {
    if (!syntheticDemandEnabled || !availableSpots.length) return [];

    const anchorSpot = availableSpots[0];
    const anchorLng = Number(anchorSpot?.lng);
    const anchorLat = Number(anchorSpot?.lat);
    if (!isValidCoord(anchorLng, anchorLat)) return [];

    return syntheticDemandZones.map((zone, index) => ({
      ...anchorSpot,
      id: `synthetic-preview-${anchorSpot.id || 'spot'}-${index}`,
      lng: zone.lng,
      lat: zone.lat,
      hostId: `${anchorSpot.hostId || 'host'}-synthetic-${index}`,
      hostName: anchorSpot.hostName || t('otherUser', 'Other user'),
      syntheticPreview: true,
    }));
  }, [availableSpots, syntheticDemandEnabled, syntheticDemandZones, t]);
  const displaySpots = useMemo(() => [...filteredSpots, ...syntheticDisplaySpots], [filteredSpots, syntheticDisplaySpots]);
  const spreadPositions = useMemo(() => spreadSpotPositions(displaySpots), [displaySpots]);
  const searchDemandGeoJson = useMemo(
    () => {
      if (!availableSpots.length) {
        return {
          type: 'FeatureCollection',
          features: [],
        };
      }

      return {
        type: 'FeatureCollection',
        features: clusterDemandZones([...searchDemandZones, ...syntheticDemandZones], SEARCH_DEMAND_CLUSTER_RADIUS_M)
          .map((cluster, clusterIndex) => {
            const level = cluster.some((zone) => zone.level === 'red') ? 'red' : 'orange';
            const intensity = Number(
              clamp(Math.max(...cluster.map((zone) => zone.intensity || 0.35)), 0.35, 1).toFixed(3),
            );
            const count = cluster.reduce((total, zone) => total + (zone.count || 0), 0);
            if (count <= 1) return null;
            const growthPct = Math.max(...cluster.map((zone) => zone.growthPct || 0));
            const paddingMeters = 20 + intensity * 20;
            const ring = buildFreeformPolygon(
              cluster.map((zone) => ({ lng: zone.lng, lat: zone.lat })),
              paddingMeters,
            );

            return {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [ring],
              },
              properties: {
                id: cluster.map((zone) => zone.key).join(':') || `cluster-${clusterIndex}`,
                level,
                count,
                growthPct,
                intensity,
              },
            };
          })
          .filter(Boolean),
      };
    },
    [availableSpots.length, searchDemandZones, syntheticDemandZones],
  );

  const buildSpotPopup = (spot, accentColor, mode) =>
    mode === 'action'
      ? buildSpotActionPopupHTML(t, isDark, spot, accentColor, null, 'spot', currency)
      : buildSpotPopupHTML(t, isDark, spot, nowMs, accentColor, currency);

  const buildParkingPopup = (parking, mode) =>
    mode === 'action'
      ? buildPublicParkingActionPopupHTML(t, isDark, parking, t('goThere', { defaultValue: 'Y aller' }), currency)
      : buildPublicParkingPopupHTML(t, isDark, parking, currency);

  const bindSpotPopupHandlers = (popup, spotId, spot, accentColor, options = {}) => {
    const {
      buildPopup = buildSpotPopup,
      onAction = handleReserveSpot,
      modeRef = popupModeRef,
      onModeChange,
      allowAction = true,
    } = options;
    const el = popup?.getElement?.();
    if (!el) {
      if (!popup.__bindOnOpen) {
        popup.__bindOnOpen = true;
        popup.once('open', () => {
          popup.__bindOnOpen = false;
          bindSpotPopupHandlers(popup, spotId, spot, accentColor, options);
        });
      }
      return;
    }
    const content = el.querySelector('.mapboxgl-popup-content');
    if (!content) {
      if (!popup.__bindOnOpen) {
        popup.__bindOnOpen = true;
        popup.once('open', () => {
          popup.__bindOnOpen = false;
          bindSpotPopupHandlers(popup, spotId, spot, accentColor, options);
        });
      }
      return;
    }
    content.style.pointerEvents = 'auto';
    const root = content.querySelector('[data-spot-popup-root],[data-parking-popup-root]');
    if (onModeChange) {
      const currentMode = modeRef.current.get(spotId) || 'info';
      onModeChange(currentMode);
    }

    popup.__popupHandlerState = {
      spotId,
      spot,
      accentColor,
      buildPopup,
      onAction,
      modeRef,
      onModeChange,
    };

    if (content && !popup.__popupDelegatedHandler) {
      popup.__popupDelegatedHandler = (event) => {
        const state = popup.__popupHandlerState;
        if (!state) return;
        const target = event?.target instanceof Element ? event.target : null;
        if (!target) return;

        const actionEl = target.closest('[data-spot-popup-action],[data-parking-popup-action]');
        if (actionEl) {
          event.preventDefault();
          event.stopPropagation();
          state.onAction?.(state.spot);
          return;
        }

        const rootEl = target.closest('[data-spot-popup-root],[data-parking-popup-root]');
        if (!rootEl) return;
        const rootMode =
          rootEl.getAttribute('data-spot-popup-root') || rootEl.getAttribute('data-parking-popup-root');
        if (rootMode === 'info') {
          event.preventDefault();
          event.stopPropagation();
          if (!allowAction) return;
          if (state.modeRef.current.get(state.spotId) === 'action') return;
          state.modeRef.current.set(state.spotId, 'action');
          state.onModeChange?.('action');
          const nextHtml = state.buildPopup(state.spot, state.accentColor, 'action');
          popup.setHTML(nextHtml);
          bindSpotPopupHandlers(popup, state.spotId, state.spot, state.accentColor, options);
          return;
        }

        const isParkingRoot = rootEl.hasAttribute?.('data-parking-popup-root');
        if (rootMode === 'action' && isParkingRoot) {
          event.preventDefault();
          event.stopPropagation();
          state.onAction?.(state.spot);
        }
      };
      content.addEventListener('click', popup.__popupDelegatedHandler);
    }

    if (root) {
      root.style.pointerEvents = 'auto';
    }
  };

  const buildParkingPopupForBind = (parking, _accent, mode) => buildParkingPopup(parking, mode);

  const registerSinglePopup = useCallback((popup) => {
    if (!popup || popup.__singlePopupRegistered) return;
    popup.__singlePopupRegistered = true;
    popup.on('open', () => {
      const current = activePopupRef.current;
      if (current && current !== popup) {
        current.__skipExitAnimation = true;
        current.remove();
      }
      activePopupRef.current = popup;
    });
    popup.on('close', () => {
      if (activePopupRef.current === popup) activePopupRef.current = null;
    });
  }, []);

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

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    showPublicParkingsRef.current = showPublicParkings;
    if (!showPublicParkings) {
      setPublicParkings([]);
      parkingFetchQueuedRef.current = null;
      lastParkingFetchRef.current = { at: 0, lat: null, lng: null };
    }
  }, [showPublicParkings]);

  useEffect(() => {
    if (!actionToast) return undefined;
    const id = window.setTimeout(() => setActionToast(''), 2200);
    return () => window.clearTimeout(id);
  }, [actionToast]);

  const fetchPublicParkings = useCallback(
    (center, { force = false } = {}) => {
      if (!showPublicParkingsRef.current) return;
      const safeLng = Number(center?.lng);
      const safeLat = Number(center?.lat);
      if (!center || !isValidCoord(safeLng, safeLat)) return;
      const now = Date.now();
      const last = lastParkingFetchRef.current;
      const moved = last.lat == null ? Infinity : getDistanceMetersBetween(last, { lng: safeLng, lat: safeLat });
      if (parkingFetchInFlightRef.current) {
        parkingFetchQueuedRef.current = { center: { lng: safeLng, lat: safeLat }, force };
        return;
      }
      if (!force && now - last.at < PARKING_FETCH_MIN_INTERVAL_MS && moved < PARKING_FETCH_MIN_DISTANCE_M) {
        return;
      }

      lastParkingFetchRef.current = { at: now, lat: safeLat, lng: safeLng };
      parkingFetchInFlightRef.current = true;
      setParkingLoading(true);
      fetchNearbyPublicParkings({
        lng: safeLng,
        lat: safeLat,
        radiusMeters: PARKING_FETCH_RADIUS_M,
        limit: 20,
      })
        .then((list) => {
          if (isMountedRef.current && showPublicParkingsRef.current) {
            setPublicParkings(list);
            saveParkingCache(safeLng, safeLat, list);
          }
        })
        .catch((err) => {
          if (!isMountedRef.current) return;
          console.error('[MapSearchView] parking fetch error:', err);
        })
        .finally(() => {
          parkingFetchInFlightRef.current = false;
          setParkingLoading(false);
          const queued = parkingFetchQueuedRef.current;
          if (queued) {
            parkingFetchQueuedRef.current = null;
            fetchPublicParkings(queued.center, { force: queued.force });
          }
        });
    },
    [],
  );

  const persistSearchPresence = useCallback(
    (center, { force = false } = {}) => {
      if (!currentUserId) return;
      const safeLng = Number(center?.lng);
      const safeLat = Number(center?.lat);
      if (!isValidCoord(safeLng, safeLat)) return;

      const zone = getDemandZone(safeLng, safeLat);
      const payload = {
        centerLng: safeLng,
        centerLat: safeLat,
        zoneId: zone.key,
        zoneLng: zone.lng,
        zoneLat: zone.lat,
        radiusKm: radius == null ? null : Number(radius),
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      };
      const signature = JSON.stringify([
        zone.key,
        Math.round(safeLng * 1000),
        Math.round(safeLat * 1000),
        radius == null ? 'any' : Number(radius).toFixed(1),
      ]);

      if (!force && lastSearchPresenceSignatureRef.current === signature) return;

      searchPresenceWriteQueuedRef.current = { payload, signature };

      const flush = async () => {
        if (searchPresenceWriteInFlightRef.current) return;
        searchPresenceWriteInFlightRef.current = true;
        try {
          while (searchPresenceWriteQueuedRef.current) {
            const next = searchPresenceWriteQueuedRef.current;
            searchPresenceWriteQueuedRef.current = null;
            try {
              const ref = doc(db, 'artifacts', appId, 'public', 'data', SEARCH_PRESENCE_COLLECTION, currentUserId);
              await setDoc(ref, next.payload, { merge: true });
              lastSearchPresenceSignatureRef.current = next.signature;
            } catch (err) {
              console.error('Error persisting search presence:', err);
              if (!searchPresenceWriteQueuedRef.current) searchPresenceWriteQueuedRef.current = next;
              break;
            }
          }
        } finally {
          searchPresenceWriteInFlightRef.current = false;
        }
      };

      void flush();
    },
    [currentUserId, radius],
  );

  const syncSearchDemandLayers = useCallback((map, data) => {
    if (!map) return;

    const demandColorExpression = [
      'interpolate',
      ['linear'],
      ['get', 'count'],
      1,
      '#ffd60a',
      5,
      '#ffb000',
      10,
      '#ff7a1a',
      15,
      '#ff5a36',
      20,
      '#ff3b30',
    ];
    const demandOpacityExpression = [
      'interpolate',
      ['linear'],
      ['get', 'count'],
      1,
      0.16,
      8,
      0.2,
      14,
      0.24,
      20,
      0.28,
    ];

    const existingSource = map.getSource(SEARCH_DEMAND_SOURCE_ID);
    if (!existingSource) {
      map.addSource(SEARCH_DEMAND_SOURCE_ID, {
        type: 'geojson',
        data,
      });
    } else {
      existingSource.setData(data);
    }

    if (!map.getLayer(SEARCH_DEMAND_GLOW_LAYER_ID)) {
      map.addLayer({
        id: SEARCH_DEMAND_GLOW_LAYER_ID,
        type: 'fill',
        source: SEARCH_DEMAND_SOURCE_ID,
        paint: {
          'fill-color': demandColorExpression,
          'fill-opacity': demandOpacityExpression,
          'fill-translate': [0, SEARCH_DEMAND_MARKER_TRANSLATE_Y],
          'fill-translate-anchor': 'viewport',
          'fill-emissive-strength': 1,
        },
      });
    }
    map.setPaintProperty(SEARCH_DEMAND_GLOW_LAYER_ID, 'fill-color', demandColorExpression);
    map.setPaintProperty(SEARCH_DEMAND_GLOW_LAYER_ID, 'fill-opacity', demandOpacityExpression);

    if (!map.getLayer(SEARCH_DEMAND_CORE_LAYER_ID)) {
      map.addLayer({
        id: SEARCH_DEMAND_CORE_LAYER_ID,
        type: 'line',
        source: SEARCH_DEMAND_SOURCE_ID,
        paint: {
          'line-color': demandColorExpression,
          'line-opacity': 0,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            ['+', 6, ['*', ['get', 'intensity'], 1.6]],
            14,
            ['+', 7.5, ['*', ['get', 'intensity'], 1.9]],
            17,
            ['+', 9, ['*', ['get', 'intensity'], 2.2]],
          ],
          'line-blur': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            4,
            14,
            5.5,
            17,
            7,
          ],
          'line-translate': [0, SEARCH_DEMAND_MARKER_TRANSLATE_Y],
          'line-translate-anchor': 'viewport',
          'line-emissive-strength': 1,
        },
      });
    }
    map.setPaintProperty(SEARCH_DEMAND_CORE_LAYER_ID, 'line-color', demandColorExpression);
  }, []);

  useEffect(() => {
    const ref = collection(db, 'artifacts', appId, 'public', 'data', SEARCH_PRESENCE_COLLECTION);
    const unsub = onSnapshot(
      ref,
      (snapshot) => {
        const now = Date.now();
        const grouped = new Map();
        const demandAnchors = availableSpots
          .filter((spot) => isValidCoord(Number(spot?.lng), Number(spot?.lat)))
          .map((spot) => ({
            id: String(spot.id || hostKeyForSpot(spot) || `${spot.lng}:${spot.lat}`),
            lng: Number(spot.lng),
            lat: Number(spot.lat),
          }));

        if (!demandAnchors.length) {
          setSearchDemandZones([]);
          return;
        }

        snapshot.forEach((entry) => {
          const data = entry.data() || {};
          const updatedAtMs = Number(data.updatedAtMs);
          const serverUpdatedAtMs = typeof data.updatedAt?.toMillis === 'function' ? data.updatedAt.toMillis() : null;
          const lastSeenMs = Number.isFinite(updatedAtMs) ? updatedAtMs : serverUpdatedAtMs;
          if (!Number.isFinite(lastSeenMs) || now - lastSeenMs > SEARCH_PRESENCE_STALE_MS) return;

          const fallbackLng = Number(data.centerLng);
          const fallbackLat = Number(data.centerLat);
          if (!isValidCoord(fallbackLng, fallbackLat)) return;

          let nearestAnchor = null;
          let nearestDistance = Infinity;
          demandAnchors.forEach((anchor) => {
            const distance = getDistanceMetersBetween(
              { lng: fallbackLng, lat: fallbackLat },
              { lng: anchor.lng, lat: anchor.lat },
            );
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestAnchor = anchor;
            }
          });

          if (!nearestAnchor || nearestDistance > SEARCH_DEMAND_SPOT_RADIUS_M) return;

          const freshness = 1 - clamp((now - lastSeenMs) / SEARCH_PRESENCE_STALE_MS, 0, 1);
          const weight = 0.35 + freshness * 0.65;
          const existing = grouped.get(nearestAnchor.id) || {
            key: nearestAnchor.id,
            lng: nearestAnchor.lng,
            lat: nearestAnchor.lat,
            count: 0,
            score: 0,
          };

          existing.count += 1;
          existing.score += weight;
          grouped.set(nearestAnchor.id, existing);
        });

        const rankedZones = [...grouped.values()]
          .sort((a, b) => b.score - a.score || b.count - a.count)
          .slice(0, SEARCH_DEMAND_MAX_VISIBLE_ZONES);

        if (!rankedZones.length) {
          setSearchDemandZones([]);
          return;
        }

        const weakestScore = Math.max(0.35, rankedZones[rankedZones.length - 1]?.score || 0.35);
        const redCount = Math.max(1, Math.ceil(rankedZones.length * 0.25));
        const orangeCount = rankedZones.length <= 1 ? 0 : Math.max(1, Math.ceil(rankedZones.length * 0.35));

        setSearchDemandZones(
          rankedZones.map((zone, index) => {
            const rawGrowthPct = Math.max(0, ((zone.score - weakestScore) / weakestScore) * 100);
            const rankPct = rankedZones.length === 1 ? 100 : ((rankedZones.length - index - 1) / (rankedZones.length - 1)) * 100;
            const growthPct = Math.round(Math.max(rawGrowthPct, rankPct));
            const level = index < redCount ? 'red' : index < redCount + orangeCount ? 'orange' : 'orange';
            const intensity = Number(clamp(1 - index / Math.max(2, rankedZones.length + 1), 0.35, 1).toFixed(3));

            return {
              ...zone,
              level,
              growthPct,
              intensity,
            };
          }),
        );
      },
      (err) => {
        console.error('Error reading search demand presence:', err);
      },
    );

    return () => unsub();
  }, [availableSpots]);

  useEffect(() => {
    if (!currentUserId) return undefined;

    return () => {
      lastSearchPresenceSignatureRef.current = '';
      searchPresenceWriteQueuedRef.current = null;
      void deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', SEARCH_PRESENCE_COLLECTION, currentUserId)).catch(() => {
        // ignore cleanup failures for stale-presence fallback
      });
    };
  }, [currentUserId]);

  useEffect(() => {
    const safeLng = Number(userCoords?.lng);
    const safeLat = Number(userCoords?.lat);
    if (!showPublicParkings || !userCoords || !isValidCoord(safeLng, safeLat)) {
      setPublicParkings([]);
      return undefined;
    }
    // Load from cache immediately
    const cached = loadParkingCache(safeLng, safeLat);
    if (cached) {
      setPublicParkings(cached);
    }
    // Then fetch fresh data
    fetchPublicParkings({ lng: safeLng, lat: safeLat });
    return undefined;
  }, [showPublicParkings, userCoords?.lng, userCoords?.lat, fetchPublicParkings]);

  useEffect(() => {
    if (!showPublicParkings || !mapLoaded || !mapRef.current) return;
    const center = mapRef.current.getCenter();
    // Load from cache if available
    const cached = loadParkingCache(center.lng, center.lat);
    if (cached) {
      setPublicParkings(cached);
    }
    fetchPublicParkings({ lng: center.lng, lat: center.lat }, { force: true });
  }, [showPublicParkings, mapLoaded, fetchPublicParkings]);

  const getSafeCenter = () => {
    if (userCoords && isValidCoord(userCoords.lng, userCoords.lat)) {
      return [userCoords.lng, userCoords.lat];
    }
    const first = filteredSpots.find((spot) => isValidCoord(spot?.lng, spot?.lat));
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
    const container = attachPersistentMapContainer(PERSISTENT_MAP_KEY, mapContainerRef.current);
    if (!container) return undefined;

    mapboxgl.accessToken = mapboxToken;
    const cachedMap = getPersistentMap(PERSISTENT_MAP_KEY);
    const map = cachedMap
      ? cachedMap
      : new mapboxgl.Map({
          container,
          style: 'mapbox://styles/louloupark/cmjb7kixg005z01qy4cztc9ce',
          center: getSafeCenter(),
          zoom: 14.5,
          pitch: 0,
          bearing: 0,
          antialias: true,
          interactive: true,
          attributionControl: false,
        });

    if (!cachedMap) {
      setPersistentMap(PERSISTENT_MAP_KEY, map);
    }

    mapRef.current = map;

    const handleStyleLoad = () => {
      applyDayNightPreset(map);
      patchSizerankInStyle(map);
      applyMapLabelLanguage(map, mapLabelLanguageRef.current);
    };
    const handleLoad = () => {
      setMapLoaded(true);
      map.resize();
    };
    const handleError = () => setMapLoaded(false);

    map.on('style.load', handleStyleLoad);
    map.on('error', handleError);
    applyDayNightPreset(map);
    if (map.loaded()) {
      handleLoad();
    } else {
      map.on('load', handleLoad);
    }

    return () => {
      map.off('style.load', handleStyleLoad);
      map.off('error', handleError);
      map.off('load', handleLoad);
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
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
    if (!mapLoaded || !mapRef.current || !currentUserId) return undefined;

    const map = mapRef.current;
    const publishPresence = (force = false) => {
      const center = map.getCenter();
      persistSearchPresence({ lng: center.lng, lat: center.lat }, { force });
    };

    publishPresence(true);

    const handleMoveEnd = () => publishPresence(false);
    const heartbeatId = window.setInterval(() => publishPresence(true), SEARCH_PRESENCE_HEARTBEAT_MS);

    map.on('moveend', handleMoveEnd);
    return () => {
      map.off('moveend', handleMoveEnd);
      window.clearInterval(heartbeatId);
    };
  }, [mapLoaded, currentUserId, persistSearchPresence]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return undefined;

    const map = mapRef.current;
    const applyLayers = () => syncSearchDemandLayers(map, searchDemandGeoJson);

    if (typeof map.isStyleLoaded === 'function' ? map.isStyleLoaded() : false) {
      applyLayers();
    } else {
      map.once('style.load', applyLayers);
    }

    map.on('style.load', applyLayers);
    return () => {
      map.off('style.load', applyLayers);
    };
  }, [mapLoaded, searchDemandGeoJson, syncSearchDemandLayers]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !showPublicParkings) return;
    const map = mapRef.current;
    let pending = null;
    const scheduleFetch = (force = false) => {
      if (pending) window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        const center = map.getCenter();
        fetchPublicParkings({ lng: center.lng, lat: center.lat }, { force });
      }, 120);
    };
    const handleMoveEnd = () => scheduleFetch(false);
    const handleZoomEnd = () => {
      const zoom = map.getZoom();
      const prevZoom = lastParkingZoomRef.current;
      lastParkingZoomRef.current = zoom;
      const zoomedOut = prevZoom != null && zoom < prevZoom - 0.05;
      scheduleFetch(zoomedOut);
    };
    lastParkingZoomRef.current = map.getZoom();
    map.on('moveend', handleMoveEnd);
    map.on('zoomend', handleZoomEnd);
    return () => {
      map.off('moveend', handleMoveEnd);
      map.off('zoomend', handleZoomEnd);
      if (pending) window.clearTimeout(pending);
    };
  }, [mapLoaded, fetchPublicParkings]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const nextIds = new Set();
    displaySpots.forEach((spot, idx) => {
      const lng = Number(spot?.lng);
      const lat = Number(spot?.lat);
      if (!isValidCoord(lng, lat)) return;
      const id = getSpotMarkerId(spot, idx);
      nextIds.add(id);
      const displayPos = spreadPositions.get(id) || { lng, lat };
      const hostKey = hostKeyForSpot(spot);
      const accentColor =
        (hostKey ? popupAccentByHost.get(hostKey) : null) || colorForSpot(spot, colorSaltRef.current);
      const popupMode = popupModeRef.current.get(id) || 'info';
      const popupHtml = buildSpotPopup(spot, accentColor, popupMode);
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
        registerSinglePopup(popup);
        popup.on('close', () => {
          popupModeRef.current.delete(id);
        });
        bindSpotPopupHandlers(popup, id, spot, accentColor, {
          allowAction: !spot?.syntheticPreview,
          onAction: spot?.syntheticPreview ? () => {} : handleReserveSpot,
        });
        const marker = new mapboxgl.Marker({
          element: el,
          rotationAlignment: 'viewport',
          pitchAlignment: 'viewport',
          anchor: 'bottom',
        })
          .setLngLat([displayPos.lng, displayPos.lat])
          .setPopup(popup)
          .addTo(mapRef.current);
        markersRef.current.set(id, marker);
      } else {
        const marker = markersRef.current.get(id);
        marker.setLngLat([displayPos.lng, displayPos.lat]);
        const popup = marker.getPopup();
        if (popup) {
          enhancePopupAnimation(popup);
          registerSinglePopup(popup);
          popup.setHTML(popupHtml);
          bindSpotPopupHandlers(popup, id, spot, accentColor, {
            allowAction: !spot?.syntheticPreview,
            onAction: spot?.syntheticPreview ? () => {} : handleReserveSpot,
          });
        }
      }
    });
    for (const [id, marker] of markersRef.current.entries()) {
      if (!nextIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
        popupModeRef.current.delete(id);
      }
    }
  }, [mapLoaded, displaySpots, spreadPositions, popupAccentByHost, isDark, t, nowMs]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const nextIds = new Set();
    const maxRadiusMeters = radius == null ? PARKING_FETCH_RADIUS_M : Number(radius) * 1000;
    const maxPrice = priceMax == null ? null : Number(priceMax);
    const setParkingMarkerInverted = (container, inner, inverted) => {
      if (!container || !inner) return;
      if (inverted) {
        inner.style.background = '#3b82f6';
        inner.style.border = '1px solid #3b82f6';
        inner.style.color = '#ffffff';
        inner.style.textShadow = '0 6px 14px rgba(0,0,0,0.35)';
      } else {
        inner.style.background = 'rgba(255,255,255,0.82)';
        inner.style.border = '1px solid rgba(255,255,255,0.9)';
        inner.style.color = '#3b82f6';
        inner.style.textShadow = '0 6px 14px rgba(59,130,246,0.45)';
      }
    };
    const bindParkingPopupToMarker = (popup, markerEl, markerInner, popupId) => {
      if (!popup || popup.__parkingColorBound) return;
      popup.__parkingColorBound = true;
      popup.on('open', () => {
        const mode = parkingPopupModeRef.current.get(popupId) || 'info';
        setParkingMarkerInverted(markerEl, markerInner, mode === 'info');
      });
      popup.on('close', () => {
        setParkingMarkerInverted(markerEl, markerInner, false);
      });
    };

    publicParkings.forEach((parking) => {
      const distanceMeters = Number(parking?.distanceMeters);
      if (maxRadiusMeters != null && Number.isFinite(distanceMeters) && distanceMeters > maxRadiusMeters) return;
      if (maxPrice != null) {
        const price = Number(parking?.tarif1h);
        if (Number.isFinite(price) && price > maxPrice) return;
      }
      const lng = Number(parking?.lng);
      const lat = Number(parking?.lat);
      if (!isValidCoord(lng, lat)) return;
      const id = parking?.id || `${lng}:${lat}`;
      nextIds.add(id);
      const popupMode = parkingPopupModeRef.current.get(id) || 'info';
      const popupHtml = buildParkingPopup(parking, popupMode);

      if (!parkingMarkersRef.current.has(id)) {
        const markerSize = 30;
        const el = document.createElement('div');
        el.style.width = `${markerSize}px`;
        el.style.height = `${markerSize}px`;
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
        el.style.userSelect = 'none';
        el.style.perspective = '800px';
        el.style.transformStyle = 'preserve-3d';

        const inner = document.createElement('div');
        inner.style.width = `${markerSize}px`;
        inner.style.height = `${markerSize}px`;
        inner.style.borderRadius = '999px';
        inner.style.background = 'rgba(255,255,255,0.82)';
        inner.style.border = '1px solid rgba(255,255,255,0.9)';
        inner.style.boxShadow = '0 8px 18px rgba(15, 23, 42, 0.22)';
        inner.style.display = 'flex';
        inner.style.alignItems = 'center';
        inner.style.justifyContent = 'center';
        inner.style.fontSize = '20px';
        inner.style.fontWeight = '900';
        inner.style.color = '#3b82f6';
        inner.style.textShadow = '0 6px 14px rgba(59,130,246,0.45)';
        inner.style.pointerEvents = 'none';
        inner.textContent = 'P';
        el.appendChild(inner);
        setParkingMarkerInverted(el, inner, false);

        const popup = new mapboxgl.Popup({ offset: 18, closeButton: false, className: 'user-presence-popup' }).setHTML(
          popupHtml,
        );
        enhancePopupAnimation(popup);
        registerSinglePopup(popup);
        bindParkingPopupToMarker(popup, el, inner, id);
        popup.on('close', () => {
          parkingPopupModeRef.current.delete(id);
        });
        bindSpotPopupHandlers(popup, id, parking, null, {
          buildPopup: buildParkingPopupForBind,
          onAction: handleGoToParking,
          modeRef: parkingPopupModeRef,
          onModeChange: (mode) => setParkingMarkerInverted(el, inner, mode === 'info'),
        });
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map);
        marker.__parkingData = parking;
        const clickHandler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentPopup = marker.getPopup();
          const currentParking = marker.__parkingData || parking;
          if (currentPopup && !currentPopup.isOpen()) {
            parkingPopupModeRef.current.set(id, 'info');
            currentPopup.setHTML(buildParkingPopup(currentParking, 'info'));
            bindSpotPopupHandlers(currentPopup, id, currentParking, null, {
              buildPopup: buildParkingPopupForBind,
              onAction: handleGoToParking,
              modeRef: parkingPopupModeRef,
              onModeChange: (mode) => setParkingMarkerInverted(el, inner, mode === 'info'),
            });
          }
          marker.togglePopup();
          if (!marker.getPopup()?.isOpen?.()) {
            setParkingMarkerInverted(el, inner, false);
          }
        };
        el.__parkingClickHandler = clickHandler;
        el.addEventListener('click', clickHandler);
        parkingMarkersRef.current.set(id, marker);
      } else {
        const marker = parkingMarkersRef.current.get(id);
        marker.setLngLat([lng, lat]);
        marker.__parkingData = parking;
        const markerEl = marker.getElement?.();
        const markerInner = markerEl?.firstChild;
        const popup = marker.getPopup();
        if (popup) {
          enhancePopupAnimation(popup);
          registerSinglePopup(popup);
          bindParkingPopupToMarker(popup, markerEl, markerInner, id);
          popup.setHTML(popupHtml);
          bindSpotPopupHandlers(popup, id, parking, null, {
            buildPopup: buildParkingPopupForBind,
            onAction: handleGoToParking,
            modeRef: parkingPopupModeRef,
            onModeChange: (mode) => setParkingMarkerInverted(markerEl, markerInner, mode === 'info'),
          });
        } else {
          const nextPopup = new mapboxgl.Popup({
            offset: 18,
            closeButton: false,
            className: 'user-presence-popup',
          }).setHTML(popupHtml);
          enhancePopupAnimation(nextPopup);
          registerSinglePopup(nextPopup);
          bindParkingPopupToMarker(nextPopup, markerEl, markerInner, id);
          nextPopup.on('close', () => {
            parkingPopupModeRef.current.delete(id);
          });
          bindSpotPopupHandlers(nextPopup, id, parking, null, {
            buildPopup: buildParkingPopupForBind,
            onAction: handleGoToParking,
            modeRef: parkingPopupModeRef,
            onModeChange: (mode) => setParkingMarkerInverted(markerEl, markerInner, mode === 'info'),
          });
          marker.setPopup(nextPopup);
        }
      }
    });

    for (const [id, marker] of parkingMarkersRef.current.entries()) {
      if (!nextIds.has(id)) {
        const el = marker.getElement?.();
        if (el && el.__parkingClickHandler) {
          el.removeEventListener('click', el.__parkingClickHandler);
          delete el.__parkingClickHandler;
        }
        marker.remove();
        parkingMarkersRef.current.delete(id);
        parkingPopupModeRef.current.delete(id);
      }
    }
  }, [mapLoaded, publicParkings, isDark, t, radius, priceMax]);

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
        registerSinglePopup(popup);
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
    <div ref={viewRef} className="fixed inset-0 z-[60]">
      <PopUpUsersStyles />
      <style>{`
        @keyframes searchSpotPulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 6px rgba(34,197,94,0.18); }
          50% { transform: translate(-50%, -50%) scale(1.08); box-shadow: 0 0 0 10px rgba(34,197,94,0.08); }
        }
      `}</style>
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
      {parkingLoading && publicParkings.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-[70]">
          <div className="bg-white rounded-full p-4 shadow-lg">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
          </div>
        </div>
      )}
      {mapLoaded && userCoords && isValidCoord(userCoords.lng, userCoords.lat) && (
        <div
          className="absolute z-[80] pointer-events-auto"
          style={{
            right: bottomNavEdgeOffset,
            bottom: 'calc(env(safe-area-inset-bottom) + 96px + 16px)',
          }}
        >
          <button
            type="button"
            aria-label="Recenter on me"
            onClick={() => {
              if (!mapRef.current) return;
              mapRef.current.easeTo({
                center: [userCoords.lng, userCoords.lat],
                duration: 800,
                pitch: 0,
                zoom: 15.2,
                bearing: 0,
                essential: true,
              });
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
      {actionToast ? (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-[130] pointer-events-none"
          style={{ top: 'var(--top-toast-offset)' }}
        >
          <div className="bg-black/80 text-white px-4 py-2 rounded-full text-sm shadow-lg">
            {actionToast}
          </div>
        </div>
      ) : null}
      <div className="absolute inset-0 z-[120] pointer-events-none">
        <div
          className={`absolute inset-0 transition-opacity duration-200 ${
            showRadiusPicker ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onClick={() => setShowRadiusPicker(false)}
        />
        <div
          ref={filtersPanelRef}
          className={`absolute left-6 right-6 transition-all duration-200 origin-top ${
            showRadiusPicker ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-90 pointer-events-none'
          }`}
          style={{ top: filtersPanelTopPx == null ? 'var(--top-panel-offset)' : `${filtersPanelTopPx}px` }}
        >
          <div className="flex flex-col space-y-4">
            <div className="bg-white p-5 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 relative overflow-hidden group">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 [@media(hover:hover)]:group-hover:scale-105">
                    <span className="text-lg font-bold">↔</span>
                  </div>
                  <label className="text-gray-600 font-semibold text-[15px] tracking-wide">
                    {t('searchRadius', 'Search radius')}
                  </label>
                </div>

                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold text-gray-900 tracking-tight font-sans">
                    {radius == null ? anyLabel : radius.toFixed(1)}
                  </span>
                  <span className="text-sm font-bold text-gray-400 uppercase tracking-wider translate-y-[-2px]">
                    {radius == null ? '' : 'km'}
                  </span>
                </div>
              </div>

              <div className="relative h-10 flex items-center px-1">
                <input
                  ref={radiusSliderRef}
                  type="range"
                  min={RADIUS_MIN_KM}
                  max={RADIUS_MAX_KM}
                  step="0.1"
                  value={radius == null ? RADIUS_MAX_KM : radius}
                  onPointerDown={(e) =>
                    startRangeDrag(e, radiusSliderRef, RADIUS_MIN_KM, RADIUS_MAX_KM, 0.1, setRadiusFromRange)
                  }
                  onChange={(e) => setRadiusFromRange(parseFloat(e.target.value))}
                  style={{
                    backgroundSize: `${
                      ((Number((radius == null ? RADIUS_MAX_KM : radius)) - RADIUS_MIN_KM) * 100) /
                      (RADIUS_MAX_KM - RADIUS_MIN_KM)
                    }% 100%`,
                  }}
                  className="
                    relative w-full h-2.5 bg-gray-100 rounded-full appearance-none cursor-pointer touch-none
                    bg-[image:linear-gradient(to_right,#f97316,#f97316)] bg-no-repeat
                    focus:outline-none focus:ring-0

                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-7
                    [&::-webkit-slider-thumb]:h-7
                    [&::-webkit-slider-thumb]:bg-white
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:shadow-[0_4px_12px_rgba(0,0,0,0.15),0_0_0_1px_rgba(0,0,0,0.05)]
                    [&::-webkit-slider-thumb]:border-0
                    [&::-webkit-slider-thumb]:transition-transform
                    [&::-webkit-slider-thumb]:duration-150
                    [&::-webkit-slider-thumb]:ease-out
                    [&::-webkit-slider-thumb]:hover:scale-110
                    [&::-webkit-slider-thumb]:active:scale-95
                  "
                />
                <div className={`absolute top-8 text-[11px] font-semibold text-gray-300 pointer-events-none select-none ${isRtl ? 'right-1' : 'left-1'}`}>
                  100 m
                </div>
                <div className={`absolute top-8 text-[11px] font-semibold text-gray-300 pointer-events-none select-none ${isRtl ? 'left-1' : 'right-1'}`}>
                  {anyLabel}
                </div>
              </div>
            </div>

            {SHOW_PRICES && (
              <div className="bg-white p-5 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 relative overflow-hidden group">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 [@media(hover:hover)]:group-hover:scale-105">
                      <span className="text-lg font-bold">{currencySymbol}</span>
                    </div>
                    <label className="text-gray-600 font-semibold text-[15px] tracking-wide">
                      {t('priceFilter', { defaultValue: 'Max price' })}
                    </label>
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold text-gray-900 tracking-tight font-sans">
                      {priceMax == null ? anyLabel : formatEuro(priceMax, currency)}
                    </span>
                    <span className="text-sm font-bold text-gray-400 uppercase tracking-wider translate-y-[-2px]">
                      {priceMax == null ? '' : currencySymbol}
                    </span>
                  </div>
                </div>

                <div className="relative h-10 flex items-center px-1">
                  <input
                    ref={priceSliderRef}
                    type="range"
                    min="0"
                    max={maxSpotPrice}
                    step="0.5"
                    value={priceMax == null ? maxSpotPrice : Math.min(priceMax, maxSpotPrice)}
                    onPointerDown={(e) => startRangeDrag(e, priceSliderRef, 0, maxSpotPrice, 0.5, setPriceMaxFromRange)}
                    onChange={(e) => setPriceMaxFromRange(parseFloat(e.target.value))}
                    style={{
                      backgroundSize: `${
                        ((Number(priceMax == null ? maxSpotPrice : Math.min(priceMax, maxSpotPrice)) - 0) * 100) /
                        Math.max(1, maxSpotPrice)
                      }% 100%`,
                    }}
                    className="
                      relative w-full h-2.5 bg-gray-100 rounded-full appearance-none cursor-pointer touch-none
                      bg-[image:linear-gradient(to_right,#f97316,#f97316)] bg-no-repeat
                      focus:outline-none focus:ring-0

                      [&::-webkit-slider-thumb]:appearance-none
                      [&::-webkit-slider-thumb]:w-7
                      [&::-webkit-slider-thumb]:h-7
                      [&::-webkit-slider-thumb]:bg-white
                      [&::-webkit-slider-thumb]:rounded-full
                      [&::-webkit-slider-thumb]:shadow-[0_4px_12px_rgba(0,0,0,0.15),0_0_0_1px_rgba(0,0,0,0.05)]
                      [&::-webkit-slider-thumb]:border-0
                      [&::-webkit-slider-thumb]:transition-transform
                      [&::-webkit-slider-thumb]:duration-150
                      [&::-webkit-slider-thumb]:ease-out
                      [&::-webkit-slider-thumb]:hover:scale-110
                      [&::-webkit-slider-thumb]:active:scale-95
                    "
                  />
                  <div className={`absolute top-8 text-[11px] font-semibold text-gray-300 pointer-events-none select-none ${isRtl ? 'right-1' : 'left-1'}`}>
                    {`0 ${currencySymbol}`}
                  </div>
                  <div className={`absolute top-8 text-[11px] font-semibold text-gray-300 pointer-events-none select-none ${isRtl ? 'left-1' : 'right-1'}`}>
                    {`${formatEuro(maxSpotPrice, currency)} ${currencySymbol}`}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {!mapboxToken && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
          Missing Mapbox Token
        </div>
      )}
      <div
        className="absolute left-0 right-0 z-30 px-6 pt-5 pb-2 pointer-events-auto"
        style={{ top: 'env(safe-area-inset-top)' }}
      >
       <div className={`flex items-center ${isRtl ? 'justify-start' : 'justify-end'}`}>
  <button
    type="button"
    ref={filtersButtonRef}
    onClick={() => setShowRadiusPicker((s) => !s)}
    className={`text-sm font-semibold rounded-full px-3 py-1 border shadow-sm transition flex flex-col leading-tight gap-0.5 relative ${isRtl ? 'items-start text-right' : 'items-end text-left'} ${
      isDark
        ? 'text-slate-100 bg-slate-900/80 border-white/10 hover:bg-slate-800'
        : 'text-slate-900 bg-white/70 border-white/60 hover:bg-white'
    }`}
    style={{ backdropFilter: 'blur(14px) saturate(180%)', WebkitBackdropFilter: 'blur(14px) saturate(180%)' }}
  >
    {/* KM (texte simple, disparaît quand panel ouvert) */}
    <span
      className={`block leading-tight font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}
    >
      {radius == null ? anyLabel : `${radius.toFixed(1)} km`}
    </span>

    {/* PRIX */}
    <span
      className={`block leading-tight font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}
    >
      {priceMax == null ? anyLabel : `${formatEuro(priceMax, currency)} ${currencySymbol}`}
    </span>
  </button>
</div>
      </div>
    </div>
  );
};

export default MapSearchView;
