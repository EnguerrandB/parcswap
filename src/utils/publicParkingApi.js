import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';

const fetchPublicParkingsCallable = httpsCallable(functions, 'fetchPublicParkings');

const PUBLIC_PARKING_TEST_CITIES = {
  paris: { lat: 48.8566, lng: 2.3522 },
  marseille: { lat: 43.2965, lng: 5.3698 },
  lyon: { lat: 45.764, lng: 4.8357 },
  toulouse: { lat: 43.6047, lng: 1.4442 },
  nice: { lat: 43.7102, lng: 7.262 },
};

const getForcedPublicParkingCityId = () => {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    const value = String(url.searchParams.get('parkingTestCity') || '').trim().toLowerCase();
    return PUBLIC_PARKING_TEST_CITIES[value] ? value : '';
  } catch (_) {
    return '';
  }
};

export const fetchNearbyPublicParkings = async ({ lng, lat, radiusMeters = 2000, limit = 20 }) => {
  const forcedCityId = getForcedPublicParkingCityId();
  const forcedCenter = forcedCityId ? PUBLIC_PARKING_TEST_CITIES[forcedCityId] : null;
  const safeLng = Number(forcedCenter?.lng ?? lng);
  const safeLat = Number(forcedCenter?.lat ?? lat);
  if (!Number.isFinite(safeLng) || !Number.isFinite(safeLat)) {
    return [];
  }

  const response = await fetchPublicParkingsCallable({
    lng: safeLng,
    lat: safeLat,
    radiusMeters,
    limit,
    forceCityId: forcedCityId || undefined,
  });

  const parkings = Array.isArray(response?.data?.parkings) ? response.data.parkings : [];
  return parkings;
};