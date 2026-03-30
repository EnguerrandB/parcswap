// src/views/SearchView.jsx
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MapPin, Bell, WifiOff, Wifi, Euro } from 'lucide-react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { appId, db } from '../firebase';
import SafeView from '../components/SafeView';
import useConnectionQuality from '../hooks/useConnectionQuality';
import useFiltersAnimation from '../hooks/useFiltersAnimation';
import { newId } from '../utils/ids';
import { fetchNearbyPublicParkings } from '../utils/publicParkingApi';
import { formatCurrencyAmount, formatCurrencyNumber, getCurrencySymbol } from '../utils/currency';
import { buildCurrentShareUrl, shareContent } from '../utils/mobile';
import {
  CARD_COLOR_SALT,
  colorForSpot,
  colorsForOrderedSpots,
  getCreatedMs,
  isFreeSpot,
  uniqueSpotsByHost,
} from '../utils/spotColors';

// --- UTILITAIRES ---
const CARD_EXIT_ROTATION = 90; // degrés d'arc pour l'animation de sortie
const CAR_EMOJIS = ['🚗', '🚙', '🏎️', '🚕', '🚚', '🚓', '🛺', '🚜'];
const getDistanceMeters = (spot, userPosition = null) => {
  if (!spot) return Infinity;
  if (userPosition && spot.lat != null && spot.lng != null) {
    const R = 6371e3; // meters
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
  // If missing, treat as very close so it shows up
  return 0;
};
const formatDistance = (m) => {
  if (!Number.isFinite(m)) return '> 1 km';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
};
const getRemainingMs = (spot, nowMs = Date.now()) => {
  if (!spot) return null;
  const { createdAt, time } = spot;
  if (time == null) return null;

  let createdMs = null;
  if (createdAt?.toMillis) {
    createdMs = createdAt.toMillis();
  } else if (typeof createdAt === 'number') {
    createdMs = createdAt;
  } else if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    createdMs = Number.isNaN(parsed) ? null : parsed;
  }
  if (!createdMs) return null;

  const remainingMs = createdMs + Number(time) * 60_000 - nowMs;
  return remainingMs;
};

const formatDuration = (ms) => {
  if (ms == null) return null;
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const RADIUS_MIN_KM = 0;
const RADIUS_MAX_KM = 2;
const DEFAULT_RADIUS_KM = 2;
const PARKING_FETCH_MIN_INTERVAL_MS = 60_000;
const PARKING_FETCH_MIN_DISTANCE_M = 250;
const PARKING_FETCH_RADIUS_M = 2000;

const isValidCoord = (lng, lat) =>
  typeof lng === 'number' &&
  typeof lat === 'number' &&
  !Number.isNaN(lng) &&
  !Number.isNaN(lat) &&
  Math.abs(lng) <= 180 &&
  Math.abs(lat) <= 90;

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

const formatHeight = (heightCm) => {
  const cm = Number(heightCm);
  if (!Number.isFinite(cm) || cm <= 0) return null;
  if (cm >= 100) {
    const meters = cm / 100;
    const display = meters.toFixed(1).replace(/\.0$/, '');
    return `${display} m`;
  }
  return `${Math.round(cm)} cm`;
};

const formatCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
};

const normalizeFiniteNumberOrNull = (value) => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// --- COMPOSANT CARTE (SWIPE) ---
// caca
// Ajoutez forwardRef et useImperativeHandle aux imports
// ... autres imports inchangés ...

