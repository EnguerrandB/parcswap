// src/App.jsx
import React, { useEffect, useState, useRef } from 'react';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  where,
  setDoc,
  limit,
  increment,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signOut,
  updateEmail,
  sendEmailVerification,
} from 'firebase/auth';

import { db, appId, auth } from './firebase';
import BottomNav from './components/BottomNav';
import SearchView from './views/SearchView';
import ProposeView from './views/ProposeView';
import ProfileView from './views/ProfileView';
import AuthView from './views/AuthView';
import i18n from './i18n/i18n';
import AppLogo from './components/AppLogo';
import movingLogo from './assets/logo_moving.svg';
import Map from './components/Map';

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

const BOTTOM_NAV_HEIGHT = 96; // fallback if we can't measure the nav
const measureBottomSafeOffset = () => {
  if (typeof document === 'undefined') return BOTTOM_NAV_HEIGHT;
  const nav = document.getElementById('bottom-nav');
  if (!nav) return BOTTOM_NAV_HEIGHT;
  const rect = nav.getBoundingClientRect();
  return Math.round(rect.height);
};

export default function ParkSwapApp() {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [activeTab, setActiveTab] = useState('search');
  const ENABLE_TAB_SWIPE = false; // toggle to true to re-enable swipe between tabs
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const touchStartTime = useRef(null);
  const tabOrder = ['search', 'propose', 'profile'];
  const [slideDir, setSlideDir] = useState('left');
  // Ajoutez ceci avec vos autres useState
  const [sheetEntryAnim, setSheetEntryAnim] = useState(false);
  const [dragProgress, setDragProgress] = useState(0); // -1 (to prev) to 1 (to next)
  const [dragging, setDragging] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const lastKnownLocationRef = useRef(null);
  const selectionWriteInFlight = useRef(false);
  const selectionQueueRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const heartbeatInFlightRef = useRef(false);

  // Try to lock orientation to portrait (best-effort; may fail on some browsers)
  useEffect(() => {
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
      if (screen?.orientation?.type && !screen.orientation.type.includes('portrait')) {
        lockOrientation();
      }
    };
    window.addEventListener('orientationchange', onOrientationChange);
    return () => window.removeEventListener('orientationchange', onOrientationChange);
  }, []);
  const upsertTransaction = async ({ spot, userId, status, role }) => {
    if (!spot || !userId) return;
    const txId = `${spot.id}-${userId}`;
    const titleHost = spot.bookerName ? `${spot.bookerName} ➜ ${spot.hostName || 'Host'}` : spot.hostName || 'Swap';
    const titleBooker = spot.hostName ? `${spot.hostName} ➜ You` : 'Swap';
    const title = role === 'host' ? titleHost : titleBooker;
    const amount = Number(spot.price || 0);
    const txDoc = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', txId);
    await setDoc(
      txDoc,
      {
        userId,
        spotId: spot.id,
        status,
        role,
        hostId: spot.hostId,
        hostName: spot.hostName || '',
        bookerId: spot.bookerId || null,
        bookerName: spot.bookerName || '',
        price: amount,
        amount,
        title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    // Increment leaderboard counter
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', userId);
    await setDoc(
      userRef,
      {
        transactions: increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {});
    if (userId === user?.uid) {
      setUser((prev) => (prev ? { ...prev, transactions: (Number(prev.transactions) || 0) + 1 } : prev));
    }
  };

  const saveSelectionStep = async (step, spot) => {
    if (!user?.uid) return;
    const ref = userSelectionRef(user.uid);
    const payload = {
      step: step || null,
      spotId: spot?.id || null,
      updatedAt: serverTimestamp(),
    };

    // Simple queue to avoid overlapping writes on rapid UI taps
    if (selectionWriteInFlight.current) {
      selectionQueueRef.current = { step: payload.step, spotId: payload.spotId };
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
        saveSelectionStep(next.step, next.spotId ? { id: next.spotId } : null);
      }
    }
  };

  const findSpotById = (spotId) => {
    if (myActiveSpot?.id === spotId) return myActiveSpot;
    if (bookedSpot?.id === spotId) return bookedSpot;
    return spots.find((s) => s.id === spotId);
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
  const [myActiveSpot, setMyActiveSpot] = useState(null);
  const [bookedSpot, setBookedSpot] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedSearchSpot, setSelectedSearchSpot] = useState(null);
  const [hideNav, setHideNav] = useState(false); // kept for compatibility but forced to false now
  const [selectionSnapshot, setSelectionSnapshot] = useState(null);
  const [userCoords, setUserCoords] = useState(null);
  const [logoOffset, setLogoOffset] = useState(0); // horizontal drag offset for the logo
  const logoDragRef = useRef(false);
  const logoDragStart = useRef({ x: 0, offset: 0 });
  const logoMovedRef = useRef(false);
  const [logoDragging, setLogoDragging] = useState(false);
  const [showAccountSheet, setShowAccountSheet] = useState(false);
  const [accountSheetOffset, setAccountSheetOffset] = useState(0);
  const [isSheetDragging, setIsSheetDragging] = useState(false);
  const sheetDragRef = useRef(false);
  const sheetStartY = useRef(0);
  const sheetOffsetRef = useRef(0);

  const clampLogoOffset = (value) => {
    if (typeof window === 'undefined') return 0;
    const max = Math.max(0, window.innerWidth / 2 - 48); // keep logo fully visible
    const min = -max;
    return Math.min(Math.max(value, min), max);
  };

  const handleLogoClick = () => {
    // Only trigger sharing if this interaction wasn't a drag
    if (logoMovedRef.current) return;
    setSheetEntryAnim(true)
    setShowAccountSheet(true);
    setAccountSheetOffset(0);
  };

  const handleLogoPointerDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    logoDragRef.current = true;
    logoMovedRef.current = false;
    setLogoDragging(false);
    logoDragStart.current = { x: startX, offset: logoOffset };

    const onMove = (ev) => {
      if (!logoDragRef.current) return;
      const delta = ev.clientX - logoDragStart.current.x;
      if (Math.abs(delta) > 3) {
        logoMovedRef.current = true;
        setLogoDragging(true);
      }
      setLogoOffset(clampLogoOffset(logoDragStart.current.offset + delta));
    };

    const onEnd = () => {
      logoDragRef.current = false;
      setLogoDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const handleAccountSheetPointerDown = (e) => {
    // Empêcher la propagation pour ne pas bouger la map en dessous
    e.stopPropagation(); 
    setSheetEntryAnim(false);
    
    sheetDragRef.current = true;
    
    // Gérer aussi bien la souris que le tactile
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    sheetStartY.current = clientY;
    
    setIsSheetDragging(true); // Désactive l'animation CSS pour un suivi 1:1 du doigt

    const onMove = (ev) => {
      if (!sheetDragRef.current) return;
      const currentY = ev.clientY || (ev.touches && ev.touches[0].clientY);
      const delta = currentY - sheetStartY.current;
      
      // On ne permet de descendre (delta positif). 
      // Si on monte (négatif), on applique une résistance (divisé par 4)
      const visibleOffset = delta > 0 ? delta : delta / 4;
      
      setAccountSheetOffset(visibleOffset);
      sheetOffsetRef.current = visibleOffset;
    };

    const onEnd = () => {
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
          setAccountSheetOffset(0); // Reset pour la prochaine ouverture
        }, 300);
      } else {
        // Sinon, on remonte (rebond)
        setAccountSheetOffset(0);
      }

      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    // Ajout des listeners tactiles spécifiques pour mobile
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onEnd);
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
  const unsub = onAuthStateChanged(auth, (fbUser) => {

    if (fbUser) {
      const nextUser = {
        uid: fbUser.uid,
        displayName: fbUser.displayName || 'User',
        email: fbUser.email || '',
        phone: fbUser.phoneNumber || '',
        transactions: 0,
        language: 'en',
      };
      setUser(nextUser);
    }

    // ❗ IMPORTANT : on laisse Firebase finir l'init AVANT de montrer AuthView
    setInitializing(false);
  });

  return () => unsub();
}, []);

  // Fallback: hydrate user immediately if auth already has a currentUser (e.g., after redirect)
 useEffect(() => {
  // on attend un cycle complet après redirect
  const timer = setTimeout(() => {
    const fbUser = auth.currentUser;
    if (!fbUser) return;

    const nextUser = {
      uid: fbUser.uid,
      displayName: fbUser.displayName || 'User',
      email: fbUser.email || '',
      phone: fbUser.phoneNumber || '',
      transactions: 0,
      language: 'en',
    };

    setUser((prev) => prev || nextUser);
    i18n.changeLanguage(nextUser.language || 'en');
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
        const available = fetchedSpots.filter((s) => s.status === 'available' || !s.status);
        setSpots(available);

        const mySpot = fetchedSpots.find((s) => s.hostId === user.uid && s.status !== 'completed');
        setMyActiveSpot(mySpot || null);

        const booked = fetchedSpots.find((s) => s.bookerId === user.uid && s.status !== 'completed');
        setBookedSpot(booked || null);
      },
      (error) => {
        console.error('Error fetching spots:', error);
      },
    );
    return () => unsubscribe();
  }, [user]);

  // Restore selected spot (itinerary) from persisted state or current booking
  useEffect(() => {
    // First priority: persisted selection with a spotId
    if (selectionSnapshot?.spotId) {
      const match = findSpotById(selectionSnapshot.spotId);
      if (match && (!selectedSearchSpot || selectedSearchSpot.id !== match.id)) {
        setSelectedSearchSpot(match);
        return;
      }
    }
    // Fallback to an active booked spot
    if (bookedSpot && (!selectedSearchSpot || selectedSearchSpot.id !== bookedSpot.id)) {
      setSelectedSearchSpot(bookedSpot);
      return;
    }
    // If no selection persists and no booking, clear local selection
    if (!selectionSnapshot?.spotId && !bookedSpot && selectedSearchSpot) {
      setSelectedSearchSpot(null);
    }
  }, [selectionSnapshot, bookedSpot, spots, selectedSearchSpot]);

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
        createdAt: serverTimestamp(),
      },
      { merge: true },
    ).catch((err) => console.error('Error creating user profile:', err));

    const unsub = onSnapshot(
      userRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        setUser((prev) => ({
          ...prev,
          displayName: data.displayName || prev?.displayName,
          email: data.email || prev?.email,
          phone: data.phone ?? prev?.phone,
          language: data.language || prev?.language || 'en',
          transactions: data.transactions ?? prev?.transactions ?? 0,
        }));
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
  const handleProposeSpot = async ({ car, time, price, length }) => {
    if (!user) return;
    const coords = await logCurrentLocation('propose_spot');
    const arcLat = 48.8738;
    const arcLng = 2.2950;
    const vehicleToUse = car || selectedVehicle?.model || '';
    const x = 50 + (Math.random() * 40 - 20);
    const y = 50 + (Math.random() * 40 - 20);
    try {
      const spotRef = await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'spots'), {
        hostId: user.uid,
        hostName: user.displayName || 'Anonymous',
        carModel: vehicleToUse,
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
      });
      await upsertTransaction({
        spot: { id: spotRef.id, hostId: user.uid, hostName: user.displayName, price },
        userId: user.uid,
        status: 'started',
        role: 'host',
      });
      setActiveTab('propose');
    } catch (err) {
      console.error('Error creating spot:', err);
    }
  };

  const handleSelectionStep = (step, spot) => {
    saveSelectionStep(step, spot);
  };

  const handleBookSpot = async (spot) => {
    if (!spot || !user) return;
    logCurrentLocation('book_spot');
    try {
      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spot.id);
      await updateDoc(spotRef, {
        status: 'booked',
        bookerId: user.uid,
        bookerName: user.displayName || 'Seeker',
      });
      await upsertTransaction({
        spot: { ...spot, bookerId: user.uid, bookerName: user.displayName },
        userId: user.uid,
        status: 'accepted',
        role: 'booker',
      });
      await upsertTransaction({
        spot: { ...spot, bookerId: user.uid, bookerName: user.displayName },
        userId: spot.hostId,
        status: 'accepted',
        role: 'host',
      });
      setActiveTab('search');
      saveSelectionStep('booked', spot);
    } catch (err) {
      console.error('Error booking spot:', err);
    }
  };

  const handleConfirmPlate = async (spotId, plate) => {
    try {
      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
      await updateDoc(spotRef, {
        status: 'confirmed',
        plateConfirmed: true,
        confirmedPlate: plate || null,
      });
      const spot = findSpotById(spotId) || { id: spotId };
      if (spot.hostId) {
        await upsertTransaction({
          spot,
          userId: spot.hostId,
          status: 'concluded',
          role: 'host',
        });
      }
      if (spot.bookerId) {
        await upsertTransaction({
          spot,
          userId: spot.bookerId,
          status: 'concluded',
          role: 'booker',
        });
      }
    } catch (err) {
      console.error('Error confirming plate:', err);
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
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId));
      setMyActiveSpot(null);
    } catch (err) {
      console.error('Error deleting spot:', err);
    }
  };

  const handleRenewSpot = async (spotId) => {
    if (!spotId) return;
    try {
      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
      await updateDoc(spotRef, {
        status: 'available',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Error renewing spot:', err);
    }
  };

  const handleCancelBooking = async (spotId) => {
    try {
      const spotRef = doc(db, 'artifacts', appId, 'public', 'data', 'spots', spotId);
      await updateDoc(spotRef, {
        status: 'available',
        bookerId: null,
        bookerName: null,
      });
      setBookedSpot(null);
      saveSelectionStep('cleared', null);
    } catch (err) {
      console.error('Error canceling booking:', err);
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

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Error signing out:', err);
    }
    // Immediately reset local state so UI returns to auth screen
    setUser(null);
    setActiveTab('search');
    setMyActiveSpot(null);
    setBookedSpot(null);
    setVehicles([]);
    setSelectedVehicle(null);
    setTransactions([]);
    setLeaderboard([]);
  };

  const changeTab = (nextTab) => {
    if (!nextTab || nextTab === activeTab) return;
    const currentIndex = tabOrder.indexOf(activeTab);
    const nextIndex = tabOrder.indexOf(nextTab);
    setSlideDir(nextIndex > currentIndex ? 'left' : 'right');
    setActiveTab(nextTab);
  };

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
            spots={spots}
            bookedSpot={bookedSpot}
            onCompleteSwap={handleCompleteSwap}
            onBookSpot={handleBookSpot}
            onCancelBooking={handleCancelBooking}
            selectedSpot={selectedSearchSpot}
            setSelectedSpot={setSelectedSearchSpot}
            onSelectionStep={handleSelectionStep}
            leaderboard={leaderboard}
            userCoords={userCoords}
          />
        </div>
      );
    }
    if (tab === 'propose') {
      return (
        <div className="h-full w-full">
          <ProposeView
            myActiveSpot={myActiveSpot}
            vehicles={vehicles}
            onProposeSpot={handleProposeSpot}
            onConfirmPlate={handleConfirmPlate}
            onCancelSpot={handleCancelSpot}
            onRenewSpot={handleRenewSpot}
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
          leaderboard={leaderboard}
          transactions={transactions}
          onLogout={handleLogout}
          theme={theme}
          onChangeTheme={setTheme}
          onInvite={handleInviteShare}
          inviteMessage={inviteMessage}
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
  return <div className="h-screen w-full bg-white"></div>;
}

  if (!user) {
    return (
      <div className="relative h-screen w-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-orange-50 via-white to-amber-50">
        <div className="fixed top-4 inset-x-0 z-[80] pointer-events-none flex justify-center">
          <AppLogo size={64} />
        </div>
       <AuthView />
      </div>
    );
  }

  return (
    <div
      className="relative h-screen w-full bg-gradient-to-br from-orange-50 via-white to-amber-50 font-sans overflow-hidden"
      onTouchStart={(e) => {
        if (!ENABLE_TAB_SWIPE) return;
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        touchStartTime.current = Date.now();
        setDragging(false);
        setDragProgress(0);
      }}
      onTouchMove={(e) => {
        if (!ENABLE_TAB_SWIPE) return;
        if (touchStartX.current == null || touchStartY.current == null) return;
        const dx = e.touches[0].clientX - touchStartX.current;
        const dy = e.touches[0].clientY - touchStartY.current;
        if (Math.abs(dy) > Math.abs(dx) * 1.5) {
          setDragProgress(0);
          return;
        }
        const width = window.innerWidth || 1;
        let progress = Math.max(-1, Math.min(1, dx / (width * 0.65)));
        const currentIndex = tabOrder.indexOf(activeTab);
        const nextTab = currentIndex < tabOrder.length - 1 ? tabOrder[currentIndex + 1] : null;
        const prevTab = currentIndex > 0 ? tabOrder[currentIndex - 1] : null;
        if (progress < 0 && !nextTab) progress = 0;
        if (progress > 0 && !prevTab) progress = 0;
        setDragging(true);
        setDragProgress(progress);
      }}
      onTouchEnd={(e) => {
        if (!ENABLE_TAB_SWIPE) return;
        if (touchStartX.current == null || touchStartY.current == null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = e.changedTouches[0].clientY - touchStartY.current;
        const dt = Date.now() - (touchStartTime.current || 0);
        touchStartX.current = null;
        touchStartY.current = null;
        touchStartTime.current = null;

        const dragStrength = Math.abs(dragProgress);
        const speed = Math.abs(dx) / Math.max(dt, 1);
        const horizontalEnough = dragStrength > 0.35 || (Math.abs(dx) > 120 && Math.abs(dx) > Math.abs(dy) * 1.2);
        const quickEnough = speed > 0.4 || dt < 800;
        const shouldFlip = horizontalEnough && quickEnough;

        const currentIndex = tabOrder.indexOf(activeTab);
        if (shouldFlip) {
          if (dx < 0 && currentIndex < tabOrder.length - 1) {
            changeTab(tabOrder[currentIndex + 1]);
          } else if (dx > 0 && currentIndex > 0) {
            changeTab(tabOrder[currentIndex - 1]);
          }
        }
        setDragProgress(0);
        setDragging(false);
      }}
    >
     <div
        className={`fixed top-4 left-1/2 z-[90] pointer-events-none transition-opacity duration-300 ${
          hideNav ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        style={{ transform: `translateX(${logoOffset}px)` }}
      >
        <button
          type="button"
          onClick={handleLogoClick}
          onPointerDown={handleLogoPointerDown}
          // Added 'relative w-16 h-16' to lock dimensions so it doesn't jump
          className="pointer-events-auto relative w-16 h-16 flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Invite friends"
          title="Glisser pour déplacer le logo"
        >
          {/* 1. Static Logo: Always rendered, fades out when dragging */}
          <div
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out ${
              logoDragging ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <AppLogo size={64} />
          </div>

          {/* 2. Moving Logo: Always rendered (preloaded), fades in when dragging */}
          <div
            className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out ${
              logoDragging ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="relative w-16 h-16">
              <div
                className="absolute inset-0 rounded-full bg-white/60 blur-md scale-140"
                aria-hidden="true"
              />
              <img
                src={movingLogo}
                alt="Logo"
                className="relative w-full h-full object-contain rounded-full shadow-md"
              />
            </div>
          </div>
        </button>
      </div>

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
      onClick={() => {
          setSheetEntryAnim(false); // <--- Important pour la fermeture fluide via backdrop
          setAccountSheetOffset(window.innerHeight);
          setTimeout(() => {
            setShowAccountSheet(false);
            setAccountSheetOffset(0);
          }, 300);
      }}
    />
    
    {/* La feuille de compte */}
    <div
      className={`relative w-full h-[90vh] bg-white rounded-t-3xl shadow-2xl border border-gray-100 overflow-hidden 
        ${isSheetDragging ? '' : 'transition-transform duration-300 ease-out'}
      `}
      style={{ 
        transform: `translateY(${accountSheetOffset}px)`,
        // L'animation ne s'active que si sheetEntryAnim est TRUE. 
        // Sinon, c'est 'none', et la transition-transform gère la remontée/descente fluide.
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
          leaderboard={leaderboard}
          transactions={transactions}
          onLogout={handleLogout}
          theme={theme}
          onChangeTheme={setTheme}
          onInvite={handleInviteShare}
          inviteMessage={inviteMessage}
        />
      </div>
    </div>
  </div>
)}
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
        <div className="flex-1 overflow-hidden relative" style={{ perspective: '1600px' }}>
          {(() => {
            const currentIndex = tabOrder.indexOf(activeTab);
            const nextTab = currentIndex < tabOrder.length - 1 ? tabOrder[currentIndex + 1] : null;
            const prevTab = currentIndex > 0 ? tabOrder[currentIndex - 1] : null;
            const targetTab = dragProgress < 0 ? nextTab : dragProgress > 0 ? prevTab : null;
            const progress = Math.max(-1, Math.min(1, dragProgress));
            const absP = Math.abs(progress);
            const origin = progress < 0 ? 'left center' : 'right center';

            const activeTransform = `translateX(${progress * 24}px) rotateY(${progress * 55}deg) scale(${1 - absP * 0.03})`;
            const activeShadow = absP === 0 ? '0 20px 50px rgba(15,23,42,0.12)' : '0 24px 60px rgba(15,23,42,0.18)';
            const backTransform =
              progress === 0
                ? 'translateX(0px) rotateY(0deg) scale(0.97)'
                : `translateX(${progress < 0 ? -20 + absP * 26 : 20 - absP * 26}px) rotateY(${progress < 0 ? -16 + absP * 16 : 16 - absP * 16}deg) scale(${0.94 + absP * 0.05})`;

            return (
              <>
                <div
                  className="absolute inset-0 will-change-transform"
                  style={{
                    transform: backTransform,
                    transformOrigin: progress < 0 ? 'right center' : 'left center',
                    transition: dragging ? 'none' : 'transform 0.35s ease, filter 0.35s ease',
                    filter: absP > 0 ? 'brightness(0.94)' : 'brightness(0.98)',
                    pointerEvents: 'none',
                  }}
                >
                  {renderTabContent(targetTab || activeTab)}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: progress < 0
                        ? 'linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0))'
                        : 'linear-gradient(270deg, rgba(0,0,0,0.06), rgba(0,0,0,0))',
                      opacity: 0.7 * absP,
                    }}
                  />
                </div>

                <div
                  className="absolute inset-0 will-change-transform bg-white/0"
                  style={{
                    transform: progress === 0 ? 'none' : activeTransform,
                    transformOrigin: origin,
                    transition: dragging ? 'none' : 'transform 0.35s ease, box-shadow 0.35s ease, filter 0.35s ease',
                    boxShadow: activeShadow,
                    filter: `brightness(${1 - absP * 0.06})`,
                    pointerEvents: 'auto',
                  }}
                >
                  {renderTabContent(activeTab)}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        progress < 0
                          ? 'linear-gradient(90deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.02) 35%, rgba(0,0,0,0) 100%)'
                          : 'linear-gradient(270deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.02) 35%, rgba(0,0,0,0) 100%)',
                      opacity: absP,
                    }}
                  />
                </div>
              </>
            );
          })()}
        </div>
        <div className="transition-opacity duration-300 opacity-100 z-0" style={{ '--bottom-nav-height': 'auto' }}>
          <BottomNav activeTab={activeTab} setActiveTab={changeTab} />
        </div>
      </div>
      {selectedSearchSpot && (
        <Map
          spot={selectedSearchSpot}
          onClose={() => {
            setSelectedSearchSpot(null);
            handleSelectionStep('cleared', null);
            setHideNav(false);
          }}
          onCancelBooking={handleCancelBooking}
          onNavStateChange={setHideNav}
          onSelectionStep={handleSelectionStep}
          initialStep={selectionSnapshot?.step || (bookedSpot ? 'booked' : null)}
          currentUserId={user?.uid || null}
          currentUserName={user?.displayName || 'User'}
          userCoords={userCoords}
        />
      )}
    </div>
  );
}
