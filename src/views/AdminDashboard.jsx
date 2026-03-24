/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  Activity,
  BadgeCheck,
  Clock3,
  Globe,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { db, appId } from '../firebase';
import { formatCurrencyAmount } from '../utils/currency';
import { applyMapLabelLanguage, patchSizerankInStyle } from '../utils/mapboxStylePatch';

const ONLINE_WINDOW_MS = 90_000;
const MAP_STYLE = 'mapbox://styles/louloupark/cmjb7kixg005z01qy4cztc9ce';
const FALLBACK_CENTER = [2.3522, 48.8566];

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

const getKycStatus = (data) => String(data?.kycStatus || data?.kyc?.status || 'unverified').toLowerCase();

const statusTone = (online) => (online ? 'bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,0.18)]' : 'bg-slate-400 shadow-[0_0_0_6px_rgba(148,163,184,0.14)]');

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
          lat: Number(location?.lat),
          lng: Number(location?.lng),
          hasCoords: isValidCoord(location?.lng, location?.lat),
        };
      })
      .sort((left, right) => {
        if (left.online !== right.online) return left.online ? -1 : 1;
        return (right.lastSeenMs || 0) - (left.lastSeenMs || 0);
      });
  }, [locationByUserId, users]);

  const mappedUsers = useMemo(() => mergedUsers.filter((entry) => entry.hasCoords), [mergedUsers]);

  const visibleMapUsers = useMemo(() => (
    showOnlyOnline ? mappedUsers.filter((entry) => entry.online) : mappedUsers
  ), [mappedUsers, showOnlyOnline]);

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

  const recentTransactions = useMemo(() => {
    return [...transactions]
      .sort((left, right) => {
        const leftMs = getMillis(left.updatedAt || left.createdAt);
        const rightMs = getMillis(right.updatedAt || right.createdAt);
        return rightMs - leftMs;
      })
      .slice(0, 8);
  }, [transactions]);

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

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
            <section className="overflow-hidden rounded-[32px] border border-white/12 bg-white/70 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55">
              <div className="border-b border-slate-200/70 px-5 py-5 dark:border-white/10">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Users</div>
                <h3 className="mt-2 text-xl font-black tracking-tight">Supervision utilisateurs</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-900/[0.03] text-xs uppercase tracking-[0.16em] text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Utilisateur</th>
                      <th className="px-5 py-4 font-semibold">Presence</th>
                      <th className="px-5 py-4 font-semibold">KYC</th>
                      <th className="px-5 py-4 font-semibold">Wallet</th>
                      <th className="px-5 py-4 font-semibold">Transactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-slate-500 dark:text-slate-400">Aucun utilisateur charge.</td>
                      </tr>
                    ) : mergedUsers.map((entry) => (
                      <tr key={entry.id} className="border-t border-slate-200/70 dark:border-white/8">
                        <td className="px-5 py-4 align-top">
                          <div className="font-semibold text-slate-900 dark:text-white">{entry.displayName}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{entry.email || 'No email'}</div>
                          <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">{entry.language}</div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200">
                            <span className={`h-2.5 w-2.5 rounded-full ${statusTone(entry.online)}`} />
                            {entry.online ? 'online' : 'offline'}
                          </div>
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{entry.lastSeenMs ? getRelativeTimeLabel(entry.lastSeenMs) : 'No heartbeat'}</div>
                          {entry.hasCoords ? (
                            <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">{entry.lat.toFixed(4)}, {entry.lng.toFixed(4)}</div>
                          ) : null}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${entry.kycStatus === 'verified' || entry.kycStatus === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'
                            : entry.kycStatus === 'pending' || entry.kycStatus === 'processing'
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
                              : 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'}`}
                          >
                            {entry.kycStatus}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="font-semibold text-slate-900 dark:text-white">{formatAdminMoney(entry.walletAvailableCents)}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">reserve {formatAdminMoney(entry.walletReservedCents)}</div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="font-semibold text-slate-900 dark:text-white">{entry.transactions}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">premium parks {entry.premiumParks}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-[32px] border border-white/12 bg-white/70 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/55">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Activity feed</div>
                  <h3 className="mt-2 text-xl font-black tracking-tight">Transactions recentes</h3>
                </div>
                <Clock3 size={18} className="text-slate-400" />
              </div>
              <div className="mt-5 space-y-3">
                {recentTransactions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                    Aucune transaction recente.
                  </div>
                ) : recentTransactions.map((tx) => {
                  const updatedMs = getMillis(tx.updatedAt || tx.createdAt);
                  return (
                    <div key={tx.id} className="rounded-2xl border border-slate-200/70 bg-white/65 px-4 py-3 dark:border-white/10 dark:bg-white/5">
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
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;