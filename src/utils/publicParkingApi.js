import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';

const fetchPublicParkingsCallable = httpsCallable(functions, 'fetchPublicParkings');

export const fetchNearbyPublicParkings = async ({ lng, lat, radiusMeters = 2000, limit = 20 }) => {
  const safeLng = Number(lng);
  const safeLat = Number(lat);
  if (!Number.isFinite(safeLng) || !Number.isFinite(safeLat)) {
    return [];
  }

  const response = await fetchPublicParkingsCallable({
    lng: safeLng,
    lat: safeLat,
    radiusMeters,
    limit,
  });

  const parkings = Array.isArray(response?.data?.parkings) ? response.data.parkings : [];
  return parkings;
};