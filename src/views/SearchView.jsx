// src/views/SearchView.jsx
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MapPin, Bell } from 'lucide-react';

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
// Stable salt for color selection (module-level to avoid changes on remount/switch)
const CARD_COLOR_SALT = Math.floor(Math.random() * 10_000);
const colorForSpot = (spot, salt = 0) => {
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

const formatDuration = (ms) => {
  if (ms == null) return null;
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

// --- COMPOSANT CARTE (SWIPE) ---
// caca
// --- COMPOSANT CARTE (SWIPE) CORRIGÉ ---
const SwipeCard = ({
  spot,
  index,
  onSwipe,
  active,
  nowMs,
  activeCardRef,
  isDark,
  leaderboard = [],
  userCoords,
  distanceOverrides = {},
  exiting = false,
  entering = false,
  colorSalt = 0,
  onVerticalSwipe,
  onDrag, // <--- Props pour communiquer avec le bouton
}) => {
  const { t } = useTranslation('common');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [spot?.id]);

  // --- NOUVELLE LOGIQUE SIMPLIFIÉE AVEC POINTER EVENTS ---
  const handlePointerDown = (e) => {
    if (!active) return;
    // 1. On capture le pointeur : tant que c'est pas lâché, on reçoit les événements
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault(); // Empêche le scroll de la page sur mobile
    
    setDragStart({ x: e.clientX, y: e.clientY });
    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || !active) return;
    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;
    setOffset({ x: deltaX, y: deltaY });
    
    // On informe le parent en temps réel
    if (onDrag) onDrag(deltaX);
  };

  const handlePointerUp = (e) => {
    if (!isDragging) return;
    
    // 2. On relâche la capture
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);

    const threshold = 100; // Seuil pour valider le swipe
    const verticalThreshold = 120;
    const absX = Math.abs(offset.x);
    const absY = Math.abs(offset.y);

    // LOGIQUE DE FIN
    if (offset.x > threshold) {
      // --> VALIDÉ À DROITE (BOOK)
      setOffset({ x: 500, y: offset.y }); // Ejecte la carte
      // On attend la fin de l'animation avant de reset le bouton
      setTimeout(() => {
        onSwipe('right');
        if (onDrag) onDrag(0); 
      }, 200);

    } else if (offset.x < -threshold) {
      // --> VALIDÉ À GAUCHE (X)
      setOffset({ x: -500, y: offset.y }); // Ejecte la carte
      setTimeout(() => {
        onSwipe('left');
        if (onDrag) onDrag(0);
      }, 200);

    } else if (offset.y < -verticalThreshold && absY > absX * 1.2) {
      // --> SWIPE VERTICAL (PARTAGE)
      onVerticalSwipe?.('up');
      setOffset({ x: 0, y: 0 });
      if (onDrag) onDrag(0); // Reset immédiat (pas d'éjection latérale)

    } else {
      // --> RETOUR AU CENTRE (ANNULATION)
      setOffset({ x: 0, y: 0 });
      if (onDrag) onDrag(0); // Reset immédiat
    }
  };

  // Styles calculés inchangés...
  const scale = Math.max(1 - index * 0.05, 0.88);
  const translateY = index * -6;
  const translateX = index * 14;
  const opacity = Math.max(1 - index * 0.25, 0);
  const baseRotation = index * 1.2;
  const rotation = isDragging ? offset.x * 0.05 : baseRotation;
  const cursorClass = isDragging ? 'cursor-grabbing' : active ? 'cursor-grab' : 'cursor-default';
  const cardColor = spot._overrideColor || colorForSpot(spot, colorSalt);
  const carEmoji = spot?.carEmoji || CAR_EMOJIS[index % CAR_EMOJIS.length];
  const remainingMs = getRemainingMs(spot, nowMs);
  const preciseTime = formatDuration(remainingMs);
  const appleShadow = active
    ? isDark
      ? '0 26px 90px -38px rgba(0,0,0,0.65), 0 16px 44px -26px rgba(0,0,0,0.45), 0 1px 0 0 rgba(255,255,255,0.06) inset'
      : '0 28px 90px -38px rgba(15,23,42,0.45), 0 16px 40px -26px rgba(15,23,42,0.18), 0 2px 0 0 rgba(255,255,255,0.65) inset'
    : isDark
      ? '0 20px 60px -40px rgba(0,0,0,0.55), 0 10px 34px -30px rgba(0,0,0,0.35), 0 1px 0 0 rgba(255,255,255,0.04) inset'
      : '0 20px 60px -40px rgba(15,23,42,0.20), 0 10px 34px -30px rgba(15,23,42,0.12), 0 1px 0 0 rgba(255,255,255,0.55) inset';
  
  const cardBackground = `linear-gradient(145deg, ${cardColor}, ${cardColor}dd)`;
  const cardBorder = '1px solid rgba(255,255,255,0.08)';
  const leaderEntry = leaderboard.find((u) => u.id === spot?.hostId);
  const rank = leaderEntry?.rank ?? (spot?.rank || spot?.position || '—');
  const transactions = leaderEntry?.transactions ?? (Number(spot?.transactions) || 0);
  const [showRank, setShowRank] = useState(false);
  const baseTx = active ? offset.x : translateX;
  const baseTy = active ? offset.y : translateY;
  const baseRot = active ? rotation : baseRotation;
  const baseScale = scale;
  const animation = exiting ? 'card-exit 0.4s ease forwards' : entering ? 'card-enter 0.35s ease-out' : undefined;

  if (!spot) return null;

  return (
    <div
      ref={active ? activeCardRef : cardRef}
      className={`absolute w-[78%] max-w-[300px] aspect-[3/4] rounded-[26px] select-none transition-transform duration-200 px-5 py-7 backdrop-blur-xl ${cursorClass}`}
      style={{
        zIndex: 10 - index,
        transform: `translate(${baseTx}px, ${baseTy}px) rotate(${baseRot}deg) scale(${baseScale})`,
        opacity,
        // On enlève la transition quand on drag pour que ça suive le doigt parfaitement
        transition: isDragging ? 'none' : 'transform 0.35s ease, box-shadow 0.35s ease, opacity 0.35s ease',
        boxShadow: appleShadow,
        background: cardBackground,
        border: cardBorder,
        animation,
        touchAction: 'none', // INDISPENSABLE pour mobile
      }}
      // On remplace tous les anciens events par ces 3 là :
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp} // Gère les cas d'interruption (appel entrant, etc.)
    >
      {/* Contenu interne avec pointer-events-none pour éviter les bugs de sélection */}
      <div className="flex flex-col items-center justify-center h-full space-y-6 text-center pointer-events-none">
        
        {/* Badge Rang (on réactive les clicks ici) */}
        <div className="absolute top-3 left-3 text-white/90 pointer-events-auto">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()} 
            onClick={() => setShowRank(true)}
            className="relative inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 backdrop-blur border border-white/15 shadow-inner shadow-black/20 active:scale-95 transition"
          >
            <span className="absolute -top-2 -right-2 text-xs font-bold bg-white/80 text-orange-600 rounded-full px-1.5 py-0.5 shadow">{rank}</span>
            <img src={leaderEntry?.rank ? `/ranks/rank${Math.min(5, Math.max(1, leaderEntry.rank))}.png` : '/ranks/rank1.png'} alt="Rang" className="w-full h-full object-contain bg-white/20 p-1 rounded-full" />
          </button>
        </div>

        <div className="mt-3"><p className="text-white text-4xl font-extrabold drop-shadow">{formatPrice(spot.price)}</p></div>

        <div className="flex flex-col items-stretch gap-3 w-full text-left">
          {/* ... Cartes d'infos identiques ... */}
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-base font-semibold"><span>🚗</span><span>{t('lengthLabel', 'Length')}</span></div>
            <div className="text-lg font-bold">{t('lengthValue', { value: spot.length ?? 5, defaultValue: '{{value}} meters' })}</div>
          </div>
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-base font-semibold"><span>📍</span><span>{t('distanceLabel', 'Distance')}</span></div>
            <div className="text-lg font-bold">{formatDistance(distanceOverrides[spot.id] ?? getDistanceMeters(spot, userCoords))}</div>
          </div>
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-base font-semibold"><span>⏱️</span><span>{t('leavingInLabel', 'Départ dans')}</span></div>
            <div className="text-lg font-bold">{preciseTime || t('etaFallback', '4:10')}</div>
          </div>
        </div>
      </div>

      {/* Modal Rang (inchangé mais avec pointer-events-auto) */}
      {showRank && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm rounded-[26px]" onClick={() => setShowRank(false)} />
          <div className="relative w-[85%] max-w-xs bg-slate-900/95 text-white rounded-2xl border border-white/10 shadow-2xl px-5 py-5">
             {/* ... contenu modal identique ... */}
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
};
// caca2

