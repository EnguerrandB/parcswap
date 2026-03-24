/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Activity,
  BadgeCheck,
  CarFront,
  CheckCircle2,
  Clock3,
  Globe,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Users,
  Wallet,
  X,
  Trash2,
} from 'lucide-react';
import { db, appId } from '../firebase';
import { formatCurrencyAmount } from '../utils/currency';
import { applyMapLabelLanguage, patchSizerankInStyle } from '../utils/mapboxStylePatch';

const ONLINE_WINDOW_MS = 90_000;
const MAP_STYLE = 'mapbox://styles/louloupark/cmjb7kixg005z01qy4cztc9ce';
const FALLBACK_CENTER = [2.3522, 48.8566];
const SUPPORTED_CURRENCIES = ['EUR', 'GBP', 'ILS', 'AED', 'RUB', 'USD'];
const SUPPORTED_LANGUAGES = ['en', 'fr', 'he', 'ar', 'ru'];
const SUPPORTED_KYC_STATUSES = ['unverified', 'pending', 'processing', 'verified', 'approved', 'failed', 'rejected'];

const getMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isValidCoord = (lng, lat) => (
  Number.isFinite(Number(lng))
  && Number.isFinite(Number(lat))
  && Math.abs(Number(lng)) <= 180
  && Math.abs(Number(lat)) <= 90
);

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const walletAvailableCentsFromData = (data) => {
  const availableRaw = Number(data?.walletAvailableCents);
  if (Number.isFinite(availableRaw)) return Math.max(0, Math.round(availableRaw));
  const legacyRaw = Number(data?.wallet);
  if (Number.isFinite(legacyRaw)) return Math.max(0, Math.round(legacyRaw * 100));
  return 0;
};

const walletReservedCentsFromData = (data) => {
  const reservedRaw = Number(data?.walletReservedCents);
  if (Number.isFinite(reservedRaw)) return Math.max(0, Math.round(reservedRaw));
  return 0;
};

const getRelativeTimeLabel = (timestampMs) => {
  if (!timestampMs) return 'never';
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
  if (deltaSeconds < 15) return 'now';
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
};

const compactNumber = (value) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);

const formatAdminMoney = (cents) => formatCurrencyAmount((Number(cents) || 0) / 100, 'EUR');

const centsToInputAmount = (cents) => {
  const amount = (Number(cents) || 0) / 100;
  return amount.toFixed(2);
};

const parseAmountToCents = (value, fallback = 0) => {
  const normalized = String(value ?? '').trim().replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * 100);
};

const parseNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizePlate = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const getKycStatus = (data) => String(data?.kycStatus || data?.kyc?.status || 'unverified').toLowerCase();

const getAdminFlag = (data) => {
  if (data?.isAdmin === true || data?.admin === true) return true;
  const role = String(data?.role || data?.userRole || '').trim().toLowerCase();
  if (role === 'admin' || role === 'superadmin') return true;
  const roles = Array.isArray(data?.roles) ? data.roles : [];
  return roles.some((entry) => {
    const normalized = String(entry || '').trim().toLowerCase();
    return normalized === 'admin' || normalized === 'superadmin';
  });
};

const statusTone = (online) => (online ? 'bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,0.18)]' : 'bg-slate-400 shadow-[0_0_0_6px_rgba(148,163,184,0.14)]');

const inputClassName = (isDark) => `h-11 w-full rounded-2xl border px-4 text-sm transition outline-none ${isDark
  ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:bg-white/8'
  : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-orange-300 focus:bg-orange-50/20'}`;

const selectClassName = (isDark) => `h-11 w-full rounded-2xl border px-4 text-sm transition outline-none ${isDark
  ? 'border-white/10 bg-white/5 text-white focus:border-orange-400/40 focus:bg-white/8'
  : 'border-slate-200 bg-white text-slate-900 focus:border-orange-300 focus:bg-orange-50/20'}`;

const TextField = ({ label, value, onChange, isDark, type = 'text', placeholder = '' }) => (
  <label className="block">
    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</div>
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={inputClassName(isDark)}
    />
  </label>
);

const AdminTabButton = ({ active, label, onClick, isDark }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${active
      ? isDark
        ? 'bg-orange-500 text-white shadow-[0_12px_30px_rgba(249,115,22,0.28)]'
        : 'bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.16)]'
      : isDark
        ? 'bg-white/6 text-slate-200 hover:bg-white/10'
        : 'bg-white text-slate-700 hover:bg-slate-50'}`}
  >
    {label}
  </button>
);

const getUserPopupHtml = (entry) => {
  const statusLabel = entry.online ? 'Online' : `Seen ${escapeHtml(getRelativeTimeLabel(entry.lastSeenMs))}`;
  return `
    <div style="min-width:220px;padding:2px 2px 0;font-family:Inter,system-ui,sans-serif;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(entry.displayName || 'User')}</div>
          <div style="font-size:12px;color:#475569;margin-top:2px;">${escapeHtml(entry.email || 'No email')}</div>
        </div>
        <div style="font-size:11px;font-weight:700;padding:4px 8px;border-radius:999px;background:${entry.online ? '#dcfce7' : '#e2e8f0'};color:${entry.online ? '#166534' : '#334155'};">
          ${statusLabel}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
        <div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Transactions</div>
          <div style="font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(String(entry.transactions || 0))}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">KYC</div>
          <div style="font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(entry.kycStatus)}</div>
        </div>
      </div>
    </div>
  `;
};

const StatCard = ({ icon: Icon, label, value, detail, accentClass }) => (
  <div className="rounded-[28px] border border-white/12 bg-white/70 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-slate-950/60">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-3 text-3xl font-black tracking-tight text-slate-950 dark:text-white">{value}</div>
        {detail ? <div className="mt-2 text-sm text-slate-600 dark:text-slate-300/80">{detail}</div> : null}
      </div>
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${accentClass}`}>
        <Icon size={22} strokeWidth={2.4} />
      </div>
    </div>
  </div>
);

