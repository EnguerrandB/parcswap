// src/views/WaitingView.jsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, MapPin, Car, Phone, User, CheckCircle } from 'lucide-react';
import { formatPrice } from '../constants';

/**
 * Waiting screen for both Search (spot accepted) and Propose (host) flows.
 * - Pass `spot` for the search overlay.
 * - Pass `myActiveSpot`/`remainingMs` for the host waiting states.
 */
const WaitingView = ({ spot, myActiveSpot, remainingMs, onCancel, onRenew, onConfirmPlate }) => {
  const { t } = useTranslation('common');
  const isDark =
    (typeof document !== 'undefined' && document.body?.dataset?.theme === 'dark') ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('theme') === 'dark');
  const [plateInput, setPlateInput] = useState('');
  const carMotionStyle = {
    animation: 'waiting-car-slide 9s ease-in-out infinite',
    animationFillMode: 'forwards',
  };

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

  // Ensure keyframes exist globally so the animation always plays
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const styleId = 'waiting-car-slide-keyframes';
    if (document.getElementById(styleId)) return;
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      @keyframes waiting-car-slide {
        0% { transform: translateX(-120vw); opacity: 0; }
        8% { transform: translateX(-20%); opacity: 1; }
        15% { transform: translateX(0); opacity: 1; }
        55% { transform: translateX(0); opacity: 1; }
        75% { transform: translateX(40%); opacity: 1; }
        90% { transform: translateX(120vw); opacity: 0.9; }
        100% { transform: translateX(160vw); opacity: 0; }
      }
    `;
    document.head.appendChild(styleEl);
  }, []);

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
if (myActiveSpot.status === 'booked') {
  return (
    <div className="h-screen overflow-hidden flex flex-col p-6 bg-gradient-to-b from-orange-50 to-white justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-6 mb-6 border border-orange-100">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
            <User className="text-orange-600" />
          </div>
          <div>
            <p className="font-bold text-lg">{myActiveSpot.bookerName}</p>
            <p className="text-sm text-gray-500">
              {t('arrivingIn', 'Arriving in ~3 min')}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700 text-center">
            {t('verifyLicensePlate', 'Verify License Plate')}
          </label>

          <input
            type="text"
            placeholder={t('platePlaceholder', 'e.g., AB-123-CD')}
            className="w-full border-2 border-gray-200 rounded-xl p-4 text-center text-2xl font-mono uppercase tracking-widest focus:border-orange-500 outline-none transition"
            value={plateInput}
            onChange={(e) => setPlateInput(formatPlate(e.target.value))}
          />

          <div className="flex justify-center">
            <button
              onClick={() => {
                const formatted = formatPlate(plateInput);
                if (!isFullPlate(formatted)) return;
                onConfirmPlate?.(myActiveSpot.id, formatted);
              }}
              className="w-full max-w-xs bg-green-600 text-white py-4 rounded-xl font-bold shadow-md hover:bg-green-700 transition"
            >
              {t('confirmPlate', 'Confirm Plate')}
            </button>
          </div>
        </div>
      </div>

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

    if (myActiveSpot.status === 'confirmed') {
      return (
        <div className="h-full min-h-screen overflow-hidden flex flex-col items-center justify-center text-center">
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
      className="h-full min-h-screen overflow-hidden p-6 flex flex-col bg-gradient-to-b from-orange-50 to-white app-surface"
        style={{
          minHeight: 'calc(100vh - 96px - env(safe-area-inset-bottom))',
          paddingBottom: 'calc(96px + env(safe-area-inset-bottom))',
        }}
      >
        <div className="mt-16 mb-6 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            {myActiveSpot.status === 'booked' ? t('seekerFound', 'Seeker Found!') : t('searching', 'Searching...')}
          </h1>
          <p className="text-gray-500 mb-2">
            {myActiveSpot.status === 'booked'
              ? t('bookerOnWay', { name: myActiveSpot.bookerName || t('unknown', 'Someone'), defaultValue: '{{name}} is on their way.' })
              : isExpired
                ? t('listingExpiredMsg', 'Your listing expired. Renew it to reach more drivers.')
                : t('listingBroadcasting', "We're broadcasting your spot to nearby drivers.")}
          </p>
        </div>

          <div className="flex-1 flex flex-col items-center justify-center relative space-y-6">
          {!isExpired && (
            <>
              <div className="absolute w-64 h-64 bg-orange-100 rounded-full animate-ping opacity-20" />
              <div className="absolute w-48 h-48 bg-orange-200 rounded-full animate-pulse opacity-30" />
            </>
          )}
          <div
            className="bg-white p-6 rounded-full shadow-xl z-10 relative"
            style={!isExpired ? carMotionStyle : { animationPlayState: 'paused' }}
          >
            <Car size={48} className="text-orange-600" />
            {!isExpired && (
              <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-bounce">
                {t('liveTag', 'Live')}
              </div>
            )}
          </div>
          <div className="w-full max-w-sm bg-white/90 backdrop-blur rounded-2xl shadow-lg border border-orange-100 px-5 py-4 z-10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">
                  {isExpired ? t('listingExpiredLabel', 'Listing expired') : t('listingExpiresIn', 'Listing expires in')}
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {remainingMs != null && !isExpired
                    ? `${String(Math.floor(remainingMs / 60000)).padStart(2, '0')}:${String(
                        Math.floor((remainingMs % 60000) / 1000),
                      ).padStart(2, '0')}`
                    : isExpired
                      ? '00:00'
                      : '--:--'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">{t('priceLabel', 'Price')}</p>
                <p className="text-xl font-bold text-gray-900">{formatPrice(myActiveSpot.price)}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {onCancel && (
                <button
                  onClick={() => onCancel(myActiveSpot.id)}
                  className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-semibold shadow-sm hover:bg-gray-50 transition"
                >
                  {t('cancel', 'Cancel')}
                </button>
              )}
              {onRenew && (
                <button
                  onClick={() => onRenew(myActiveSpot.id)}
                  className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3 rounded-xl font-bold shadow-md hover:scale-[1.01] transition"
                >
                  {t('renew', 'Renew')}
                </button>
              )}
            </div>
          </div>

          <div
            className={`w-full max-w-md rounded-3xl shadow-xl px-6 py-6 z-10 border ${
              isDark
                ? 'bg-gradient-to-r from-slate-800 via-slate-900 to-black border-slate-700'
                : 'bg-gradient-to-r from-amber-200 via-orange-100 to-white border-orange-200'
            }`}
          >
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
    );
  }

  // Search accepted waiting overlay
  return (
    <div
      className="h-screen overflow-hidden flex flex-col p-6 from-orange-50 via-white to-amber-50 flex flex-col items-center justify-center px-6 py-10 text-center app-surface"
      style={{
        minHeight: 'calc(100vh - 96px - env(safe-area-inset-bottom))',
        paddingBottom: 'calc(96px + env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-16 h-16 rounded-full bg-white shadow-lg border border-orange-100 flex items-center justify-center mb-4">
        <Car className="text-orange-500" size={32} />
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

      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-8 px-6 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold shadow hover:bg-gray-50 transition"
        >
          {t('cancel', 'Cancel')}
        </button>
      )}
    </div>
  );
};

export default WaitingView;
