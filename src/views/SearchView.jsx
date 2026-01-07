// src/views/SearchView.jsx
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MapPin, Bell, WifiOff, Wifi, Euro } from 'lucide-react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { appId, db } from '../firebase';
import useConnectionQuality from '../hooks/useConnectionQuality';
import { newId } from '../utils/ids';

// --- UTILITAIRES ---
const formatPrice = (price) => `${Number(price || 0).toFixed(2)} €`;
const CARD_COLORS = [
  '#ff3b30', // vivid red
  '#ffcc00', // vivid yellow
  '#007aff', // vivid blue
  '#34c759', // vivid green
  '#5856d6', // vivid indigo
  '#ff9500', // vivid orange
  '#af52de', // vivid purple
  '#0fb9b1', // vivid teal
]; // bright primary-inspired palette for each card
const FREE_CARD_COLOR = '#d4af37'; // gold
// Stable salt for color selection (module-level to avoid changes on remount/switch)
const CARD_COLOR_SALT = Math.floor(Math.random() * 10_000);
const CARD_EXIT_ROTATION = 90; // degrés d'arc pour l'animation de sortie
const isFreeSpot = (spot) => {
  const price = Number(spot?.price ?? 0);
  return Number.isFinite(price) && price <= 0;
};
const colorForSpot = (spot, salt = 0) => {
  if (isFreeSpot(spot)) return FREE_CARD_COLOR;
  if (!spot?.id) return CARD_COLORS[0];
  let hash = 0;
  for (let i = 0; i < spot.id.length; i += 1) {
    hash = (hash * 31 + spot.id.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash + salt) % CARD_COLORS.length;
  return CARD_COLORS[idx];
};
const colorsForOrderedSpots = (spots, salt = 0) => {
  const assigned = [];
  let lastColor = null;
  spots.forEach((spot) => {
    if (isFreeSpot(spot)) {
      assigned.push(FREE_CARD_COLOR);
      lastColor = FREE_CARD_COLOR;
      return;
    }
    let color = colorForSpot(spot, salt);
    if (color === lastColor) {
      const rotated = CARD_COLORS.slice(1).concat(CARD_COLORS[0]);
      color = rotated.find((c) => c !== lastColor) || color;
    }
    assigned.push(color);
    lastColor = color;
  });
  return assigned;
};
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
const getCreatedMs = (spot) => {
  const createdAt = spot?.createdAt;
  if (createdAt?.toMillis) return createdAt.toMillis();
  if (typeof createdAt === 'number') return createdAt;
  if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

const hostKeyForSpot = (spot) => spot?.hostId || spot?.hostName || spot?.id;

const uniqueSpotsByHost = (spots = []) => {
  const byHost = new Map();

  spots.forEach((spot) => {
    const key = hostKeyForSpot(spot);
    if (!key) return;

    const prev = byHost.get(key);
    if (!prev) {
      byHost.set(key, spot);
      return;
    }

    const prevCreated = getCreatedMs(prev);
    const nextCreated = getCreatedMs(spot);
    if (nextCreated > prevCreated) {
      byHost.set(key, spot);
      return;
    }

    if (nextCreated === prevCreated) {
      const prevPrice = Number(prev?.price);
      const nextPrice = Number(spot?.price);
      if (Number.isFinite(prevPrice) && Number.isFinite(nextPrice) && nextPrice < prevPrice) {
        byHost.set(key, spot);
      }
    }
  });

  return Array.from(byHost.values());
};

const formatDuration = (ms) => {
  if (ms == null) return null;
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatEuro = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)).replace(/\.00$/, '');
};