const AdminDashboard = ({ currentUser, theme = 'light', onExit }) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const hasFittedBoundsRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [spots, setSpots] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [showOnlyOnline, setShowOnlyOnline] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUserVehicles, setSelectedUserVehicles] = useState([]);
  const [selectedUserForm, setSelectedUserForm] = useState(null);
  const [vehicleForms, setVehicleForms] = useState({});
  const [newVehicleForm, setNewVehicleForm] = useState({ model: '', plate: '' });
  const [saveState, setSaveState] = useState({ tone: 'idle', message: '' });

  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const isDark = theme === 'dark';

  useEffect(() => {
    const unsubUsers = onSnapshot(
      collection(db, 'artifacts', appId, 'public', 'data', 'users'),
      (snapshot) => {
        setUsers(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      },
      (error) => setMapError(error?.message || 'Unable to load users.'),
    );

    const unsubLocations = onSnapshot(
      collection(db, 'artifacts', appId, 'public', 'data', 'userLocations'),
      (snapshot) => {
        setLocations(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      },
      (error) => setMapError(error?.message || 'Unable to load live locations.'),
    );

    const unsubSpots = onSnapshot(
      collection(db, 'artifacts', appId, 'public', 'data', 'spots'),
      (snapshot) => {
        setSpots(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      },
      (error) => setMapError(error?.message || 'Unable to load spots.'),
    );

    const unsubTransactions = onSnapshot(
      collection(db, 'artifacts', appId, 'public', 'data', 'transactions'),
      (snapshot) => {
        setTransactions(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      },
      (error) => setMapError(error?.message || 'Unable to load transactions.'),
    );

    return () => {
      unsubUsers();
      unsubLocations();
      unsubSpots();
      unsubTransactions();
    };
  }, []);

  const locationByUserId = useMemo(() => {
    const next = new Map();
    locations.forEach((entry) => {
      next.set(entry.id, entry);
    });
    return next;
  }, [locations]);

  const mergedUsers = useMemo(() => {
    return users
      .map((user) => {
        const location = locationByUserId.get(user.id);
        const lastSeenMs = getMillis(location?.updatedAt);
        const online = lastSeenMs > 0 && Date.now() - lastSeenMs <= ONLINE_WINDOW_MS;
        return {
          id: user.id,
          displayName: user.displayName || 'User',
          email: user.email || '',
          phone: user.phone || '',
          language: user.language || 'en',
          transactions: Number(user.transactions || 0),
          premiumParks: Number(user.premiumParks || 0),
          kycStatus: getKycStatus(user),
          walletAvailableCents: walletAvailableCentsFromData(user),
          walletReservedCents: walletReservedCentsFromData(user),
          createdAtMs: getMillis(user.createdAt),
          lastSeenMs,
          online,
          isAdmin: getAdminFlag(user),
          lat: Number(location?.lat),
          lng: Number(location?.lng),
          hasCoords: isValidCoord(location?.lng, location?.lat),
        };
      })
      .sort((left, right) => {
        if (left.online !== right.online) return left.online ? -1 : 1;
        return left.displayName.localeCompare(right.displayName, undefined, {
          sensitivity: 'base',
          numeric: true,
        });
      });
  }, [locationByUserId, users]);

  const mappedUsers = useMemo(() => mergedUsers.filter((entry) => entry.hasCoords), [mergedUsers]);

  const visibleMapUsers = useMemo(() => (
    showOnlyOnline ? mappedUsers.filter((entry) => entry.online) : mappedUsers
  ), [mappedUsers, showOnlyOnline]);

  const filteredUsers = useMemo(() => {
    const query = String(userSearch || '').trim().toLowerCase();
    if (!query) return mergedUsers;
    return mergedUsers.filter((entry) => (
      String(entry.displayName || '').toLowerCase().includes(query)
      || String(entry.email || '').toLowerCase().includes(query)
      || String(entry.phone || '').toLowerCase().includes(query)
      || String(entry.language || '').toLowerCase().includes(query)
    ));
  }, [mergedUsers, userSearch]);

  const selectedUser = useMemo(
    () => mergedUsers.find((entry) => entry.id === selectedUserId) || null,
    [mergedUsers, selectedUserId],
  );

  const selectedUserTransactions = useMemo(() => {
    if (!selectedUserId) return [];
    return transactions
      .filter((tx) => tx.userId === selectedUserId || tx.hostId === selectedUserId || tx.bookerId === selectedUserId)
      .sort((left, right) => getMillis(right.updatedAt || right.createdAt) - getMillis(left.updatedAt || left.createdAt))
      .slice(0, 10);
  }, [selectedUserId, transactions]);

  useEffect(() => {
    if (!filteredUsers.length) {
      if (selectedUserId) setSelectedUserId('');
      return;
    }
    const stillVisible = filteredUsers.some((entry) => entry.id === selectedUserId);
    if (!selectedUserId || !stillVisible) {
      setSelectedUserId(filteredUsers[0].id);
    }
  }, [filteredUsers, selectedUserId]);

  useEffect(() => {
    if (!selectedUser) {
      setSelectedUserForm(null);
      return;
    }
    setSelectedUserForm({
      displayName: selectedUser.displayName || '',
      email: selectedUser.email || '',
      phone: selectedUser.phone || '',
      language: selectedUser.language || 'en',
      currency: SUPPORTED_CURRENCIES.includes(String(selectedUser.currency || '').toUpperCase())
        ? String(selectedUser.currency || '').toUpperCase()
        : 'EUR',
      kycStatus: selectedUser.kycStatus || 'unverified',
      premiumParks: String(selectedUser.premiumParks ?? 0),
      walletAvailableCents: centsToInputAmount(selectedUser.walletAvailableCents),
      walletReservedCents: centsToInputAmount(selectedUser.walletReservedCents),
      isAdmin: selectedUser.isAdmin === true,
    });
    setSaveState({ tone: 'idle', message: '' });
  }, [selectedUser]);

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUserVehicles([]);
      return undefined;
    }

    const vehiclesRef = collection(db, 'artifacts', appId, 'public', 'data', 'users', selectedUserId, 'vehicles');
    const unsubVehicles = onSnapshot(
      vehiclesRef,
      (snapshot) => {
        const nextVehicles = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((left, right) => {
            if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
            return String(left.model || '').localeCompare(String(right.model || ''), undefined, { sensitivity: 'base' });
          });
        setSelectedUserVehicles(nextVehicles);
      },
      (error) => setSaveState({ tone: 'error', message: error?.message || 'Impossible de charger les vehicules.' }),
    );

    return () => unsubVehicles();
  }, [selectedUserId]);

  useEffect(() => {
    setVehicleForms(
      selectedUserVehicles.reduce((acc, vehicle) => {
        acc[vehicle.id] = {
          model: vehicle.model || '',
          plate: vehicle.plate || '',
          isDefault: vehicle.isDefault === true,
        };
        return acc;
      }, {}),
    );
  }, [selectedUserVehicles]);

  const handleSaveUser = async () => {
    if (!selectedUserId || !selectedUserForm) return;
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', selectedUserId);
    try {
      const payload = {
        displayName: selectedUserForm.displayName.trim() || null,
        email: selectedUserForm.email.trim() || null,
        phone: selectedUserForm.phone.trim() || null,
        language: selectedUserForm.language.trim() || 'en',
        currency: String(selectedUserForm.currency || 'EUR').toUpperCase(),
        kycStatus: selectedUserForm.kycStatus || 'unverified',
        premiumParks: parseNonNegativeInt(selectedUserForm.premiumParks, 0),
        walletAvailableCents: parseAmountToCents(selectedUserForm.walletAvailableCents, 0),
        walletReservedCents: parseAmountToCents(selectedUserForm.walletReservedCents, 0),
        isAdmin: selectedUserForm.isAdmin === true,
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, payload, { merge: true });
      setSaveState({ tone: 'success', message: 'Utilisateur mis a jour en temps reel.' });
    } catch (error) {
      setSaveState({ tone: 'error', message: error?.message || 'Echec de la mise a jour utilisateur.' });
    }
  };

  const handleSaveVehicle = async (vehicleId) => {
    if (!selectedUserId || !vehicleId) return;
    const draft = vehicleForms[vehicleId];
    if (!draft) return;
    try {
      await updateDoc(
        doc(db, 'artifacts', appId, 'public', 'data', 'users', selectedUserId, 'vehicles', vehicleId),
        {
          model: String(draft.model || '').trim(),
          plate: normalizePlate(draft.plate),
          isDefault: draft.isDefault === true,
        },
      );
      setSaveState({ tone: 'success', message: 'Vehicule mis a jour.' });
    } catch (error) {
      setSaveState({ tone: 'error', message: error?.message || 'Echec de mise a jour du vehicule.' });
    }
  };

  const handleSetDefaultVehicle = async (vehicleId) => {
    if (!selectedUserId || !vehicleId) return;
    try {
      await Promise.all(
        selectedUserVehicles.map((vehicle) => updateDoc(
          doc(db, 'artifacts', appId, 'public', 'data', 'users', selectedUserId, 'vehicles', vehicle.id),
          { isDefault: vehicle.id === vehicleId },
        )),
      );
      setSaveState({ tone: 'success', message: 'Vehicule par defaut mis a jour.' });
    } catch (error) {
      setSaveState({ tone: 'error', message: error?.message || 'Echec du changement de vehicule par defaut.' });
    }
  };

  const handleDeleteVehicle = async (vehicleId) => {
    if (!selectedUserId || !vehicleId) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', selectedUserId, 'vehicles', vehicleId));
      setSaveState({ tone: 'success', message: 'Vehicule supprime.' });
    } catch (error) {
      setSaveState({ tone: 'error', message: error?.message || 'Echec de suppression du vehicule.' });
    }
  };

  const handleAddVehicle = async () => {
    if (!selectedUserId) return;
    const model = String(newVehicleForm.model || '').trim();
    const plate = normalizePlate(newVehicleForm.plate);
    if (!model || !plate) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'users', selectedUserId, 'vehicles'), {
        ownerId: selectedUserId,
        model,
        plate,
        isDefault: selectedUserVehicles.length === 0,
        createdAt: serverTimestamp(),
      });
      setNewVehicleForm({ model: '', plate: '' });
      setSaveState({ tone: 'success', message: 'Vehicule ajoute.' });
    } catch (error) {
      setSaveState({ tone: 'error', message: error?.message || 'Echec d ajout du vehicule.' });
    }
  };

  const stats = useMemo(() => {
    const totalUsers = mergedUsers.length;
    const onlineUsers = mergedUsers.filter((entry) => entry.online).length;
    const usersWithKycVerified = mergedUsers.filter((entry) => entry.kycStatus === 'verified' || entry.kycStatus === 'approved').length;
    const usersWithPendingKyc = mergedUsers.filter((entry) => entry.kycStatus === 'pending' || entry.kycStatus === 'processing').length;
    const usersWithFailedKyc = mergedUsers.filter((entry) => ['failed', 'rejected', 'canceled'].includes(entry.kycStatus)).length;
    const totalWalletAvailableCents = mergedUsers.reduce((sum, entry) => sum + entry.walletAvailableCents, 0);
    const totalWalletReservedCents = mergedUsers.reduce((sum, entry) => sum + entry.walletReservedCents, 0);
    const activeSpots = spots.filter((spot) => spot.status === 'available' || !spot.status).length;
    const bookedSpots = spots.filter((spot) => spot.status === 'booked' || spot.status === 'confirmed').length;
    const completedSpots = spots.filter((spot) => spot.status === 'completed' || spot.plateConfirmed === true).length;
    const last24hUsers = mergedUsers.filter((entry) => entry.createdAtMs && Date.now() - entry.createdAtMs <= 86_400_000).length;
    const totalTransactions = transactions.length;
    const concludedTransactions = transactions.filter((tx) => String(tx.status || '').toLowerCase() === 'concluded').length;
    return {
      totalUsers,
      onlineUsers,
      usersWithKycVerified,
      usersWithPendingKyc,
      usersWithFailedKyc,
      totalWalletAvailableCents,
      totalWalletReservedCents,
      activeSpots,
      bookedSpots,
      completedSpots,
      last24hUsers,
      totalTransactions,
      concludedTransactions,
    };
  }, [mergedUsers, spots, transactions]);

  const topLanguages = useMemo(() => {
    const counts = mergedUsers.reduce((acc, entry) => {
      const key = String(entry.language || 'en').split('-')[0].toLowerCase();
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map());
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5);
  }, [mergedUsers]);

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) return undefined;
    const markers = markersRef.current;
    try {
      mapboxgl.accessToken = mapboxToken;
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE,
        center: FALLBACK_CENTER,
        zoom: 10.5,
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
      map.on('load', () => {
        patchSizerankInStyle(map);
        applyMapLabelLanguage(map, currentUser?.language || 'en');
        setMapReady(true);
      });
      map.on('error', (event) => {
        const errorMessage = event?.error?.message || 'Mapbox failed to render.';
        setMapError(errorMessage);
      });
    } catch (error) {
      setMapError(error?.message || 'Unable to initialize admin map.');
    }

    return () => {
      markers.forEach((marker) => marker.remove());
      markers.clear();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
    };
  }, [currentUser?.language, mapboxToken]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    applyMapLabelLanguage(mapRef.current, currentUser?.language || 'en');
  }, [currentUser?.language, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const nextIds = new Set();

    visibleMapUsers.forEach((entry) => {
      nextIds.add(entry.id);
      const popupHtml = getUserPopupHtml(entry);
      const markerRecord = markersRef.current.get(entry.id);

      if (!markerRecord) {
        const markerEl = document.createElement('button');
        markerEl.type = 'button';
        markerEl.style.width = '22px';
        markerEl.style.height = '22px';
        markerEl.style.borderRadius = '999px';
        markerEl.style.border = '2px solid rgba(255,255,255,0.95)';
        markerEl.style.background = entry.online ? '#10b981' : '#64748b';
        markerEl.style.boxShadow = entry.online
          ? '0 0 0 8px rgba(16,185,129,0.18), 0 10px 24px rgba(15,23,42,0.22)'
          : '0 0 0 8px rgba(100,116,139,0.14), 0 10px 24px rgba(15,23,42,0.16)';
        markerEl.style.cursor = 'pointer';
        markerEl.setAttribute('aria-label', entry.displayName || 'User marker');

        const popup = new mapboxgl.Popup({ offset: 14, closeButton: false }).setHTML(popupHtml);
        const marker = new mapboxgl.Marker({ element: markerEl, anchor: 'center' })
          .setLngLat([entry.lng, entry.lat])
          .setPopup(popup)
          .addTo(mapRef.current);
        markersRef.current.set(entry.id, { marker, popup, markerEl });
      } else {
        markerRecord.marker.setLngLat([entry.lng, entry.lat]);
        markerRecord.popup.setHTML(popupHtml);
        markerRecord.markerEl.style.background = entry.online ? '#10b981' : '#64748b';
        markerRecord.markerEl.style.boxShadow = entry.online
          ? '0 0 0 8px rgba(16,185,129,0.18), 0 10px 24px rgba(15,23,42,0.22)'
          : '0 0 0 8px rgba(100,116,139,0.14), 0 10px 24px rgba(15,23,42,0.16)';
      }
    });

    markersRef.current.forEach((record, id) => {
      if (!nextIds.has(id)) {
        record.marker.remove();
        markersRef.current.delete(id);
      }
    });

    if (!hasFittedBoundsRef.current && visibleMapUsers.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      visibleMapUsers.forEach((entry) => bounds.extend([entry.lng, entry.lat]));
      mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 900 });
      hasFittedBoundsRef.current = true;
    }
  }, [mapReady, visibleMapUsers]);

  return (
    <div className={`relative h-screen overflow-hidden ${isDark ? 'bg-[#050816] text-slate-50' : 'bg-[#f4efe7] text-slate-950'}`}>
      <div className="absolute inset-0 pointer-events-none">
        <div className={`absolute -top-28 right-[-8rem] h-72 w-72 rounded-full blur-3xl ${isDark ? 'bg-amber-500/20' : 'bg-orange-300/45'}`} />
        <div className={`absolute bottom-[-8rem] left-[-5rem] h-80 w-80 rounded-full blur-3xl ${isDark ? 'bg-cyan-500/16' : 'bg-sky-200/55'}`} />
      </div>

      <div className="relative z-10 h-full overflow-y-auto px-4 pb-10 pt-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
          <div className="flex flex-col gap-4 rounded-[32px] border border-white/12 bg-white/70 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-600 dark:text-orange-300">Admin Control Room</div>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Vue globale temps reel de ParkSwap</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300/80">
                Presence live, activite produit, suivi KYC et portefeuille. Les donnees proviennent directement de Firebase en ecoute temps reel.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${isDark ? 'bg-white/8 text-slate-200' : 'bg-slate-900/5 text-slate-700'}`}>
                <RefreshCw size={16} className="text-emerald-500" />
                Live sync
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${isDark ? 'bg-white/8 text-slate-200' : 'bg-slate-900/5 text-slate-700'}`}>
                <ShieldAlert size={16} className="text-orange-500" />
                {currentUser?.email || 'Admin'}
              </div>
              {onExit ? (
                <button
                  type="button"
                  onClick={onExit}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${isDark ? 'border-white/10 bg-white/6 text-slate-100 hover:bg-white/10' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}
                >
                  <X size={16} />
                  Retour a l app
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <AdminTabButton
              active={activeTab === 'overview'}
              label="Vue globale"
              onClick={() => setActiveTab('overview')}
              isDark={isDark}
            />
            <AdminTabButton
              active={activeTab === 'users'}
              label="Utilisateurs"
              onClick={() => setActiveTab('users')}
              isDark={isDark}
            />
          </div>

          {activeTab === 'overview' ? (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  icon={Users}
                  label="Utilisateurs"
                  value={compactNumber(stats.totalUsers)}
                  detail={`${stats.last24hUsers} nouveaux sur 24h`}
                  accentClass="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200"
                />
                <StatCard
                  icon={Activity}
                  label="En ligne"
                  value={compactNumber(stats.onlineUsers)}
                  detail={`${mappedUsers.length} avec geoloc exploitable`}
                  accentClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
                />
                <StatCard
                  icon={Wallet}
                  label="Wallet disponible"
                  value={formatAdminMoney(stats.totalWalletAvailableCents)}
                  detail={`${formatAdminMoney(stats.totalWalletReservedCents)} reserves`}
                  accentClass="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                />
                <StatCard
                  icon={BadgeCheck}
                  label="Transactions"
                  value={compactNumber(stats.totalTransactions)}
                  detail={`${stats.concludedTransactions} conclues`}
                  accentClass="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"
                />
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.9fr)]">
                <section className="rounded-[32px] border border-white/12 bg-white/70 p-4 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55">
                  <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Presence map</div>
                      <h2 className="mt-2 text-2xl font-black tracking-tight">Personnes connectees en temps reel</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowOnlyOnline((value) => !value)}
                        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${showOnlyOnline
                          ? isDark
                            ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : isDark
                            ? 'border-white/10 bg-white/5 text-slate-200'
                            : 'border-slate-200 bg-white text-slate-700'}`}
                      >
                        <Users size={16} />
                        {showOnlyOnline ? 'Online only' : 'All tracked users'}
                      </button>
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <span className={`h-3 w-3 rounded-full ${statusTone(true)}`} />
                        online
                        <span className={`ml-3 h-3 w-3 rounded-full ${statusTone(false)}`} />
                        stale
                      </div>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-200/40 dark:bg-slate-900/70" style={{ minHeight: '480px' }}>
                    {!mapboxToken ? (
                      <div className="flex h-[480px] items-center justify-center px-6 text-center">
                        <div>
                          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-500">
                            <MapPin size={24} />
                          </div>
                          <h3 className="mt-4 text-xl font-bold">Mapbox token missing</h3>
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300/80">Ajoute VITE_MAPBOX_TOKEN pour afficher la carte live dans l interface admin.</p>
                        </div>
                      </div>
                    ) : (
                      <div ref={mapContainerRef} className="h-[480px] w-full" />
                    )}
                    {mapError ? (
                      <div className="absolute left-4 top-4 rounded-2xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-lg">
                        {mapError}
                      </div>
                    ) : null}
                    {mapboxToken && !mapReady ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm dark:bg-slate-950/45">
                        <div className="inline-flex items-center gap-3 rounded-full border border-white/20 bg-slate-950/80 px-4 py-2 text-sm font-semibold text-white">
                          <RefreshCw size={16} className="animate-spin" />
                          Initialisation de la carte admin
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>

                <aside className="grid grid-cols-1 gap-6">
                  <section className="rounded-[32px] border border-white/12 bg-white/70 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Usage</div>
                    <h3 className="mt-2 text-xl font-black tracking-tight">Etat produit</h3>
                    <div className="mt-5 space-y-4">
                      {[
                        { label: 'Spots disponibles', value: stats.activeSpots, color: 'bg-orange-500' },
                        { label: 'Reservations en cours', value: stats.bookedSpots, color: 'bg-sky-500' },
                        { label: 'Swaps finalises', value: stats.completedSpots, color: 'bg-emerald-500' },
                      ].map((item) => {
                        const total = Math.max(1, stats.activeSpots + stats.bookedSpots + stats.completedSpots);
                        const width = `${Math.min(100, (item.value / total) * 100)}%`;
                        return (
                          <div key={item.label}>
                            <div className="mb-2 flex items-center justify-between text-sm">
                              <span className="font-semibold text-slate-700 dark:text-slate-200">{item.label}</span>
                              <span className="text-slate-500 dark:text-slate-400">{item.value}</span>
                            </div>
                            <div className="h-2.5 rounded-full bg-slate-200/80 dark:bg-white/10">
                              <div className={`h-2.5 rounded-full ${item.color}`} style={{ width }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-[32px] border border-white/12 bg-white/70 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">KYC</div>
                    <h3 className="mt-2 text-xl font-black tracking-tight">Verification utilisateurs</h3>
                    <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
                        <div className="text-2xl font-black text-emerald-700 dark:text-emerald-200">{stats.usersWithKycVerified}</div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700/80 dark:text-emerald-200/80">Verified</div>
                      </div>
                      <div className="rounded-2xl bg-amber-50 p-4 dark:bg-amber-500/10">
                        <div className="text-2xl font-black text-amber-700 dark:text-amber-200">{stats.usersWithPendingKyc}</div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700/80 dark:text-amber-200/80">Pending</div>
                      </div>
                      <div className="rounded-2xl bg-rose-50 p-4 dark:bg-rose-500/10">
                        <div className="text-2xl font-black text-rose-700 dark:text-rose-200">{stats.usersWithFailedKyc}</div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-rose-700/80 dark:text-rose-200/80">Failed</div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[32px] border border-white/12 bg-white/70 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Locales</div>
                        <h3 className="mt-2 text-xl font-black tracking-tight">Langues dominantes</h3>
                      </div>
                      <Globe size={18} className="text-slate-400" />
                    </div>
                    <div className="mt-5 space-y-3">
                      {topLanguages.length === 0 ? (
                        <div className="text-sm text-slate-500 dark:text-slate-400">Aucune langue disponible.</div>
                      ) : topLanguages.map(([language, count]) => {
                        const width = `${Math.min(100, (count / Math.max(1, stats.totalUsers)) * 100)}%`;
                        return (
                          <div key={language}>
                            <div className="mb-2 flex items-center justify-between text-sm">
                              <span className="font-semibold uppercase text-slate-700 dark:text-slate-200">{language}</span>
                              <span className="text-slate-500 dark:text-slate-400">{count}</span>
                            </div>
                            <div className="h-2.5 rounded-full bg-slate-200/80 dark:bg-white/10">
                              <div className="h-2.5 rounded-full bg-slate-900 dark:bg-slate-100" style={{ width }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </aside>
              </div>
            </>
          ) : null}

          {activeTab === 'users' ? (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
            <section className="overflow-hidden rounded-[32px] border border-white/12 bg-white/70 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55">
              <div className="border-b border-slate-200/70 px-5 py-5 dark:border-white/10">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">User directory</div>
                <h3 className="mt-2 text-xl font-black tracking-tight">Vue dediee aux utilisateurs</h3>
                <div className="mt-4 relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Rechercher par nom, email, telephone, langue"
                    className={`${inputClassName(isDark)} pl-11`}
                  />
                </div>
              </div>

              <div className="max-h-[940px] overflow-y-auto p-3">
                {filteredUsers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                    Aucun utilisateur ne correspond a la recherche.
                  </div>
                ) : filteredUsers.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedUserId(entry.id)}
                    className={`mb-3 w-full rounded-[24px] border p-4 text-left transition ${selectedUserId === entry.id
                      ? isDark
                        ? 'border-orange-400/30 bg-orange-500/10 shadow-[0_18px_45px_rgba(249,115,22,0.12)]'
                        : 'border-orange-200 bg-orange-50/90 shadow-[0_18px_45px_rgba(249,115,22,0.1)]'
                      : isDark
                        ? 'border-white/8 bg-white/4 hover:bg-white/6'
                        : 'border-slate-200/70 bg-white/75 hover:bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900 dark:text-white">{entry.displayName}</div>
                        <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{entry.email || 'No email'}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                          <span>{entry.language}</span>
                          <span>{entry.phone || 'No phone'}</span>
                        </div>
                      </div>
                      <span className={`h-3 w-3 shrink-0 rounded-full ${statusTone(entry.online)}`} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.12em] ${entry.online
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
                        : 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'}`}
                      >
                        {entry.online ? 'online' : 'offline'}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">{entry.transactions} tx</span>
                      <span className="text-slate-500 dark:text-slate-400">{formatAdminMoney(entry.walletAvailableCents)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-[32px] border border-white/12 bg-white/70 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55">
              {!selectedUser || !selectedUserForm ? (
                <div className="flex min-h-[640px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                  Selectionne un utilisateur pour afficher sa fiche, ses vehicules et ses actions admin.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/55 p-5 dark:bg-white/5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">User profile</div>
                          <h3 className="mt-2 text-2xl font-black tracking-tight">{selectedUser.displayName}</h3>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span>{selectedUser.id}</span>
                            <span>•</span>
                            <span>{selectedUser.lastSeenMs ? getRelativeTimeLabel(selectedUser.lastSeenMs) : 'No heartbeat'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${selectedUser.online
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
                            : 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'}`}
                          >
                            {selectedUser.online ? 'online' : 'offline'}
                          </span>
                          {selectedUserForm.isAdmin ? (
                            <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-orange-700 dark:bg-orange-500/10 dark:text-orange-200">
                              admin
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {saveState.message ? (
                        <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${saveState.tone === 'success'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
                          : saveState.tone === 'error'
                            ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200'
                            : 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'}`}
                        >
                          {saveState.message}
                        </div>
                      ) : null}

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <TextField
                          label="Nom"
                          value={selectedUserForm.displayName}
                          onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, displayName: event.target.value }))}
                          isDark={isDark}
                        />
                        <TextField
                          label="Email"
                          value={selectedUserForm.email}
                          onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, email: event.target.value }))}
                          isDark={isDark}
                          type="email"
                        />
                        <TextField
                          label="Telephone"
                          value={selectedUserForm.phone}
                          onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, phone: event.target.value }))}
                          isDark={isDark}
                        />
                        <label className="block">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Langue</div>
                          <select
                            value={selectedUserForm.language}
                            onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, language: event.target.value }))}
                            className={selectClassName(isDark)}
                          >
                            {SUPPORTED_LANGUAGES.map((language) => (
                              <option key={language} value={language}>{language}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Currency</div>
                          <select
                            value={selectedUserForm.currency}
                            onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, currency: event.target.value }))}
                            className={selectClassName(isDark)}
                          >
                            {SUPPORTED_CURRENCIES.map((currency) => (
                              <option key={currency} value={currency}>{currency}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">KYC</div>
                          <select
                            value={selectedUserForm.kycStatus}
                            onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, kycStatus: event.target.value }))}
                            className={selectClassName(isDark)}
                          >
                            {SUPPORTED_KYC_STATUSES.map((status) => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </label>
                        <TextField
                          label="Wallet disponible"
                          value={selectedUserForm.walletAvailableCents}
                          onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, walletAvailableCents: event.target.value }))}
                          isDark={isDark}
                        />
                        <TextField
                          label="Wallet reserve"
                          value={selectedUserForm.walletReservedCents}
                          onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, walletReservedCents: event.target.value }))}
                          isDark={isDark}
                        />
                        <TextField
                          label="Premium parks"
                          value={selectedUserForm.premiumParks}
                          onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, premiumParks: event.target.value }))}
                          isDark={isDark}
                        />
                        <label className="flex items-center gap-3 rounded-2xl border border-slate-200/80 px-4 py-3 dark:border-white/10">
                          <input
                            type="checkbox"
                            checked={selectedUserForm.isAdmin}
                            onChange={(event) => setSelectedUserForm((prev) => ({ ...prev, isAdmin: event.target.checked }))}
                            className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-400"
                          />
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">Admin access</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Active ou retire l acces admin cote document utilisateur.</div>
                          </div>
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={handleSaveUser}
                          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                        >
                          <Save size={16} />
                          Enregistrer
                        </button>
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          Transactions: <span className="font-semibold text-slate-900 dark:text-white">{selectedUser.transactions}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[28px] border border-white/10 bg-white/55 p-5 dark:bg-white/5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Vehicles</div>
                          <h4 className="mt-2 text-xl font-black tracking-tight">Vehicules de l utilisateur</h4>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                          <CarFront size={14} />
                          {selectedUserVehicles.length}
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto]">
                        <input
                          type="text"
                          value={newVehicleForm.model}
                          onChange={(event) => setNewVehicleForm((prev) => ({ ...prev, model: event.target.value }))}
                          placeholder="Modele"
                          className={inputClassName(isDark)}
                        />
                        <input
                          type="text"
                          value={newVehicleForm.plate}
                          onChange={(event) => setNewVehicleForm((prev) => ({ ...prev, plate: event.target.value.toUpperCase() }))}
                          placeholder="Plaque"
                          className={inputClassName(isDark)}
                        />
                        <button
                          type="button"
                          onClick={handleAddVehicle}
                          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 text-sm font-semibold text-white transition hover:brightness-110"
                        >
                          <Plus size={16} />
                          Ajouter
                        </button>
                      </div>

                      <div className="mt-5 space-y-3">
                        {selectedUserVehicles.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                            Aucun vehicule pour cet utilisateur.
                          </div>
                        ) : selectedUserVehicles.map((vehicle) => {
                          const draft = vehicleForms[vehicle.id] || { model: '', plate: '', isDefault: false };
                          return (
                            <div key={vehicle.id} className="rounded-[24px] border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_200px_auto]">
                                <input
                                  type="text"
                                  value={draft.model}
                                  onChange={(event) => setVehicleForms((prev) => ({ ...prev, [vehicle.id]: { ...prev[vehicle.id], model: event.target.value } }))}
                                  className={inputClassName(isDark)}
                                  placeholder="Modele"
                                />
                                <input
                                  type="text"
                                  value={draft.plate}
                                  onChange={(event) => setVehicleForms((prev) => ({ ...prev, [vehicle.id]: { ...prev[vehicle.id], plate: event.target.value.toUpperCase() } }))}
                                  className={inputClassName(isDark)}
                                  placeholder="Plaque"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveVehicle(vehicle.id)}
                                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                                  >
                                    <Save size={15} />
                                    Sauver
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteVehicle(vehicle.id)}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-200 text-rose-600 transition hover:bg-rose-50 dark:border-rose-400/20 dark:text-rose-200 dark:hover:bg-rose-500/10"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleSetDefaultVehicle(vehicle.id)}
                                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${vehicle.isDefault
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
                                    : 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'}`}
                                >
                                  <CheckCircle2 size={14} />
                                  {vehicle.isDefault ? 'Defaut' : 'Mettre par defaut'}
                                </button>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{vehicle.ownerId || selectedUserId}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-[28px] border border-white/10 bg-white/55 p-5 dark:bg-white/5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Live summary</div>
                      <h4 className="mt-2 text-xl font-black tracking-tight">Etat instantane</h4>
                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-slate-100/80 p-4 dark:bg-white/8">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Presence</div>
                          <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{selectedUser.online ? 'Online' : 'Offline'}</div>
                        </div>
                        <div className="rounded-2xl bg-slate-100/80 p-4 dark:bg-white/8">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Wallet</div>
                          <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatAdminMoney(selectedUser.walletAvailableCents)}</div>
                        </div>
                        <div className="rounded-2xl bg-slate-100/80 p-4 dark:bg-white/8">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Premium parks</div>
                          <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{selectedUser.premiumParks}</div>
                        </div>
                        <div className="rounded-2xl bg-slate-100/80 p-4 dark:bg-white/8">
                          <div className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">KYC</div>
                          <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{selectedUser.kycStatus}</div>
                        </div>
                      </div>
                      {selectedUser.hasCoords ? (
                        <div className="mt-4 rounded-2xl border border-slate-200/70 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300/80">
                          Derniere position: {selectedUser.lat.toFixed(5)}, {selectedUser.lng.toFixed(5)}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-[28px] border border-white/10 bg-white/55 p-5 dark:bg-white/5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Transactions</div>
                          <h4 className="mt-2 text-xl font-black tracking-tight">Historique recent de l utilisateur</h4>
                        </div>
                        <Clock3 size={18} className="text-slate-400" />
                      </div>
                      <div className="mt-5 space-y-3">
                        {selectedUserTransactions.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                            Aucune transaction pour cet utilisateur.
                          </div>
                        ) : selectedUserTransactions.map((tx) => {
                          const updatedMs = getMillis(tx.updatedAt || tx.createdAt);
                          return (
                            <div key={tx.id} className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 dark:border-white/10 dark:bg-white/5">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-semibold text-slate-900 dark:text-white">{tx.title || 'Swap'}</div>
                                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tx.status || 'unknown'} · {tx.role || 'n/a'}</div>
                                </div>
                                <div className="text-right">
                                  <div className="font-semibold text-slate-900 dark:text-white">{formatCurrencyAmount(Number(tx.amount || tx.price || 0), 'EUR')}</div>
                                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{getRelativeTimeLabel(updatedMs)}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;