// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
	  collection,
	  addDoc,
	  onSnapshot,
	  query,
	  orderBy,
	  updateDoc,
	  doc,
	  getDoc,
	  getDocs,
	  deleteDoc,
	  serverTimestamp,
	  writeBatch,
	  where,
	  setDoc,
  limit,
  increment,
  runTransaction,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signOut,
  updateEmail,
  sendEmailVerification,
} from 'firebase/auth';

import { db, appId, auth } from './firebase';
import BottomNav from './components/BottomNav';
import TapDebugOverlay from './components/TapDebugOverlay';
import SearchView from './views/SearchView';
import ProposeView from './views/ProposeView';
import ProfileView from './views/ProfileView';
import AuthView from './views/AuthView';
import i18n from './i18n/i18n';
import Map from './components/Map';
import MapSearchView from './components/MapSearchView';
import PremiumParksDeltaToast from './components/PremiumParksDeltaToast';
import { List, MapPin, Settings } from 'lucide-react';
import { newId } from './utils/ids';

const hashSeed = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const ConfettiOverlay = ({ seedKey }) => {
  const pieces = React.useMemo(() => {
    const rand = mulberry32(hashSeed(seedKey || 'parkswap'));
    const colors = ['#f97316', '#fb923c', '#f59e0b', '#22c55e', '#38bdf8', '#a78bfa', '#f472b6'];
    return Array.from({ length: 70 }).map(() => {
      const size = 6 + Math.floor(rand() * 8);
      return {
        left: `${Math.floor(rand() * 100)}%`,
        delay: `${(rand() * 0.35).toFixed(2)}s`,
        duration: `${(1.2 + rand() * 0.9).toFixed(2)}s`,
        rotate: `${Math.floor(rand() * 360)}deg`,
        drift: `${Math.floor((rand() - 0.5) * 220)}px`,
        color: colors[Math.floor(rand() * colors.length)],
        size,
        radius: rand() > 0.6 ? 999 : 2 + Math.floor(rand() * 6),
      };
    });
  }, [seedKey]);

  return (
    <div className="fixed inset-0 z-[220] pointer-events-none overflow-hidden">
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translate3d(var(--drift), 0, 0) rotate(var(--rot)); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translate3d(calc(var(--drift) * -1), 130vh, 0) rotate(calc(var(--rot) + 540deg)); opacity: 0; }
        }
      `}</style>
      {pieces.map((p, idx) => (
        <span
          // eslint-disable-next-line react/no-array-index-key
          key={idx}
          className="absolute will-change-transform"
          style={{
            left: p.left,
            top: '-12vh',
            width: `${p.size}px`,
            height: `${Math.max(6, Math.round(p.size * 0.6))}px`,
            background: p.color,
            borderRadius: `${p.radius}px`,
            animation: `confetti-fall ${p.duration} cubic-bezier(.12,.55,.28,1) ${p.delay} both`,
            '--drift': p.drift,
            '--rot': p.rotate,
          }}
        />
      ))}
    </div>
  );
};

const AuthTransitionOverlay = ({ theme = 'light', mode = 'out', name = '' }) => (
  <div className="fixed inset-0 z-[10000] flex items-center justify-center">
    <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />
    <div
      className={`relative w-[min(320px,84vw)] rounded-3xl border px-6 py-5 shadow-2xl ${
        theme === 'dark'
          ? 'bg-slate-900/70 border-white/10 text-slate-100'
          : 'bg-white/80 border-white/60 text-slate-900'
      }`}
      style={{ WebkitBackdropFilter: 'blur(18px) saturate(180%)', backdropFilter: 'blur(18px) saturate(180%)' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        {mode === 'out' ? (
          <div className="h-5 w-5 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
        ) : (
          <div className="h-5 w-5 rounded-full bg-gradient-to-br from-orange-500 to-amber-400 shadow-[0_10px_24px_rgba(249,115,22,0.35)] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M20 6L9 17l-5-5"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {mode === 'out' ? i18n.t('loggingOut', 'Déconnexion…') : i18n.t('connected', 'Connecté')}
          </div>
          {mode === 'in' && (
            <div className="mt-0.5 text-xs opacity-70 truncate">
              {name
                ? i18n.t('welcomeBackName', { defaultValue: 'Welcome back, {{name}}', name })
                : i18n.t('welcomeBack', 'Welcome back')}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
);

const LogoutOverlay = ({ theme = 'light' }) => <AuthTransitionOverlay theme={theme} mode="out" />;

const OrientationBlockedOverlay = ({ visible }) => {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[20000] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-xl" />
      <div
        className="relative w-[min(360px,88vw)] rounded-[28px] border border-white/10 bg-slate-950/55 px-6 py-6 text-slate-50 shadow-[0_26px_80px_rgba(0,0,0,0.65)]"
        style={{ WebkitBackdropFilter: 'blur(22px) saturate(180%)', backdropFilter: 'blur(22px) saturate(180%)' }}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/8">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
                stroke="currentColor"
                strokeWidth="2"
                opacity="0.9"
              />
              <path
                d="M16.5 7.5l3 3-3 3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
              <path
                d="M19.5 10.5H10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.9"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">Mode portrait uniquement</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-200/80">
              Tournez votre téléphone pour continuer.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const userSelectionRef = (uid) =>
  doc(db, 'artifacts', appId, 'public', 'data', 'userSelections', uid);

const vehiclesCollectionForUser = (uid) =>
  collection(db, 'artifacts', appId, 'public', 'data', 'users', uid, 'vehicles');

const getRemainingMs = (spot) => {
  if (!spot || spot.time == null || spot.time === undefined) return Infinity;
  const createdAt = spot.createdAt;
  let createdMs = null;
  if (createdAt?.toMillis) {
    createdMs = createdAt.toMillis();
  } else if (typeof createdAt === 'number') {
    createdMs = createdAt;
  } else if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    createdMs = Number.isNaN(parsed) ? null : parsed;
  }
  if (!createdMs) return Infinity;
  return createdMs + Number(spot.time) * 60_000 - Date.now();
};

const EXPIRED_PROPOSE_DISMISS_MS = 60_000;
const PREMIUM_PARKS_MAX = 5;
const isFreeSpot = (spot) => {
  const price = Number(spot?.price ?? 0);
  return Number.isFinite(price) && price <= 0;
};

const BOTTOM_NAV_HEIGHT = 96; // fallback if we can't measure the nav
const measureBottomSafeOffset = () => {
  if (typeof document === 'undefined') return BOTTOM_NAV_HEIGHT;
  const nav = document.getElementById('bottom-nav');
  if (!nav) return BOTTOM_NAV_HEIGHT;
  const rect = nav.getBoundingClientRect();
  return Math.round(rect.height);
};

export default function ParkSwapApp() {
  const RENEW_WAVE_DURATION_MS = 650;
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [activeTab, setActiveTab] = useState('search');
  const proposeViewRef = useRef(null);
  const tabOrder = ['search', 'propose', 'profile'];
  const [slideDir, setSlideDir] = useState('left');
  const prevTabRef = useRef('search');
  // Ajoutez ceci avec vos autres useState
  const [sheetEntryAnim, setSheetEntryAnim] = useState(false);
  const [sheetExitAnim, setSheetExitAnim] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
	  const [showInvite, setShowInvite] = useState(false);
	  const [inviteMessage, setInviteMessage] = useState('');
		  const [cancelledNotice, setCancelledNotice] = useState(null);
		  const cancelledNoticeSeenRef = useRef(new Set());
		  const [celebration, setCelebration] = useState(null);
		  const celebrationSeenRef = useRef(new Set());
		  const [loggingOut, setLoggingOut] = useState(false);
		  const [loggingIn, setLoggingIn] = useState(false);
		  const lastKnownLocationRef = useRef(null);
		  const selectionWriteInFlight = useRef(false);
		  const selectionQueueRef = useRef(null);
		  const heartbeatIntervalRef = useRef(null);
		  const heartbeatInFlightRef = useRef(false);
		  const userUidRef = useRef(null);
		  const initializingRef = useRef(true);
		  const loginOverlayTimerRef = useRef(null);
		  const [orientationBlocked, setOrientationBlocked] = useState(false);
  const [menuNudgeActive, setMenuNudgeActive] = useState(false);
  const menuNudgeTimerRef = useRef(null);
  const pendingVehicleOnboardingRef = useRef(false);
  const [highlightVehiclesRequestId, setHighlightVehiclesRequestId] = useState(0);
  const cancelledNoticeTimerRef = useRef(null);

  const lastAuthNameKey = 'parkswap_last_auth_name';
  const consumeLastAuthName = () => {
        try {
          const raw = window.sessionStorage?.getItem(lastAuthNameKey);
          if (!raw) return '';
          window.sessionStorage?.removeItem(lastAuthNameKey);
          return String(raw || '').trim();
        } catch (_) {
          return '';
        }
      };

  useEffect(() => {
    return () => {
      if (menuNudgeTimerRef.current) {
        window.clearTimeout(menuNudgeTimerRef.current);
        menuNudgeTimerRef.current = null;
      }
      if (cancelledNoticeTimerRef.current) {
        window.clearTimeout(cancelledNoticeTimerRef.current);
        cancelledNoticeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    userUidRef.current = user?.uid || null;
  }, [user?.uid]);

  // Try to lock orientation to portrait (best-effort) + block landscape UX-wise.
  useEffect(() => {
    const isMobileLike = () => {
      try {
        const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
        const small = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 900;
        return Boolean(coarse || small);
      } catch (_) {
        return true;
      }
    };

    const computeBlocked = () => {
      const w = window.innerWidth || 0;
      const h = window.innerHeight || 0;
      if (!w || !h) return false;
      return isMobileLike() && w > h;
    };

    const lockOrientation = async () => {
      try {
        if (screen?.orientation?.lock) {
          await screen.orientation.lock('portrait');
        }
      } catch (_) {
        // ignore failures (iOS Safari/PWA limitations)
      }
    };
    lockOrientation();
    const onOrientationChange = () => {
      setOrientationBlocked(computeBlocked());
      if (screen?.orientation?.type && !screen.orientation.type.includes('portrait')) {
        lockOrientation();
      }
    };
    const onResize = () => setOrientationBlocked(computeBlocked());
    setOrientationBlocked(computeBlocked());
    window.addEventListener('orientationchange', onOrientationChange);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('orientationchange', onOrientationChange);
      window.removeEventListener('resize', onResize);
    };
	  }, []);
	  const upsertTransaction = async ({ spot, userId, status, role }) => {
	    if (!spot || !userId) return;
	    const txId = `${spot.id}-${userId}`;
	    const title =
	      spot.hostName && spot.bookerName
	        ? `${spot.bookerName} ➜ ${spot.hostName}`
	        : spot.hostName || spot.bookerName || 'Swap';
	    const amount = Number(spot.price || 0);
	    const txDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', txId);
	    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', userId);
	    const bookingSessionId =
	      typeof spot?.bookingSessionId === 'string' && spot.bookingSessionId ? spot.bookingSessionId : null;

	    const basePayload = {
	      userId,
	      spotId: spot.id,
	      bookingSessionId,
	      status,
	      role,
	      hostId: spot.hostId,
	      hostName: spot.hostName || '',
	      bookerId: spot.bookerId || null,
	      bookerName: spot.bookerName || '',
	      price: amount,
	      amount,
	      title,
	      updatedAt: serverTimestamp(),
	    };

	    try {
	      const didIncrement = await runTransaction(db, async (tx) => {
	        const txSnap = await tx.get(txDoc);
	        const existing = txSnap.exists() ? txSnap.data() : null;
	        const alreadyCounted = !!existing?.concludedCountedAt;
	        const shouldCount = status === 'concluded' && !alreadyCounted;

	        if (txSnap.exists()) {
	          tx.set(txDoc, basePayload, { merge: true });
	        } else {
	          tx.set(txDoc, { ...basePayload, createdAt: serverTimestamp() }, { merge: true });
	        }

	        if (shouldCount) {
	          tx.set(
	            userRef,
	            {
	              transactions: increment(1),
	              updatedAt: serverTimestamp(),
	            },
	            { merge: true },
	          );
	          tx.set(txDoc, { concludedCountedAt: serverTimestamp() }, { merge: true });
	        }

	        return shouldCount;
	      });

	      if (didIncrement && userId === user?.uid) {
	        setUser((prev) => (prev ? { ...prev, transactions: (Number(prev.transactions) || 0) + 1 } : prev));
	      }
	    } catch (err) {
	      console.error('Error upserting transaction:', err);
	    }
	  };

  const normalizePlate = (plate) => String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const getDefaultVehiclePlateForUser = async (uid) => {
    if (!uid) return null;
    try {
      const vehiclesRef = vehiclesCollectionForUser(uid);
      const q = query(vehiclesRef, where('isDefault', '==', true), limit(1));
      const snap = await getDocs(q);
      const doc0 = snap.docs?.[0];
      const data = doc0 ? doc0.data() : {};
      return data?.plate || null;
    } catch (_) {
      return null;
    }
  };

	  const saveSelectionStep = async (step, spot, meta = {}) => {
	    if (!user?.uid) return;
	    const ref = userSelectionRef(user.uid);
	    const bookingSessionId =
	      typeof meta?.bookingSessionId === 'string' && meta.bookingSessionId
	        ? meta.bookingSessionId
	        : typeof spot?.bookingSessionId === 'string' && spot.bookingSessionId
	          ? spot.bookingSessionId
	          : null;
	    const payload = {
	      step: step || null,
	      spotId: spot?.id || null,
	      bookingSessionId,
	      updatedAt: serverTimestamp(),
	    };

	    // Simple queue to avoid overlapping writes on rapid UI taps
	    if (selectionWriteInFlight.current) {
	      selectionQueueRef.current = {
	        step: payload.step,
	        spotId: payload.spotId,
	        bookingSessionId: payload.bookingSessionId,
	      };
	      return;
	    }

    selectionWriteInFlight.current = true;
    try {
      await setDoc(ref, payload, { merge: true });
    } catch (err) {
      console.error('Error persisting selection step:', err);
	    } finally {
	      selectionWriteInFlight.current = false;
	      if (selectionQueueRef.current) {
	        const next = selectionQueueRef.current;
	        selectionQueueRef.current = null;
	        saveSelectionStep(
	          next.step,
	          next.spotId ? { id: next.spotId } : null,
	          next.bookingSessionId ? { bookingSessionId: next.bookingSessionId } : {},
	        );
	      }
	    }
	  };

  const logCurrentLocation = async (contextLabel = 'location') => {
    if (!navigator?.geolocation) {
      console.log(`[${contextLabel}] Geolocation API not available`);
      return null;
    }
    const fallbackLocation = { lat: 48.8738, lng: 2.295 };
    const attempt = (opts) =>
      new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            console.log(`[${contextLabel}] lat=${coords.lat}, lng=${coords.lng}`);
            lastKnownLocationRef.current = coords;
            resolve(coords);
          },
          (err) => {
            console.log(`[${contextLabel}] Geolocation failed: ${err?.message || err}`);
            resolve(null);
          },
          opts,
        );
      });

    // Try high accuracy first, then fallback to a more lenient request to avoid timeouts
    const first = await attempt({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 10_000 });
    if (first) return first;
    const second = await attempt({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 20_000 });
    if (second) return second;
    if (lastKnownLocationRef.current) {
      console.log(`[${contextLabel}] Using last known location`);
      return lastKnownLocationRef.current;
    }
    console.log(`[${contextLabel}] Falling back to default location (Arc de Triomphe)`);
    return fallbackLocation;
  };
  const [spots, setSpots] = useState([]);
  const [searchDeckIndex, setSearchDeckIndex] = useState(0);
  const [myActiveSpot, setMyActiveSpot] = useState(null);
  const [bookedSpot, setBookedSpot] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedSearchSpot, setSelectedSearchSpot] = useState(null);
  const [searchMapOpen, setSearchMapOpen] = useState(false);
  const searchMapPrefRef = useRef('list');
  const [hideNav, setHideNav] = useState(false); // kept for compatibility but forced to false now
  const [searchFiltersOpen, setSearchFiltersOpen] = useState(false);
  const [renewFeedbackId, setRenewFeedbackId] = useState(0);
  const [renewWave, setRenewWave] = useState(null);
  const [premiumParksDeltaToast, setPremiumParksDeltaToast] = useState(null);
  const [selectionSnapshot, setSelectionSnapshot] = useState(null);
  const suppressSelectionRestoreUntilRef = useRef(0);
  const [userCoords, setUserCoords] = useState(null);

  const visibleSpots = useMemo(
    () => spots.filter((spot) => getRemainingMs(spot) > 0),
    [spots],
  );

  const findSpotById = (spotId) => {
    if (myActiveSpot?.id === spotId) return myActiveSpot;
    if (bookedSpot?.id === spotId) return bookedSpot;
    return visibleSpots.find((s) => s.id === spotId);
  };
	  const [showAccountSheet, setShowAccountSheet] = useState(false);
	  const [accountSheetOffset, setAccountSheetOffset] = useState(0);
		  const [isSheetDragging, setIsSheetDragging] = useState(false);
		  const [addVehicleRequestId, setAddVehicleRequestId] = useState(0);
		  const sheetDragRef = useRef(false);
		  const sheetStartY = useRef(0);
		  const sheetOffsetRef = useRef(0);
  

	  const handleMenuClick = () => {
	    setSheetExitAnim(false);
	    setSheetEntryAnim(true);
	    setShowAccountSheet(true);
	    setAccountSheetOffset(0);
	    if (pendingVehicleOnboardingRef.current) {
	      pendingVehicleOnboardingRef.current = false;
	      setMenuNudgeActive(false);
	      setHighlightVehiclesRequestId((v) => v + 1);
	    }
	  };

	  const nudgeVehicleOnboarding = () => {
	    pendingVehicleOnboardingRef.current = true;
	    setMenuNudgeActive(true);
	    if (menuNudgeTimerRef.current) window.clearTimeout(menuNudgeTimerRef.current);
	    menuNudgeTimerRef.current = window.setTimeout(() => setMenuNudgeActive(false), 5200);

	    // If the account sheet is already open, jump straight to the in-profile nudge.
	    if (showAccountSheet) {
	      pendingVehicleOnboardingRef.current = false;
	      setHighlightVehiclesRequestId((v) => v + 1);
	    }
	  };

	  const openAddVehicle = () => {
	    setSheetExitAnim(false);
	    setSheetEntryAnim(true);
	    setShowAccountSheet(true);
	    setAccountSheetOffset(0);
	    setAddVehicleRequestId((v) => v + 1);
	  };

	  const closeAccountSheet = () => {
	    if (sheetExitAnim) return;
	    setSheetEntryAnim(false);
	    setIsSheetDragging(false);
	    sheetDragRef.current = false;
	    setSheetExitAnim(true);
	    const screenHeight = window.innerHeight;
	    window.requestAnimationFrame(() => {
	      setAccountSheetOffset(screenHeight);
	    });
	    setTimeout(() => {
	      setShowAccountSheet(false);
	    }, 320);
	  };

		  const handleAccountSheetPointerDown = (e) => {
		    // Empêcher la propagation pour ne pas bouger la map en dessous
		    e.stopPropagation();

	    const scrollContainer = e.target?.closest?.('[data-role="account-sheet-scroll"]');
	    const startedInScrollable = Boolean(scrollContainer);

	    // Si on touche dans le contenu scrollable et qu'il n'est pas en haut, on laisse scroller.
	    if (startedInScrollable && scrollContainer.scrollTop > 1) return;

	    setSheetEntryAnim(false);

	    // Gérer aussi bien la souris que le tactile
	    const startY = e.clientY || (e.touches && e.touches[0].clientY);
	    const startX = e.clientX || (e.touches && e.touches[0].clientX);
	    if (startY == null) return;

			    sheetStartY.current = startY;
			    sheetOffsetRef.current = 0;

	    // Drag immédiat si on prend la "handle", sinon on attend un vrai pull-down (scroll top).
	    sheetDragRef.current = !startedInScrollable;
	    if (!startedInScrollable) {
	      setIsSheetDragging(true); // Suivi 1:1 du doigt
	    }

	    const startXRef = startX ?? 0;

	    const cleanup = () => {
	      window.removeEventListener('pointermove', onMove);
	      window.removeEventListener('pointerup', onEnd);
	      window.removeEventListener('pointercancel', onEnd);
	      window.removeEventListener('touchmove', onMove);
	      window.removeEventListener('touchend', onEnd);
	      window.removeEventListener('touchcancel', onEnd);
	    };

	    const onMove = (ev) => {
	      const currentY = ev.clientY || (ev.touches && ev.touches[0].clientY);
	      const currentX = ev.clientX || (ev.touches && ev.touches[0].clientX);
	      if (currentY == null) return;

	      const deltaY = currentY - sheetStartY.current;
	      const deltaX = currentX != null ? currentX - startXRef : 0;

	      if (startedInScrollable) {
	        // Si le contenu commence à scroller, on annule le drag de sheet.
	        if (scrollContainer && scrollContainer.scrollTop > 0) {
	          cleanup();
	          return;
	        }

	        // On n'active le drag que si l'utilisateur tire vers le bas.
	        if (!sheetDragRef.current) {
	          const absY = Math.abs(deltaY);
	          const absX = Math.abs(deltaX);
	          if (deltaY > 8 && absY > absX + 2) {
	            sheetDragRef.current = true;
	            setIsSheetDragging(true);
	          } else if (deltaY < -8 && absY > absX + 2) {
	            // Gesture vers le haut => scroll normal.
	            cleanup();
	            return;
	          } else {
	            return;
	          }
	        }
	      } else if (!sheetDragRef.current) {
	        return;
	      }

	      const visibleOffset = deltaY > 0 ? deltaY : 0;
	      setAccountSheetOffset(visibleOffset);
	      sheetOffsetRef.current = visibleOffset;
	      if (visibleOffset > 0 && ev.cancelable) ev.preventDefault();
	    };

	    const onEnd = () => {
	      cleanup();

	      if (!sheetDragRef.current) return;

	      setIsSheetDragging(false); // Réactive l'animation CSS pour le "snap"
	      sheetDragRef.current = false;

	      const delta = sheetOffsetRef.current;
	      const screenHeight = window.innerHeight;

	      // Si on a glissé de plus de 150px vers le bas, on ferme
	      if (delta > 150) {
	        // 1. On pousse la feuille tout en bas (hors écran)
	        setAccountSheetOffset(screenHeight);

	        // 2. On attend la fin de l'animation (300ms) avant de démonter le composant
	        setTimeout(() => {
	          setShowAccountSheet(false);
        }, 300);
	      } else {
	        // Sinon, on remonte (rebond)
	        setAccountSheetOffset(0);
	      }
	    };

	    

	    window.addEventListener('pointermove', onMove);
	    window.addEventListener('pointerup', onEnd);
	    window.addEventListener('pointercancel', onEnd);
	    // Ajout des listeners tactiles spécifiques pour mobile
	    window.addEventListener('touchmove', onMove, { passive: false });
	    window.addEventListener('touchend', onEnd);
	    window.addEventListener('touchcancel', onEnd);
	  };
  // Fetch current user location for cards/navigation
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const coords = await logCurrentLocation('search_view');
      if (!cancelled && coords) setUserCoords(coords);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Heartbeat: keep userLocations up to date even hors navigation
  useEffect(() => {
    if (!user?.uid) return undefined;
    let cancelled = false;

    const persistHeartbeat = async () => {
      if (heartbeatInFlightRef.current) return;
      heartbeatInFlightRef.current = true;
      try {
        const coords = await logCurrentLocation('heartbeat');
        if (cancelled || !coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;
        await setDoc(
          doc(db, 'artifacts', appId, 'public', 'data', 'userLocations', user.uid),
          {
            lat: coords.lat,
            lng: coords.lng,
            displayName: user.displayName || 'User',
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (err) {
        console.error('Error persisting heartbeat location', err);
      } finally {
        heartbeatInFlightRef.current = false;
      }
    };

    // Kick off immediately, then every 30s
    persistHeartbeat();
    const interval = setInterval(persistHeartbeat, 30_000);
    heartbeatIntervalRef.current = interval;

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (heartbeatIntervalRef.current === interval) heartbeatIntervalRef.current = null;
      heartbeatInFlightRef.current = false;
    };
  }, [user?.uid, user?.displayName]);

  const getInitialTheme = () => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage?.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.theme = theme;
    window.localStorage?.setItem('theme', theme);
  }, [theme]);

  // Keep a CSS variable in sync with the real bottom nav height so views can avoid overlap.
  useEffect(() => {
    const updateBottomPadding = () => {
      if (typeof document === 'undefined') return;
      const safeValue = measureBottomSafeOffset();
      document.documentElement.style.setProperty('--bottom-safe-offset', `${safeValue}px`);
    };
    updateBottomPadding();

    let observer = null;
    const tryAttachObserver = () => {
      if (typeof document === 'undefined' || !('ResizeObserver' in window)) return;
      const navEl = document.getElementById('bottom-nav');
      if (!navEl || observer) return;
      observer = new ResizeObserver(updateBottomPadding);
      observer.observe(navEl);
      updateBottomPadding(); // ensure we capture the measured height once nav is present
    };

    // Poll briefly until the nav mounts, then rely on ResizeObserver + resize/orientation
    const pollId = setInterval(() => {
      tryAttachObserver();
      const navEl = typeof document !== 'undefined' ? document.getElementById('bottom-nav') : null;
      if (navEl) clearInterval(pollId);
    }, 250);
    tryAttachObserver();

    window.addEventListener('resize', updateBottomPadding);
    window.addEventListener('orientationchange', updateBottomPadding);
    return () => {
      window.removeEventListener('resize', updateBottomPadding);
      window.removeEventListener('orientationchange', updateBottomPadding);
      if (observer) observer.disconnect();
      clearInterval(pollId);
    };
  }, []);

		  // --- Auth subscription ---
		  useEffect(() => {
		    let cancelled = false;
		    const hydrateUser = async (fbUser) => {
		      if (!fbUser) return null;
		      const fallbackName = fbUser.displayName ? '' : consumeLastAuthName();
		      const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', fbUser.uid);
		      let language = i18n.language || 'en';
          let wallet = 0;
		      try {
		        const snap = await getDoc(userRef);
		        if (snap.exists()) {
		          const data = snap.data();
		          if (data?.language) language = data.language;
              const walletValue = Number(data?.wallet);
              if (Number.isFinite(walletValue)) wallet = walletValue;
		        }
		      } catch (err) {
		        console.error('Error loading user language:', err);
		      }
		      return {
		        uid: fbUser.uid,
		        displayName: fbUser.displayName || fallbackName || 'User',
		        email: fbUser.email || '',
		        phone: fbUser.phoneNumber || '',
		        transactions: 0,
		        premiumParks: PREMIUM_PARKS_MAX,
            wallet,
		        language: language || 'en',
		      };
		    };

		    const unsub = onAuthStateChanged(auth, (fbUser) => {
		      (async () => {
		        if (cancelled) return;
		        if (fbUser) {
		          const nextUser = await hydrateUser(fbUser);
		          if (cancelled) return;
		          const wasLoggedOut = !userUidRef.current && !initializingRef.current;
		          if (nextUser?.language) i18n.changeLanguage(nextUser.language);
		          setUser(nextUser);
		          if (wasLoggedOut) {
		            if (loginOverlayTimerRef.current) window.clearTimeout(loginOverlayTimerRef.current);
		            setLoggingIn(true);
		            loginOverlayTimerRef.current = window.setTimeout(() => setLoggingIn(false), 1200);
		          }
		        } else if (!loggingOut) {
		          setUser(null);
		        }

		        // ❗ IMPORTANT : on laisse Firebase finir l'init AVANT de montrer AuthView
		        setInitializing(false);
		        initializingRef.current = false;
		      })();
		    });

		    return () => {
		      cancelled = true;
		      unsub();
		    };
		  }, []);

  // Fallback: hydrate user immediately if auth already has a currentUser (e.g., after redirect)
 useEffect(() => {
  // on attend un cycle complet après redirect
  const timer = setTimeout(() => {
    const fbUser = auth.currentUser;
    if (!fbUser) return;

    // If auth subscription already hydrated, skip.
    if (userUidRef.current) return;

    (async () => {
      const fallbackName = fbUser.displayName ? '' : consumeLastAuthName();
      const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', fbUser.uid);
      let language = i18n.language || 'en';
      let wallet = 0;
      try {
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data?.language) language = data.language;
          const walletValue = Number(data?.wallet);
          if (Number.isFinite(walletValue)) wallet = walletValue;
        }
      } catch (err) {
        console.error('Error loading user language:', err);
      }
      const nextUser = {
        uid: fbUser.uid,
        displayName: fbUser.displayName || fallbackName || 'User',
        email: fbUser.email || '',
        phone: fbUser.phoneNumber || '',
        transactions: 0,
        premiumParks: PREMIUM_PARKS_MAX,
        wallet,
        language: language || 'en',
      };
      setUser((prev) => prev || nextUser);
      if (nextUser.language) i18n.changeLanguage(nextUser.language);
    })();
  }, 300); // 300ms = perfect mobile delay

  return () => clearTimeout(timer);
}, [auth]);

	  // --- Firestore subscription for spots ---
	  useEffect(() => {
	    if (!user) return;
	    const spotsRef = collection(db, 'artifacts', appId, 'public', 'data', 'spots');
	    const q = query(spotsRef, orderBy('createdAt', 'desc'));
	    const unsubscribe = onSnapshot(
	      q,
	      (snapshot) => {
	        const fetchedSpots = snapshot.docs.map((docSnap) => ({
	          id: docSnap.id,
	          ...docSnap.data(),
	        }));
	        if (typeof window !== 'undefined' && celebrationSeenRef.current.size === 0) {
	          try {
	            const raw = window.localStorage?.getItem('parkswap_celebrate_seen');
	            const list = raw ? JSON.parse(raw) : [];
	            if (Array.isArray(list)) {
	              celebrationSeenRef.current = new Set(list.filter((v) => typeof v === 'string'));
	            }
	          } catch (_) {
	            // ignore storage errors
	          }
	        }
	        if (typeof window !== 'undefined' && cancelledNoticeSeenRef.current.size === 0) {
	          try {
	            const raw = window.localStorage?.getItem('parkswap_cancel_seen');
	            const list = raw ? JSON.parse(raw) : [];
            if (Array.isArray(list)) {
              cancelledNoticeSeenRef.current = new Set(list.filter((v) => typeof v === 'string'));
            }
          } catch (_) {
            // ignore storage errors
          }
        }

        const cancelledForMe = fetchedSpots.find(
          (s) => s.status === 'cancelled' && s.cancelledFor && user?.uid && s.cancelledFor === user.uid,
        );
        if (cancelledForMe && !cancelledNoticeSeenRef.current.has(cancelledForMe.id)) {
          cancelledNoticeSeenRef.current.add(cancelledForMe.id);
          if (typeof window !== 'undefined') {
            try {
              window.localStorage?.setItem(
                'parkswap_cancel_seen',
                JSON.stringify(Array.from(cancelledNoticeSeenRef.current)),
              );
            } catch (_) {
              // ignore storage errors
            }
          }

          setCancelledNotice({
            spotId: cancelledForMe.id,
            hostName: cancelledForMe.hostName || 'Host',
          });
          setActiveTab('search');
          setSelectedSearchSpot(null);
          setBookedSpot(null);
	          saveSelectionStep('cleared', null);
	        }
	        const debugSpot = fetchedSpots.find((s) => s.bookerId === user.uid || s.hostId === user.uid);
	        if (debugSpot) {
	          console.log('[Spots snapshot]', debugSpot.id, {
            status: debugSpot.status,
            bookerAccepted: debugSpot.bookerAccepted,
            bookerId: debugSpot.bookerId,
            hostId: debugSpot.hostId,
          });
	        }
	        const available = fetchedSpots.filter((s) => s.status === 'available' || !s.status);
	        setSpots(available);

	        const completedForMe = fetchedSpots.find(
	          (s) =>
	            (s.status === 'completed' || s.plateConfirmed) &&
	            user?.uid &&
	            (s.hostId === user.uid || s.bookerId === user.uid),
	        );
	        if (completedForMe && !celebrationSeenRef.current.has(completedForMe.id)) {
	          celebrationSeenRef.current.add(completedForMe.id);
	          if (typeof window !== 'undefined') {
	            try {
	              window.localStorage?.setItem(
	                'parkswap_celebrate_seen',
	                JSON.stringify(Array.from(celebrationSeenRef.current)),
	              );
	            } catch (_) {
	              // ignore storage errors
	            }
	          }

	          setCelebration({ spotId: completedForMe.id });
	          setActiveTab('search');
	          setSelectedSearchSpot(null);
	          setMyActiveSpot(null);
	          setBookedSpot(null);
	          saveSelectionStep('cleared', null);
	          if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
	            window.setTimeout(() => setCelebration(null), 1700);
	          }
	        }

		        const mySpot = fetchedSpots.find((s) => {
		          if (s.hostId !== user.uid) return false;
		          if (s.status === 'completed' || s.status === 'cancelled') return false;
		          if (s.status === 'booked' || s.status === 'confirmed') return true;
		          const remaining = getRemainingMs(s);
		          if (!Number.isFinite(remaining)) return true;
		          return remaining > -EXPIRED_PROPOSE_DISMISS_MS;
		        });
		        setMyActiveSpot(mySpot || null);

	        const booked = fetchedSpots.find((s) => s.bookerId === user.uid && s.status !== 'completed' && s.status !== 'cancelled');
	        setBookedSpot(booked || null);
	      },
      (error) => {
        console.error('Error fetching spots:', error);
      },
    );
    return () => unsubscribe();
	  }, [user]);

	  // --- Auto-dismiss stale expired propose listings ---
	  useEffect(() => {
	    if (!myActiveSpot) return undefined;
	    if (myActiveSpot.status === 'booked' || myActiveSpot.status === 'confirmed') return undefined;
	    const remaining = getRemainingMs(myActiveSpot);
	    if (!Number.isFinite(remaining)) return undefined;
	    if (remaining > 0) return undefined;

	    const expiredForMs = -remaining;
	    if (expiredForMs > EXPIRED_PROPOSE_DISMISS_MS) {
	      setMyActiveSpot(null);
	      return undefined;
	    }

	    const msUntilDismiss = Math.max(0, EXPIRED_PROPOSE_DISMISS_MS - expiredForMs);
	    const spotId = myActiveSpot.id;
	    const timer = window.setTimeout(() => {
	      setMyActiveSpot((current) => {
	        if (!current || current.id !== spotId) return current;
	        if (current.status === 'booked' || current.status === 'confirmed') return current;
	        const nextRemaining = getRemainingMs(current);
	        if (!Number.isFinite(nextRemaining)) return current;
	        return nextRemaining <= -EXPIRED_PROPOSE_DISMISS_MS ? null : current;
	      });
	    }, msUntilDismiss + 25);

	    return () => window.clearTimeout(timer);
	  }, [myActiveSpot?.id, myActiveSpot?.status, myActiveSpot?.createdAt, myActiveSpot?.time]);

	  // Restore selected spot (itinerary) from persisted state or current booking
	  useEffect(() => {
	    if (Date.now() < suppressSelectionRestoreUntilRef.current) return;
	    // First priority: persisted selection with a spotId
	    if (selectionSnapshot?.spotId) {
	      const match = findSpotById(selectionSnapshot.spotId);
	      const patched =
	        match && selectionSnapshot.bookingSessionId
	          ? { ...match, bookingSessionId: selectionSnapshot.bookingSessionId }
	          : match;
	      if (patched && (!selectedSearchSpot || selectedSearchSpot.id !== patched.id)) {
	        setSelectedSearchSpot(patched);
	        return;
	      }
	    }
	    // Fallback to an active booked spot
	    if (bookedSpot && (!selectedSearchSpot || selectedSearchSpot.id !== bookedSpot.id)) {
	      const patched =
	        selectionSnapshot?.spotId === bookedSpot.id && selectionSnapshot?.bookingSessionId
	          ? { ...bookedSpot, bookingSessionId: selectionSnapshot.bookingSessionId }
	          : bookedSpot;
	      setSelectedSearchSpot(patched);
	      return;
	    }
    // If no selection persists and no booking, clear local selection
    if (!selectionSnapshot?.spotId && !bookedSpot && selectedSearchSpot && !selectedSearchSpot?.mapOnly) {
      setSelectedSearchSpot(null);
    }
  }, [selectionSnapshot, bookedSpot, spots, selectedSearchSpot]);

  const closeMap = () => {
    suppressSelectionRestoreUntilRef.current = Date.now() + 2000;
    setSelectionSnapshot(null);
    handleSelectionStep('cleared', null);
    setHideNav(false);
    setSelectedSearchSpot(null);
  };

  // --- Persisted selection subscription (to restore itinerary after reload) ---
  useEffect(() => {
    if (!user?.uid) return;
    const ref = userSelectionRef(user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setSelectionSnapshot(snap.exists() ? snap.data() : null);
      },
      (err) => console.error('Error watching selection state:', err),
    );
    return () => unsub();
  }, [user?.uid]);

  // --- Transactions subscription (history) ---
  useEffect(() => {
    if (!user) return;
    const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
    const q = query(txRef, where('userId', '==', user.uid), limit(50));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const txs = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }))
          .sort((a, b) => {
            const getMs = (v) =>
              v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : Date.parse(v) || 0;
            return getMs(b.updatedAt || b.createdAt) - getMs(a.updatedAt || a.createdAt);
          });
        setTransactions(txs);
      },
      (error) => {
        console.error('Error fetching transactions:', error);
      },
    );
    return () => unsubscribe();
  }, [user]);

  // --- Vehicles subscription ---
  useEffect(() => {
    if (!user) return;
    const vehiclesRef = vehiclesCollectionForUser(user.uid);
    const q = query(vehiclesRef, orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetched = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setVehicles(fetched);
        const defaultVeh = fetched.find((v) => v.isDefault) || fetched[0] || null;
        setSelectedVehicle(defaultVeh);
      },
      (error) => {
        console.error('Error fetching vehicles:', error);
      },
    );
    return () => unsubscribe();
  }, [user]);

  // --- Ensure user profile doc exists / hydrate (live subscription) ---
	  useEffect(() => {
	    if (!user?.uid) return;
	    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);

	    // Seed Premium Parks once per account (start with 5 hearts).
	    runTransaction(db, async (tx) => {
	      const snap = await tx.get(userRef);
	      const data = snap.exists() ? snap.data() : null;
	      const initialized = data?.premiumParksInitialized === true;
	      const current = Number(data?.premiumParks);
	      const hasValue = Number.isFinite(current);
        const walletRaw = Number(data?.wallet);
        const hasWallet = Number.isFinite(walletRaw);
        const walletSeed = hasWallet ? {} : { wallet: 0 };

	      if (!snap.exists()) {
	        tx.set(
	          userRef,
	          { premiumParks: PREMIUM_PARKS_MAX, premiumParksInitialized: true, ...walletSeed },
	          { merge: true },
	        );
	        return;
	      }

	      if (!initialized) {
	        tx.set(
	          userRef,
	          { premiumParks: PREMIUM_PARKS_MAX, premiumParksInitialized: true, ...walletSeed },
	          { merge: true },
	        );
	        return;
	      }

	      if (!hasValue) {
	        tx.set(userRef, { premiumParks: PREMIUM_PARKS_MAX, ...walletSeed }, { merge: true });
        return;
	      }

        if (!hasWallet) {
          tx.set(userRef, { wallet: 0 }, { merge: true });
        }
	    }).catch((err) => console.error('Error initializing Premium Parks:', err));

	    // Ensure the profile doc exists with basic defaults
	    // Ensure doc exists without resetting transaction count
		    setDoc(
		      userRef,
		      {
		        displayName: user.displayName,
		        email: user.email,
		        phone: user.phone,
		        language: user.language || i18n.language || 'en',
		        // increment(0) preserves existing transactions and initializes to 0 if missing
		        transactions: increment(0),
            wallet: increment(0),
		        createdAt: serverTimestamp(),
		      },
		      { merge: true },
		    ).catch((err) => console.error('Error creating user profile:', err));

    const unsub = onSnapshot(
      userRef,
	      (snap) => {
	        if (!snap.exists()) return;
	        const data = snap.data();
		        setUser((prev) => {
		          const premiumInitialized = data.premiumParksInitialized === true;
		          const premiumValue = Number(data.premiumParks);
		          const nextPremium =
		            premiumInitialized
		              ? Number.isFinite(premiumValue)
		                ? premiumValue
		                : prev?.premiumParks ?? PREMIUM_PARKS_MAX
		              : PREMIUM_PARKS_MAX;
              const walletValue = Number(data.wallet);
              const nextWallet = Number.isFinite(walletValue) ? walletValue : prev?.wallet ?? 0;
		          return {
		            ...prev,
		            displayName: data.displayName || prev?.displayName,
		            email: data.email || prev?.email,
		            phone: data.phone ?? prev?.phone,
		            language: data.language || prev?.language || 'en',
		            transactions: data.transactions ?? prev?.transactions ?? 0,
		            premiumParks: nextPremium,
                wallet: nextWallet,
		          };
		        });
	      },
	      (err) => console.error('Error subscribing to user profile:', err),
	    );
    return () => unsub();
  }, [user?.uid]);

  // --- Leaderboard subscription ---
  useEffect(() => {
    if (!user) return;
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'users');
    const q = query(usersRef, orderBy('transactions', 'desc'), limit(50));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const topUsers = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));

        const sorted = [...topUsers].sort((a, b) => Number(b.transactions || 0) - Number(a.transactions || 0));
        const withRanks = sorted.map((u, idx) => ({ ...u, rank: idx + 1 }));
        setLeaderboard(withRanks);
      },
      (error) => {
        console.error('Error fetching leaderboard:', error);
      },
    );
    return () => unsubscribe();
  }, [user]);

  // --- Expire available spots after timer ---
  useEffect(() => {
    const interval = setInterval(async () => {
      const expired = spots.filter(
        (s) => (s.status === 'available' || !s.status) && getRemainingMs(s) <= 0,
      );
      if (expired.length === 0) return;
      await Promise.all(
        expired.map((spot) =>
          updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'spots', spot.id), {
            status: 'expired',
          }),
        ),
      );
    }, 5_000);
    return () => clearInterval(interval);
  }, [spots]);

  // --- Handlers ---
	  const handleProposeSpot = async ({ car, time, price, length, vehiclePlate, vehicleId }) => {
	    if (!user) return;
	    // Best-effort: keep location fresh, but don't block publishing on geolocation (iOS can take seconds).
	    logCurrentLocation('propose_spot');
	    const arcLat = 48.8738;
	    const arcLng = 2.2950;
	    const vehicleToUse = car || selectedVehicle?.model || '';
	    const x = 50 + (Math.random() * 40 - 20);
	    const y = 50 + (Math.random() * 40 - 20);
	    try {
	      if (myActiveSpot && myActiveSpot.status !== 'completed' && myActiveSpot.status !== 'cancelled') {
	        const err = new Error('active_spot_exists');
	        err.code = 'active_spot_exists';
	        throw err;
	      }

	      const spotPayload = {
	        hostId: user.uid,
	        hostName: user.displayName || 'Anonymous',
	        carModel: vehicleToUse,
	        hostVehiclePlate: vehiclePlate || selectedVehicle?.plate || null,
	        hostVehicleId: vehicleId || selectedVehicle?.id || null,
	        time,
	        price,
	        length: length ?? null,
	        x,
	        y,
	        lat: arcLat,
	        lng: arcLng,
	        status: 'available',
	        createdAt: serverTimestamp(),
	        address: 'Arc de Triomphe, Paris',
	      };

	      const spotRef = await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'spots'), spotPayload);

	      // Optimistic UI: show the waiting state immediately (snapshot will reconcile).
	      setMyActiveSpot({
	        id: spotRef.id,
	        ...spotPayload,
	        createdAt: Date.now(),
	      });

	      // Leaderboard/transactions are non-critical; don't block spot publishing on them.
	      upsertTransaction({
	        spot: { id: spotRef.id, hostId: user.uid, hostName: user.displayName, price },
	        userId: user.uid,
	        status: 'started',
	        role: 'host',
	      }).catch((err) => console.error('Error creating host transaction:', err));
	      setActiveTab('propose');
	      return { ok: true, spotId: spotRef.id };
	    } catch (err) {
	      console.error('Error creating spot:', err);
	      throw err;
	    }
	  };

		  const handleSelectionStep = async (step, spot, meta = {}) => {
		    if (step !== 'nav_started') {
		      saveSelectionStep(step, spot, meta);
		      return { ok: true };
		    }

	    if (!user || !spot?.id) return { ok: false, code: 'missing_input' };

	    const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spot.id);
	    const bookerRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);

	    const bookingSessionId =
	      typeof meta?.bookingSessionId === 'string' && meta.bookingSessionId
	        ? meta.bookingSessionId
	        : typeof spot?.bookingSessionId === 'string' && spot.bookingSessionId
	          ? spot.bookingSessionId
	          : null;
	    const fallbackSessionId = bookingSessionId || newId();
	    const navOpId =
	      typeof meta?.opId === 'string' && meta.opId
	        ? meta.opId
	        : fallbackSessionId;

	    try {
	      const result = await runTransaction(db, async (tx) => {
	        const snap = await tx.get(spotRef);
	        if (!snap.exists()) {
	          const err = new Error('spot_missing');
	          err.code = 'spot_missing';
	          throw err;
	        }

	        const liveSpot = { id: spot.id, ...snap.data() };
	        const status = liveSpot.status;
	        if (status !== 'booked') {
	          const err = new Error('spot_not_booked');
	          err.code = 'spot_not_booked';
	          throw err;
	        }
	        if (liveSpot.bookerId !== user.uid) {
	          const err = new Error('not_booker');
	          err.code = 'not_booker';
	          throw err;
	        }

	        const liveSessionId =
	          typeof liveSpot.bookingSessionId === 'string' && liveSpot.bookingSessionId
	            ? liveSpot.bookingSessionId
	            : null;
	        if (bookingSessionId && liveSessionId && bookingSessionId !== liveSessionId) {
	          const err = new Error('session_mismatch');
	          err.code = 'session_mismatch';
	          throw err;
	        }
	        const resolvedSessionId = liveSessionId || bookingSessionId || fallbackSessionId;

	        const free = isFreeSpot(liveSpot);
	        const resolvedHostId = liveSpot.hostId || spot.hostId || null;
	        const hostRef = resolvedHostId
	          ? doc(db, 'artifacts', appId, 'public', 'data', 'users', resolvedHostId)
	          : null;

	        const alreadyApplied = !!liveSpot.premiumParksAppliedAt;
	        let bookerSnap = null;
	        let hostSnap = null;
	        if (free && !alreadyApplied) {
	          bookerSnap = await tx.get(bookerRef);
	          if (hostRef && resolvedHostId && resolvedHostId !== user.uid) {
	            hostSnap = await tx.get(hostRef);
	          }
	        }

	        let premiumParksDeltaApplied = false;
	        let bookerBefore = null;
	        let bookerAfter = null;
	        let hostAfter = null;
	        let hostDelta = 0;

	        if (free && !alreadyApplied) {
	          const bookerData = bookerSnap?.exists() ? bookerSnap.data() : {};
	          const currentHeartsRaw = Number(bookerData?.premiumParks);
	          const currentHearts = Number.isFinite(currentHeartsRaw) ? currentHeartsRaw : PREMIUM_PARKS_MAX;
	          if (currentHearts <= 0) {
	            const err = new Error('no_premium_parks');
	            err.code = 'no_premium_parks';
	            throw err;
	          }

	          bookerBefore = currentHearts;
	          bookerAfter = Math.max(0, Math.min(PREMIUM_PARKS_MAX, currentHearts - 1));

	          if (hostRef && resolvedHostId && resolvedHostId !== user.uid) {
	            const hostData = hostSnap?.exists() ? hostSnap.data() : {};
	            const hostHeartsRaw = Number(hostData?.premiumParks);
	            const hostHearts = Number.isFinite(hostHeartsRaw) ? hostHeartsRaw : PREMIUM_PARKS_MAX;
	            hostAfter = Math.max(0, Math.min(PREMIUM_PARKS_MAX, hostHearts + 1));
	            hostDelta = hostAfter - hostHearts;
	          }

	          tx.set(
	            bookerRef,
	            { premiumParks: bookerAfter, premiumParksInitialized: true },
	            { merge: true },
	          );

	          if (hostRef && resolvedHostId && resolvedHostId !== user.uid) {
	            tx.set(
	              hostRef,
	              { premiumParks: hostAfter, premiumParksInitialized: true },
	              { merge: true },
	            );
	          }

	          premiumParksDeltaApplied = true;
	        }

	        const acceptancePayload = {};
	        if (!liveSpot.bookingSessionId) acceptancePayload.bookingSessionId = resolvedSessionId;
	        if (!liveSpot.navOpId) {
	          acceptancePayload.navOpId = navOpId;
	          acceptancePayload.navOpAt = serverTimestamp();
	        }
	        if (!liveSpot.bookerAccepted) {
	          acceptancePayload.bookerAccepted = true;
	          acceptancePayload.bookerAcceptedAt = serverTimestamp();
	        }

	        const nextBookerName = user.displayName || 'Seeker';
	        if (nextBookerName && liveSpot.bookerName !== nextBookerName) {
	          acceptancePayload.bookerName = nextBookerName;
	        }

	        const plate = selectedVehicle?.plate || null;
	        const vehicleId = selectedVehicle?.id || null;
	        if (plate && liveSpot.bookerVehiclePlate !== plate) acceptancePayload.bookerVehiclePlate = plate;
	        if (vehicleId && liveSpot.bookerVehicleId !== vehicleId) acceptancePayload.bookerVehicleId = vehicleId;

	        if (premiumParksDeltaApplied) {
	          acceptancePayload.premiumParksAppliedAt = serverTimestamp();
	          acceptancePayload.premiumParksAppliedBy = user.uid;
	          acceptancePayload.premiumParksBookerDelta = -1;
	          acceptancePayload.premiumParksBookerAfter = bookerAfter;
	          acceptancePayload.premiumParksHostDelta = hostDelta;
	          acceptancePayload.premiumParksHostAfter = hostAfter;
	        }

	        if (Object.keys(acceptancePayload).length > 0) {
	          tx.update(spotRef, acceptancePayload);
	        }

	        return {
	          ok: true,
	          isFree: free,
	          bookingSessionId: resolvedSessionId,
	          premiumParksDeltaApplied,
	          bookerBefore,
	          bookerAfter,
	          hostAfter,
	          hostDelta,
	        };
	      });

	      const persistedSessionId = result?.bookingSessionId || bookingSessionId || spot?.bookingSessionId || null;
	      saveSelectionStep(
	        step,
	        spot ? { ...spot, bookingSessionId: persistedSessionId } : spot,
	        persistedSessionId ? { ...meta, bookingSessionId: persistedSessionId } : meta,
	      );
	      return result;
	    } catch (err) {
	      console.error('Error marking nav started on spot', err);
	      return { ok: false, code: err?.code || err?.message || 'unknown_error' };
	    }
	  };

	  const handleBookSpot = async (spot, meta = {}) => {
	    if (!spot || !user) return { ok: false, code: 'missing_input' };
	    const bookingSessionId =
	      typeof meta?.bookingSessionId === 'string' && meta.bookingSessionId
	        ? meta.bookingSessionId
	        : newId();
	    const bookOpId =
	      typeof meta?.opId === 'string' && meta.opId
	        ? meta.opId
	        : bookingSessionId;
	    logCurrentLocation('book_spot');
	    try {
	      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spot.id);
	      const bookerRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);

	      const { isFree, hostId, bookingSessionId: confirmedSessionId } = await runTransaction(db, async (tx) => {
	        const snap = await tx.get(spotRef);
	        if (!snap.exists()) {
	          const err = new Error('spot_missing');
	          err.code = 'spot_missing';
	          throw err;
	        }

	        const liveSpot = { id: spot.id, ...snap.data() };
	        const status = liveSpot.status;
	        const liveSessionId = typeof liveSpot.bookingSessionId === 'string' ? liveSpot.bookingSessionId : null;
	        const liveBookOpId = typeof liveSpot.bookOpId === 'string' ? liveSpot.bookOpId : null;
	        if (status && status !== 'available') {
	          if (
	            status === 'booked' &&
	            liveSpot.bookerId === user.uid &&
	            liveSessionId === bookingSessionId &&
	            liveBookOpId === bookOpId
	          ) {
	            return {
	              isFree: isFreeSpot(liveSpot),
	              hostId: liveSpot.hostId || spot.hostId || null,
	              bookingSessionId: liveSessionId,
	            };
	          }
	          const err = new Error('spot_not_available');
	          err.code = 'spot_not_available';
	          throw err;
	        }

	        const free = isFreeSpot(liveSpot);
	        const resolvedHostId = liveSpot.hostId || spot.hostId || null;
	        const priceValue = Number(liveSpot.price ?? spot.price ?? 0);
	        const amount = Number.isFinite(priceValue) ? priceValue : 0;
	        const hostRef = resolvedHostId
	          ? doc(db, 'artifacts', appId, 'public', 'data', 'users', resolvedHostId)
	          : null;

	        if (amount) {
	          tx.set(bookerRef, { wallet: increment(-amount) }, { merge: true });
	          if (hostRef && resolvedHostId !== user.uid) {
	            tx.set(hostRef, { wallet: increment(amount) }, { merge: true });
	          }
	        }
	        if (free) {
	          const bookerSnap = await tx.get(bookerRef);
	          const bookerData = bookerSnap.exists() ? bookerSnap.data() : {};
	          const currentHeartsRaw = Number(bookerData?.premiumParks);
	          const currentHearts = Number.isFinite(currentHeartsRaw) ? currentHeartsRaw : PREMIUM_PARKS_MAX;
	          if (currentHearts <= 0) {
	            const err = new Error('no_premium_parks');
	            err.code = 'no_premium_parks';
	            throw err;
	          }
	        }

	        tx.update(spotRef, {
	          status: 'booked',
	          bookingSessionId,
	          bookedAt: serverTimestamp(),
	          bookOpId,
	          bookOpAt: serverTimestamp(),
	          bookerId: user.uid,
	          bookerName: user.displayName || 'Seeker',
	          bookerAccepted: false,
	          bookerAcceptedAt: null,
	          navOpId: null,
	          navOpAt: null,
	          bookerVehiclePlate: selectedVehicle?.plate || null,
	          bookerVehicleId: selectedVehicle?.id || null,
	          premiumParksAppliedAt: null,
	          premiumParksAppliedBy: null,
	          premiumParksBookerDelta: null,
	          premiumParksBookerAfter: null,
	          premiumParksHostDelta: null,
	          premiumParksHostAfter: null,
	          hostVerifiedBookerPlate: false,
	          hostVerifiedBookerPlateAt: null,
	          hostConfirmedBookerPlate: null,
	          hostConfirmedBookerPlateNorm: null,
	          bookerVerifiedHostPlate: false,
	          bookerVerifiedHostPlateAt: null,
	          bookerConfirmedHostPlate: null,
	          bookerConfirmedHostPlateNorm: null,
	          plateConfirmed: false,
	          completedAt: null,
	          cancelledAt: null,
	          cancelledBy: null,
	          cancelledByRole: null,
	          cancelledFor: null,
	          cancelledForName: null,
	        });

	        return { isFree: free, hostId: resolvedHostId, bookingSessionId };
	      });
	      setSelectedSearchSpot((prev) =>
	        prev?.id === spot.id ? { ...prev, bookingSessionId: confirmedSessionId } : prev,
	      );
	      await upsertTransaction({
	        spot: { ...spot, bookerId: user.uid, bookerName: user.displayName, bookingSessionId: confirmedSessionId },
	        userId: user.uid,
	        status: 'accepted',
	        role: 'booker',
	      });
	      if (hostId && hostId !== user.uid) {
	        await upsertTransaction({
	          spot: { ...spot, bookerId: user.uid, bookerName: user.displayName, bookingSessionId: confirmedSessionId },
	          userId: hostId,
	          status: 'accepted',
	          role: 'host',
	        });
	      }
	      setActiveTab('search');
	      saveSelectionStep('booked', { ...spot, bookingSessionId: confirmedSessionId });
	      return { ok: true, isFree, bookingSessionId: confirmedSessionId };
	    } catch (err) {
	      console.error('Error booking spot:', err);
	      return { ok: false, code: err?.code || err?.message || 'unknown_error' };
	    }
	  };

	  const handleConfirmPlate = async (spotId, plate, meta = {}) => {
	    if (!spotId || !user?.uid) return { ok: false, message: 'Impossible de confirmer la plaque. Réessaie.' };
	    const requestedSessionId =
	      typeof meta?.bookingSessionId === 'string' && meta.bookingSessionId ? meta.bookingSessionId : null;
	    const submitted = normalizePlate(plate);
	    if (!submitted) return { ok: false, message: 'Impossible de confirmer la plaque. Réessaie.' };

	    try {
	      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
	      const result = await runTransaction(db, async (tx) => {
	        const snap = await tx.get(spotRef);
	        if (!snap.exists()) {
	          const err = new Error('spot_missing');
	          err.code = 'spot_missing';
	          throw err;
	        }
	        const liveSpot = { id: spotId, ...snap.data() };
	        if (liveSpot.status !== 'booked') {
	          const err = new Error('spot_not_booked');
	          err.code = 'spot_not_booked';
	          throw err;
	        }
	        if (liveSpot.hostId !== user.uid) {
	          const err = new Error('not_host');
	          err.code = 'not_host';
	          throw err;
	        }
	        const liveSessionId =
	          typeof liveSpot.bookingSessionId === 'string' && liveSpot.bookingSessionId
	            ? liveSpot.bookingSessionId
	            : null;
	        if (requestedSessionId && liveSessionId && requestedSessionId !== liveSessionId) {
	          const err = new Error('session_mismatch');
	          err.code = 'session_mismatch';
	          throw err;
	        }

	        const expected = normalizePlate(liveSpot.bookerVehiclePlate);
	        if (!expected || submitted !== expected) {
	          const err = new Error('plate_mismatch');
	          err.code = 'plate_mismatch';
	          throw err;
	        }

	        if (
	          liveSpot.hostVerifiedBookerPlate === true &&
	          liveSpot.hostConfirmedBookerPlateNorm &&
	          liveSpot.hostConfirmedBookerPlateNorm === submitted
	        ) {
	          return { ok: true, already: true };
	        }

	        tx.update(spotRef, {
	          hostVerifiedBookerPlate: true,
	          hostVerifiedBookerPlateAt: serverTimestamp(),
	          hostConfirmedBookerPlate: plate || null,
	          hostConfirmedBookerPlateNorm: submitted || null,
	        });
	        return { ok: true };
	      });
	      return result;
	    } catch (err) {
	      console.error('Error confirming plate:', err);
	      if (err?.code === 'plate_mismatch') {
	        return {
	          ok: false,
	          message: "La plaque ne correspond pas au véhicule actif de l'autre utilisateur.",
	        };
	      }
	      return { ok: false, message: 'Impossible de confirmer la plaque. Réessaie.' };
	    }
	  };

	  const handleConfirmHostPlate = async (spotId, plate, meta = {}) => {
	    if (!spotId || !user?.uid) return { ok: false, message: 'Impossible de confirmer la plaque. Réessaie.' };
	    const requestedSessionId =
	      typeof meta?.bookingSessionId === 'string' && meta.bookingSessionId ? meta.bookingSessionId : null;
	    const submitted = normalizePlate(plate);
	    if (!submitted) return { ok: false, message: 'Impossible de confirmer la plaque. Réessaie.' };

	    try {
	      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
	      const result = await runTransaction(db, async (tx) => {
	        const snap = await tx.get(spotRef);
	        if (!snap.exists()) {
	          const err = new Error('spot_missing');
	          err.code = 'spot_missing';
	          throw err;
	        }
	        const liveSpot = { id: spotId, ...snap.data() };
	        if (liveSpot.status !== 'booked') {
	          const err = new Error('spot_not_booked');
	          err.code = 'spot_not_booked';
	          throw err;
	        }
	        if (liveSpot.bookerId !== user.uid) {
	          const err = new Error('not_booker');
	          err.code = 'not_booker';
	          throw err;
	        }
	        const liveSessionId =
	          typeof liveSpot.bookingSessionId === 'string' && liveSpot.bookingSessionId
	            ? liveSpot.bookingSessionId
	            : null;
	        if (requestedSessionId && liveSessionId && requestedSessionId !== liveSessionId) {
	          const err = new Error('session_mismatch');
	          err.code = 'session_mismatch';
	          throw err;
	        }

	        const expected = normalizePlate(liveSpot.hostVehiclePlate);
	        if (!expected || submitted !== expected) {
	          const err = new Error('plate_mismatch');
	          err.code = 'plate_mismatch';
	          throw err;
	        }

	        if (
	          liveSpot.bookerVerifiedHostPlate === true &&
	          liveSpot.bookerConfirmedHostPlateNorm &&
	          liveSpot.bookerConfirmedHostPlateNorm === submitted &&
	          (liveSpot.plateConfirmed || liveSpot.status === 'completed')
	        ) {
	          return { ok: true, finalized: true, spot: liveSpot };
	        }

	        const shouldFinalize =
	          liveSpot.hostVerifiedBookerPlate === true &&
	          !liveSpot.plateConfirmed &&
	          liveSpot.status !== 'completed';

	        const updates = {
	          bookerVerifiedHostPlate: true,
	          bookerVerifiedHostPlateAt: serverTimestamp(),
	          bookerConfirmedHostPlate: plate || null,
	          bookerConfirmedHostPlateNorm: submitted || null,
	        };
	        if (shouldFinalize) {
	          updates.status = 'completed';
	          updates.plateConfirmed = true;
	          updates.completedAt = serverTimestamp();
	        }

	        tx.update(spotRef, updates);

	        return { ok: true, finalized: shouldFinalize, spot: liveSpot };
	      });

	      if (result?.ok && result.finalized) {
	        const spot = result.spot || findSpotById(spotId) || { id: spotId };
	        if (spot.hostId) {
	          await upsertTransaction({ spot, userId: spot.hostId, status: 'concluded', role: 'host' });
	        }
	        if (spot.bookerId) {
	          await upsertTransaction({ spot, userId: spot.bookerId, status: 'concluded', role: 'booker' });
	        }
	      }
	      return { ok: true };
	    } catch (err) {
	      console.error('Error confirming host plate:', err);
	      if (err?.code === 'plate_mismatch') {
	        return {
	          ok: false,
	          message: "La plaque ne correspond pas au véhicule actif de l'autre utilisateur.",
	        };
	      }
	      return { ok: false, message: 'Impossible de confirmer la plaque. Réessaie.' };
	    }
	  };

  const handleCompleteSwap = async (spotId) => {
    try {
      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
      await updateDoc(spotRef, {
        status: 'completed',
      });
      setMyActiveSpot(null);
      setBookedSpot(null);
      saveSelectionStep('cleared', null);
    } catch (err) {
      console.error('Error completing swap:', err);
    }
  };

	  const handleCancelSpot = async (spotId) => {
	    try {
	      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
	      const spot = myActiveSpot?.id === spotId ? myActiveSpot : null;

	      if (spot?.bookerId) {
	        await runTransaction(db, async (tx) => {
	          const snap = await tx.get(spotRef);
	          if (!snap.exists()) return;
	          const liveSpot = { id: spotId, ...snap.data() };
	          const hostId = liveSpot.hostId || user?.uid || null;
	          const cancelPayload = {
	            status: 'cancelled',
	            cancelledAt: serverTimestamp(),
	            cancelledBy: user?.uid || null,
	            cancelledByRole: 'host',
	            cancelledFor: liveSpot.bookerId || spot.bookerId,
	            cancelledForName: liveSpot.bookerName || spot.bookerName || null,
	            bookingSessionId: null,
	            bookedAt: null,
	            bookOpId: null,
	            bookOpAt: null,
	            navOpId: null,
	            navOpAt: null,
	            bookerId: null,
	            bookerName: null,
	            bookerAccepted: false,
	            bookerAcceptedAt: null,
	            bookerVehiclePlate: null,
	            bookerVehicleId: null,
	            hostVerifiedBookerPlate: false,
	            hostVerifiedBookerPlateAt: null,
	            hostConfirmedBookerPlate: null,
	            hostConfirmedBookerPlateNorm: null,
	            bookerVerifiedHostPlate: false,
	            bookerVerifiedHostPlateAt: null,
	            bookerConfirmedHostPlate: null,
	            bookerConfirmedHostPlateNorm: null,
	            plateConfirmed: false,
	            completedAt: null,
	          };

	          if (hostId) {
	            const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', hostId);
	            const userSnap = await tx.get(userRef);
	            const currentHeartsRaw = Number(userSnap?.data()?.premiumParks);
	            const currentHearts = Number.isFinite(currentHeartsRaw) ? currentHeartsRaw : PREMIUM_PARKS_MAX;
	            const nextHearts = Math.max(0, Math.min(PREMIUM_PARKS_MAX, currentHearts - 1));
	            const delta = nextHearts - currentHearts;
	            tx.set(
	              userRef,
	              { premiumParks: nextHearts, premiumParksInitialized: true },
	              { merge: true },
	            );
	            cancelPayload.premiumParksAppliedAt = serverTimestamp();
	            cancelPayload.premiumParksAppliedBy = hostId;
	            cancelPayload.premiumParksHostDelta = delta;
	            cancelPayload.premiumParksHostAfter = nextHearts;
	            cancelPayload.premiumParksBookerDelta = null;
	            cancelPayload.premiumParksBookerAfter = null;
	          } else {
	            cancelPayload.premiumParksAppliedAt = null;
	            cancelPayload.premiumParksAppliedBy = null;
	            cancelPayload.premiumParksHostDelta = null;
	            cancelPayload.premiumParksHostAfter = null;
	            cancelPayload.premiumParksBookerDelta = null;
	            cancelPayload.premiumParksBookerAfter = null;
	          }

	          tx.update(spotRef, cancelPayload);
	        });
	      } else {
	        await deleteDoc(spotRef);
	      }

      setMyActiveSpot(null);
      setBookedSpot(null);
      setSelectedSearchSpot(null);
      saveSelectionStep('cleared', null);
      setActiveTab('search');
      if (spot?.bookerId && user?.uid) {
        const fromCount = Number.isFinite(Number(user?.premiumParks))
          ? Number(user?.premiumParks)
          : PREMIUM_PARKS_MAX;
        const toCount = Math.max(0, Math.min(PREMIUM_PARKS_MAX, fromCount - 1));
        if (toCount !== fromCount) {
          setPremiumParksDeltaToast({ from: fromCount, to: toCount });
        }
      }
    } catch (err) {
      console.error('Error deleting spot:', err);
    }
  };

	  const handleRenewSpot = async (spotId) => {
	    if (!spotId) return;
	    try {
	      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
	      await runTransaction(db, async (tx) => {
	        const snap = await tx.get(spotRef);
	        if (!snap.exists()) return;
	        const liveSpot = snap.data() || {};
	        if (liveSpot.status === 'booked' || liveSpot.bookerId) return;

	        tx.update(spotRef, {
	          status: 'available',
	          createdAt: serverTimestamp(),
	          bookingSessionId: null,
	          bookedAt: null,
	          bookOpId: null,
	          bookOpAt: null,
	          navOpId: null,
	          navOpAt: null,
	          bookerId: null,
	          bookerName: null,
	          bookerAccepted: false,
	          bookerAcceptedAt: null,
	          bookerVehiclePlate: null,
	          bookerVehicleId: null,
	          premiumParksAppliedAt: null,
	          premiumParksAppliedBy: null,
	          premiumParksBookerDelta: null,
	          premiumParksBookerAfter: null,
	          premiumParksHostDelta: null,
	          premiumParksHostAfter: null,
	          hostVerifiedBookerPlate: false,
	          hostVerifiedBookerPlateAt: null,
	          hostConfirmedBookerPlate: null,
	          hostConfirmedBookerPlateNorm: null,
	          bookerVerifiedHostPlate: false,
	          bookerVerifiedHostPlateAt: null,
	          bookerConfirmedHostPlate: null,
	          bookerConfirmedHostPlateNorm: null,
	          plateConfirmed: false,
	          completedAt: null,
	          cancelledAt: null,
	          cancelledBy: null,
	          cancelledByRole: null,
	          cancelledFor: null,
	          cancelledForName: null,
	        });
	      });
	    } catch (err) {
	      console.error('Error renewing spot:', err);
	    }
	  };

	  const handleCancelBooking = async (spotId, meta = {}) => {
	    if (!spotId || !user?.uid) return { ok: false, code: 'missing_input' };
	    const requestedSessionId =
	      typeof meta?.bookingSessionId === 'string' && meta.bookingSessionId ? meta.bookingSessionId : null;

	    try {
	      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
	      const result = await runTransaction(db, async (tx) => {
	        const snap = await tx.get(spotRef);
	        if (!snap.exists()) return { ok: true, skipped: true };
	        const liveSpot = { id: spotId, ...snap.data() };

	        const status = liveSpot.status;
	        if (status !== 'booked') {
	          return { ok: true, already: true };
	        }
	        if (liveSpot.bookerId !== user.uid) {
	          const err = new Error('not_booker');
	          err.code = 'not_booker';
	          throw err;
	        }

	        const liveSessionId =
	          typeof liveSpot.bookingSessionId === 'string' && liveSpot.bookingSessionId
	            ? liveSpot.bookingSessionId
	            : null;
	        if (requestedSessionId && liveSessionId && requestedSessionId !== liveSessionId) {
	          // Stale cancel request: do not affect a newer booking session.
	          return { ok: true, stale: true };
	        }

	        tx.update(spotRef, {
	          status: 'available',
	          bookingSessionId: null,
	          bookedAt: null,
	          bookOpId: null,
	          bookOpAt: null,
	          navOpId: null,
	          navOpAt: null,
	          bookerId: null,
	          bookerName: null,
	          bookerAccepted: false,
	          bookerAcceptedAt: null,
	          bookerVehiclePlate: null,
	          bookerVehicleId: null,
	          premiumParksAppliedAt: null,
	          premiumParksAppliedBy: null,
	          premiumParksBookerDelta: null,
	          premiumParksBookerAfter: null,
	          premiumParksHostDelta: null,
	          premiumParksHostAfter: null,
	          hostVerifiedBookerPlate: false,
	          hostVerifiedBookerPlateAt: null,
	          hostConfirmedBookerPlate: null,
	          hostConfirmedBookerPlateNorm: null,
	          bookerVerifiedHostPlate: false,
	          bookerVerifiedHostPlateAt: null,
	          bookerConfirmedHostPlate: null,
	          bookerConfirmedHostPlateNorm: null,
	          plateConfirmed: false,
	          completedAt: null,
	          cancelledAt: null,
	          cancelledBy: null,
	          cancelledByRole: null,
	          cancelledFor: null,
	          cancelledForName: null,
	        });

	        return { ok: true };
	      });

	      setBookedSpot(null);
	      saveSelectionStep('cleared', null);
	      return result;
	    } catch (err) {
	      console.error('Error canceling booking:', err);
	      return { ok: false, code: err?.code || err?.message || 'unknown_error' };
	    }
	  };

  const handleAddVehicle = async ({ model, plate, photo }) => {
    if (!user || !model || !plate) return;
    try {
      await addDoc(vehiclesCollectionForUser(user.uid), {
        ownerId: user.uid,
        model,
        plate,
        photo: photo || null,
        isDefault: vehicles.length === 0,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Error adding vehicle:', err);
    }
  };

  const handleDeleteVehicle = async (vehicleId) => {
    if (!vehicleId) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid, 'vehicles', vehicleId));
    } catch (err) {
      console.error('Error deleting vehicle:', err);
    }
  };

  const handleSelectVehicle = async (vehicleId) => {
    if (!vehicleId || !user) return;
    try {
      const updates = vehicles.map((v) =>
        updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid, 'vehicles', v.id), {
          isDefault: v.id === vehicleId,
        }),
      );
      await Promise.all(updates);
      const newDefault = vehicles.find((v) => v.id === vehicleId) || null;
      setSelectedVehicle(newDefault);
    } catch (err) {
      console.error('Error selecting vehicle:', err);
    }
  };

  const handleUpdateProfile = async ({ displayName, email, phone, language, phoneVerified }) => {
    if (!user?.uid) return { needsEmailVerify: false, reauthRequired: false };
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
    const needsEmailVerify = !!email && email !== user.email;
    let verificationEmailSent = false;
    let reauthRequired = false;
    try {
      const updates = {
        displayName: displayName || null,
        email: email || null,
        phone: phone || null,
        language: language || i18n.language || 'en',
      };

      // Email verification flow
      if (needsEmailVerify && auth.currentUser) {
        try {
          await updateEmail(auth.currentUser, email);
          await sendEmailVerification(auth.currentUser);
          verificationEmailSent = true;
          updates.email = user.email; // keep old email until verified
          updates.pendingEmail = email;
          updates.emailVerified = false;
          await setDoc(userRef, updates, { merge: true });
          await signOut(auth);
          return { needsEmailVerify: true, reauthRequired: false };
        } catch (err) {
          if (err?.code === 'auth/requires-recent-login') {
            reauthRequired = true;
          }
          return { needsEmailVerify: false, reauthRequired, error: err };
        }
      }

      // Phone: track verification when changed
      if (phone && phone !== user.phone) {
        updates.phoneVerified = phoneVerified === true ? true : false;
      } else if (phoneVerified === true) {
        updates.phoneVerified = true;
      }

      await setDoc(
        userRef,
        updates,
        { merge: true },
      );
      setUser((prev) => ({
        ...prev,
        displayName: displayName || prev.displayName,
        email: email || prev.email,
        phone: phone || prev.phone,
        language: language || prev.language || i18n.language,
        phoneVerified: updates.phoneVerified ?? prev.phoneVerified,
      }));
    } catch (err) {
      console.error('Error updating profile:', err);
      return { needsEmailVerify: false, reauthRequired, error: err };
    }
    return { needsEmailVerify: verificationEmailSent, reauthRequired };
  };

  const handleAddWallet = async (amount) => {
    if (!user?.uid) return { ok: false };
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return { ok: false };
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
    try {
      await setDoc(userRef, { wallet: increment(value), updatedAt: serverTimestamp() }, { merge: true });
      setUser((prev) =>
        prev ? { ...prev, wallet: (Number(prev.wallet) || 0) + value } : prev,
      );
      return { ok: true };
    } catch (err) {
      console.error('Error adding wallet funds:', err);
      return { ok: false, error: err };
    }
  };

	  const handleLogout = async () => {
	    if (loggingOut) return;
	    const startMs = Date.now();
	    setLoggingOut(true);
	    try {
	      await signOut(auth);
	    } catch (err) {
	      console.error('Error signing out:', err);
	    }
	    const minMs = 2000;
	    const elapsed = Date.now() - startMs;
	    const remaining = Math.max(0, minMs - elapsed);
	    if (remaining) {
	      await new Promise((resolve) => window.setTimeout(resolve, remaining));
	    }
	    // Immediately reset local state so UI returns to auth screen
	    setUser(null);
	    setActiveTab('search');
	    setSearchDeckIndex(0);
	    setMyActiveSpot(null);
	    setBookedSpot(null);
	    setVehicles([]);
	    setSelectedVehicle(null);
	    setTransactions([]);
	    setLeaderboard([]);
	    setLoggingOut(false);
	  };

  const isSearchInProgress =
    !!myActiveSpot && myActiveSpot.status !== 'completed' && myActiveSpot.status !== 'cancelled';

  const changeTab = (nextTab) => {
    if (!nextTab || nextTab === activeTab) return;
    if (isSearchInProgress && nextTab !== 'propose') return;
    const currentIndex = tabOrder.indexOf(activeTab);
    const nextIndex = tabOrder.indexOf(nextTab);
    setSlideDir(nextIndex > currentIndex ? 'left' : 'right');
    setActiveTab(nextTab);
  };

  const persistSearchViewMode = async (mode) => {
    if (!user?.uid) return;
    try {
      const ref = doc(db, 'artifacts', appId, 'public', 'data', 'userSearchPrefs', user.uid);
      await setDoc(ref, { viewMode: mode, updatedAt: serverTimestamp() }, { merge: true });
      searchMapPrefRef.current = mode;
    } catch (err) {
      console.error('Error persisting search view mode:', err);
    }
  };

  const openSearchMap = () => {
    setSearchMapOpen(true);
    if (searchMapPrefRef.current !== 'map') {
      persistSearchViewMode('map');
    }
  };

  const closeSearchMap = () => {
    setSearchMapOpen(false);
    if (searchMapPrefRef.current !== 'list') {
      persistSearchViewMode('list');
    }
  };

  const toggleSearchMap = () => {
    if (searchMapOpen) {
      closeSearchMap();
    } else {
      openSearchMap();
    }
  };

  useEffect(() => {
    if (!user?.uid) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'userSearchPrefs', user.uid);
        const snap = await getDoc(ref);
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : null;
        const mode = data?.viewMode;
        if (mode === 'map') setSearchMapOpen(true);
        if (mode === 'list') setSearchMapOpen(false);
        if (mode) searchMapPrefRef.current = mode;
      } catch (err) {
        console.error('Error loading search view mode:', err);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!showAccountSheet) {
      setSheetExitAnim(false);
      setAccountSheetOffset(0);
      setIsSheetDragging(false);
      sheetDragRef.current = false;
      return;
    }
    setShowInvite(false);
    setCancelledNotice(null);
    setSearchFiltersOpen(false);
  }, [showAccountSheet]);

  useEffect(() => {
    if (!cancelledNotice) {
      if (cancelledNoticeTimerRef.current) {
        window.clearTimeout(cancelledNoticeTimerRef.current);
        cancelledNoticeTimerRef.current = null;
      }
      return;
    }
    if (cancelledNoticeTimerRef.current) {
      window.clearTimeout(cancelledNoticeTimerRef.current);
    }
    cancelledNoticeTimerRef.current = window.setTimeout(() => {
      setCancelledNotice(null);
      cancelledNoticeTimerRef.current = null;
    }, 5_000);
  }, [cancelledNotice]);

  useEffect(() => {
    prevTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (!isSearchInProgress) return;
    if (activeTab === 'propose') return;
    setSlideDir('right');
    setActiveTab('propose');
  }, [isSearchInProgress, activeTab]);

  const inviteLink = typeof window !== 'undefined' ? window.location.origin : 'https://parkswap.app';
  const handleInviteShare = async () => {
    setInviteMessage('');
    if (navigator?.share) {
      try {
        await navigator.share({
          title: 'Join me on ParkSwap',
          text: 'Swap parking spots with me on ParkSwap!',
          url: inviteLink,
        });
        setInviteMessage('Shared ✨');
        return;
      } catch (_) {
        // ignore and fallback to copy
      }
    }
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(inviteLink);
        setInviteMessage('Link copied');
        return;
      } catch (_) {
        setInviteMessage('');
      }
    }
  };

  const renderTabContent = (tab) => {
    if (tab === 'search') {
      return (
        <div className="h-full w-full">
          <SearchView
            spots={visibleSpots}
            bookedSpot={bookedSpot}
            onCompleteSwap={handleCompleteSwap}
            onBookSpot={handleBookSpot}
            onCancelBooking={handleCancelBooking}
            selectedSpot={selectedSearchSpot}
            setSelectedSpot={setSelectedSearchSpot}
            onSelectionStep={handleSelectionStep}
	            leaderboard={leaderboard}
	            userCoords={userCoords}
	            currentUserId={user?.uid || null}
              onFiltersOpenChange={setSearchFiltersOpen}
	            premiumParks={user?.premiumParks ?? PREMIUM_PARKS_MAX}
	            deckIndex={searchDeckIndex}
	            setDeckIndex={setSearchDeckIndex}
	          />
        </div>
      );
    }
    if (tab === 'propose') {
      return (
        <div className="h-full w-full">
          <ProposeView
            ref={proposeViewRef}
            myActiveSpot={myActiveSpot}
            vehicles={vehicles}
            onProposeSpot={handleProposeSpot}
            onConfirmPlate={handleConfirmPlate}
            onCancelSpot={handleCancelSpot}
            onRenewSpot={handleRenewSpot}
            onNudgeAddVehicle={openAddVehicle}
            renewFeedbackId={renewFeedbackId}
            renewWaveDurationMs={RENEW_WAVE_DURATION_MS}
          />
        </div>
      );
    }
    return (
      <div className="h-full w-full">
        <ProfileView
          user={user}
          vehicles={vehicles}
          onAddVehicle={handleAddVehicle}
          onDeleteVehicle={handleDeleteVehicle}
          onSelectVehicle={handleSelectVehicle}
          onUpdateProfile={handleUpdateProfile}
          onAddWallet={handleAddWallet}
          leaderboard={leaderboard}
          transactions={transactions}
          onLogout={handleLogout}
          theme={theme}
          onChangeTheme={setTheme}
          onInvite={handleInviteShare}
          inviteMessage={inviteMessage}
          openAddVehicleRequestId={addVehicleRequestId}
          highlightVehiclesRequestId={highlightVehiclesRequestId}
        />
      </div>
    );
  };

  // keep i18n in sync when profile already has a language
  useEffect(() => {
    if (user?.language) {
      i18n.changeLanguage(user.language);
    }
  }, [user?.language]);

  if (initializing) {
  // 🔥 IMPORTANT : on attend Firebase avant d'afficher AuthView
  return (
    <div
      className={`relative h-screen w-full ${
        theme === 'dark' ? 'bg-[#0b1220] text-slate-100 app-surface' : 'bg-white'
      }`}
    >
      <OrientationBlockedOverlay visible={orientationBlocked} />
    </div>
  );
}

  if (!user) {
    return (
      <div
        className={`relative h-screen w-full overflow-hidden flex items-center justify-center ${
          theme === 'dark'
            ? 'bg-[#0b1220] text-slate-100 app-surface'
            : 'bg-gradient-to-br from-orange-50 via-white to-amber-50'
        }`}
      >
       <AuthView />
       {loggingIn && <AuthTransitionOverlay theme={theme} mode="in" name="" />}
       {loggingOut && <AuthTransitionOverlay theme={theme} mode="out" />}
       <OrientationBlockedOverlay visible={orientationBlocked} />
      </div>
    );
  }

  const isDark = theme === 'dark';
  const prevTab = prevTabRef.current;
  const shouldTabSlide =
    (prevTab === 'search' || prevTab === 'propose') &&
    (activeTab === 'search' || activeTab === 'propose') &&
    prevTab !== activeTab;
  const tabSlideClass = shouldTabSlide ? (slideDir === 'left' ? 'tab-slide-left' : 'tab-slide-right') : '';

	  const launchRenewWave = () => {
	    try {
	      if (typeof document === 'undefined') return;
      const fromEl = document.querySelector('[data-role="bottomnav-propose-button"]');
      const toEl = document.querySelector('[data-role="waiting-timer-target"]');
      if (!fromEl || !toEl) return;
      const from = fromEl.getBoundingClientRect();
      const to = toEl.getBoundingClientRect();
      const fromPt = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
      const toPt = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setRenewWave({ id, from: fromPt, to: toPt, phase: 0 });
      window.requestAnimationFrame(() => {
        setRenewWave((prev) => (prev && prev.id === id ? { ...prev, phase: 1 } : prev));
      });
      window.setTimeout(() => {
        setRenewWave((prev) => (prev && prev.id === id ? null : prev));
      }, RENEW_WAVE_DURATION_MS + 180);
    } catch (_) {
      // ignore
    }
	  };

	  const isHostSelectionFlow =
	    !!myActiveSpot && (myActiveSpot.status === 'booked' || myActiveSpot.status === 'confirmed');

	  return (
	    <div
	      className={`relative h-screen w-full font-sans overflow-hidden ${
	        theme === 'dark'
          ? 'bg-[#0b1220] text-slate-100 app-surface'
          : 'bg-gradient-to-br from-orange-50 via-white to-amber-50'
      }`}
    >
      {loggingIn && <AuthTransitionOverlay theme={theme} mode="in" name={user?.displayName || ''} />}
      {loggingOut && <AuthTransitionOverlay theme={theme} mode="out" />}
      <OrientationBlockedOverlay visible={orientationBlocked} />
      {renewWave ? (
        <div className="fixed inset-0 z-[10050] pointer-events-none">
          <div
            className="absolute w-4 h-4 rounded-full border-2 border-orange-500/70 bg-orange-400/15 shadow-[0_12px_30px_rgba(249,115,22,0.22)]"
            style={{
              left: 0,
              top: 0,
              transform: `translate(${(renewWave.phase ? renewWave.to.x : renewWave.from.x) - 8}px, ${
                (renewWave.phase ? renewWave.to.y : renewWave.from.y) - 8
              }px) scale(${renewWave.phase ? 2.2 : 1})`,
              opacity: renewWave.phase ? 0.15 : 0.95,
              transition: `transform ${RENEW_WAVE_DURATION_MS}ms cubic-bezier(0.2,0.8,0.2,1), opacity ${RENEW_WAVE_DURATION_MS}ms cubic-bezier(0.2,0.8,0.2,1)`,
              willChange: 'transform, opacity',
            }}
          />
        </div>
      ) : null}
      {premiumParksDeltaToast ? (
        <PremiumParksDeltaToast
          fromCount={premiumParksDeltaToast.from}
          toCount={premiumParksDeltaToast.to}
          onDone={() => setPremiumParksDeltaToast(null)}
        />
      ) : null}
	      {activeTab === 'search' && !searchFiltersOpen && !isHostSelectionFlow && (
	        <div
	          className={`fixed top-4 left-4 z-[90] transition-opacity duration-300 ${
	            hideNav ? 'opacity-0 pointer-events-none' : 'opacity-100'
	          }`}
	        >
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleMenuClick}
              className={`relative w-12 h-12 rounded-2xl shadow-sm transition active:scale-95 flex items-center justify-center border ${
                theme === 'dark'
                  ? 'bg-slate-900/80 text-slate-100 border-white/10 hover:bg-slate-800'
                  : 'bg-white/70 text-slate-900 border-white/60 hover:bg-white'
              }`}
              style={{ backdropFilter: 'blur(14px) saturate(180%)', WebkitBackdropFilter: 'blur(14px) saturate(180%)' }}
              aria-label={i18n.t('settings', 'Settings')}
              title={i18n.t('settings', 'Settings')}
            >
              {menuNudgeActive ? (
                <>
                  <span
                    className="pointer-events-none absolute -inset-1 rounded-[18px] bg-orange-400/25 blur-md animate-pulse"
                    aria-hidden="true"
                  />
                  <span
                    className="pointer-events-none absolute -inset-1 rounded-[18px] border border-orange-300/70"
                    aria-hidden="true"
                  />
                </>
              ) : null}
              <Settings size={22} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={toggleSearchMap}
              className={`relative w-12 h-12 rounded-2xl shadow-sm transition active:scale-95 flex items-center justify-center border ${
                theme === 'dark'
                  ? 'bg-slate-900/80 text-slate-100 border-white/10 hover:bg-slate-800'
                  : 'bg-white/70 text-slate-900 border-white/60 hover:bg-white'
              }`}
              style={{ backdropFilter: 'blur(14px) saturate(180%)', WebkitBackdropFilter: 'blur(14px) saturate(180%)' }}
              aria-label={searchMapOpen ? i18n.t('listView', 'Liste') : i18n.t('openMap', 'Carte')}
              title={searchMapOpen ? i18n.t('listView', 'Liste') : i18n.t('openMap', 'Carte')}
            >
              {searchMapOpen ? <List size={22} strokeWidth={2.5} /> : <MapPin size={22} strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      )}

	{showAccountSheet && (
  <div className="fixed inset-0 z-[400] flex flex-col justify-end">
    {/* Définition de l'animation */}
    <style>{`
      @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
    `}</style>

    {/* Backdrop */}
    <div
      className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
      onClick={closeAccountSheet}
    />
    
    {/* La feuille de compte */}
    <div

      className={`relative w-full h-[90vh] bg-white rounded-t-3xl shadow-2xl border border-gray-100 overflow-hidden 
        ${isSheetDragging ? '' : 'transition-transform duration-300 ease-out'}
      `}
      style={{ 
        transform: `translateY(${accountSheetOffset}px)`,
        animation: sheetEntryAnim ? 'slideUp 0.3s ease-out forwards' : 'none'
      }}
      onTouchStart={(e) => handleAccountSheetPointerDown(e)}
      onMouseDown={(e) => handleAccountSheetPointerDown(e)}
    >
      {/* ... Le reste du contenu ne change pas ... */}
      {/* ... reste du contenu de la modale ... */}
      <div 
        className="absolute inset-x-0 top-0 h-8 z-10 flex justify-center pt-3 cursor-grab active:cursor-grabbing bg-white"
        onPointerDown={handleAccountSheetPointerDown}
      >
        <div className="w-12 h-1.5 rounded-full bg-gray-300" />
      </div>

      <div className="h-full pt-8 overflow-hidden">
        <ProfileView
          user={user}
          vehicles={vehicles}
          onAddVehicle={handleAddVehicle}
          onDeleteVehicle={handleDeleteVehicle}
          onSelectVehicle={handleSelectVehicle}
          onUpdateProfile={handleUpdateProfile}
          onAddWallet={handleAddWallet}
          leaderboard={leaderboard}
          transactions={transactions}
          onLogout={handleLogout}
          theme={theme}
          onChangeTheme={setTheme}
          onInvite={handleInviteShare}
          inviteMessage={inviteMessage}
          openAddVehicleRequestId={addVehicleRequestId}
          highlightVehiclesRequestId={highlightVehiclesRequestId}
        />
      </div>
    </div>
  </div>
	)}
      {cancelledNotice && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center px-6">
          <div
            className={`absolute inset-0 backdrop-blur-sm ${isDark ? 'bg-black/70' : 'bg-black/50'}`}
            onClick={() => setCancelledNotice(null)}
          />
          <div
            className="
              relative w-full max-w-md
              rounded-[28px] border
              shadow-[0_30px_90px_rgba(15,23,42,0.35)]
              p-6 text-center
            "
            style={
              isDark
                ? { WebkitBackdropFilter: 'blur(24px) saturate(180%)', backgroundColor: 'rgba(15,23,42,0.78)', borderColor: 'rgba(255,255,255,0.12)' }
                : { WebkitBackdropFilter: 'blur(24px) saturate(180%)', backgroundColor: 'rgba(255,255,255,0.85)', borderColor: 'rgba(255,255,255,0.6)' }
            }
            role="dialog"
            aria-modal="true"
            aria-label="Cancellation notice"
          >
            <p className={`text-xs uppercase tracking-[0.18em] font-semibold mb-2 ${isDark ? 'text-orange-300' : 'text-orange-600'}`}>
              {i18n.t('update', 'Mise à jour')}
            </p>
            <h3 className={`text-2xl font-extrabold ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {i18n.t('offerCancelledTitle', 'Proposition annulée')}
            </h3>
            <p className={`mt-3 text-sm ${isDark ? 'text-slate-200/80' : 'text-slate-700'}`}>
              {i18n.t(
                'offerCancelledBody',
                "L'utilisateur a annulé sa proposition. Tu es de retour à l'accueil.",
              )}
            </p>
            <button
              type="button"
              onClick={() => setCancelledNotice(null)}
              className={`
                mt-5 w-full h-12 rounded-2xl
                text-white font-extrabold shadow-[0_12px_30px_rgba(249,115,22,0.35)]
                hover:brightness-110 transition active:scale-[0.99]
                ${isDark ? 'bg-gradient-to-r from-orange-400 to-amber-400' : 'bg-gradient-to-r from-orange-500 to-amber-500'}
              `}
            >
              OK
            </button>
          </div>
        </div>
      )}
	      {celebration && <ConfettiOverlay seedKey={`${celebration.spotId}:${user?.uid || 'user'}`} />}
	      {showInvite && (
	        <div className="fixed inset-0 z-[120] flex items-center justify-center px-6">
	          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
	      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-orange-100 p-6 invite-pop">
            <button
              type="button"
              onClick={() => setShowInvite(false)}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
              aria-label="Close invite"
            >
              ×
            </button>
            <p className="text-xs uppercase tracking-[0.18em] text-orange-500 font-bold mb-2">Invite friends</p>
            <h3 className="text-2xl font-bold text-slate-900 mb-3">Share ParkSwap</h3>
            <p className="text-gray-600 text-sm mb-4">
              Send your friends a link to join you on ParkSwap. Parking swaps are better together.
            </p>
            <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-sm text-gray-700 mb-4 flex items-center justify-between">
              <span className="truncate">{inviteLink}</span>
              <button
                type="button"
                onClick={handleInviteShare}
                className="ml-3 text-orange-600 font-semibold hover:underline"
              >
                {navigator?.share ? 'Share' : 'Copy'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleInviteShare}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-400 text-white py-3 rounded-xl font-bold shadow-lg hover:scale-[1.01] transition"
            >
              Invite now
            </button>
            {inviteMessage ? (
              <p className="text-sm text-green-600 mt-2 text-center">{inviteMessage}</p>
            ) : null}
          </div>
        </div>
      )}
     <div className="relative flex flex-col h-full">
        <div className={`flex-1 overflow-hidden relative ${theme === 'dark' ? 'bg-[#0b1220]' : ''}`}>
          <div key={activeTab} className={`absolute inset-0 ${tabSlideClass}`}>
            {renderTabContent(activeTab)}
          </div>
        </div>
        <div className="transition-opacity duration-300 opacity-100 z-[70]" style={{ '--bottom-nav-height': 'auto' }}>
      {!(activeTab === 'propose' && myActiveSpot?.status === 'booked') && (
        <BottomNav
          activeTab={activeTab}
          setActiveTab={changeTab}
          waitingMode={activeTab === 'propose' && !!myActiveSpot}
          canPublish={vehicles.length > 0}
          onPublishDisabledPress={openAddVehicle}
          onCancelPress={() => {
            if (!myActiveSpot?.id) return;
            handleCancelSpot(myActiveSpot.id);
          }}
          onRenewPress={() => {
            if (!myActiveSpot?.id) return;
            setRenewFeedbackId((v) => v + 1);
            launchRenewWave();
            handleRenewSpot(myActiveSpot.id);
          }}
          onProposePress={() => {
            if (activeTab !== 'propose') {
              changeTab('propose');
              return;
            }
            proposeViewRef.current?.publish?.();
          }}
        />
      )}
        </div>
      </div>
      {selectedSearchSpot && (selectedSearchSpot?.mapOnly || getRemainingMs(selectedSearchSpot) > 0) && (
        <Map
          spot={selectedSearchSpot}
          onClose={closeMap}
          onCancelBooking={handleCancelBooking}
          onConfirmHostPlate={handleConfirmHostPlate}
          onNavStateChange={setHideNav}
          onSelectionStep={handleSelectionStep}
          initialStep={selectionSnapshot?.step || (bookedSpot ? 'booked' : null)}
          currentUserId={user?.uid || null}
          currentUserName={user?.displayName || 'User'}
          userCoords={userCoords}
        />
      )}
      {activeTab === 'search' && searchMapOpen && (
        <MapSearchView
          spots={visibleSpots}
          userCoords={userCoords}
          currentUserId={user?.uid || null}
          onFiltersOpenChange={setSearchFiltersOpen}
          onBookSpot={handleBookSpot}
          onSelectionStep={handleSelectionStep}
          setSelectedSpot={setSelectedSearchSpot}
          premiumParks={user?.premiumParks ?? PREMIUM_PARKS_MAX}
        />
      )}
      <TapDebugOverlay />
    </div>
  );
}