// --- COMPOSANT SWIPE CARD CORRIGÉ AVEC ANIMATION BOUTON ---
const SwipeCard = forwardRef(({
  spot,
  index,
  onSwipe,
  active,
  nowMs,
  isDark,
  leaderboard = [],
  userCoords,
  distanceOverrides = {},
  exiting = false,
  entering = false,
  colorSalt = 0,
  onVerticalSwipe,
  onDrag,
  canSwipeRight,
  onBlockedSwipe,
  onSwipeWithoutExit,
  formatPrice,
  formatParkingPrice,
}, ref) => { // 'ref' est maintenant reçu ici via forwardRef
  const { t, i18n } = useTranslation('common');
  const isRtl = i18n.dir(i18n.resolvedLanguage || i18n.language) === 'rtl';
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  
  // Référence interne pour le DOM
  const internalRef = useRef(null);

  // --- EXPOSER L'ANIMATION AU PARENT ---
  useImperativeHandle(ref, () => ({
    // Permet au parent de récupérer la position (pour trackActionPosition)
    getBoundingClientRect: () => internalRef.current?.getBoundingClientRect(),
    
    // Déclenche une sortie latérale courte pour les boutons d'action
    triggerSwipe: (direction) => {
      if (direction === 'right') {
        const allowed =
          typeof canSwipeRight === 'function' ? canSwipeRight() : canSwipeRight == null ? true : Boolean(canSwipeRight);
        if (!allowed) {
          setOffset({ x: 0, y: 0 });
          if (onDrag) onDrag(0);
          onBlockedSwipe?.();
          return;
        }
      }
      const isRight = direction === 'right';
      const exitDistance = typeof window !== 'undefined'
        ? Math.min(Math.max(window.innerWidth * 0.42, 240), 380)
        : 280;

      setOffset({
        x: isRight ? exitDistance : -exitDistance,
        y: 0,
      });

      setTimeout(() => {
        onSwipe(direction);
        if (onDrag) onDrag(0);
      }, 220);
    }
  }));

  useEffect(() => {
    // Reset offset si l'ID change (nouvelle carte)
    if (!exiting) {
      setOffset({ x: 0, y: 0 });
    }
  }, [spot?.id, exiting]);

  // --- LOGIQUE POINTER EVENTS (inchangée) ---
  const handlePointerDown = (e) => {
    if (!active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    setDragStart({ x: e.clientX, y: e.clientY });
    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !active) return;
    const deltaX = Math.round(e.clientX - dragStart.x);
    const deltaY = Math.round(e.clientY - dragStart.y);
    setOffset({ x: deltaX, y: deltaY });
    if (onDrag) onDrag(deltaX);
  };

  const handlePointerUp = (e) => {
    if (!isDragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);

    const threshold = 100;
    const verticalThreshold = 120;
    const absX = Math.abs(offset.x);
    const absY = Math.abs(offset.y);

    if (offset.x > threshold) {
      const allowed =
        typeof canSwipeRight === 'function' ? canSwipeRight() : canSwipeRight == null ? true : Boolean(canSwipeRight);
      if (!allowed) {
        setOffset({ x: 0, y: 0 });
        if (onDrag) onDrag(0);
        onBlockedSwipe?.();
        return;
      }
      setOffset({ x: 500, y: offset.y });
      setTimeout(() => { onSwipe('right'); if (onDrag) onDrag(0); }, 200);
    } else if (offset.x < -threshold) {
      setOffset({ x: 0, y: 0 });
      if (onDrag) onDrag(0);
      if (typeof onSwipeWithoutExit === 'function') onSwipeWithoutExit('left');
      else onSwipe('left');
    } else if (offset.y < -verticalThreshold && absY > absX * 1.2) {
      onVerticalSwipe?.('up');
      setOffset({ x: 0, y: 0 });
      if (onDrag) onDrag(0);
    } else {
      setOffset({ x: 0, y: 0 });
      if (onDrag) onDrag(0);
    }
  };

  // --- STYLES CALCULÉS ---
  const scale = Math.max(1 - index * 0.05, 0.88);
  const translateY = index * -6;
  const translateX = index * 14;
  const opacity = Math.max(1 - index * 0.25, 0);
  const baseRotation = index * 1.2;

  // CORRECTION ROTATION : On force la rotation si l'offset est grand, même sans drag
  // Cela permet à la carte de tourner pendant l'animation déclenchée par le bouton
  const shouldRotate = isDragging || Math.abs(offset.x) > 50; 
  const rotation = shouldRotate ? offset.x * 0.1 : baseRotation; // 0.1 pour accentuer l'effet

  const cursorClass = isDragging ? 'cursor-grabbing' : active ? 'cursor-grab' : 'cursor-default';
  const isPublicParking = !!spot?.isPublicParking;
  const isFree = !isPublicParking && isFreeSpot(spot);
  const cardColor = spot._overrideColor || colorForSpot(spot, colorSalt);
  const carEmoji = spot?.carEmoji || CAR_EMOJIS[index % CAR_EMOJIS.length];
  const remainingMs = isPublicParking ? null : getRemainingMs(spot, nowMs);
  const preciseTime = formatDuration(remainingMs);
  const parkingName = spot?.parkingName || spot?.name || t('publicParking', { defaultValue: 'Public parking' });
  const distanceLabel = formatDistance(distanceOverrides[spot.id] ?? getDistanceMeters(spot, userCoords));
  const placesLabel = formatCount(spot?.nbPlaces);
  const heightLabel = formatHeight(spot?.heightMaxCm);
  const priceDisplay = isPublicParking
    ? formatParkingPrice(spot?.tarif1h ?? spot?.price)
    : formatPrice(spot.price);
  
  // Ombres (inchangé)
  const appleShadow = active
    ? isDark
      ? '0 26px 90px -38px rgba(0,0,0,0.65), 0 16px 44px -26px rgba(0,0,0,0.45), 0 1px 0 0 rgba(255,255,255,0.06) inset'
      : '0 28px 90px -38px rgba(15,23,42,0.45), 0 16px 40px -26px rgba(15,23,42,0.18), 0 2px 0 0 rgba(255,255,255,0.65) inset'
    : isDark
      ? '0 20px 60px -40px rgba(0,0,0,0.55), 0 10px 34px -30px rgba(0,0,0,0.35), 0 1px 0 0 rgba(255,255,255,0.04) inset'
      : '0 20px 60px -40px rgba(15,23,42,0.20), 0 10px 34px -30px rgba(15,23,42,0.12), 0 1px 0 0 rgba(255,255,255,0.55) inset';
  
  const cardBackground = isPublicParking
    ? 'linear-gradient(145deg, #1d4ed8 0%, #2563eb 45%, #3b82f6 100%)'
    : isFree
      ? 'linear-gradient(145deg, #fff5cc 0%, #ffe08a 18%, #d4af37 48%, #b8860b 78%, #6b4f13 100%)'
      : `linear-gradient(145deg, ${cardColor}, ${cardColor}dd)`;
  const cardBorder = isPublicParking
    ? '1px solid rgba(255,255,255,0.22)'
    : isFree
      ? '1px solid rgba(255, 236, 170, 0.55)'
      : '1px solid rgba(255,255,255,0.08)';
  const premiumGlow = isFree
    ? active
      ? isDark
        ? '0 36px 110px -55px rgba(212,175,55,0.7), 0 14px 40px -30px rgba(0,0,0,0.65)'
        : '0 36px 110px -55px rgba(212,175,55,0.55), 0 14px 40px -30px rgba(15,23,42,0.18)'
      : isDark
        ? '0 24px 80px -55px rgba(212,175,55,0.45)'
        : '0 24px 80px -55px rgba(212,175,55,0.32)'
    : null;
  const leaderEntry = isPublicParking ? null : leaderboard.find((u) => u.id === spot?.hostId);
  const rank = leaderEntry?.rank ?? (spot?.rank || spot?.position || '—');
  const transactions = leaderEntry?.transactions ?? (Number(spot?.transactions) || 0);
  const [showRank, setShowRank] = useState(false);

  // Position finale combinée
  const baseTx = active ? offset.x : translateX;
  const baseTy = active ? offset.y : translateY;
  const baseRot = active ? rotation : baseRotation;
  const baseScale = scale;
  const enterDelayMs = Math.min(index * 60, 140);
  const animation = exiting
    ? 'card-exit 0.4s ease forwards'
    : entering
      ? `card-enter 0.56s cubic-bezier(0.22, 1, 0.36, 1) ${enterDelayMs}ms both`
      : undefined;

  if (!spot) return null;

  return (
    <div
      ref={internalRef} // On attache la ref interne ici
      className={`absolute  rounded-[26px] select-none transition-transform duration-200 px-5 py-7 backdrop-blur-xl ${cursorClass}`}
      style={{
        '--card-tx': `${baseTx}px`,
        '--card-ty': `${baseTy}px`,
        '--card-rot': `${baseRot}deg`,
        '--card-scale': baseScale,
        zIndex: 50 - index,
        transform: `translate(${baseTx}px, ${baseTy}px) rotate(${baseRot}deg) scale(${baseScale})`,
        opacity,
        // La transition est active sauf si on drag manuellement
        transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.35s ease, opacity 0.35s ease',
        boxShadow: isFree ? `${appleShadow}, ${premiumGlow}, inset 0 0 0 1px rgba(255, 248, 220, 0.22)` : appleShadow,
        background: cardBackground,
        border: cardBorder,
        animation,
        touchAction: 'none',
        width: 'clamp(220px, 65vw, 300px)',
        filter: isFree ? 'saturate(1.12) contrast(1.03)' : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {isFree && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[26px] overflow-hidden"
          aria-hidden="true"
          style={{ zIndex: -1 }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 18% 14%, rgba(255,255,255,0.70), rgba(255,255,255,0) 42%), radial-gradient(circle at 85% 6%, rgba(255,237,178,0.65), rgba(255,237,178,0) 52%), radial-gradient(circle at 30% 92%, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%)',
              mixBlendMode: 'overlay',
              opacity: 0.9,
            }}
          />
          <div
            className="absolute inset-0 card-sheen"
            style={{
              background:
                'linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.20) 35%, rgba(255,255,255,0.60) 50%, rgba(255,214,102,0.35) 58%, rgba(255,255,255,0.12) 66%, rgba(255,255,255,0) 75%)',
              backgroundSize: '200% 200%',
              mixBlendMode: 'screen',
              opacity: 0.85,
            }}
          />
          <div
            className="absolute inset-0 opacity-20"
            style={{
              background:
                'repeating-linear-gradient(115deg, rgba(255,255,255,0.00) 0px, rgba(255,255,255,0.00) 7px, rgba(255,255,255,0.09) 9px)',
              mixBlendMode: 'overlay',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              boxShadow:
                'inset 0 0 0 1px rgba(255, 248, 220, 0.35), inset 0 0 18px rgba(255, 236, 170, 0.22), inset 0 -18px 30px rgba(107, 79, 19, 0.22)',
            }}
          />
        </div>
      )}
      {/* ... CONTENU DE LA CARTE (INCHANGÉ) ... */}
      <div className="flex flex-col items-center justify-center h-full space-y-6 text-center pointer-events-none">
        
        {isPublicParking ? (
          <div className={`absolute top-3 left-3 right-3 flex items-center gap-2 text-white/90 pointer-events-none ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
            <div
              className="flex items-center justify-center rounded-full bg-white/15 border border-white/20 font-extrabold"
              style={{ width: 'clamp(38px, 10vw, 46px)', height: 'clamp(38px, 10vw, 46px)' }}
            >
              P
            </div>
            <div className="text-sm font-semibold truncate">{parkingName}</div>
          </div>
        ) : (
          <div className={`absolute top-3 text-white/90 pointer-events-auto ${isRtl ? 'right-3' : 'left-3'}`}>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()} 
              onClick={() => setShowRank(true)}
              className="relative inline-flex items-center justify-center rounded-full bg-white/10 backdrop-blur border border-white/15 shadow-inner shadow-black/20 active:scale-95 transition"
              style={{ width: 'clamp(44px, 12vw, 56px)', height: 'clamp(44px, 12vw, 56px)' }}
            >
              <span className={`absolute -top-2 text-xs font-bold bg-white/80 text-orange-600 rounded-full px-1.5 py-0.5 shadow ${isRtl ? '-left-2' : '-right-2'}`}>{rank}</span>
              <img src={leaderEntry?.rank ? `/ranks/rank${Math.min(5, Math.max(1, leaderEntry.rank))}.png` : '/ranks/rank1.png'} alt="Rang" className="w-full h-full object-contain bg-white/20 p-1 rounded-full" />
            </button>
          </div>
        )}

        <div className="mt-3">
          <p className="text-white font-extrabold drop-shadow text-[clamp(22px,6vw,34px)] price-pulse">
            {priceDisplay}
          </p>
        </div>

        <div className={`flex flex-col items-stretch gap-3 w-full ${isRtl ? 'text-right' : 'text-left'}`}>
          {isPublicParking ? (
            <>
              <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
                <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>P</span><span>{t('parkingSpacesLabel', 'Places')}</span></div>
                <div className="text-[clamp(15px,4vw,18px)] font-bold">{placesLabel ?? '—'}</div>
              </div>
              <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
                <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>📍</span><span>{t('distanceLabel', 'Distance')}</span></div>
                <div className="text-[clamp(15px,4vw,18px)] font-bold">{distanceLabel}</div>
              </div>
              <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
                <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>↕</span><span>{t('heightLabel', 'Height')}</span></div>
                <div className="text-[clamp(15px,4vw,18px)] font-bold">
                  {heightLabel ? t('heightValue', { value: heightLabel, defaultValue: 'Max {{value}}' }) : t('openNowValue', 'Open')}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
                <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>🚗</span><span>{t('lengthLabel', 'Length')}</span></div>
                <div className="text-[clamp(15px,4vw,18px)] font-bold">{t('lengthValue', { value: spot.length ?? 5, defaultValue: '{{value}} meters' })}</div>
              </div>
              <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
                <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>📍</span><span>{t('distanceLabel', 'Distance')}</span></div>
                <div className="text-[clamp(15px,4vw,18px)] font-bold">{distanceLabel}</div>
              </div>
              <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
                <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>⏱️</span><span>{t('leavingInLabel', 'Leaving in')}</span></div>
                <div className="text-[clamp(15px,4vw,18px)] font-bold">{preciseTime || t('etaFallback', '4:10')}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {!isPublicParking && showRank && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm rounded-[26px]" onClick={() => setShowRank(false)} />
          <div className="relative w-[85%] max-w-xs bg-slate-900/95 text-white rounded-2xl border border-white/10 shadow-2xl px-5 py-5">
             <button type="button" onClick={() => setShowRank(false)} className={`absolute top-2 text-white/70 hover:text-white ${isRtl ? 'left-2' : 'right-2'}`}>×</button>
             <div className={`flex items-center gap-3 mb-4 ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
                <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 border border-white/15 text-2xl shadow-inner shadow-black/30">{carEmoji}</span>
                <div><p className="text-xs uppercase tracking-wide text-white/60">Rang</p><p className="text-2xl font-bold">#{rank}</p></div>
             </div>
             <div className="rounded-xl bg-white/10 border border-white/10 px-4 py-3">
               <div className="flex items-center justify-between"><span className="text-sm text-white/70">Transactions</span><span className="text-lg font-semibold">{transactions}</span></div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
});
SwipeCard.displayName = 'SwipeCard';
// caca2

// --- VUE PRINCIPALE ---
const SearchView = ({
  spots = [],
  currency = 'EUR',
  premiumParks = 0,
  showPublicParkings = true,
  onBookSpot,
  onCancelBooking,
  selectedSpot: controlledSelectedSpot,
  setSelectedSpot: setControlledSelectedSpot,
  onSelectionStep,
  leaderboard = [],
  userCoords = null,
  currentUserId = null,
  onFiltersOpenChange,
  deckIndex = null,
  setDeckIndex,
}) => {
  const { t, i18n } = useTranslation('common');
  const isRtl = i18n.dir(i18n.resolvedLanguage || i18n.language) === 'rtl';
  const currencySymbol = getCurrencySymbol(currency);
  const formatPrice = (price) => formatCurrencyAmount(price, currency);
  const formatPriceNumber = (price) => formatCurrencyNumber(price, currency);
  const formatParkingPrice = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return `-- ${currencySymbol} / h`;
    return `${formatCurrencyAmount(n, currency)} / h`;
  };
  const isDark =
    (typeof document !== 'undefined' && document.body?.dataset?.theme === 'dark') ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('theme') === 'dark');
  const viewRef = useRef(null);
  const visualAreaRef = useRef(null);
  const cardStackRef = useRef(null);
  const activeCardRef = useRef(null);
  const [localDeckIndex, setLocalDeckIndex] = useState(0);
  const currentIndex = Number.isFinite(deckIndex) ? deckIndex : localDeckIndex;
  const setCurrentIndex = setDeckIndex ?? setLocalDeckIndex;
  const actionRef = useRef(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [internalSelectedSpot, setInternalSelectedSpot] = useState(null);
  const selectedSpot = controlledSelectedSpot ?? internalSelectedSpot;
  const setSelectedSpot = setControlledSelectedSpot ?? setInternalSelectedSpot;
  const [nowMs, setNowMs] = useState(Date.now());
  const [radius, setRadius] = useState(DEFAULT_RADIUS_KM);
  const [priceMax, setPriceMax] = useState(null); // null => any price
  const {
    showRadiusPicker,
    setShowRadiusPicker,
    filtersButtonRef,
    filtersPanelTopPx,
  } = useFiltersAnimation({ viewRef, onFiltersOpenChange });
  const [distanceOverrides, setDistanceOverrides] = useState({});
  const [exitingCards, setExitingCards] = useState([]);
  const prevVisibleRef = useRef([]);
  const suppressedExitIdsRef = useRef(new Set());
  const [enteringIds, setEnteringIds] = useState([]);
  const getSpotDistanceMeters = useCallback(
    (spot) => {
      const override = distanceOverrides?.[spot?.id];
      return Number.isFinite(override) ? override : getDistanceMeters(spot, userCoords);
    },
    [distanceOverrides, userCoords],
  );
  // Stable salt to keep card colors consistent across renders/tab switches
  const colorSaltRef = useRef(CARD_COLOR_SALT);
  const [shareToast, setShareToast] = useState('');
  const [dragX, setDragX] = useState(0);
  const actionsRowRef = useRef(null);
  const dismissButtonRef = useRef(null);
  const acceptButtonRef = useRef(null);
  const radiusSliderRef = useRef(null);
  const priceSliderRef = useRef(null);
  const { isOnline, isPoorConnection } = useConnectionQuality();
  const prefsHydratedRef = useRef(false);
  const prefsTouchedRef = useRef(false);
  const prefsWriteInFlightRef = useRef(false);
  const prefsWriteQueuedRef = useRef(null);
  const prefsFlushRequestedRef = useRef(false);
  const prefsLastSavedRef = useRef({ radius: null, priceMax: null });
  const [publicParkings, setPublicParkings] = useState([]);
  const parkingFetchInFlightRef = useRef(false);
  const parkingFetchQueuedRef = useRef(null);
  const lastParkingFetchRef = useRef({ at: 0, lat: null, lng: null });
  const isMountedRef = useRef(true);
  const showPublicParkingsRef = useRef(showPublicParkings);
  const maxSpotPrice = useMemo(() => {
    const values = (spots || []).map((s) => Number(s?.price)).filter((n) => Number.isFinite(n) && n >= 0);
    const max = values.length ? Math.max(...values) : 0;
    return Math.max(10, Math.ceil(max));
  }, [spots]);
  const anyLabel = t('any', { defaultValue: 'Any' });

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

  const fetchPublicParkings = useCallback((center, { force = false } = {}) => {
    if (!showPublicParkingsRef.current) {
      return;
    }
    const safeLng = Number(center?.lng);
    const safeLat = Number(center?.lat);
    if (!center || !isValidCoord(safeLng, safeLat)) {
      return;
    }
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
    fetchNearbyPublicParkings({
      lng: safeLng,
      lat: safeLat,
      radiusMeters: PARKING_FETCH_RADIUS_M,
      limit: 20,
    })
      .then((list) => {
        if (isMountedRef.current && showPublicParkingsRef.current) {
          setPublicParkings(list);
        }
      })
      .catch((err) => {
        console.error('[SearchView] Error fetching public parkings:', err);
        if (!isMountedRef.current) return;
      })
      .finally(() => {
        parkingFetchInFlightRef.current = false;
        const queued = parkingFetchQueuedRef.current;
        if (queued) {
          parkingFetchQueuedRef.current = null;
          fetchPublicParkings(queued.center, { force: queued.force });
        }
      });
  }, []);

  // Inject lightweight keyframes for card enter/exit
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('search-card-anims');
    const content = `
      @keyframes card-enter {
        from {
          opacity: 0;
          transform: translate(calc(var(--card-tx) + 140px), calc(var(--card-ty) + 10px)) rotate(calc(var(--card-rot) + 8deg)) scale(calc(var(--card-scale) * 0.9));
          filter: saturate(0.88) brightness(0.96);
        }
        68% {
          opacity: 1;
          transform: translate(calc(var(--card-tx) - 10px), calc(var(--card-ty) - 2px)) rotate(calc(var(--card-rot) - 1.5deg)) scale(calc(var(--card-scale) * 1.01));
          filter: saturate(1.04) brightness(1.02);
        }
        100% {
          opacity: 1;
          transform: translate(var(--card-tx), var(--card-ty)) rotate(var(--card-rot)) scale(var(--card-scale));
          filter: saturate(1) brightness(1);
        }
      }
      @keyframes card-exit {
        from {
          opacity: 1;
          transform: translate(var(--card-tx), var(--card-ty)) rotate(var(--card-rot)) scale(var(--card-scale));
        }
        to {
          opacity: 0;
          transform: translate(calc(var(--card-tx) - 240px), calc(var(--card-ty) - 80px)) rotate(calc(var(--card-rot) - ${CARD_EXIT_ROTATION}deg)) scale(calc(var(--card-scale) * 0.9));
        }
      }
      @keyframes expired-pulse {
        0% { box-shadow: 0 0 0 0 rgba(255,107,107,0.28), 0 0 0 8px rgba(255,107,107,0.10); }
        50% { box-shadow: 0 0 0 6px rgba(255,107,107,0.22), 0 0 0 14px rgba(255,107,107,0.06); }
        100% { box-shadow: 0 0 0 0 rgba(255,107,107,0.28), 0 0 0 8px rgba(255,107,107,0.10); }
      }
        /* NOUVEAU : Animation de tremblement "haptique" */
      @keyframes tremble {
        0% { transform: scale(1.3) rotate(0deg); }
        25% { transform: scale(1.3) rotate(-3deg); }
        50% { transform: scale(1.3) rotate(3deg); }
        75% { transform: scale(1.3) rotate(-3deg); }
        100% { transform: scale(1.3) rotate(0deg); }
      }
      .haptic-active {
        animation: tremble 0.4s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .haptic-active {
          animation: none !important;
        }
      }
    `;
    if (existing) {
      existing.textContent = content;
    } else {
      const style = document.createElement('style');
      style.id = 'search-card-anims';
      style.textContent = content;
      document.head.appendChild(style);
    }
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
    const safeLng = Number(userCoords?.lng);
    const safeLat = Number(userCoords?.lat);
    if (!showPublicParkings || !userCoords || !isValidCoord(safeLng, safeLat)) {
      setPublicParkings([]);
      return undefined;
    }
    fetchPublicParkings({ lng: safeLng, lat: safeLat });
    return undefined;
  }, [showPublicParkings, userCoords?.lng, userCoords?.lat, fetchPublicParkings]);

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

  const sortedSpots = [...(spots || [])].sort((a, b) => getCreatedMs(a) - getCreatedMs(b)); // older first so new cards go to the back
  const countAvailableWith = (radiusKmOverride, priceMaxOverride) => {
    const filtered = sortedSpots.filter((spot) => {
      const withinRadius =
        radiusKmOverride == null ? true : getSpotDistanceMeters(spot) <= radiusKmOverride * 1000;
      if (!withinRadius) return false;
      if (priceMaxOverride == null) return true;
      const p = Number(spot?.price ?? 0);
      return Number.isFinite(p) ? p <= priceMaxOverride : true;
    });
    return uniqueSpotsByHost(filtered).length;
  };
  const spotsAvailableWith = (radiusKmOverride, priceMaxOverride) => {
    const filtered = sortedSpots.filter((spot) => {
      const withinRadius =
        radiusKmOverride == null ? true : getSpotDistanceMeters(spot) <= radiusKmOverride * 1000;
      if (!withinRadius) return false;
      if (priceMaxOverride == null) return true;
      const p = Number(spot?.price ?? 0);
      return Number.isFinite(p) ? p <= priceMaxOverride : true;
    });
    return uniqueSpotsByHost(filtered);
  };

  const filteredSpots = sortedSpots.filter((spot) => {
    const withinRadius = radius == null ? true : getSpotDistanceMeters(spot) <= radius * 1000;
    if (!withinRadius) return false;
    if (priceMax == null) return true;
    const p = Number(spot?.price ?? 0);
    return Number.isFinite(p) ? p <= priceMax : true;
  });
  const availableSpots = uniqueSpotsByHost(filteredSpots).sort((a, b) => getCreatedMs(a) - getCreatedMs(b));
  const availableColors = colorsForOrderedSpots(availableSpots, colorSaltRef.current);
  const spotColorById = useMemo(() => {
    const map = new Map();
    availableSpots.forEach((spot, idx) => {
      map.set(spot.id, availableColors[idx]);
    });
    return map;
  }, [availableSpots, availableColors]);
  const publicParkingCards = useMemo(() => {
    if (!showPublicParkings) {
      return [];
    }
    const maxRadiusMeters = radius == null ? PARKING_FETCH_RADIUS_M : Number(radius) * 1000;
    const maxPrice = priceMax == null ? null : Number(priceMax);
    const sorted = [...(publicParkings || [])]
      .filter((parking) => {
        if (maxRadiusMeters != null && Number(parking?.distanceMeters) > maxRadiusMeters) return false;
        if (maxPrice != null) {
          const price = Number(parking?.tarif1h);
          if (Number.isFinite(price) && price > maxPrice) return false;
        }
        return true;
      })
      .sort((a, b) => (a?.distanceMeters ?? Infinity) - (b?.distanceMeters ?? Infinity));
    const cards = sorted.map((parking, idx) => ({
      ...parking,
      id: `public-parking-${parking?.id || idx}`,
      parkingId: parking?.id,
      isPublicParking: true,
      price: parking?.tarif1h,
    }));
    return cards;
  }, [publicParkings, showPublicParkings, radius, priceMax]);
  const availableCards = useMemo(() => {
    const cards = [...availableSpots, ...publicParkingCards];
    return cards;
  }, [availableSpots, publicParkingCards]);
  const normalizedCurrentIndex = Number.isFinite(currentIndex) ? Math.max(0, Math.trunc(currentIndex)) : 0;
  const boundedCurrentIndex = Math.min(normalizedCurrentIndex, availableCards.length);
  const outOfCards = boundedCurrentIndex >= availableCards.length;
  const visibleSpots = outOfCards ? [] : availableCards.slice(boundedCurrentIndex, boundedCurrentIndex + 3); // show 3 at once
  const noSpots = availableCards.length === 0;
  const showOffline = !isOnline && !selectedSpot;
  const showEmpty = (noSpots || outOfCards) && !selectedSpot && isOnline;
  const showDeckRecovery = !selectedSpot && !showOffline && !showEmpty && visibleSpots.length === 0;
  const isMapOpen = !!selectedSpot;
  const activeSpot = visibleSpots?.[0] || null;
  const relaxedRadiusCount =
    noSpots && radius != null ? countAvailableWith(Math.min(RADIUS_MAX_KM, Number(radius) + 0.5), priceMax) : 0;
  const relaxedPriceCount =
    noSpots && priceMax != null ? countAvailableWith(radius, Number(priceMax) + 1) : 0;
  const showRelaxHint =
    noSpots &&
    (radius != null || priceMax != null) &&
    (relaxedRadiusCount > 0 || relaxedPriceCount > 0);
  const relaxedRadiusValue = radius != null ? Math.min(RADIUS_MAX_KM, Number(radius) + 0.5) : radius;
  const relaxedPriceValue = priceMax != null ? Number(priceMax) + 1 : priceMax;
  const premiumParksCount = Number.isFinite(Number(premiumParks)) ? Number(premiumParks) : 0;
  const canAcceptFreeSpot = premiumParksCount > 0;
  const isActivePublicParking = !!activeSpot?.isPublicParking;
  const isActiveFreeSpot = !isActivePublicParking && isFreeSpot(activeSpot);
  const blockActiveFreeBooking = isActiveFreeSpot && !canAcceptFreeSpot;
  const dismissSwipeProgress = dragX < 0 ? Math.min(Math.abs(dragX) / 140, 1) : 0;
  const rightButtonLabel = isActivePublicParking
    ? t('goThere', { defaultValue: 'Y aller' })
    : t('book', 'Book');
  const [actionButtonTravel, setActionButtonTravel] = useState({ left: 0, right: 0 });

  useLayoutEffect(() => {
    const rowEl = actionsRowRef.current;
    const dismissEl = dismissButtonRef.current;
    const acceptEl = acceptButtonRef.current;
    if (!rowEl || !dismissEl || !acceptEl) return undefined;

    const updateActionButtonTravel = () => {
      const rowWidth = rowEl.getBoundingClientRect().width;
      const dismissWidth = dismissEl.getBoundingClientRect().width;
      const acceptWidth = acceptEl.getBoundingClientRect().width;

      setActionButtonTravel({
        left: Math.max(0, (rowWidth - dismissWidth) / 2),
        right: Math.max(0, (rowWidth - acceptWidth) / 2),
      });
    };

    updateActionButtonTravel();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateActionButtonTravel);
      return () => window.removeEventListener('resize', updateActionButtonTravel);
    }

    const observer = new ResizeObserver(() => updateActionButtonTravel());
    observer.observe(rowEl);
    observer.observe(dismissEl);
    observer.observe(acceptEl);

    return () => observer.disconnect();
  }, [rightButtonLabel, visibleSpots.length, isMapOpen]);

  useEffect(() => {
    if (currentIndex !== boundedCurrentIndex) {
      setCurrentIndex(boundedCurrentIndex);
    }
  }, [boundedCurrentIndex, currentIndex, setCurrentIndex]);

  // Track cards leaving the visible stack to animate them out
  useEffect(() => {
    const prev = prevVisibleRef.current;
    const removed = prev.filter(
      (prevItem) => !visibleSpots.find((v) => v.id === prevItem.spot.id),
    );
    if (removed.length) {
      setExitingCards((prevExit) => {
        const next = [...prevExit];
        removed.forEach((item) => {
          if (suppressedExitIdsRef.current.has(item.spot.id)) {
            suppressedExitIdsRef.current.delete(item.spot.id);
            return;
          }
          const key = `${item.spot.id}-${item.index}`;
          if (!next.find((c) => c._exitKey === key)) {
            next.push({ ...item.spot, _exitKey: key, _exitIndex: item.index });
          }
        });
        return next;
      });
    }
    const prevIds = new Set(prev.map((p) => p.spot.id));
    const added = visibleSpots.filter((s) => !prevIds.has(s.id)).map((s) => s.id);
    if (added.length) {
      added.forEach((id) => {
        setEnteringIds((prevEnter) => (prevEnter.includes(id) ? prevEnter : [...prevEnter, id]));
        setTimeout(() => {
          setEnteringIds((prevEnter) => prevEnter.filter((v) => v !== id));
        }, 450);
      });
    }
    prevVisibleRef.current = visibleSpots.map((spot, idx) => ({ spot, index: idx }));
  }, [visibleSpots]);

  useEffect(() => {
    if (exitingCards.length === 0) return undefined;
    const timers = exitingCards.map((card) =>
      setTimeout(
        () =>
          setExitingCards((prev) => prev.filter((c) => c._exitKey !== card._exitKey)),
        375,
      ),
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [exitingCards]);

  // Fetch Mapbox driving distances for spots near the user (fallback to haversine)
  useEffect(() => {
    if (!userCoords || !import.meta.env.VITE_MAPBOX_TOKEN) return undefined;
    const controller = new AbortController();
    const candidates = (spots || [])
      .filter((s) => s?.lat != null && s?.lng != null)
      .slice(0, 10); // limit to first 10 to avoid rate limits

    const fetchDistances = async () => {
      const results = await Promise.all(
        candidates.map(async (spot) => {
          try {
            const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${userCoords.lng},${userCoords.lat};${spot.lng},${spot.lat}?annotations=distance&access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`;
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error('matrix_failed');
            const data = await res.json();
            const dist = data?.distances?.[0]?.[1];
            if (Number.isFinite(dist)) return [spot.id, dist];
          } catch (_) {
            return [spot.id, getDistanceMeters(spot, userCoords)];
          }
          return [spot.id, getDistanceMeters(spot, userCoords)];
        }),
      );
      const next = {};
      results.forEach(([id, dist]) => {
        if (id != null && Number.isFinite(dist)) next[id] = dist;
      });
      setDistanceOverrides((prev) => ({ ...prev, ...next }));
    };

    fetchDistances();
    return () => controller.abort();
  }, [userCoords, spots]);

  // Tick every second to refresh countdowns
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [actionPos, setActionPos] = useState({ top: null, left: '50%' });

  const trackActionPosition = () => {
    const root = viewRef.current;
    const cardEl = activeCardRef.current;
    if (!root || !cardEl) return;
    const rootRect = root.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const navRect = isMapOpen ? null : document.getElementById('bottom-nav')?.getBoundingClientRect();
    const desiredLeft = cardRect.left + cardRect.width / 2 - rootRect.left;
    let desiredTop = cardRect.bottom - 50 - rootRect.top;
    if (navRect) {
      const maxTop = navRect.top - rootRect.top - 100; // keep above nav but closer
      desiredTop = Math.min(desiredTop, maxTop);
    }
    setActionPos({ top: desiredTop, left: desiredLeft });
  };

  useLayoutEffect(() => {
    let raf = null;
    const loop = () => {
      trackActionPosition();
      raf = requestAnimationFrame(loop);
    };
    loop();
    const onResize = () => trackActionPosition();
    window.addEventListener('resize', onResize);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    trackActionPosition();
  }, [visibleSpots?.length, selectedSpot]);

  const handleGoToParking = (parking) => {
    if (!parking || !isValidCoord(Number(parking.lng), Number(parking.lat))) return;
    const parkingSpot = {
      id: `public-parking-${parking.parkingId || parking.id || `${parking.lng}:${parking.lat}`}`,
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
    setSelectedSpot(parkingSpot);
  };

  const handleSwipe = (direction, spot) => {
    if (!spot) return;

    if (direction === 'right') {
      if (spot.isPublicParking) {
        handleGoToParking(spot);
        setCurrentIndex((prev) => prev + 1);
        return;
      }
      if (isFreeSpot(spot) && !canAcceptFreeSpot) {
        const msg = t('premiumParksEmpty', 'No Premium Parks left.');
        setShareToast(msg);
        setTimeout(() => setShareToast(''), 2200);
        return;
      }
      const bookingSessionId = newId();
      const flowId = `${spot?.id || 'unknown'}:${bookingSessionId}:${Date.now()}`;
      const spotWithSession = { ...spot, bookingSessionId };
      console.log('[SearchSwipe] selected -> start booking flow', {
        flowId,
        spotId: spot?.id || null,
        bookingSessionId,
        currentUserId,
        spotStatus: spot?.status || null,
        spotBookerId: spot?.bookerId || null,
      });
      onSelectionStep?.('selected', spotWithSession, { bookingSessionId });
      setSelectedSpot(spotWithSession);
      (async () => {
        console.log('[SearchSwipe] calling onBookSpot', {
          flowId,
          spotId: spot?.id || null,
          bookingSessionId,
          opId: bookingSessionId,
        });
        const bookRes = await onBookSpot?.(spot, { bookingSessionId, opId: bookingSessionId });
        console.log('[SearchSwipe] onBookSpot result', {
          flowId,
          spotId: spot?.id || null,
          bookRes,
        });
        if (bookRes && bookRes.ok === false) {
          console.warn('[SearchSwipe] booking failed, nav_started skipped', {
            flowId,
            spotId: spot?.id || null,
            code: bookRes?.code || null,
          });
          onSelectionStep?.('cleared', null);
          setSelectedSpot(null);
          return;
        }
      })();
      setCurrentIndex((prev) => prev + 1);
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handleVerticalShare = async (spot) => {
    if (!spot) return;
    const msg = t(
      'shareJoke',
      "Je partage ta place, pas ta playlist... promis ! 😅",
    );
    setShareToast(msg);
    setTimeout(() => setShareToast(''), 2200);
    try {
      await shareContent({
        title: spot.address || 'Place de parking',
        text: msg,
        url: buildCurrentShareUrl(),
      });
    } catch (_) {
      // ignore share cancellation
    }
  };

  const notifyNoPremiumParks = () => {
    const msg = t('premiumParksEmpty', 'No Premium Parks left.');
    setShareToast(msg);
    setTimeout(() => setShareToast(''), 2200);
  };

  const handleDismissActiveCard = () => {
    if (!activeSpot) return;
    suppressedExitIdsRef.current.add(activeSpot.id);
    if (activeCardRef.current) {
      activeCardRef.current.triggerSwipe('left');
      return;
    }
    setDragX(0);
    handleSwipe('left', activeSpot);
  };

  const handleSwipeWithoutExit = (direction, spot) => {
    if (!spot) return;
    suppressedExitIdsRef.current.add(spot.id);
    setDragX(0);
    handleSwipe(direction, spot);
  };

  const handleEnableNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }
    if (!('Notification' in window)) {
      alert(t('notificationsUnsupported', 'Notifications are not supported on this device.'));
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      setNotificationsEnabled(true);
    } else {
      alert(t('notificationsDenied', 'Notifications are disabled. Please allow them in your browser settings.'));
    }
  };

  const handleRelaxFilters = () => {
    if (!showRelaxHint) return;
    const nextRadius = relaxedRadiusCount > 0 ? relaxedRadiusValue : radius;
    const nextPrice = relaxedPriceCount > 0 ? relaxedPriceValue : priceMax;
    if (relaxedRadiusCount > 0 && Number.isFinite(nextRadius)) {
      setRadiusFromRange(nextRadius);
    }
    if (relaxedPriceCount > 0 && Number.isFinite(nextPrice)) {
      setPriceMaxFromRange(nextPrice);
    }
    const candidates = spotsAvailableWith(nextRadius, nextPrice);
    const target = candidates[0];
    if (!target) return;
    const bookingSessionId = newId();
    const spotWithSession = { ...target, bookingSessionId };
    onSelectionStep?.('selected', spotWithSession, { bookingSessionId });
    setSelectedSpot(spotWithSession);
  };
  return (
    <SafeView
      ref={viewRef}
      className="h-full w-full flex flex-col relative overflow-hidden font-sans app-surface"
      withBottomInset={false}
      style={{
        touchAction: 'pan-x',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 90px)',
      }}
    >
      {isOnline && isPoorConnection && (
        <div
          className="absolute left-4 right-4 z-50 pointer-events-none"
          style={{ top: '12px' }}
        >
          <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-amber-200/70 bg-amber-50/90 text-amber-800 text-sm shadow-md backdrop-blur">
            <Wifi size={16} className="text-amber-700" />
            {t('poorConnectionWarning', { defaultValue: 'Slow connection. Some actions may take longer.' })}
          </div>
        </div>
      )}
      {!isOnline && selectedSpot && (
        <div
          className="absolute left-4 right-4 z-50 pointer-events-none"
          style={{ top: '12px' }}
        >
          <div className="flex items-center justify-center px-3 py-2 rounded-xl border border-amber-200/70 bg-amber-50/90 text-amber-800 text-sm shadow-md backdrop-blur">
            {t('offlineWarning', 'Limited connection. Enable cellular data or Wi‑Fi.')}
          </div>
        </div>
      )}
      {!selectedSpot && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          {/* Overlay cliquable */}
          <div
            className={`absolute inset-0 transition-opacity duration-200 ${
              showRadiusPicker ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            onClick={() => setShowRadiusPicker(false)}
          />
          {/* Panneau filtres (radius + prix) */}
	          <div
	            className={`absolute left-6 right-6 transition-all duration-200 origin-top ${
	              showRadiusPicker
	                ? 'opacity-100 scale-100 pointer-events-auto'
	                : 'opacity-0 scale-90 pointer-events-none'
	            }`}
              style={{ top: filtersPanelTopPx == null ? '114px' : `${filtersPanelTopPx}px` }}
	          >
            <div className="flex flex-col space-y-4">
              <div className="bg-white p-5 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 relative overflow-hidden group">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 [@media(hover:hover)]:group-hover:scale-105">
                      <MapPin size={20} strokeWidth={2.5} />
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

              <div className="bg-white p-5 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 relative overflow-hidden group">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 [@media(hover:hover)]:group-hover:scale-105">
                      <Euro size={20} strokeWidth={2.5} />
                    </div>
                    <label className="text-gray-600 font-semibold text-[15px] tracking-wide">
                      {t('priceFilter', { defaultValue: 'Max price' })}
                    </label>
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold text-gray-900 tracking-tight font-sans">
                      {priceMax == null ? anyLabel : formatPriceNumber(priceMax)}
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
                    {`${formatPriceNumber(maxSpotPrice)} ${currencySymbol}`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
	      {!selectedSpot && (
	        <div className="px-6 pt-5 pb-2 relative z-0">
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
            <span
              className={`block leading-tight font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}
            >
              {radius == null ? anyLabel : `${radius.toFixed(1)} km`}
            </span>
            <span
              className={`block leading-tight font-semibold ${isDark ? 'text-slate-50' : 'text-slate-900'}`}
            >
              {priceMax == null ? anyLabel : `${formatPriceNumber(priceMax)} ${currencySymbol}`}
            </span>
	            </button>
            </div>
          </div>
        )}

      {/* Stack de Cartes + Actions */}
      <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
        <div
          ref={visualAreaRef}
          className="flex-1 flex flex-col items-center justify-center"
          style={{ gap: 'clamp(10px, 4vh, 20px)' }}
        >
          {showOffline ? (
            <div className="text-center space-y-4 max-w-sm empty-state">
              <div
                className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center border shadow-xl ${
                  isDark ? 'bg-slate-900 border-white/10 shadow-black/40 animate-[pulseLocation_2.0s_ease-in-out_infinite]' : 'bg-white border-white animate-[pulseLocation_2.0s_ease-in-out_infinite]'
                }`}
              >
                <WifiOff size={42} className={isDark ? 'text-amber-300' : 'text-orange-500'} />
              </div>
              <div>
                <h3 className={`text-2xl font-bold mb-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                  {t('offlineTitle', { defaultValue: 'No connection' })}
                </h3>
                <p className={`${isDark ? 'text-slate-400' : 'text-gray-500'} text-sm`}>
                  {t('offlineSubtitle', { defaultValue: 'Turn on Wi‑Fi or cellular data to see spots.' })}
                </p>
              </div>
            </div>
          ) : showEmpty ? (
            <div className="text-center space-y-4 max-w-sm empty-state">
              <div
                className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center border shadow-xl ${
                  isDark ? 'bg-slate-900 border-white/10 shadow-black/40 animate-[pulseLocation_2.4s_ease-in-out_infinite]' : 'bg-white border-white animate-[pulseLocation_2.4s_ease-in-out_infinite]'
                }`}
              >
                <MapPin size={42} className="text-orange-500" />
              </div>
              <div>
                <h3 className={`text-2xl font-bold mb-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                  {t('noSpotsTitleFun', 'Nobody has moved… yet!')}
                </h3>
                <p className={`${isDark ? 'text-slate-400' : 'text-gray-500'} text-sm`}>
                  {t('noSpotsSubtitleFun', 'Widen the radius or blink— a spot will pop up.')}
                </p>
              </div>
              {showRelaxHint ? (
                <button
                  type="button"
                  onClick={handleRelaxFilters}
                  className={`mx-auto w-full rounded-[24px] border px-4 py-4 ${isRtl ? 'text-right' : 'text-left'} shadow-[0_18px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl transition active:scale-[0.99] ${
                    isDark ? 'bg-slate-900/70 border-white/10' : 'bg-white/80 border-white/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className={`text-[11px] font-extrabold uppercase tracking-[0.18em] ${isDark ? 'text-orange-300' : 'text-orange-600'}`}>
                        {t('relaxFilters', { defaultValue: 'Relax filters' })}
                      </div>
                      <div className={`mt-1 text-sm font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                        {t('relaxFiltersHint', { defaultValue: 'Tap to open a nearby spot' })}
                      </div>
                      <div className={`mt-1 text-xs font-semibold ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                        {[
                          relaxedRadiusCount > 0 ? t('relaxRadiusStep', { defaultValue: '+500 m radius' }) : null,
                          relaxedPriceCount > 0 ? t('relaxPriceStep', { defaultValue: '+1 € max price' }) : null,
                        ]
                          .filter(Boolean)
                          .join(' • ')}
                      </div>
                    </div>
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center border ${
                      isDark ? 'bg-white/5 border-white/10 text-orange-200' : 'bg-orange-50 border-orange-100 text-orange-500'
                    }`}
                    >
                      <MapPin size={20} strokeWidth={2.5} />
                    </div>
                  </div>
                </button>
              ) : null}
            </div>
          ) : showDeckRecovery ? (
            <div className="text-center space-y-4 max-w-sm empty-state px-6">
              <div
                className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center border shadow-xl ${
                  isDark ? 'bg-slate-900 border-white/10 shadow-black/40 animate-[pulseLocation_2.2s_ease-in-out_infinite]' : 'bg-white border-white animate-[pulseLocation_2.2s_ease-in-out_infinite]'
                }`}
              >
                <MapPin size={42} className="text-orange-500" />
              </div>
              <div>
                <h3 className={`text-2xl font-bold mb-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                  {t('searchRecoveryTitle', { defaultValue: 'Refreshing nearby spots' })}
                </h3>
                <p className={`${isDark ? 'text-slate-400' : 'text-gray-500'} text-sm`}>
                  {availableCards.length > 0
                    ? t('searchRecoverySubtitle', { defaultValue: 'The list got out of sync. Reload the stack to continue.' })
                    : t('searchLoadingSubtitle', { defaultValue: 'Looking for available spots around you.' })}
                </p>
              </div>
              {availableCards.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCurrentIndex(0)}
                  className={`mx-auto inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition ${
                    isDark ? 'bg-white/10 text-slate-100 hover:bg-white/15' : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {t('reloadSpots', { defaultValue: 'Reload spots' })}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {visibleSpots.length > 0 && (
                <>
                  <div
                    ref={cardStackRef}
                    className="relative z-40 w-full flex items-center justify-center overflow-visible"
                    // MODIFICATION : Hauteur ajustée pour coller à la taille réelle des cartes (~400px)
                    // Cela permet au parent (justify-center) de centrer le groupe "Cartes + Boutons" ensemble
                    style={{ height: 'clamp(320px, 45vh, 420px)' }}
                  >
                    {[
                      ...visibleSpots.map((spot, i) => {
                        const decorated = spot.isPublicParking
                          ? spot
                          : { ...spot, _overrideColor: spotColorById.get(spot.id) };
                        return {
                          spot: decorated,
                          index: i,
                          exiting: false,
                        };
                      }),
                      ...exitingCards
                      .filter((c) => !visibleSpots.find((v) => v.id === c.id))
                      .map((spotObj) => {
                        const decorated = spotObj.isPublicParking
                          ? spotObj
                          : { ...spotObj, _overrideColor: spotColorById.get(spotObj.id) };
                        return {
                          spot: decorated,
                          index: spotObj._exitIndex ?? visibleSpots.length,
                          exiting: true,
                        };
                      })].map(({ spot, index, exiting }) => {
                      const entering = enteringIds.includes(spot.id);
                      return (
	                      <SwipeCard
	                        key={spot._exitKey || spot.id}
	                        onDrag={setDragX}
	                        spot={spot}
	                        canSwipeRight={() => (spot.isPublicParking ? true : !isFreeSpot(spot) || canAcceptFreeSpot)}
	                        onBlockedSwipe={spot.isPublicParking ? undefined : notifyNoPremiumParks}
	                        index={index}
	                        active={!exiting && index === 0}
	                        nowMs={nowMs}
                            formatPrice={formatPrice}
                            formatParkingPrice={formatParkingPrice}
	                        ref={(!exiting && index === 0) ? activeCardRef : null}
	                        onSwipe={(dir) => handleSwipe(dir, spot)}
                        onSwipeWithoutExit={(dir) => handleSwipeWithoutExit(dir, spot)}
                        onVerticalSwipe={spot.isPublicParking ? undefined : () => handleVerticalShare(spot)}
                        isDark={isDark}
                        userCoords={userCoords}
                        distanceOverrides={distanceOverrides}
                        leaderboard={leaderboard}
                        exiting={exiting}
                        entering={entering}
                        colorSalt={colorSaltRef.current || CARD_COLOR_SALT}
                      />
                      );
                    }).reverse()}
                  </div>

                </>
              )}
            </>
          )}
        

        

        {/* --- BLOC BOUTONS CORRIGÉ --- */}
          {!isMapOpen && !noSpots && visibleSpots.length > 0 && (
            <div 
              ref={actionsRowRef}
              className="flex justify-between items-center z-50 pointer-events-auto"
              // MODIFICATION : On utilise exactement la même largeur que la SwipeCard (ligne 257)
              // pour que les boutons s'alignent parfaitement aux bords gauche/droite de la carte.
              style={{ width: 'clamp(220px, 65vw, 300px)' }}
            >
              
              {/* BOUTON GAUCHE (Refuser / X) */}
              <button
                ref={dismissButtonRef}
                onClick={handleDismissActiveCard}
                className="search-dismiss-button"
                style={{
                  width: 'clamp(52px, 14vw, 72px)',
                  height: 'clamp(52px, 14vw, 72px)',
                  ['--dismiss-progress']: dismissSwipeProgress,
                  ['--dismiss-surface']: isDark ? 'rgba(9, 14, 28, 0.82)' : 'rgba(255, 255, 255, 0.88)',
                  ['--dismiss-surface-strong']: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                  ['--dismiss-edge']: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.08)',
                  ['--dismiss-highlight']: isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.92)',
                  ['--dismiss-glow']: isDark ? 'rgba(251, 113, 133, 0.42)' : 'rgba(244, 63, 94, 0.28)',
                  ['--dismiss-icon']: isDark ? 'rgb(253, 164, 175)' : 'rgb(225, 29, 72)',
                  // LE BOUTON NE GÈRE QUE LA POSITION (TRANSLATE) ET L'OPACITÉ
                  transform: `translateX(${
                    dragX < 0 ? Math.min(Math.abs(dragX) / 140, 1) * actionButtonTravel.left : 0
                  }px)`,
                  opacity: dragX > 0 ? Math.max(1 - dragX / 100, 0) : 1,
                  transition: Math.abs(dragX) > 2
                    ? 'opacity 80ms linear'
                    : 'transform 220ms cubic-bezier(0.2,0.8,0.2,1), opacity 220ms ease',
                  willChange: 'transform, opacity',
                }}
              >
                <span className="search-dismiss-button__halo" aria-hidden="true" />
                <span className="search-dismiss-button__shell" aria-hidden="true" />
                {/* CONTENEUR INTERNE : GÈRE LE SCALE ET L'ANIMATION */}
                <div
                  className={`search-dismiss-button__icon flex items-center justify-center w-full h-full transition-transform duration-75 ${
                    dragX < -100 ? 'haptic-active' : ''
                  }`}
                  style={{
                    transform: `scale(${
                      dragX < 0 
                        ? 1 + Math.min(Math.abs(dragX) / 250, 0.3) 
                        : Math.max(1 - dragX / 150, 0.6)
                    })`
                  }}
                >
                  <X size={28} strokeWidth={2.5} />
                </div>
              </button>

              {/* BOUTON DROIT (Réserver / Book) */}
	              <button
                  ref={acceptButtonRef}
	                disabled={blockActiveFreeBooking}
	                onClick={() => {
	                  if (blockActiveFreeBooking) {
	                    notifyNoPremiumParks();
	                    return;
	                  }
	                  if (activeCardRef.current) {
	                    activeCardRef.current.triggerSwipe('right');
	                  }
	                }}
	                className={`px-7 rounded-full flex items-center justify-center text-white font-bold text-base ${
	                  isDark
	                    ? 'bg-gradient-to-r from-orange-500 to-amber-400'
	                    : 'bg-gradient-to-r from-orange-500 to-amber-400'
	                } ${blockActiveFreeBooking ? 'opacity-50 cursor-not-allowed' : ''}`}
	                style={{
	                  height: 'clamp(52px, 14vw, 72px)',
	                  // LE BOUTON NE GÈRE QUE LA POSITION (TRANSLATE) ET L'OPACITÉ
	                  transform: `translateX(${
                      dragX > 0 ? -Math.min(dragX / 140, 1) * actionButtonTravel.right : 0
                  }px)`,
                  opacity: dragX < 0 ? Math.max(1 - Math.abs(dragX) / 100, 0) : 1,
                  transition: Math.abs(dragX) > 2
  ? 'opacity 80ms linear'
  : 'transform 220ms cubic-bezier(0.2,0.8,0.2,1), opacity 220ms ease',
willChange: 'transform, opacity',
                }}
              >
                {/* CONTENEUR INTERNE : GÈRE LE SCALE ET L'ANIMATION */}
                <div 
                  className={`flex items-center justify-center w-full h-full transition-transform duration-75 ${
                    dragX > 100 ? 'haptic-active' : ''
                  }`}
                  style={{
                     transform: `scale(${
                      dragX > 0 
                        ? 1 + Math.min(dragX / 250, 0.3) 
                        : Math.max(1 - Math.abs(dragX) / 150, 0.6)
                    })`
                  }}
                >
                  {rightButtonLabel}
                </div>
              </button>
            </div>
          )}
      </div>

        {shareToast ? (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-black/80 text-white px-4 py-2 rounded-full text-sm shadow-lg">
              {shareToast}
            </div>
          </div>
        ) : null}
    </div>
    </SafeView>
  );
};

export default SearchView;
