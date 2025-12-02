// src/components/Map.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPrice } from '../constants';

const buildMapUrl = (spot, userLoc, mapsKey) => {
  const destination = spot?.lat != null && spot?.lng != null ? `${spot.lat},${spot.lng}` : (spot?.address || 'Paris');
  const origin = userLoc?.lat != null && userLoc?.lng != null ? `${userLoc.lat},${userLoc.lng}` : null;
  const destQuery = encodeURIComponent(destination);
  const originQuery = origin ? encodeURIComponent(origin) : null;
  if (!destQuery) return 'about:blank';
  // If an embed API key is provided, request a directions embed (origin -> destination).
  if (mapsKey && originQuery) {
    return `https://www.google.com/maps/embed/v1/directions?key=${mapsKey}&origin=${originQuery}&destination=${destQuery}&mode=driving&zoom=15`;
  }
  // Fallback: use a directions URL embed (often still draws a route).
  if (originQuery) {
    return `https://www.google.com/maps/dir/?api=1&origin=${originQuery}&destination=${destQuery}&travelmode=driving&output=embed&zoom=15`;
  }
  // Last resort: map centered on destination.
  return `https://www.google.com/maps?q=${destQuery}&output=embed`;
};

const Map = ({ spot, onClose, onCancelBooking }) => {
  const { t } = useTranslation('common');
  const [userLoc, setUserLoc] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY;

  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setUserLoc(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  }, [spot?.id]);

  const embedUrl = useMemo(() => buildMapUrl(spot, userLoc, mapsKey), [spot, userLoc, mapsKey]);

  return (
    <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="relative w-full max-w-lg h-[78vh] overflow-hidden rounded-3xl shadow-2xl bg-white">
        <iframe
          title="map"
          src={embedUrl}
          className="w-full h-full border-0 rounded-3xl"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        <div className="absolute inset-x-0 top-0 px-5 pt-4 pb-6 bg-gradient-to-b from-white/90 via-white/40 to-transparent rounded-t-3xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-orange-500 font-semibold">{t('itinerary', 'Itinerary')}</p>
              <p className="text-base font-semibold text-slate-900">{spot?.address || t('unknown', 'Unknown')}</p>
            </div>
            <div className="text-lg font-bold text-orange-600">
              {formatPrice(spot?.price || 0)}
            </div>
          </div>
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[90%] flex flex-col space-y-3">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-xl p-3 text-center text-sm text-gray-700">
            {t('mapHint', 'Follow the live route to your spot.')}
          </div>
          <button
            onClick={() => {
              if (!spot) {
                onClose?.();
                return;
              }
              setConfirming(true);
            }}
            className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl py-3 font-semibold shadow-lg hover:scale-[1.01] transition"
          >
            {t('cancel', 'Close')}
          </button>
        </div>
        {confirming && (
          <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex items-center justify-center px-6">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-sm p-6 animate-[fadeIn_200ms_ease-out]">
              <p className="font-semibold text-gray-900 mb-4 text-center">
                {t('confirmCancel', 'The parking spot will be listed again')}
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={async () => {
                    if (onCancelBooking && spot) {
                      await onCancelBooking(spot.id);
                    }
                    setConfirming(false);
                    onClose?.();
                  }}
                  className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3 rounded-xl font-semibold shadow hover:scale-[1.01] transition"
                >
                  {t('yes', 'Yes')}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex-1 bg-gray-100 text-gray-800 py-3 rounded-xl font-semibold border border-gray-200 shadow hover:bg-gray-200 transition"
                >
                  {t('no', 'No')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Map;
