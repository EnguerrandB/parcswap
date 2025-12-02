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
  getDoc,
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
  const [dragProgress, setDragProgress] = useState(0); // -1 (to prev) to 1 (to next)
  const [dragging, setDragging] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');

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
  }, []);
  const upsertTransaction = async ({ spot, userId, status, role }) => {
    if (!spot || !userId) return;
    const txId = `${spot.id}-${userId}`;
    const titleHost = spot.bookerName ? `${spot.bookerName} ➜ ${spot.hostName || 'Host'}` : spot.hostName || 'Swap';
    const titleBooker = spot.hostName ? `${spot.hostName} ➜ You` : 'Swap';
    const title = role === 'host' ? titleHost : titleBooker;
    const amount = Number(spot.price || 0);
    await setDoc(
      doc(db, 'artifacts', appId, 'public', 'data', 'transactions', txId),
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
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        console.log(`[${contextLabel}] lat=${coords.lat}, lng=${coords.lng}`);
        resolve(coords);
      },
      (err) => {
        console.log(`[${contextLabel}] Geolocation failed: ${err?.message || err}`);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
    );
  });
};
  const [spots, setSpots] = useState([]);
  const [myActiveSpot, setMyActiveSpot] = useState(null);
  const [bookedSpot, setBookedSpot] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedSearchSpot, setSelectedSearchSpot] = useState(null);
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

  // --- Transactions subscription (history) ---
  useEffect(() => {
    if (!user) return;
    const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
    const q = query(txRef, where('userId', '==', user.uid), limit(50));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let txs = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        if (txs.length === 0) {
          // Fallback fake data
          txs = [
            { id: 'fake-1', title: 'Swap with Alice', amount: 8, status: 'completed', createdAt: new Date() },
            { id: 'fake-2', title: 'Swap with Bob', amount: 5, status: 'completed', createdAt: new Date() },
            { id: 'fake-3', title: 'Swap with Charlie', amount: 7, status: 'completed', createdAt: new Date() },
          ];
        }
        setTransactions(txs);
      },
      (error) => {
        console.error('Error fetching transactions:', error);
      },
    );
    return () => unsubscribe();
  }, [user]);

  // Sync leaderboard entry with local transaction count for current user
  useEffect(() => {
    if (!user) return;
    const count = transactions.length;
    setLeaderboard((prev) => {
      let updated = false;
      const next = prev.map((u) => {
        if (u.id === user.uid) {
          if (Number(u.transactions || 0) !== count) {
            updated = true;
            return { ...u, transactions: count };
          }
        }
        return u;
      });
      if (!next.find((u) => u.id === user.uid)) {
        updated = true;
        next.push({
          id: user.uid,
          displayName: user.displayName,
          email: user.email,
          transactions: count,
        });
      }
      if (!updated) return prev;
      next.sort((a, b) => Number(b.transactions || 0) - Number(a.transactions || 0));
      return next.slice(0, 10);
    });
  }, [transactions, user]);

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

  // --- Ensure user profile doc exists / hydrate ---
  useEffect(() => {
    if (!user?.uid) return;
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
    getDoc(userRef)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setUser((prev) => ({
            ...prev,
            displayName: data.displayName || prev.displayName,
            email: data.email || prev.email,
            phone: data.phone || prev.phone,
            language: data.language || prev.language || 'en',
            transactions: data.transactions ?? prev.transactions ?? 0,
          }));
        } else {
          setDoc(
            userRef,
            {
              displayName: user.displayName,
              email: user.email,
              phone: user.phone,
              language: user.language || i18n.language || 'en',
              transactions: user.transactions ?? 0,
              createdAt: serverTimestamp(),
            },
            { merge: true },
          ).catch((err) => console.error('Error creating user profile:', err));
        }
      })
      .catch((err) => console.error('Error fetching user profile:', err));
  }, [user?.uid]);

  // --- Leaderboard subscription ---
  useEffect(() => {
    if (!user) return;
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'users');
    const q = query(usersRef, orderBy('transactions', 'desc'), limit(10));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let topUsers = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        if (user?.uid && !topUsers.find((u) => u.id === user.uid)) {
          topUsers = [
            ...topUsers,
            {
              id: user.uid,
              displayName: user.displayName,
              email: user.email,
              transactions: user.transactions ?? 0,
            },
          ];
        }
        if (topUsers.length === 0 && user?.uid) {
          topUsers = [
            {
              id: user.uid,
              displayName: user.displayName,
              email: user.email,
              transactions: user.transactions ?? 0,
            },
          ];
        }
        const pseudonyms = [
          'CosmoFox',
          'VelvetRoad',
          'OrangeBolt',
          'SkylineRider',
          'MintyDrive',
          'NeonTrail',
          'UrbanPulse',
          'SilverNest',
          'CloudyPath',
          'SunnyLane',
        ];
        let pseudoIndex = 0;
        while (topUsers.length < 10 && pseudoIndex < pseudonyms.length) {
          const name = pseudonyms[pseudoIndex];
          const pseudoId = `pseudo-${pseudoIndex}`;
          if (!topUsers.find((u) => u.id === pseudoId)) {
            topUsers.push({
              id: pseudoId,
              displayName: name,
              email: '',
              transactions: Math.floor(Math.random() * 5),
            });
          }
          pseudoIndex += 1;
        }
        topUsers.sort((a, b) => Number(b.transactions || 0) - Number(a.transactions || 0));
        setLeaderboard(topUsers);
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
        <SearchView
          spots={spots}
          bookedSpot={bookedSpot}
          onCompleteSwap={handleCompleteSwap}
          onBookSpot={handleBookSpot}
          onCancelBooking={handleCancelBooking}
          selectedSpot={selectedSearchSpot}
          setSelectedSpot={setSelectedSearchSpot}
        />
      );
    }
    if (tab === 'propose') {
      return (
        <ProposeView
          myActiveSpot={myActiveSpot}
          vehicles={vehicles}
          onProposeSpot={handleProposeSpot}
          onConfirmPlate={handleConfirmPlate}
          onCancelSpot={handleCancelSpot}
          onRenewSpot={handleRenewSpot}
        />
      );
    }
    return (
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
      <div className="fixed top-4 inset-x-0 z-[90] flex justify-center pointer-events-none">
        <button
          type="button"
          onClick={() => setShowInvite(true)}
          className="pointer-events-auto active:scale-95 transition"
          aria-label="Invite friends"
        >
          <AppLogo size={64} />
        </button>
      </div>
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
      <div className="relative z-10 flex flex-col h-full">
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
                    transform: activeTransform,
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
        <BottomNav activeTab={activeTab} setActiveTab={changeTab} />
      </div>
    </div>
  );
}
