// src/views/SearchView.jsx
import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, MapPin, Bell } from 'lucide-react';

// --- UTILITAIRES ---
const formatPrice = (price) => `${Number(price || 0).toFixed(2)} €`;
const CARD_COLORS = ['#0f1d33', '#112640', '#0d2039', '#0c192f']; // deep navy gradients per card
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

// --- COMPOSANT CARTE (SWIPE) ---
const SwipeCard = ({ spot, index, onSwipe, active, nowMs, activeCardRef, isDark, leaderboard = [], userCoords, distanceOverrides = {} }) => {
  const { t } = useTranslation('common');
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [spot?.id]);

  const handleStart = (clientX, clientY) => {
    if (!active) return;
    setDragStart({ x: clientX, y: clientY });
    setIsDragging(true);
  };

  const handleMove = (clientX, clientY) => {
    if (!isDragging || !active) return;
    const deltaX = clientX - dragStart.x;
    const deltaY = clientY - dragStart.y;
    setOffset({ x: deltaX, y: deltaY });
  };

  const handleEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const threshold = 100;

    if (offset.x > threshold) {
      setOffset({ x: 500, y: offset.y });
      setTimeout(() => onSwipe('right'), 200);
    } else if (offset.x < -threshold) {
      setOffset({ x: -500, y: offset.y });
      setTimeout(() => onSwipe('left'), 200);
    } else {
      setOffset({ x: 0, y: 0 });
    }
  };

  // Events Mouse/Touch
  const onMouseDown = (e) => handleStart(e.clientX, e.clientY);
  const onMouseMove = (e) => handleMove(e.clientX, e.clientY);
  const onMouseUp = () => handleEnd();
  const onTouchStart = (e) => handleStart(e.touches[0].clientX, e.touches[0].clientY);
  const onTouchMove = (e) => handleMove(e.touches[0].clientX, e.touches[0].clientY);
  const onTouchEnd = () => handleEnd();

  // Style de la pile
  const scale = Math.max(1 - index * 0.03, 0.95); // subtle elegance
  const translateY = index * 6;
  const translateX = index * 12; // slight peek
  const opacity = Math.max(1 - index * 0.2, 0);
  const baseRotation = index === 0 ? 0 : index === 1 ? -6 : 6; // mimic stacked tilt
  const rotation = isDragging ? offset.x * 0.05 : baseRotation;
  const cursorClass = isDragging ? 'cursor-grabbing' : active ? 'cursor-grab' : 'cursor-default';
  const cardColor = CARD_COLORS[index % CARD_COLORS.length];
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
  const textStrong = isDark ? 'text-slate-50' : 'text-slate-900';
  const textMuted = isDark ? 'text-slate-300' : 'text-gray-500';
  const cardBackground = `linear-gradient(145deg, ${cardColor}, ${cardColor}dd)`;
  const cardBorder = '1px solid rgba(255,255,255,0.08)';
  const leaderEntry = leaderboard.find((u) => u.id === spot?.hostId);
  const fallbackRank = spot?.rank || spot?.position;
  const rank = leaderEntry?.rank ?? (fallbackRank != null ? fallbackRank : '—');
  const transactions =
    leaderEntry?.transactions ??
    (Number.isFinite(spot?.transactions) ? Number(spot.transactions) : 0);
  const [showRank, setShowRank] = useState(false);

  if (!spot) return null;

  return (
    <div
      ref={active ? activeCardRef : cardRef}
      className={`absolute w-[78%] max-w-[300px] aspect-[3/4] rounded-[26px] select-none transition-transform duration-200 px-5 py-7 backdrop-blur-xl ${cursorClass}`}
      style={{
        zIndex: 10 - index,
        transform: `translate(${offset.x + translateX}px, ${offset.y + translateY}px) rotate(${rotation}deg) scale(${scale})`,
        opacity,
        transition: isDragging ? 'none' : 'transform 0.35s ease, box-shadow 0.35s ease',
        boxShadow: appleShadow,
        background: cardBackground,
        backdropFilter: 'blur(16px)',
        border: cardBorder
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex flex-col items-center justify-center h-full space-y-6 text-center">
        {/* Top row: rank badge */}
        <div className="w-full flex items-start justify-start text-white/90">
          <button
            type="button"
            onClick={() => setShowRank(true)}
            className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 backdrop-blur border border-white/15 text-2xl shadow-inner shadow-black/20 relative active:scale-95 transition"
          >
            <span className="absolute -top-2 -right-2 text-xs font-bold bg-white/80 text-orange-600 rounded-full px-1.5 py-0.5 shadow">{rank}</span>
            {carEmoji}
          </button>
        </div>

        {/* Headline: price only */}
        <div className="mt-3">
          <p className="text-white text-4xl font-extrabold drop-shadow">{formatPrice(spot.price)}</p>
        </div>

        {/* Info cards */}
        <div className="flex flex-col items-stretch gap-3 w-full text-left">
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-base font-semibold">
              <span role="img" aria-label="car">🚗</span>
              <span>{t('lengthLabel', 'Length')}</span>
            </div>
            <div className="text-lg font-bold">
              {t('lengthValue', { value: spot.length ?? 5, defaultValue: '{{value}} meters' })}
            </div>
          </div>
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-base font-semibold">
              <span role="img" aria-label="pin">📍</span>
              <span>{t('distanceLabel', 'Distance')}</span>
            </div>
            <div className="text-lg font-bold">
              {formatDistance(distanceOverrides[spot.id] ?? getDistanceMeters(spot, userCoords))}
            </div>
          </div>
          <div className="w-full rounded-2xl bg-white/12 backdrop-blur-sm border border-white/15 px-4 py-3 shadow-md flex items-center justify-between text-white">
            <div className="flex items-center gap-2 text-base font-semibold">
              <span role="img" aria-label="clock">⏱️</span>
              <span>{t('leavingInLabel', 'Départ dans')}</span>
            </div>
            <div className="text-lg font-bold">
              {preciseTime || t('etaFallback', '4:10')}
            </div>
          </div>
        </div>
      </div>
      {showRank && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowRank(false)} />
          <div className="relative w-[85%] max-w-xs bg-slate-900/95 text-white rounded-2xl border border-white/10 shadow-2xl px-5 py-5">
            <button
              type="button"
              onClick={() => setShowRank(false)}
              className="absolute top-2 right-2 text-white/70 hover:text-white"
              aria-label="Close"
            >
              ×
            </button>
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 border border-white/15 text-2xl shadow-inner shadow-black/30">
                {carEmoji}
              </span>
              <div>
                <p className="text-xs uppercase tracking-wide text-white/60">Rang</p>
                <p className="text-2xl font-bold">#{rank}</p>
              </div>
            </div>
            <div className="rounded-xl bg-white/10 border border-white/10 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/70">Transactions</span>
                <span className="text-lg font-semibold">{transactions}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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

  const availableSpots = (spots || []).filter((spot) => getDistanceMeters(spot, userCoords) <= radius * 1000);
  const outOfCards = currentIndex >= availableSpots.length;
  const visibleSpots = outOfCards ? [] : availableSpots.slice(currentIndex, currentIndex + 2); // primary + a hint of next
  const noSpots = availableSpots.length === 0;
  const showEmpty = (noSpots || outOfCards) && !selectedSpot;
  const isMapOpen = !!selectedSpot;

  useEffect(() => {
    setCurrentIndex(0);
  }, [spots]);

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
          <div className="px-6 pt-5 pb-2 flex justify-between items-center z-20">
            <div>
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
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.1"
                  value={radius}
                  onChange={(e) => setRadius(parseFloat(e.target.value))}
                  className="w-full accent-orange-500"
                />
                <div className={`mt-2 flex justify-between text-[11px] uppercase tracking-wide ${isDark ? 'text-slate-400' : 'text-slate-400'}`}>
                  <span>100 m</span>
                  <span>500 m</span>
                  <span>1 km</span>
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
          className="flex-1 flex flex-col items-center justify-center -mt-2"
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
                  <div ref={cardStackRef} className="relative w-full h-[480px] flex items-center justify-center">
                    {visibleSpots
                      .map((spot, i) => (
                        <SwipeCard
                          key={spot.id}
                          spot={spot}
                          index={i}
                      active={i === 0}
                      nowMs={nowMs}
                      activeCardRef={activeCardRef}   // ✅ AJOUT ICI
                      onSwipe={(dir) => handleSwipe(dir, spot)}
                      isDark={isDark}
                      userCoords={userCoords}
                      distanceOverrides={distanceOverrides}
                      leaderboard={leaderboard}
                    />
                      ))
                      .reverse()}
                  </div>

                  <div className="mt-4 text-amber-300 text-sm font-medium">
                    {t('swipeHint', 'Swipe right to book, left to pass')}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {!isMapOpen && !noSpots && visibleSpots.length > 0 && (
          <div
            ref={actionRef}
            className="px-6 flex justify-between items-center z-20 w-[84%] max-w-[330px] mx-auto absolute pointer-events-auto"
            style={
              actionPos.top != null
                ? { top: `${actionPos.top}px`, left: `${actionPos.left}px`, transform: 'translate(-50%, 0)' }
                : { bottom: '130px', left: '50%', transform: 'translate(-50%, 0)' }
            }
          >
            <button
              onClick={() => handleSwipe('left', visibleSpots[0])}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition active:scale-95 hover:scale-105 border ${
                isDark
                  ? 'bg-slate-900 text-rose-400 border-white/10 shadow-lg shadow-black/50'
                  : 'bg-white text-rose-500 border-white/60 shadow-lg shadow-slate-200'
              }`}
            >
              <X size={32} strokeWidth={2.5} />
            </button>

            <button
              onClick={() => handleSwipe('right', visibleSpots[0])}
              className={`px-7 h-14 rounded-full flex items-center justify-center text-white transition active:scale-95 font-bold text-base hover:scale-105 border ${
                isDark
                  ? 'bg-gradient-to-r from-orange-500 to-amber-400 shadow-xl shadow-orange-900/60 border-white/10'
                  : 'bg-gradient-to-r from-orange-500 to-amber-400 shadow-xl shadow-orange-200 border-white/60'
              }`}
            >
              {t('book', 'Book')}
            </button>
          </div>
        )}
      </div>

    </div>
  );
};

export default SearchView;
