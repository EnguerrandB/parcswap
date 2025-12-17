// src/views/GotConfirmedView.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, X, MapPin } from 'lucide-react';

const GotConfirmedView = ({
  spot,
  bookerCoords,
  distanceText,
  mapboxToken,
  onCancel,
  onConfirmPlate,
  plateInput,
  setPlateInput,
  formatPlate,
  isFullPlate,
  isValidCoord,
}) => {
  const { t } = useTranslation('common');
  const miniMapRef = useRef(null);
  const miniMapInstanceRef = useRef(null);
  const bookerMarkerRef = useRef(null);
  const spotMarkerRef = useRef(null);
  const [showPlateModal, setShowPlateModal] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const autoPromptedRef = useRef(false);

  const distanceMeters = (() => {
    if (!isValidCoord(spot?.lng, spot?.lat) || !isValidCoord(bookerCoords?.lng, bookerCoords?.lat)) return null;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371e3;
    const dLat = toRad(bookerCoords.lat - spot.lat);
    const dLon = toRad(bookerCoords.lng - spot.lng);
    const lat1 = toRad(spot.lat);
    const lat2 = toRad(bookerCoords.lat);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  })();

  const closePlateModal = () => setShowPlateModal(false);
  const openPlateModal = () => setShowPlateModal(true);
  const handleSubmitPlate = () => {
    const formatted = formatPlate(plateInput);
    if (!isFullPlate(formatted)) return;
    onConfirmPlate?.(spot.id, formatted);
    closePlateModal();
  };

  // Init mini map
  useEffect(() => {
    if (!mapboxToken || !isValidCoord(spot?.lng, spot?.lat)) {
      setMapError('Map unavailable');
      setMapReady(false);
      return undefined;
    }
    setMapError(null);
    setMapReady(false);
    if (miniMapInstanceRef.current || !miniMapRef.current) return undefined;
    mapboxgl.accessToken = mapboxToken;
    const hasBooker = isValidCoord(bookerCoords?.lng, bookerCoords?.lat);
    const map = new mapboxgl.Map({
      container: miniMapRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: hasBooker ? [bookerCoords.lng, bookerCoords.lat] : [spot.lng, spot.lat],
      zoom: 15,
      pitch: 40,
      bearing: -8,
      interactive: true,
      attributionControl: false,
    });

    const spotMarker = new mapboxgl.Marker({ color: '#f97316' })
      .setLngLat([spot.lng, spot.lat])
      .addTo(map);

    const bookerMarker = hasBooker
      ? new mapboxgl.Marker({ color: '#2563eb' })
          .setLngLat([bookerCoords.lng, bookerCoords.lat])
          .addTo(map)
      : null;

    const bounds = new mapboxgl.LngLatBounds().extend([spot.lng, spot.lat]);
    if (hasBooker) bounds.extend([bookerCoords.lng, bookerCoords.lat]);
    map.fitBounds(bounds, { padding: 32, duration: 0 });

    map.on('load', () => setMapReady(true));
    map.on('error', (e) => {
      setMapError((prev) => prev || e?.error || 'Map error');
    });

    miniMapInstanceRef.current = map;
    spotMarkerRef.current = spotMarker;
    bookerMarkerRef.current = bookerMarker;

    return () => {
      if (bookerMarker) bookerMarker.remove();
      spotMarker.remove();
      map.remove();
      miniMapInstanceRef.current = null;
      spotMarkerRef.current = null;
      bookerMarkerRef.current = null;
      setMapReady(false);
    };
  }, [mapboxToken, spot?.lng, spot?.lat, bookerCoords?.lng, bookerCoords?.lat, isValidCoord]);

  // Update marker when booker moves
  useEffect(() => {
    if (!miniMapInstanceRef.current) return;
    const hasCoords = bookerCoords && isValidCoord(bookerCoords.lng, bookerCoords.lat);
    if (hasCoords && !bookerMarkerRef.current) {
      bookerMarkerRef.current = new mapboxgl.Marker({ color: '#2563eb' })
        .setLngLat([bookerCoords.lng, bookerCoords.lat])
        .addTo(miniMapInstanceRef.current);
    } else if (!hasCoords && bookerMarkerRef.current) {
      bookerMarkerRef.current.remove();
      bookerMarkerRef.current = null;
    }

    if (hasCoords && bookerMarkerRef.current) {
      bookerMarkerRef.current.setLngLat([bookerCoords.lng, bookerCoords.lat]);
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([spot.lng, spot.lat]);
      bounds.extend([bookerCoords.lng, bookerCoords.lat]);
      miniMapInstanceRef.current.fitBounds(bounds, { padding: 28, duration: 500 });
    }
  }, [bookerCoords?.lng, bookerCoords?.lat, spot?.lng, spot?.lat, isValidCoord]);

  // Auto-open plate modal when close to destination
  useEffect(() => {
    if (distanceMeters == null) return;
    if (distanceMeters <= 50 && !autoPromptedRef.current) {
      autoPromptedRef.current = true;
      setShowPlateModal(true);
    }
  }, [distanceMeters]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-white relative">
      <div ref={miniMapRef} className="absolute inset-0 z-0 bg-gray-100" />
      {!mapReady && (
        <div className="absolute inset-0 z-0 flex items-center justify-center bg-gradient-to-br from-orange-50 via-white to-amber-50 text-gray-500 text-sm">
          {mapError ? t('mapUnavailable', 'Carte indisponible') : t('loadingMap', 'Chargement de la carte...')}
        </div>
      )}

      {/* Overlays */}
      <div className="relative z-10 flex flex-col h-full pointer-events-none">
        <div className="flex justify-between items-center px-4 pt-5 gap-3">
          {onCancel && (
            <button
              onClick={() => onCancel(spot.id)}
              className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/85 text-red-600 font-semibold shadow-md border border-red-100 hover:bg-white"
            >
              <X className="w-4 h-4" />
              {t('cancelReturn', 'Cancel & return')}
            </button>
          )}
          <button
            onClick={openPlateModal}
            className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-600 text-white font-semibold shadow-lg hover:bg-orange-700 transition"
          >
            <Car className="w-4 h-4" />
            {t('arrivedQuestion', 'Arrived ?')}
          </button>
        </div>

        <div className="mt-auto p-4 pb-8">
          <div className="pointer-events-auto rounded-3xl bg-white/90 backdrop-blur border border-white/70 shadow-xl p-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-700 flex items-center justify-center shadow-inner">
              <MapPin className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="text-xs uppercase font-semibold text-gray-500">{t('driver', { defaultValue: 'Driver' })}</p>
              <p className="text-lg font-bold text-gray-900">{spot?.bookerName || t('seeker', 'Seeker')}</p>
              <p className="text-sm text-gray-600">
                {distanceText
                  ? t('arrivingDistance', { defaultValue: 'Arriving in ~{{distance}}', distance: distanceText })
                  : distanceMeters != null
                    ? t('distanceMeters', { defaultValue: '{{meters}} m away', meters: distanceMeters })
                    : t('arrivingIn', 'Arriving in ~3 min')}
              </p>
            </div>
            {distanceMeters != null && (
              <span className="text-xs font-semibold text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
                {distanceMeters} m
              </span>
            )}
          </div>
        </div>
      </div>

      {showPlateModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closePlateModal} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-orange-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">{t('verifyLicensePlate', 'Verify License Plate')}</h3>
              <button onClick={closePlateModal} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              {t('platePrompt', 'Saisis la plaque quand tu es arrivé sur place.')}
            </p>
            <input
              type="text"
              placeholder={t('platePlaceholder', 'e.g., AB-123-CD')}
              className="w-full border-2 border-gray-200 rounded-xl p-4 text-center text-2xl font-mono uppercase tracking-widest focus:border-orange-500 outline-none transition"
              value={plateInput}
              onChange={(e) => setPlateInput(formatPlate(e.target.value))}
            />
            <button
              onClick={handleSubmitPlate}
              className="w-full mt-4 bg-green-600 text-white py-3 rounded-xl font-semibold shadow-md hover:bg-green-700 transition disabled:opacity-50"
              disabled={!isFullPlate(formatPlate(plateInput))}
            >
              {t('confirmPlate', 'Confirm Plate')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GotConfirmedView;
