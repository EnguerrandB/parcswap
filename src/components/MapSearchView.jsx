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
import { patchSizerankInStyle } from '../utils/mapboxStylePatch';
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
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

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

const formatEuro = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)).replace(/\.00$/, '');
};

const normalizeParkingText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const extractTimeRanges = (raw) => {
  const text = String(raw || '');
  const matches = [...text.matchAll(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/gi)];
  const minutes = matches
    .map((match) => {
      const hour = Number(match[1]);
      const min = match[2] ? Number(match[2]) : 0;
      if (!Number.isFinite(hour) || hour < 0 || hour > 24) return null;
      if (!Number.isFinite(min) || min < 0 || min > 59) return null;
      return hour === 24 ? 24 * 60 : hour * 60 + min;
    })
    .filter((value) => value != null);
  const ranges = [];
  for (let i = 0; i + 1 < minutes.length; i += 2) {
    ranges.push([minutes[i], minutes[i + 1]]);
  }
  return ranges;
};

const isParkingOpenNow = (record, now = new Date()) => {
  if (!record) return false;
  const raw = record?.horaire_na ?? record?.horaire ?? record?.horaires ?? '';
  const text = normalizeParkingText(raw);
  if (!text) return false;
  if (text.includes('ferme') || text.includes('fermee')) return false;
  if (text.includes('24h') || text.includes('24 h') || text.includes('24/24')) return true;

  const ranges = extractTimeRanges(text);
  if (!ranges.length) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return ranges.some(([start, end]) => {
    if (start == null || end == null) return false;
    if (start === end) return false;
    if (end > start) return nowMinutes >= start && nowMinutes <= end;
    return nowMinutes >= start || nowMinutes <= end;
  });
};

const isResidentOnlyParking = (record) => {
  if (!record) return false;
  const type = normalizeParkingText(record?.type_usagers ?? record?.type_usager ?? '');
  const hours = normalizeParkingText(record?.horaire_na ?? '');
  const info = normalizeParkingText(
    Array.isArray(record?.info) ? record.info.join(' ') : record?.info ?? '',
  );
  const isPublic =
    type.includes('tous') || type.includes('public') || type.includes('visiteur') || type.includes('visitor');
  if (isPublic) return false;
  if (type.includes('abonn') || type.includes('resident')) return true;
  if (hours.includes('abonn')) return true;
  if (info.includes('abonn')) return true;
  return false;
};

const toNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  userCoords = null,
  currentUserId = null,
  showPublicParkings = true,
  onBookSpot,
  onSelectionStep,
  setSelectedSpot,
  premiumParks = 0,
  onFiltersOpenChange,
}) => {
  const { t } = useTranslation('common');
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
  const isMountedRef = useRef(true);
  const lastParkingFetchRef = useRef({ at: 0, lat: null, lng: null });
  const lastParkingZoomRef = useRef(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [mapLoaded, setMapLoaded] = useState(false);
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
  const [publicParkings, setPublicParkings] = useState([]);
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
  const premiumParksCount = Number.isFinite(Number(premiumParks)) ? Number(premiumParks) : 0;
  const canAcceptFreeSpot = premiumParksCount > 0;
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
      } else if (bookRes.code === 'spot_not_available') {
        setActionToast(t('spotNotAvailable', { defaultValue: 'Spot no longer available.' }));
      } else {
        setActionToast(t('somethingWentWrong', { defaultValue: 'Something went wrong.' }));
      }
      return;
    }
    const resolvedSessionId = bookRes?.bookingSessionId || bookingSessionId;
    const navRes = await onSelectionStep?.('nav_started', spotWithSession, {
      bookingSessionId: resolvedSessionId,
      opId: newId(),
    });
    if (navRes && navRes.ok === false) {
      if (navRes.code === 'no_premium_parks') {
        showPremiumToast();
      } else if (navRes.code === 'spot_not_booked') {
        setActionToast(t('spotNotReady', { defaultValue: 'Just a sec…' }));
      } else {
        setActionToast(t('somethingWentWrong', { defaultValue: 'Something went wrong.' }));
      }
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
        const nextPriceMax = data.priceMax == null ? null : Number(data.priceMax);

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

    const safeRadius =
      radius == null
        ? null
        : Math.max(RADIUS_MIN_KM, Math.min(RADIUS_MAX_KM, Number(radius) || DEFAULT_RADIUS_KM));
    const safePriceMax = priceMax == null ? null : Number(priceMax);

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
  const spreadPositions = useMemo(() => spreadSpotPositions(filteredSpots), [filteredSpots]);

  const buildSpotPopup = (spot, accentColor, mode) =>
    mode === 'action'
      ? buildSpotActionPopupHTML(t, isDark, spot, accentColor)
      : buildSpotPopupHTML(t, isDark, spot, nowMs, accentColor);

  const buildParkingPopup = (parking, mode) =>
    mode === 'action'
      ? buildPublicParkingActionPopupHTML(t, isDark, parking, t('goThere', { defaultValue: 'Y aller' }))
      : buildPublicParkingPopupHTML(t, isDark, parking);

  const bindSpotPopupHandlers = (popup, spotId, spot, accentColor, options = {}) => {
    const {
      buildPopup = buildSpotPopup,
      onAction = handleReserveSpot,
      modeRef = popupModeRef,
      onModeChange,
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
      const params = new URLSearchParams();
      params.set(
        'where',
        `distance(geo_point_2d, geom'POINT(${safeLng} ${safeLat})', ${PARKING_FETCH_RADIUS_M}m)`,
      );
      params.set(
        'order_by',
        `distance(geo_point_2d, geom'POINT(${safeLng} ${safeLat})')`,
      );
      params.set('limit', '20');
      const url = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/stationnement-en-ouvrage/records?${params.toString()}`;

      fetch(url, { mode: 'cors', credentials: 'omit' })
        .then((res) => {
          if (!res.ok) throw new Error(`parking_fetch_${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (!isMountedRef.current || !showPublicParkingsRef.current) return;
          const raw = Array.isArray(data?.results) ? data.results : Array.isArray(data?.records) ? data.records : [];
          const next = [];
          raw.forEach((row, idx) => {
            const record = row?.fields ?? row;
            if (!record) return;
            if (isResidentOnlyParking(record)) return;
            if (!isParkingOpenNow(record)) return;
            const id = row?.recordid || record?.recordid || record?.id || `parking-${idx}`;
            const shape = record?.geo_shape || record?.geometry || null;
            let lng = null;
            let lat = null;
            if (shape?.type === 'Point' && Array.isArray(shape.coordinates)) {
              [lng, lat] = shape.coordinates;
            } else if (Array.isArray(shape?.coordinates) && typeof shape.coordinates[0] === 'number') {
              [lng, lat] = shape.coordinates;
            } else if (shape?.geometry?.type === 'Point' && Array.isArray(shape.geometry.coordinates)) {
              [lng, lat] = shape.geometry.coordinates;
            }
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
              const point = record?.geo_point_2d || record?.geo_point || null;
              const parsePointArray = (arr) => {
                if (!Array.isArray(arr) || arr.length < 2) return null;
                const a = Number(arr[0]);
                const b = Number(arr[1]);
                if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
                const cand1 = { lat: a, lng: b };
                const cand2 = { lat: b, lng: a };
                const d1 = getDistanceMetersBetween(cand1, { lat: safeLat, lng: safeLng });
                const d2 = getDistanceMetersBetween(cand2, { lat: safeLat, lng: safeLng });
                return d1 <= d2 ? cand1 : cand2;
              };
              if (Array.isArray(point)) {
                const picked = parsePointArray(point);
                if (picked) {
                  lat = picked.lat;
                  lng = picked.lng;
                }
              } else if (typeof point === 'string') {
                const parts = point.split(/[,\s]+/).filter(Boolean).map((v) => Number(v));
                const picked = parsePointArray(parts);
                if (picked) {
                  lat = picked.lat;
                  lng = picked.lng;
                }
              } else if (point && typeof point === 'object') {
                lat = Number(point.lat ?? point.latitude ?? point.y);
                lng = Number(point.lon ?? point.lng ?? point.longitude ?? point.x);
              }
            }
            const parsedLng = Number(lng);
            const parsedLat = Number(lat);
            if (!isValidCoord(parsedLng, parsedLat)) return;
            const name = record?.nom || record?.name || record?.nom_parc || '';
            const address =
              record?.adresse ||
              (Array.isArray(record?.adress_geo_entrees) ? record.adress_geo_entrees[0] : record?.adress_geo_entrees) ||
              record?.adress ||
              '';
            const distanceMeters = getDistanceMetersBetween(
              { lng: safeLng, lat: safeLat },
              { lng: parsedLng, lat: parsedLat },
            );
            next.push({
              id,
              lng: parsedLng,
              lat: parsedLat,
              name,
              address,
              distanceMeters,
              typeUsagers: record?.type_usagers ?? record?.type_usager ?? '',
              hours: record?.horaire_na ?? '',
              heightMaxCm: toNumberOrNull(record?.hauteur_max),
              tarif1h: toNumberOrNull(record?.tarif_1h),
              tarif2h: toNumberOrNull(record?.tarif_2h),
              tarif24h: toNumberOrNull(record?.tarif_24h),
              nbPlaces: toNumberOrNull(record?.nb_places),
              nbPmr: toNumberOrNull(record?.nb_pmr),
              nbEv: toNumberOrNull(record?.nb_voitures_electriques),
              url: record?.url ?? '',
              phone: record?.tel ?? '',
            });
          });

          const unique = new Map();
          next.forEach((item) => {
            if (!unique.has(item.id)) unique.set(item.id, item);
          });
          const list = Array.from(unique.values());
          if (isMountedRef.current && showPublicParkingsRef.current) {
            setPublicParkings(list);
          }
        })
        .catch((err) => {
          if (!isMountedRef.current) return;
          console.error('[MapSearchView] parking fetch error:', err);
        })
        .finally(() => {
          parkingFetchInFlightRef.current = false;
          const queued = parkingFetchQueuedRef.current;
          if (queued) {
            parkingFetchQueuedRef.current = null;
            fetchPublicParkings(queued.center, { force: queued.force });
          }
        });
    },
    [],
  );

  useEffect(() => {
    const safeLng = Number(userCoords?.lng);
    const safeLat = Number(userCoords?.lat);
    if (!showPublicParkings || !userCoords || !isValidCoord(safeLng, safeLat)) {
      setPublicParkings([]);
      return undefined;
    }
    fetchPublicParkings({ lng: safeLng, lat: safeLat });
    return undefined;
  }, [showPublicParkings, userCoords?.lng, userCoords?.lat, fetchPublicParkings]);

  useEffect(() => {
    if (!showPublicParkings || !mapLoaded || !mapRef.current) return;
    const center = mapRef.current.getCenter();
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
    filteredSpots.forEach((spot, idx) => {
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
        bindSpotPopupHandlers(popup, id, spot, accentColor);
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
          bindSpotPopupHandlers(popup, id, spot, accentColor);
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
  }, [mapLoaded, filteredSpots, spreadPositions, popupAccentByHost, isDark, t, nowMs]);

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
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[130] pointer-events-none">
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
          style={{ top: filtersPanelTopPx == null ? 'calc(64px + 50px)' : `${filtersPanelTopPx}px` }}
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
                <div className="absolute top-8 left-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
                  100 m
                </div>
                <div className="absolute top-8 right-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
                  {anyLabel}
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 relative overflow-hidden group">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 [@media(hover:hover)]:group-hover:scale-105">
                    <span className="text-lg font-bold">€</span>
                  </div>
                  <label className="text-gray-600 font-semibold text-[15px] tracking-wide">
                    {t('priceFilter', { defaultValue: 'Max price' })}
                  </label>
                </div>

                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold text-gray-900 tracking-tight font-sans">
                    {priceMax == null ? anyLabel : formatEuro(priceMax)}
                  </span>
                  <span className="text-sm font-bold text-gray-400 uppercase tracking-wider translate-y-[-2px]">
                    {priceMax == null ? '' : '€'}
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
                <div className="absolute top-8 left-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
                  0 €
                </div>
                <div className="absolute top-8 right-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
                  {formatEuro(maxSpotPrice)} €
                </div>
              </div>
            </div>
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
       <div className="flex items-center justify-end">
  <button
    type="button"
    ref={filtersButtonRef}
    onClick={() => setShowRadiusPicker((s) => !s)}
    className={`text-sm font-semibold rounded-full px-3 py-1 border shadow-sm transition flex flex-col items-end leading-tight gap-0.5 relative ${
      isDark
        ? 'text-slate-50 bg-slate-800/80 border-white/10 hover:bg-slate-800'
        : 'text-slate-900 bg-white/70 border-white/60 hover:bg-white'
    }`}
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
      {priceMax == null ? anyLabel : `${formatEuro(priceMax)} €`}
    </span>
  </button>
</div>
      </div>
    </div>
  );
};

export default MapSearchView;