const RADIUS_MIN_KM = 0.1;
const RADIUS_MAX_KM = 5000;
const DEFAULT_RADIUS_KM = 2000;

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
}, ref) => { // 'ref' est maintenant reçu ici via forwardRef
  const { t } = useTranslation('common');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  
  // Référence interne pour le DOM
  const internalRef = useRef(null);

  // --- EXPOSER L'ANIMATION AU PARENT ---
  useImperativeHandle(ref, () => ({
    // Permet au parent de récupérer la position (pour trackActionPosition)
    getBoundingClientRect: () => internalRef.current?.getBoundingClientRect(),
    
    // La fonction magique pour l'arc de cercle
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
      const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 400;
      
      // CONFIGURATION DE L'ARC :
      // On l'envoie loin sur le côté (X)
      // On le fait tomber légèrement (Y positif = gravité)
      // La rotation se fera via le calcul de style plus bas
      setOffset({ 
        x: isRight ? screenWidth + 200 : -screenWidth - 200, 
        y: 100 
      });

      // On attend la fin de la transition CSS (0.35s) avant de valider
      setTimeout(() => {
        onSwipe(direction);
        if (onDrag) onDrag(0);
      }, 300);
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
      setOffset({ x: -500, y: offset.y });
      setTimeout(() => { onSwipe('left'); if (onDrag) onDrag(0); }, 200);
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
  const isFree = isFreeSpot(spot);
  const cardColor = spot._overrideColor || colorForSpot(spot, colorSalt);
  const carEmoji = spot?.carEmoji || CAR_EMOJIS[index % CAR_EMOJIS.length];
  const remainingMs = getRemainingMs(spot, nowMs);
  const preciseTime = formatDuration(remainingMs);
  
  // Ombres (inchangé)
  const appleShadow = active
    ? isDark
      ? '0 26px 90px -38px rgba(0,0,0,0.65), 0 16px 44px -26px rgba(0,0,0,0.45), 0 1px 0 0 rgba(255,255,255,0.06) inset'
      : '0 28px 90px -38px rgba(15,23,42,0.45), 0 16px 40px -26px rgba(15,23,42,0.18), 0 2px 0 0 rgba(255,255,255,0.65) inset'
    : isDark
      ? '0 20px 60px -40px rgba(0,0,0,0.55), 0 10px 34px -30px rgba(0,0,0,0.35), 0 1px 0 0 rgba(255,255,255,0.04) inset'
      : '0 20px 60px -40px rgba(15,23,42,0.20), 0 10px 34px -30px rgba(15,23,42,0.12), 0 1px 0 0 rgba(255,255,255,0.55) inset';
  
  const cardBackground = isFree
    ? 'linear-gradient(145deg, #fff5cc 0%, #ffe08a 18%, #d4af37 48%, #b8860b 78%, #6b4f13 100%)'
    : `linear-gradient(145deg, ${cardColor}, ${cardColor}dd)`;
  const cardBorder = isFree ? '1px solid rgba(255, 236, 170, 0.55)' : '1px solid rgba(255,255,255,0.08)';
  const premiumGlow = isFree
    ? active
      ? isDark
        ? '0 36px 110px -55px rgba(212,175,55,0.7), 0 14px 40px -30px rgba(0,0,0,0.65)'
        : '0 36px 110px -55px rgba(212,175,55,0.55), 0 14px 40px -30px rgba(15,23,42,0.18)'
      : isDark
        ? '0 24px 80px -55px rgba(212,175,55,0.45)'
        : '0 24px 80px -55px rgba(212,175,55,0.32)'
    : null;
  const leaderEntry = leaderboard.find((u) => u.id === spot?.hostId);
  const rank = leaderEntry?.rank ?? (spot?.rank || spot?.position || '—');
  const transactions = leaderEntry?.transactions ?? (Number(spot?.transactions) || 0);
  const [showRank, setShowRank] = useState(false);

  // Position finale combinée
  const baseTx = active ? offset.x : translateX;
  const baseTy = active ? offset.y : translateY;
  const baseRot = active ? rotation : baseRotation;
  const baseScale = scale;
  const animation = exiting ? 'card-exit 0.4s ease forwards' : entering ? 'card-enter 0.35s ease-out' : undefined;

  if (!spot) return null;

  return (
    <div
      ref={internalRef} // On attache la ref interne ici
      className={`absolute  rounded-[26px] select-none transition-transform duration-200 px-5 py-7 backdrop-blur-xl ${cursorClass}`}
      style={{
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
        
        <div className="absolute top-3 left-3 text-white/90 pointer-events-auto">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()} 
            onClick={() => setShowRank(true)}
            className="relative inline-flex items-center justify-center rounded-full bg-white/10 backdrop-blur border border-white/15 shadow-inner shadow-black/20 active:scale-95 transition"
            style={{ width: 'clamp(44px, 12vw, 56px)', height: 'clamp(44px, 12vw, 56px)' }}
          >
            <span className="absolute -top-2 -right-2 text-xs font-bold bg-white/80 text-orange-600 rounded-full px-1.5 py-0.5 shadow">{rank}</span>
            <img src={leaderEntry?.rank ? `/ranks/rank${Math.min(5, Math.max(1, leaderEntry.rank))}.png` : '/ranks/rank1.png'} alt="Rang" className="w-full h-full object-contain bg-white/20 p-1 rounded-full" />
          </button>
        </div>

        <div className="mt-3">
          <p className="text-white font-extrabold drop-shadow text-[clamp(22px,6vw,34px)] price-pulse">
            {formatPrice(spot.price)}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-3 w-full text-left">
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>🚗</span><span>{t('lengthLabel', 'Length')}</span></div>
            <div className="text-[clamp(15px,4vw,18px)] font-bold">{t('lengthValue', { value: spot.length ?? 5, defaultValue: '{{value}} meters' })}</div>
          </div>
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>📍</span><span>{t('distanceLabel', 'Distance')}</span></div>
            <div className="text-[clamp(15px,4vw,18px)] font-bold">{formatDistance(distanceOverrides[spot.id] ?? getDistanceMeters(spot, userCoords))}</div>
          </div>
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-[clamp(13px,3.4vw,16px)] font-semibold"><span>⏱️</span><span>{t('leavingInLabel', 'Leaving in')}</span></div>
            <div className="text-[clamp(15px,4vw,18px)] font-bold">{preciseTime || t('etaFallback', '4:10')}</div>
          </div>
        </div>
      </div>

      {showRank && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm rounded-[26px]" onClick={() => setShowRank(false)} />
          <div className="relative w-[85%] max-w-xs bg-slate-900/95 text-white rounded-2xl border border-white/10 shadow-2xl px-5 py-5">
             <button type="button" onClick={() => setShowRank(false)} className="absolute top-2 right-2 text-white/70 hover:text-white">×</button>
             <div className="flex items-center gap-3 mb-4">
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
  premiumParks = 0,
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
  const { t } = useTranslation('common');
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
  const [showRadiusPicker, setShowRadiusPicker] = useState(false);
  const filtersButtonRef = useRef(null);
  const [filtersPanelTopPx, setFiltersPanelTopPx] = useState(null);
  const [distanceOverrides, setDistanceOverrides] = useState({});
  const [exitingCards, setExitingCards] = useState([]);
  const prevVisibleRef = useRef([]);
  const [enteringIds, setEnteringIds] = useState([]);
  // Stable salt to keep card colors consistent across renders/tab switches
  const colorSaltRef = useRef(CARD_COLOR_SALT);
  const [shareToast, setShareToast] = useState('');
  const [dragX, setDragX] = useState(0);
  const radiusSliderRef = useRef(null);
  const priceSliderRef = useRef(null);
  const { isOnline, isPoorConnection } = useConnectionQuality();
  const prefsHydratedRef = useRef(false);
  const prefsWriteTimerRef = useRef(null);
  const prefsLastSavedRef = useRef({ radius: null, priceMax: null });
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
    if (n >= RADIUS_MAX_KM - 1e-6) {
      setRadius(null);
    } else {
      setRadius(n);
    }
  };

  const setPriceMaxFromRange = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    if (n >= maxSpotPrice - 1e-6) {
      setPriceMax(null);
    } else {
      setPriceMax(n);
    }
  };

  const computeFiltersPanelTop = () => {
    if (!viewRef.current || !filtersButtonRef.current) return null;
    const viewRect = viewRef.current.getBoundingClientRect();
    const buttonRect = filtersButtonRef.current.getBoundingClientRect();
    const top = buttonRect.bottom - viewRect.top + 10;
    return Math.max(0, Math.round(top));
  };

  useEffect(() => {
    if (!showRadiusPicker) return undefined;
    const update = () => setFiltersPanelTopPx(computeFiltersPanelTop());
    const rafUpdate = () => window.requestAnimationFrame(update);

    rafUpdate();
    window.addEventListener('resize', rafUpdate);
    window.addEventListener('orientationchange', rafUpdate);

    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', rafUpdate);
    viewport?.addEventListener('scroll', rafUpdate);

    return () => {
      window.removeEventListener('resize', rafUpdate);
      window.removeEventListener('orientationchange', rafUpdate);
      viewport?.removeEventListener('resize', rafUpdate);
      viewport?.removeEventListener('scroll', rafUpdate);
    };
  }, [showRadiusPicker]);

  // Inject lightweight keyframes for card enter/exit
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('search-card-anims');
    const content = `
      @keyframes card-enter {
        from {
          opacity: 0;
          transform: translate(var(--card-tx), calc(var(--card-ty) + 24px)) rotate(var(--card-rot)) scale(calc(var(--card-scale) * 0.95));
        }
        to {
          opacity: 1;
          transform: translate(var(--card-tx), var(--card-ty)) rotate(var(--card-rot)) scale(var(--card-scale));
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

        if (nextRadius == null || (Number.isFinite(nextRadius) && nextRadius > 0)) {
          setRadius((prev) => (prefsHydratedRef.current ? prev : nextRadius));
        }
        if (nextPriceMax == null || Number.isFinite(nextPriceMax)) {
          setPriceMax((prev) => (prefsHydratedRef.current ? prev : nextPriceMax));
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
    if (!prefsHydratedRef.current) return undefined;

    const safeRadius =
      radius == null
        ? null
        : Math.max(RADIUS_MIN_KM, Math.min(RADIUS_MAX_KM, Number(radius) || DEFAULT_RADIUS_KM));
    const safePriceMax = priceMax == null ? null : Number(priceMax);

    const last = prefsLastSavedRef.current;
    if (last.radius === safeRadius && last.priceMax === safePriceMax) return undefined;

    if (prefsWriteTimerRef.current) window.clearTimeout(prefsWriteTimerRef.current);
    prefsWriteTimerRef.current = window.setTimeout(async () => {
      try {
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'userSearchPrefs', currentUserId);
        await setDoc(
          ref,
          { radiusKm: safeRadius, priceMax: safePriceMax, updatedAt: serverTimestamp() },
          { merge: true },
        );
        prefsLastSavedRef.current = { radius: safeRadius, priceMax: safePriceMax };
      } catch (err) {
        console.error('Error persisting search prefs:', err);
      }
    }, 450);

    return () => {
      if (prefsWriteTimerRef.current) window.clearTimeout(prefsWriteTimerRef.current);
    };
  }, [currentUserId, radius, priceMax]);

  const sortedSpots = [...(spots || [])].sort((a, b) => getCreatedMs(a) - getCreatedMs(b)); // older first so new cards go to the back
  const filteredSpots = sortedSpots.filter((spot) => {
    const withinRadius = radius == null ? true : getDistanceMeters(spot, userCoords) <= radius * 1000;
    if (!withinRadius) return false;
    if (priceMax == null) return true;
    const p = Number(spot?.price ?? 0);
    return Number.isFinite(p) ? p <= priceMax : true;
  });
  const availableSpots = uniqueSpotsByHost(filteredSpots).sort((a, b) => getCreatedMs(a) - getCreatedMs(b));
  const availableColors = colorsForOrderedSpots(availableSpots, colorSaltRef.current);
  const outOfCards = currentIndex >= availableSpots.length;
  const visibleSpots = outOfCards ? [] : availableSpots.slice(currentIndex, currentIndex + 3); // show 3 at once
  const noSpots = availableSpots.length === 0;
  const showOffline = !isOnline && !selectedSpot;
  const showEmpty = (noSpots || outOfCards) && !selectedSpot && isOnline;
  const isMapOpen = !!selectedSpot;
  const activeSpot = visibleSpots?.[0] || null;
  const premiumParksCount = Number.isFinite(Number(premiumParks)) ? Number(premiumParks) : 0;
  const canAcceptFreeSpot = premiumParksCount > 0;
  const isActiveFreeSpot = isFreeSpot(activeSpot);
  const blockActiveFreeBooking = isActiveFreeSpot && !canAcceptFreeSpot;

  useEffect(() => {
    if (!Number.isFinite(currentIndex)) return;
    const maxIndex = availableSpots.length;
    if (currentIndex < 0) setCurrentIndex(0);
    else if (currentIndex > maxIndex) setCurrentIndex(maxIndex);
  }, [availableSpots.length, currentIndex, setCurrentIndex]);

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

  const handleSwipe = (direction, spot) => {
    if (!spot) return;

    if (direction === 'right') {
      if (isFreeSpot(spot) && !canAcceptFreeSpot) {
        const msg = t('premiumParksEmpty', 'No Premium Parks left.');
        setShareToast(msg);
        setTimeout(() => setShareToast(''), 2200);
        return;
      }
      const bookingSessionId = newId();
      const spotWithSession = { ...spot, bookingSessionId };
      onSelectionStep?.('selected', spotWithSession, { bookingSessionId });
      onBookSpot?.(spot, { bookingSessionId, opId: bookingSessionId });
      setSelectedSpot(spotWithSession);
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
    if (navigator?.share) {
      try {
        await navigator.share({
          title: spot.address || 'Place de parking',
          text: msg,
          url: window?.location?.href || '',
        });
      } catch (_) {
        // ignore share cancellation
      }
    }
  };

  const notifyNoPremiumParks = () => {
    const msg = t('premiumParksEmpty', 'No Premium Parks left.');
    setShareToast(msg);
    setTimeout(() => setShareToast(''), 2200);
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

  useEffect(() => {
    onFiltersOpenChange?.(showRadiusPicker);
    return () => onFiltersOpenChange?.(false);
  }, [showRadiusPicker, onFiltersOpenChange]);

  return (
    <div
      ref={viewRef}
      className={`h-full w-full flex flex-col relative overflow-hidden font-sans app-surface ${
        isDark ? 'bg-gradient-to-br from-slate-900 via-slate-950 to-black' : 'bg-gradient-to-br from-orange-50 via-white to-amber-50'
      }`}
      style={{
        touchAction: 'pan-x',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 90px)',
      }}
    >
      {isOnline && isPoorConnection && (
        <div className="absolute top-3 left-4 right-4 z-50 pointer-events-none">
          <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-amber-200/70 bg-amber-50/90 text-amber-800 text-sm shadow-md backdrop-blur">
            <Wifi size={16} className="text-amber-700" />
            {t('poorConnectionWarning', { defaultValue: 'Slow connection. Some actions may take longer.' })}
          </div>
        </div>
      )}
      {!isOnline && selectedSpot && (
        <div className="absolute top-3 left-4 right-4 z-50 pointer-events-none">
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
	            style={{ top: filtersPanelTopPx == null ? 'calc(64px + 50px)' : `${filtersPanelTopPx}px` }}
	          >
            <div className="space-y-4">
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
                      <Euro size={20} strokeWidth={2.5} />
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
      )}
      {/* Header */}
	      {!selectedSpot && (
	        <div className="px-6 pt-5 pb-2 relative flex items-center justify-end z-0">
	          <button
	            type="button"
	            ref={filtersButtonRef}
	            onClick={() => setShowRadiusPicker((s) => !s)}
	            className={`text-sm font-semibold rounded-full px-3 py-1 border shadow-sm transition ${
	              isDark
	                ? 'text-slate-50 bg-slate-800/80 border-white/10 hover:bg-slate-800'
	                : 'text-slate-900 bg-white/70 border-white/60 hover:bg-white'
	            }`}
	          >
	            {t('filtersHeader', {
	              defaultValue: '{{radius}} • {{price}}',
	              radius: radius == null ? anyLabel : `${radius.toFixed(1)} km`,
	              price: priceMax == null ? anyLabel : `≤ ${formatEuro(priceMax)} €`,
	            })}
	          </button>
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
                      ...visibleSpots.map((spot, i) => ({
                        spot: { ...spot, _overrideColor: availableColors[currentIndex + i] },
                        index: i,
                        exiting: false,
                      })),
                      ...exitingCards
                      .filter((c) => !visibleSpots.find((v) => v.id === c.id))
                      .map((spotObj) => ({
                        spot: spotObj,
                        index: spotObj._exitIndex ?? visibleSpots.length,
                        exiting: true,
                      }))].map(({ spot, index, exiting }) => {
                      const entering = enteringIds.includes(spot.id);
                      return (
	                      <SwipeCard
	                        key={spot._exitKey || spot.id}
	                        onDrag={setDragX}
	                        spot={spot}
	                        canSwipeRight={() => !isFreeSpot(spot) || canAcceptFreeSpot}
	                        onBlockedSwipe={notifyNoPremiumParks}
	                        index={index}
	                        active={!exiting && index === 0}
	                        nowMs={nowMs}
	                        ref={(!exiting && index === 0) ? activeCardRef : null}
	                        onSwipe={(dir) => handleSwipe(dir, spot)}
                        onVerticalSwipe={() => handleVerticalShare(spot)}
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
              className="flex justify-between items-center z-50 pointer-events-auto"
              // MODIFICATION : On utilise exactement la même largeur que la SwipeCard (ligne 257)
              // pour que les boutons s'alignent parfaitement aux bords gauche/droite de la carte.
              style={{ width: 'clamp(220px, 65vw, 300px)' }}
            >
              
              {/* BOUTON GAUCHE (Refuser / X) */}
              <button
                onClick={() => {
                  if (activeCardRef.current) {
                    activeCardRef.current.triggerSwipe('left');
                  }
                }}
                className={`rounded-full flex items-center justify-center border ${
                  isDark
                    ? 'bg-slate-900 text-rose-400 border-orange-400/70 shadow-lg'
                    : 'bg-white text-rose-500 border-orange-400/70 shadow-lg'
                }`}
                style={{
                  width: 'clamp(52px, 14vw, 72px)',
                  height: 'clamp(52px, 14vw, 72px)',
                  // LE BOUTON NE GÈRE QUE LA POSITION (TRANSLATE) ET L'OPACITÉ
                  transform: `translateX(${
                    dragX < 0 ? Math.min(Math.abs(dragX) * 0.7, 120) : 0
                  }px)`,
                  opacity: dragX > 0 ? Math.max(1 - dragX / 100, 0) : 1,
                  transition: Math.abs(dragX) > 2
                    ? 'opacity 80ms linear'
                    : 'transform 220ms cubic-bezier(0.2,0.8,0.2,1), opacity 220ms ease',
                  willChange: 'transform, opacity',
                }}
              >
                {/* CONTENEUR INTERNE : GÈRE LE SCALE ET L'ANIMATION */}
                <div
                  className={`flex items-center justify-center w-full h-full transition-transform duration-75 ${
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
	                    dragX > 0 ? -Math.min(dragX * 0.7, 120) : 0
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
                  {t('book', 'Book')}
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
    </div>
  );
};

export default SearchView;
