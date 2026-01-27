// src/views/WaitingView.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, MapPin, Car, Phone, User, CheckCircle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, appId } from '../firebase';
import { formatPrice } from '../constants';
import GotSelectedView from './GotSelectedView';
import GotConfirmedView from './GotConfirmedView';

/**
 * Waiting screen for both Search (spot accepted) and Propose (host) flows.
 * - Pass `spot` for the search overlay.
 * - Pass `myActiveSpot`/`remainingMs` for the host waiting states.
 */
const WaitingView = ({
  spot,
  myActiveSpot,
  remainingMs,
  onCancel,
  onRenew,
  onConfirmPlate,
  renewFeedbackId = 0,
  renewWaveDurationMs = 650,
}) => {
  const { t } = useTranslation('common');
  const isDark =
    (typeof document !== 'undefined' && document.body?.dataset?.theme === 'dark') ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('theme') === 'dark');
  const [plateInput, setPlateInput] = useState('');
  const [showAd, setShowAd] = useState(false);
  const [bookerCoords, setBookerCoords] = useState(null);
  const [bookerLastSeen, setBookerLastSeen] = useState(null);
  const [optimisticRenew, setOptimisticRenew] = useState(null);
  const [optimisticNow, setOptimisticNow] = useState(() => Date.now());
  const [timerPulse, setTimerPulse] = useState(false);
  const adTimerRef = useRef(null);
  const hasScheduledAdRef = useRef(false);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const carMotionStyle = {
    animation: 'waiting-car-slide 9s ease-in-out infinite',
    animationFillMode: 'forwards',
  };
  const bookerAccepted = !!myActiveSpot?.bookerAccepted;
  const bookerStartedNav = !!myActiveSpot?.navOpId || !!myActiveSpot?.navOpAt;
  const isReservedPendingAccept = !!myActiveSpot && myActiveSpot.status === 'booked' && !bookerStartedNav;
  const isExpired = !!myActiveSpot && !optimisticRenew && (
    myActiveSpot.status === 'expired' || (remainingMs !== null && remainingMs <= 0)
  );
  const isWaitingForAccept = !!myActiveSpot && !isExpired && (!myActiveSpot.status || myActiveSpot.status === 'available');

  // Prevent background scrolling while waiting overlay is shown
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverscroll = document.body.style.overscrollBehavior;
    const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overscrollBehavior = prevBodyOverscroll;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
    };
  }, []);

  useEffect(() => {
    if (!myActiveSpot?.id) return undefined;
    if (!renewFeedbackId) return undefined;
    
    const durationMin = Number(myActiveSpot.time ?? 5);

    // CHANGEMENT ICI : On stocke le timeout pour pouvoir le nettoyer
    const tWave = window.setTimeout(() => {
      const now = Date.now();
      const endAt = now + durationMin * 60_000;

      // 1. On lance le POP visuel
      setTimerPulse(true);

      // 2. On attend la fin du POP (220ms) pour changer le texte du timer
      window.setTimeout(() => {
        setTimerPulse(false);
        setOptimisticRenew({ startAt: now, endAt, spotId: myActiveSpot.id }); // <--- La ligne a été déplacée ici
      }, 220);

      window.setTimeout(() => setOptimisticRenew(null), 4500);

    }, renewWaveDurationMs);

    return () => {
      window.clearTimeout(tWave);
    };
  }, [renewFeedbackId, myActiveSpot?.id, myActiveSpot?.time, renewWaveDurationMs]);

  useEffect(() => {
    if (!optimisticRenew) return undefined;
    const id = setInterval(() => setOptimisticNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [optimisticRenew]);

  useEffect(() => {
    if (!isWaitingForAccept) {
      setShowAd(false);
      hasScheduledAdRef.current = false;
      if (adTimerRef.current) {
        window.clearTimeout(adTimerRef.current);
        adTimerRef.current = null;
      }
      return undefined;
    }

    if (!hasScheduledAdRef.current) {
      hasScheduledAdRef.current = true;
      adTimerRef.current = window.setTimeout(() => {
        setShowAd(true);
        adTimerRef.current = null;
      }, 5000);
    }

    return () => {
      if (adTimerRef.current) {
        window.clearTimeout(adTimerRef.current);
        adTimerRef.current = null;
      }
      hasScheduledAdRef.current = false;
    };
  }, [myActiveSpot?.id, myActiveSpot?.status, isWaitingForAccept]);

  useEffect(() => {
    if (remainingMs != null && remainingMs <= 0) {
      setShowAd(false);
      hasScheduledAdRef.current = false;
      if (adTimerRef.current) {
        window.clearTimeout(adTimerRef.current);
        adTimerRef.current = null;
      }
    }
  }, [remainingMs]);

  const displayRemainingMs = (() => {
    if (!myActiveSpot || !optimisticRenew) return remainingMs;
    if (optimisticRenew.spotId !== myActiveSpot.id) return remainingMs;
    if (optimisticNow < optimisticRenew.startAt) return remainingMs;
    const ms = optimisticRenew.endAt - optimisticNow;
    return ms > 0 ? ms : 0;
  })();

  const formatPlate = (value) => {
    const cleaned = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let letters1 = '';
    let digits = '';
    let letters2 = '';
    for (const ch of cleaned) {
      if (letters1.length < 2 && /[A-Z]/.test(ch)) {
        letters1 += ch;
        continue;
      }
      if (letters1.length === 2 && digits.length < 3 && /[0-9]/.test(ch)) {
        digits += ch;
        continue;
      }
      if (letters1.length === 2 && digits.length === 3 && letters2.length < 2 && /[A-Z]/.test(ch)) {
        letters2 += ch;
      }
    }
    return [letters1, digits, letters2].filter(Boolean).join('-');
  };
  const isFullPlate = (plate) => /^[A-Z]{2}-\d{3}-[A-Z]{2}$/.test(plate || '');
  const isValidCoord = (lng, lat) => (
    typeof lng === 'number' && typeof lat === 'number' &&
    !Number.isNaN(lng) && !Number.isNaN(lat) &&
    Math.abs(lng) <= 180 && Math.abs(lat) <= 90
  );

  const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const formatDistanceText = (km) => {
    if (km == null || Number.isNaN(km)) return '--';
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
  };

  // Subscribe to booker's live position (for host view)
  useEffect(() => {
    if (!myActiveSpot?.bookerId) return undefined;
    const userLocRef = doc(db, 'artifacts', appId, 'public', 'data', 'userLocations', myActiveSpot.bookerId);
    const unsub = onSnapshot(
      userLocRef,
      (snap) => {
        if (!snap.exists()) {
          setBookerCoords(null);
          return;
        }
        const data = snap.data() || {};
        const lng = Number(data.lng);
        const lat = Number(data.lat);
        if (isValidCoord(lng, lat)) {
          setBookerCoords({ lng, lat });
          setBookerLastSeen(data.updatedAt?.toDate?.() || null);
        }
      },
      (err) => console.error('[WaitingView] Error subscribing to booker location:', err),
    );
    return () => unsub();
  }, [myActiveSpot?.bookerId]);

  // Host/propose waiting states
  if (myActiveSpot) {
    if (myActiveSpot.status === 'booked') {
      const distanceKm = bookerCoords && isValidCoord(bookerCoords.lng, bookerCoords.lat)
        ? getDistanceFromLatLonInKm(myActiveSpot.lat, myActiveSpot.lng, bookerCoords.lat, bookerCoords.lng)
        : null;

      if (!bookerStartedNav) {
        return <GotSelectedView spot={myActiveSpot} onCancel={onCancel} />;
      }

      return (
        <GotConfirmedView
          spot={myActiveSpot}
          bookerCoords={bookerCoords}
          distanceText={formatDistanceText(distanceKm)}
          mapboxToken={mapboxToken}
          onCancel={onCancel}
          onConfirmPlate={onConfirmPlate}
          plateInput={plateInput}
          setPlateInput={setPlateInput}
          formatPlate={formatPlate}
          isFullPlate={isFullPlate}
          isValidCoord={isValidCoord}
        />
      );
    }

    if (myActiveSpot.status === 'confirmed') {
      return (
        <div className="fixed inset-0 z-[9999] overflow-hidden flex flex-col items-center justify-center text-center">
          <div className="bg-green-100 p-6 rounded-full mb-6">
            <CheckCircle size={48} className="text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('swapConfirmed', 'Swap Confirmed')}</h2>
          <p className="text-gray-500 mb-8">{t('waitingForSeeker', 'Waiting for seeker to park...')}</p>
          {onCancel && (
            <button
              onClick={() => onCancel(myActiveSpot.id)}
              className="mt-2 px-5 py-3 border border-red-200 text-red-600 rounded-xl font-semibold hover:bg-red-50 transition"
            >
              {t('cancelReturn', 'Cancel & return')}
            </button>
          )}
        </div>
      );
    }

    return (
      <div
        className="fixed inset-0 overflow-hidden flex flex-col p-6 bg-gradient-to-b from-orange-50 to-white app-surface"
        style={{
          paddingBottom: 'var(--bottom-safe-offset, 96px)',
        }}
      >
        <div className="mt-16 mb-6 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            {isReservedPendingAccept
              ? t('awaitingNavAccept', 'Seeker accepted the card, waiting for confirmation')
              : myActiveSpot.status === 'booked'
                ? t('seekerFound', 'Seeker Found!')
                : (
                  <span>
                    {t('searching', 'Searching')}
                    <span className="dot-ellipsis" aria-hidden="true">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  </span>
                )}
          </h1>
          <p className="text-gray-500 mb-2">
            {isReservedPendingAccept
              ? t('waitingNavConfirm', 'Waiting for the driver to start navigation.')
              : myActiveSpot.status === 'booked'
                ? t('bookerOnWay', { name: myActiveSpot.bookerName || t('unknown', 'Someone'), defaultValue: '{{name}} is on their way.' })
                : isExpired
                  ? t('listingExpiredMsg', 'Your listing expired. Renew it to reach more drivers.')
                  : t('listingBroadcasting', "We're broadcasting your spot to nearby drivers.")}
          </p>
        </div>

          <div className="flex-1 flex flex-col items-center justify-start relative space-y-6">
          {!isExpired && (
            <>
              <div className="absolute w-[clamp(160px,62vmin,256px)] h-[clamp(160px,62vmin,256px)] bg-orange-100 rounded-full animate-ping opacity-20 z-20 pointer-events-none" />
              <div className="absolute w-[clamp(120px,48vmin,208px)] h-[clamp(120px,48vmin,208px)] bg-orange-200 rounded-full animate-pulse opacity-30 z-20 pointer-events-none" />
            </>
          )}
          <div
            className="bg-white p-[clamp(14px,4.5vmin,24px)] rounded-full shadow-xl z-30 relative"
            style={!isExpired ? carMotionStyle : { animationPlayState: 'paused' }}
          >
            <Car className="text-orange-600 w-[clamp(32px,9vmin,48px)] h-[clamp(32px,9vmin,48px)]" />
            {!isExpired && !isReservedPendingAccept && (
              <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-bounce">
                {t('liveTag', 'Live')}
              </div>
            )}
          </div>
          <div className="w-full max-w-[clamp(280px,92vmin,420px)] bg-white/90 backdrop-blur rounded-2xl shadow-lg border border-orange-100 p-[clamp(14px,4vmin,20px)] z-40">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[clamp(12px,3.2vmin,14px)] text-gray-500">
                  {isExpired ? t('listingExpiredLabel', 'Listing expired') : t('listingExpiresIn', 'Listing expires in')}
                </p>
                <p
                  className={`text-[clamp(18px,6vmin,26px)] font-bold text-gray-900 leading-tight transition-transform duration-200 ease-out ${
                    timerPulse ? 'scale-[1.08]' : 'scale-100'
                  }`}
                  data-role="waiting-timer-target"
                >
                  {displayRemainingMs != null && !isExpired
                    ? `${String(Math.floor(displayRemainingMs / 60000)).padStart(2, '0')}:${String(
                        Math.floor((displayRemainingMs % 60000) / 1000),
                      ).padStart(2, '0')}`
                    : isExpired
                      ? '00:00'
                      : '--:--'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[clamp(12px,3.2vmin,14px)] text-gray-500">{t('priceLabel', 'Price')}</p>
                <p className="text-[clamp(16px,5vmin,22px)] font-bold text-gray-900 leading-tight">{formatPrice(myActiveSpot.price)}</p>
              </div>
            </div>
            {/* Actions are handled by BottomNav while WaitingView is visible */}
          </div>

          {/* BLOC PUB ANIMÉ - Toujours dans le DOM, mais animé via CSS */}
          <div
            className={`w-full max-w-md rounded-3xl shadow-xl z-10 border overflow-hidden ${
              isDark
                ? 'bg-gradient-to-r from-slate-800 via-slate-900 to-black border-slate-700'
                : 'bg-gradient-to-r from-amber-200 via-orange-100 to-white border-orange-200'
            } ${
              /* CORRECTION ICI : On utilise les classes d'animation CSS pures au lieu de mélanger transition et animation */
              showAd
                ? 'ad-bounce-entry py-6 mt-6 px-6 max-h-[400px]' 
                : 'ad-exit max-h-0 py-0 mt-0 px-6 opacity-0' /* opacity-0 pour éviter le flash au chargement */
            }`}
          >
            {/* Le contenu interne */}
            <div className={`transition-opacity duration-500 delay-300 ${showAd ? 'opacity-100' : 'opacity-0'}`}>
              <p
                className={`text-xs uppercase font-bold tracking-wide mb-2 ${
                  isDark ? 'text-amber-300' : 'text-orange-500'
                }`}
              >
                {t('sponsored', 'Sponsored')}
              </p>
              <h3
                className={`text-2xl font-bold mb-2 ${
                  isDark ? 'text-slate-50' : 'text-gray-900'
                }`}
              >
                {t('sponsoredTitle', 'Drive smarter, earn more')}
              </h3>
              <p
                className={`text-sm leading-relaxed ${
                  isDark ? 'text-slate-200' : 'text-gray-600'
                }`}
              >
                {t('sponsoredBody', 'Boost your next swap with priority placement and instant notifications. Limited-time offer for early hosts.')}
              </p>
              <button className="mt-4 bg-orange-500 text-white px-4 py-2 rounded-xl font-semibold shadow hover:bg-orange-600 transition">
                {t('learnMore', 'Learn more')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Search accepted waiting overlay
  return (
    <div
      className="fixed inset-0 z-[9999 overflow-hidden flex flex-col items-center justify-center px-6 py-10 text-center app-surface bg-gradient-to-b from-orange-50 via-white to-amber-50"
        style={{
          paddingBottom: 'var(--bottom-safe-offset, 96px)',
        }}
      >
      <div className="w-[clamp(52px,14vmin,64px)] h-[clamp(52px,14vmin,64px)] rounded-full bg-white shadow-lg border border-orange-100 flex items-center justify-center mb-4">
        <Car className="text-orange-500 w-[clamp(24px,7vmin,32px)] h-[clamp(24px,7vmin,32px)]" />
      </div>
      <h1 className="text-3xl font-extrabold text-slate-900 mb-2">
        {t('waitingDriverTitle', 'Waiting for the driver')}
      </h1>
      <p className="text-gray-600 mb-8 max-w-md">
        {t(
          'waitingDriverSubtitle',
          'Hang tight! Your parking swap is in progress. We will notify you as soon as the driver is nearby.'
        )}
      </p>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-orange-100 p-5 space-y-4 text-left">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center">
            <MapPin className="text-orange-500" size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">{t('location', 'Location')}</p>
            <p className="font-semibold text-slate-900">{spot?.address || t('unknown', 'Unknown')}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center">
            <Clock className="text-orange-500" size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">{t('etaLabel', 'ETA')}</p>
            <p className="font-semibold text-slate-900">
              {spot?.eta || t('etaFallback', 'A few minutes')}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center">
            <Phone className="text-orange-500" size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">{t('contact', 'Contact')}</p>
            <p className="font-semibold text-slate-900">
              {spot?.driverName || t('driverOnTheWay', 'Driver on the way')}
            </p>
          </div>
        </div>

        {spot?.price != null && (
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <p className="text-sm text-gray-500">{t('priceLabel', 'Price')}</p>
            <p className="text-lg font-bold text-slate-900">{formatPrice(spot.price)}</p>
          </div>
        )}
      </div>

      {/* Actions are handled by BottomNav while WaitingView is visible */}
    </div>
  );
};

export default WaitingView;