// --- VUE PRINCIPALE ---
const SearchView = ({
  spots = [],
  onBookSpot,
  onCancelBooking,
  selectedSpot: controlledSelectedSpot,
  setSelectedSpot: setControlledSelectedSpot,
  onSelectionStep,
  leaderboard = [],
  userCoords = null,
}) => {
  const { t } = useTranslation('common');
  const isDark =
    (typeof document !== 'undefined' && document.body?.dataset?.theme === 'dark') ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('theme') === 'dark');
  const viewRef = useRef(null);
  const visualAreaRef = useRef(null);
  const cardStackRef = useRef(null);
  const activeCardRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const actionRef = useRef(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [internalSelectedSpot, setInternalSelectedSpot] = useState(null);
  const selectedSpot = controlledSelectedSpot ?? internalSelectedSpot;
  const setSelectedSpot = setControlledSelectedSpot ?? setInternalSelectedSpot;
  const [nowMs, setNowMs] = useState(Date.now());
  const [radius, setRadius] = useState(2);
  const [showRadiusPicker, setShowRadiusPicker] = useState(false);
  const [distanceOverrides, setDistanceOverrides] = useState({});
  const [exitingCards, setExitingCards] = useState([]);
  const prevVisibleRef = useRef([]);
  const [enteringIds, setEnteringIds] = useState([]);
  // Stable salt to keep card colors consistent across renders/tab switches
  const colorSaltRef = useRef(CARD_COLOR_SALT);
  const [shareToast, setShareToast] = useState('');
  const [dragX, setDragX] = useState(0);
  const radiusSliderRef = useRef(null);

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

  // Inject lightweight keyframes for card enter/exit
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('search-card-anims')) return;
    const style = document.createElement('style');
    style.id = 'search-card-anims';
    style.textContent = `
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
          transform: translate(calc(var(--card-tx) - 240px), calc(var(--card-ty) - 80px)) rotate(calc(var(--card-rot) - 8deg)) scale(calc(var(--card-scale) * 0.9));
        }
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
    document.head.appendChild(style);
  }, []);

  const sortedSpots = [...(spots || [])].sort((a, b) => getCreatedMs(a) - getCreatedMs(b)); // older first so new cards go to the back
  const availableSpots = sortedSpots.filter((spot) => getDistanceMeters(spot, userCoords) <= radius * 1000);
  const availableColors = colorsForOrderedSpots(availableSpots, colorSaltRef.current);
  const outOfCards = currentIndex >= availableSpots.length;
  const visibleSpots = outOfCards ? [] : availableSpots.slice(currentIndex, currentIndex + 3); // show 3 at once
  const noSpots = availableSpots.length === 0;
  const showEmpty = (noSpots || outOfCards) && !selectedSpot;
  const isMapOpen = !!selectedSpot;

  useEffect(() => {
    setCurrentIndex(0);
  }, [spots]);

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
        400,
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
      onSelectionStep?.('selected', spot);
      onBookSpot?.(spot);
      setSelectedSpot(spot);
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

  return (
    <div
      ref={viewRef}
      className={`h-full w-full flex flex-col relative overflow-hidden font-sans app-surface ${
        isDark ? 'bg-gradient-to-br from-slate-900 via-slate-950 to-black' : 'bg-gradient-to-br from-orange-50 via-white to-amber-50'
      }`}
      style={{ touchAction: 'pan-x' }}
    >
      {!selectedSpot && showRadiusPicker && (
        <div
          className="absolute inset-0 z-30"
          onClick={() => setShowRadiusPicker(false)}
        />
      )}
      {/* Header */}
      {!selectedSpot && (
        <>
          <div className="px-6 pt-5 pb-2 relative flex items-center justify-between z-20">
            <div className="flex flex-col items-center text-center">
              <p className={`text-xs uppercase tracking-[0.15em] font-semibold ${isDark ? 'text-amber-300' : 'text-orange-400'}`}>
                {t('liveNearby', 'Live nearby')}
              </p>
              <button
                onClick={() => setShowRadiusPicker((s) => !s)}
                className={`mt-1 text-sm font-semibold rounded-full px-3 py-1 border shadow-sm transition ${
                  isDark
                    ? 'text-slate-50 bg-slate-800/80 border-white/10 hover:bg-slate-800'
                    : 'text-slate-900 bg-white/70 border-white/60 hover:bg-white'
                }`}
              >
                {t('radiusLabel', {
                  city: 'Paris',
                  value: radius.toFixed(1),
                  defaultValue: 'Paris • {{value}} km radius',
                })}
              </button>
            </div>
            <button
              type="button"
              onClick={handleEnableNotifications}
              className={`p-2 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition border shadow-md ${
                isDark ? 'bg-slate-800 border-white/10 shadow-black/40' : 'bg-white border-white/60'
              }`}
              aria-label={notificationsEnabled ? t('notificationsOn', 'Notifications on') : t('enableNotifications', 'Enable notifications')}
            >
              {notificationsEnabled ? (
                <Bell size={18} className="text-orange-500" />
              ) : (
                <span className="relative inline-flex items-center justify-center">
                  <Bell size={18} className="text-gray-400" />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="4" y1="4" x2="20" y2="20" />
                    </svg>
                  </span>
                </span>
              )}
            </button>
          </div>

          {showRadiusPicker && (
            <div className="absolute top-16 left-6 right-6 z-30">
              <div
                className={`backdrop-blur-lg rounded-2xl shadow-2xl border p-4 ${
                  isDark ? 'bg-slate-900/90 border-white/10 shadow-black/40' : 'bg-white/95 border-white/80'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-sm font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                    {t('searchRadius', 'Search radius')}
                  </span>
                  <span className={`text-sm font-bold ${isDark ? 'text-amber-300' : 'text-orange-600'}`}>
                    {t('radiusValue', {
                      value: radius.toFixed(1),
                      defaultValue: '{{value}} km',
                    })}
                  </span>
                </div>
                <input
                  ref={radiusSliderRef}
                  type="range"
                  min="0.1"
                  max="2000"
                  step="0.1"
                  value={radius}
                  onPointerDown={(e) =>
                    startRangeDrag(e, radiusSliderRef, 0.1, 2000, 0.1, setRadius)
                  }
                  onChange={(e) => setRadius(parseFloat(e.target.value))}
                  className="w-full accent-orange-500"
                />
                <div className={`mt-2 flex justify-between text-[11px] uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-400'}`}>
                  <span>100 m</span>
                  <span>500 m</span>
                  <span>2000 km</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Stack de Cartes + Actions */}
      <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
        <div
          ref={visualAreaRef}
          className="flex-1 flex flex-col items-center justify-center gap-6"
        >
          {showEmpty ? (
            <div className="text-center space-y-4 max-w-sm empty-state">
              <div
                className={`w-20 h-20 rounded-3xl mx-auto flex items-center justify-center border shadow-xl ${
                  isDark ? 'bg-slate-900 border-white/10 shadow-black/40' : 'bg-white border-white'
                }`}
              >
                <MapPin size={42} className="text-orange-500" />
              </div>
              <div>
                <h3 className={`text-2xl font-bold mb-1 ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                  {t('noSpotsTitle', 'No spots in range')}
                </h3>
                <p className={`${isDark ? 'text-slate-400' : 'text-gray-500'} text-sm`}>
                  {t('noSpotsSubtitle', 'Try expanding the radius or check back soon.')}
                </p>
              </div>
            </div>
          ) : (
            <>
              {visibleSpots.length > 0 && (
                <>
                  <div ref={cardStackRef} className="relative w-full h-[480px] flex items-center justify-center overflow-visible">
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
                        index={index}
                        active={!exiting && index === 0}
                        nowMs={nowMs}
                        activeCardRef={activeCardRef}
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
            <div className="flex justify-between items-center z-20 w-[84%] max-w-[330px] pointer-events-auto">
              
              {/* BOUTON GAUCHE (Refuser / X) */}
              <button
                onClick={() => handleSwipe('left', visibleSpots[0])}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-75 border ${
                  isDark
                    ? 'bg-slate-900 text-rose-400 border-white/10 shadow-lg'
                    : 'bg-white text-rose-500 border-white/60 shadow-lg'
                }`}
                style={{
                  // LE BOUTON NE GÈRE QUE LA POSITION (TRANSLATE) ET L'OPACITÉ
                  transform: `translateX(${
                    dragX < 0 ? Math.min(Math.abs(dragX) * 0.7, 120) : 0
                  }px)`,
                  opacity: dragX > 0 ? Math.max(1 - dragX / 100, 0) : 1,
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
                  <X size={32} strokeWidth={2.5} />
                </div>
              </button>

              {/* BOUTON DROIT (Réserver / Book) */}
              <button
                onClick={() => handleSwipe('right', visibleSpots[0])}
                className={`px-7 h-14 rounded-full flex items-center justify-center text-white transition-all duration-75 font-bold text-base border ${
                  isDark
                    ? 'bg-gradient-to-r from-orange-500 to-amber-400 border-white/10'
                    : 'bg-gradient-to-r from-orange-500 to-amber-400 border-white/60'
                }`}
                style={{
                  // LE BOUTON NE GÈRE QUE LA POSITION (TRANSLATE) ET L'OPACITÉ
                  transform: `translateX(${
                    dragX > 0 ? -Math.min(dragX * 0.7, 120) : 0
                  }px)`,
                  opacity: dragX < 0 ? Math.max(1 - Math.abs(dragX) / 100, 0) : 1,
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
