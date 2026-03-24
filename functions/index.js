const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Stripe = require("stripe");

admin.initializeApp();

const firebaseConfig = (() => {
  try {
    return process.env.FIREBASE_CONFIG
      ? JSON.parse(process.env.FIREBASE_CONFIG)
      : {};
  } catch (_) {
    return {};
  }
})();

const projectId =
  firebaseConfig.projectId ||
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  "parkswap-36bb2";

const stripeConfig = functions.config().stripe || {};
const stripeSecret = stripeConfig.secret || process.env.STRIPE_SECRET_KEY || "";
const stripeWebhookSecret =
  stripeConfig.webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || "";
const stripeReturnUrl =
  stripeConfig.return_url ||
  process.env.STRIPE_RETURN_URL ||
  "https://parkswap.app";
const stripeFeePercent = Number(
  stripeConfig.fee_percent ?? process.env.STRIPE_FEE_PERCENT ?? 1.4,
);
const stripeFeeFixed = Number(
  stripeConfig.fee_fixed ?? process.env.STRIPE_FEE_FIXED ?? 0.25,
);

const stripe = stripeSecret
  ? new Stripe(stripeSecret, {
      apiVersion: "2024-04-10",
    })
  : null;

const WALLET_VERSION = 1;
const WALLET_AVAILABLE_FIELD = "walletAvailableCents";
const WALLET_RESERVED_FIELD = "walletReservedCents";
const WALLET_LEGACY_FIELD = "wallet";
const PREMIUM_PARKS_MAX = 5;

const getUserRef = (uid) =>
  admin.firestore().doc(`artifacts/${projectId}/public/data/users/${uid}`);

const buildWalletLedgerRef = (id) =>
  admin
    .firestore()
    .doc(`artifacts/${projectId}/public/data/walletLedger/${id}`);

const makeId = () => admin.firestore().collection("_").doc().id;

const normalizeReturnUrl = (value) => {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch (_) {
    return "";
  }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseAmountToCents = (value) => {
  const raw = typeof value === "string" ? value.replace(",", ".") : value;
  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100);
  if (!Number.isFinite(rounded)) return null;
  return rounded;
};

const parsePriceToCents = (value) => {
  const raw = typeof value === "string" ? value.replace(",", ".") : value;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
};

const normalizeWalletCents = (data = {}) => {
  const availableRaw = Number(data?.[WALLET_AVAILABLE_FIELD]);
  const reservedRaw = Number(data?.[WALLET_RESERVED_FIELD]);
  const legacyRaw = Number(data?.[WALLET_LEGACY_FIELD]);

  let available = Number.isFinite(availableRaw)
    ? Math.round(availableRaw)
    : null;
  let reserved = Number.isFinite(reservedRaw) ? Math.round(reservedRaw) : null;
  const legacy = Number.isFinite(legacyRaw)
    ? Math.round(legacyRaw * 100)
    : null;

  let migrated = false;
  if (available == null) {
    available = legacy != null ? legacy : 0;
    migrated = true;
  }
  if (reserved == null) {
    reserved = 0;
    migrated = true;
  }
  if (Number.isFinite(availableRaw) && availableRaw < 0) migrated = true;
  if (Number.isFinite(reservedRaw) && reservedRaw < 0) migrated = true;

  available = Math.max(0, available);
  reserved = Math.max(0, reserved);

  return { available, reserved, migrated };
};

const ensureWalletFields = (tx, userRef, data) => {
  const normalized = normalizeWalletCents(data);
  if (normalized.migrated) {
    tx.update(userRef, {
      [WALLET_AVAILABLE_FIELD]: normalized.available,
      [WALLET_RESERVED_FIELD]: normalized.reserved,
      walletVersion: WALLET_VERSION,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  return normalized;
};

const getSafeBookerName = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "Seeker";
};

const buildHttpsError = (status, code) =>
  new functions.https.HttpsError(status, code, { code });

const buildReturnUrl = (baseUrl, params = {}) => {
  const normalized = normalizeReturnUrl(baseUrl) || stripeReturnUrl;
  if (!normalized) return "";
  const url = new URL(normalized);
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

const computeFeeCents = (amountCents) => {
  const percent = Number.isFinite(stripeFeePercent)
    ? stripeFeePercent / 100
    : 0;
  const fixed = Number.isFinite(stripeFeeFixed) ? stripeFeeFixed : 0;
  const total = (amountCents / 100 + fixed) / Math.max(0.01, 1 - percent);
  const totalCents = Math.round(total * 100);
  const feeCents = Math.max(0, totalCents - amountCents);
  return { feeCents, totalCents };
};

const PUBLIC_PARKING_DEFAULT_LIMIT = 20;
const PUBLIC_PARKING_MAX_LIMIT = 40;
const PUBLIC_PARKING_DEFAULT_RADIUS_M = 2000;
const PUBLIC_PARKING_MAX_RADIUS_M = 4000;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const PUBLIC_PARKING_CITIES = [
  {
    id: "paris",
    name: "Paris",
    source: "paris",
    center: { lat: 48.8566, lng: 2.3522 },
    radiusMeters: 25000,
  },
  {
    id: "marseille",
    name: "Marseille",
    source: "overpass",
    center: { lat: 43.2965, lng: 5.3698 },
    radiusMeters: 18000,
  },
  {
    id: "lyon",
    name: "Lyon",
    source: "overpass",
    center: { lat: 45.764, lng: 4.8357 },
    radiusMeters: 18000,
  },
  {
    id: "toulouse",
    name: "Toulouse",
    source: "overpass",
    center: { lat: 43.6047, lng: 1.4442 },
    radiusMeters: 18000,
  },
  {
    id: "nice",
    name: "Nice",
    source: "overpass",
    center: { lat: 43.7102, lng: 7.262 },
    radiusMeters: 15000,
  },
];

const isValidCoord = (lng, lat) =>
  Number.isFinite(lng) &&
  Number.isFinite(lat) &&
  Math.abs(lng) <= 180 &&
  Math.abs(lat) <= 90;

const toFiniteNumberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const getDistanceMetersBetween = (a, b) => {
  if (!a || !b) return Infinity;
  if (!isValidCoord(a.lng, a.lat) || !isValidCoord(b.lng, b.lat)) {
    return Infinity;
  }
  const R = 6371e3;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const c =
    2 *
    Math.atan2(
      Math.sqrt(
        Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2,
      ),
      Math.sqrt(
        1 -
          (Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2),
      ),
    );
  return R * c;
};

const normalizeParkingText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const extractTimeRanges = (raw) => {
  const text = String(raw || "");
  const matches = [...text.matchAll(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/gi)];
  const minutes = matches
    .map((match) => {
      const hour = Number(match[1]);
      const min = match[2] ? Number(match[2]) : 0;
      if (!Number.isFinite(hour) || hour < 0 || hour > 24) return null;
      if (!Number.isFinite(min) || min < 0 || min > 59) return null;
      return hour === 24 ? 24 * 60 : hour * 60 + min;
    })
    .filter((value) => value != null);
  const ranges = [];
  for (let i = 0; i + 1 < minutes.length; i += 2) {
    ranges.push([minutes[i], minutes[i + 1]]);
  }
  return ranges;
};

const isOpenEveryDayText = (text) =>
  /\b7\s*j(?:ours)?\s*(?:\/|sur)\s*7\b/.test(text);

const isParkingOpenNow = (record, now = new Date()) => {
  if (!record) return false;
  const raw = record?.horaire_na ?? record?.horaire ?? record?.horaires ?? "";
  const text = normalizeParkingText(raw);
  if (!text) return false;
  if (text.includes("ferme") || text.includes("fermee")) return false;
  if (text.includes("24h") || text.includes("24 h") || text.includes("24/24")) {
    return true;
  }
  if (isOpenEveryDayText(text)) return true;

  const ranges = extractTimeRanges(text);
  if (!ranges.length) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return ranges.some(([start, end]) => {
    if (start == null || end == null) return false;
    if (start === end) return false;
    if (end > start) return nowMinutes >= start && nowMinutes <= end;
    return nowMinutes >= start || nowMinutes <= end;
  });
};

const isResidentOnlyParking = (record) => {
  if (!record) return false;
  const type = normalizeParkingText(
    record?.type_usagers ?? record?.type_usager ?? "",
  );
  const hours = normalizeParkingText(record?.horaire_na ?? "");
  const info = normalizeParkingText(
    Array.isArray(record?.info) ? record.info.join(" ") : (record?.info ?? ""),
  );
  const isPublic =
    type.includes("tous") ||
    type.includes("public") ||
    type.includes("visiteur") ||
    type.includes("visitor");
  if (isPublic) return false;
  if (type.includes("abonn") || type.includes("resident")) return true;
  if (hours.includes("abonn")) return true;
  if (info.includes("abonn")) return true;
  return false;
};

const resolvePublicParkingCity = (coords) => {
  if (!coords) return null;
  let bestCity = null;
  let bestDistance = Infinity;
  PUBLIC_PARKING_CITIES.forEach((city) => {
    const distance = getDistanceMetersBetween(coords, city.center);
    if (distance <= city.radiusMeters && distance < bestDistance) {
      bestCity = city;
      bestDistance = distance;
    }
  });
  return bestCity;
};

const getPublicParkingCityById = (cityId) =>
  PUBLIC_PARKING_CITIES.find((city) => city.id === cityId) || null;

const withTimeout = async (promiseFactory, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchJson = async (url, options = {}, timeoutMs = 12000) =>
  withTimeout(async (signal) => {
    const response = await fetch(url, {
      ...options,
      signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`public_parking_fetch_${response.status}`);
    }
    return response.json();
  }, timeoutMs);

const fetchJsonText = async (url, options = {}, timeoutMs = 12000) =>
  withTimeout(async (signal) => {
    const response = await fetch(url, {
      ...options,
      signal,
      headers: {
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.1",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      contentType: response.headers.get("content-type") || "",
    };
  }, timeoutMs);

const pickParisPoint = (record, origin) => {
  const shape = record?.geo_shape || record?.geometry || null;
  let lng = null;
  let lat = null;
  if (shape?.type === "Point" && Array.isArray(shape.coordinates)) {
    [lng, lat] = shape.coordinates;
  } else if (
    Array.isArray(shape?.coordinates) &&
    typeof shape.coordinates[0] === "number"
  ) {
    [lng, lat] = shape.coordinates;
  } else if (
    shape?.geometry?.type === "Point" &&
    Array.isArray(shape.geometry.coordinates)
  ) {
    [lng, lat] = shape.geometry.coordinates;
  }
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    return { lng: Number(lng), lat: Number(lat) };
  }

  const point = record?.geo_point_2d || record?.geo_point || null;
  const parsePointArray = (arr) => {
    if (!Array.isArray(arr) || arr.length < 2) return null;
    const a = Number(arr[0]);
    const b = Number(arr[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const cand1 = { lat: a, lng: b };
    const cand2 = { lat: b, lng: a };
    const d1 = getDistanceMetersBetween(cand1, origin);
    const d2 = getDistanceMetersBetween(cand2, origin);
    return d1 <= d2 ? cand1 : cand2;
  };

  if (Array.isArray(point)) {
    return parsePointArray(point);
  }
  if (typeof point === "string") {
    const parts = point
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((value) => Number(value));
    return parsePointArray(parts);
  }
  if (point && typeof point === "object") {
    const parsed = {
      lat: Number(point.lat ?? point.latitude ?? point.y),
      lng: Number(point.lon ?? point.lng ?? point.longitude ?? point.x),
    };
    return isValidCoord(parsed.lng, parsed.lat) ? parsed : null;
  }
  return null;
};

const fetchParisPublicParkings = async ({ lat, lng, radiusMeters, limit }) => {
  const params = new URLSearchParams();
  params.set(
    "where",
    `distance(geo_point_2d, geom'POINT(${lng} ${lat})', ${radiusMeters}m)`,
  );
  params.set("order_by", `distance(geo_point_2d, geom'POINT(${lng} ${lat})')`);
  params.set("limit", String(limit));
  const url = `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/stationnement-en-ouvrage/records?${params.toString()}`;
  const data = await fetchJson(url);
  const raw = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.records)
      ? data.records
      : [];
  const unique = new Map();

  raw.forEach((row, idx) => {
    const record = row?.fields ?? row;
    if (!record) return;
    if (isResidentOnlyParking(record)) return;
    if (!isParkingOpenNow(record)) return;

    const coords = pickParisPoint(record, { lat, lng });
    if (!coords || !isValidCoord(coords.lng, coords.lat)) return;

    const id =
      row?.recordid || record?.recordid || record?.id || `parking-${idx}`;
    const address =
      record?.adresse ||
      (Array.isArray(record?.adress_geo_entrees)
        ? record.adress_geo_entrees[0]
        : record?.adress_geo_entrees) ||
      record?.adress ||
      "";

    unique.set(id, {
      id,
      cityId: "paris",
      cityName: "Paris",
      lng: coords.lng,
      lat: coords.lat,
      name: record?.nom || record?.name || record?.nom_parc || "",
      address,
      distanceMeters: getDistanceMetersBetween({ lat, lng }, coords),
      typeUsagers: record?.type_usagers ?? record?.type_usager ?? "",
      hours: record?.horaire_na ?? "",
      heightMaxCm: toFiniteNumberOrNull(record?.hauteur_max),
      tarif1h: toFiniteNumberOrNull(record?.tarif_1h),
      tarif2h: toFiniteNumberOrNull(record?.tarif_2h),
      tarif24h: toFiniteNumberOrNull(record?.tarif_24h),
      nbPlaces: toFiniteNumberOrNull(record?.nb_places),
      nbPmr: toFiniteNumberOrNull(record?.nb_pmr),
      nbEv: toFiniteNumberOrNull(record?.nb_voitures_electriques),
      url: record?.url ?? "",
      phone: record?.tel ?? "",
      source: "paris",
    });
  });

  return Array.from(unique.values())
    .sort(
      (a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
    )
    .slice(0, limit);
};

const parseHeightToCm = (value) => {
  if (value == null || value === "") return null;
  const text = String(value).trim().toLowerCase().replace(/,/g, ".");
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (text.includes("cm")) return Math.round(amount);
  if (text.includes("m") || amount <= 5) return Math.round(amount * 100);
  return Math.round(amount);
};

const parseHourlyRate = (charge, fee) => {
  if (
    String(fee || "")
      .trim()
      .toLowerCase() === "no"
  )
    return 0;
  const text = String(charge || "")
    .trim()
    .toLowerCase()
    .replace(/,/g, ".");
  if (!text) return null;

  const directMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:€|eur).*(?:\/|per)?\s*(h|hr|heure|hour)\b/,
  );
  if (directMatch) {
    const amount = Number(directMatch[1]);
    return Number.isFinite(amount) ? amount : null;
  }

  const minuteMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:€|eur).*(?:\/|per)?\s*(\d+)\s*min/,
  );
  if (minuteMatch) {
    const amount = Number(minuteMatch[1]);
    const minutes = Number(minuteMatch[2]);
    if (Number.isFinite(amount) && Number.isFinite(minutes) && minutes > 0) {
      return Math.round(amount * (60 / minutes) * 100) / 100;
    }
  }

  return null;
};

const buildAddressFromTags = (tags = {}) => {
  const line1 = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ")
    .trim();
  const line2 = [tags["addr:postcode"], tags["addr:city"]]
    .filter(Boolean)
    .join(" ")
    .trim();
  return [line1, line2].filter(Boolean).join(", ");
};

const buildOverpassQuery = ({ lat, lng, radiusMeters }) => `
[out:json][timeout:12];
(
  node["amenity"="parking"]["access"!~"^(private|customers|permit|residents)$"]["parking"!~"^(street_side|lane)$"](around:${radiusMeters},${lat},${lng});
  way["amenity"="parking"]["access"!~"^(private|customers|permit|residents)$"]["parking"!~"^(street_side|lane)$"](around:${radiusMeters},${lat},${lng});
  relation["amenity"="parking"]["access"!~"^(private|customers|permit|residents)$"]["parking"!~"^(street_side|lane)$"](around:${radiusMeters},${lat},${lng});
);
out center tags;
`;

const pickOverpassCoords = (element) => {
  const direct = {
    lat: Number(element?.lat),
    lng: Number(element?.lon),
  };
  if (isValidCoord(direct.lng, direct.lat)) return direct;
  const center = {
    lat: Number(element?.center?.lat),
    lng: Number(element?.center?.lon),
  };
  return isValidCoord(center.lng, center.lat) ? center : null;
};

const fetchOverpassData = async ({ lat, lng, radiusMeters }) => {
  const body = new URLSearchParams({
    data: buildOverpassQuery({ lat, lng, radiusMeters }),
  }).toString();
  const errors = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchJsonText(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body,
        },
        15000,
      );
      if (!response.ok) {
        errors.push(`${endpoint} status ${response.status}`);
        continue;
      }

      try {
        return JSON.parse(response.text);
      } catch (_) {
        errors.push(
          `${endpoint} invalid json ${response.contentType} ${response.text
            .slice(0, 120)
            .replace(/\s+/g, " ")}`,
        );
      }
    } catch (err) {
      errors.push(`${endpoint} ${err?.message || String(err)}`);
    }
  }

  throw new Error(`overpass_unavailable: ${errors.join(" | ")}`);
};

const fetchOverpassPublicParkings = async ({
  city,
  lat,
  lng,
  radiusMeters,
  limit,
}) => {
  const data = await fetchOverpassData({ lat, lng, radiusMeters });

  const elements = Array.isArray(data?.elements) ? data.elements : [];
  const unique = new Map();

  elements.forEach((element, idx) => {
    const tags = element?.tags || {};
    const coords = pickOverpassCoords(element);
    if (!coords) return;

    const name = String(tags.name || tags.operator || "").trim();
    const id = `${element?.type || "parking"}-${element?.id || idx}`;
    const distanceMeters = getDistanceMetersBetween({ lat, lng }, coords);
    unique.set(id, {
      id,
      cityId: city.id,
      cityName: city.name,
      lng: coords.lng,
      lat: coords.lat,
      name,
      address: buildAddressFromTags(tags),
      distanceMeters,
      typeUsagers: tags.access || "public",
      hours: tags.opening_hours || "",
      heightMaxCm: parseHeightToCm(tags.maxheight),
      tarif1h: parseHourlyRate(tags.charge, tags.fee),
      tarif2h: null,
      tarif24h: null,
      nbPlaces: toFiniteNumberOrNull(tags.capacity),
      nbPmr: toFiniteNumberOrNull(tags["capacity:disabled"]),
      nbEv: toFiniteNumberOrNull(tags["capacity:charging"]),
      url: tags.website || tags.url || "",
      phone: tags.phone || "",
      source: "overpass",
    });
  });

  return Array.from(unique.values())
    .sort(
      (a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
    )
    .slice(0, limit);
};

exports.fetchPublicParkings = functions
  .runWith({
    cors: true,
    timeoutSeconds: 20,
  })
  .https.onCall(async (data) => {
    const lng = Number(data?.lng);
    const lat = Number(data?.lat);
    const forceCityId =
      typeof data?.forceCityId === "string"
        ? data.forceCityId.trim().toLowerCase()
        : "";
    const limit = clamp(
      Math.round(Number(data?.limit) || PUBLIC_PARKING_DEFAULT_LIMIT),
      1,
      PUBLIC_PARKING_MAX_LIMIT,
    );
    const radiusMeters = clamp(
      Math.round(Number(data?.radiusMeters) || PUBLIC_PARKING_DEFAULT_RADIUS_M),
      300,
      PUBLIC_PARKING_MAX_RADIUS_M,
    );

    if (!isValidCoord(lng, lat)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Valid coordinates are required.",
      );
    }

    const city =
      getPublicParkingCityById(forceCityId) ||
      resolvePublicParkingCity({ lat, lng });
    if (!city) {
      return { parkings: [], cityId: null };
    }

    try {
      const parkings =
        city.source === "paris"
          ? await fetchParisPublicParkings({ lat, lng, radiusMeters, limit })
          : await fetchOverpassPublicParkings({
              city,
              lat,
              lng,
              radiusMeters,
              limit,
            });
      return {
        parkings,
        cityId: city.id,
        cityName: city.name,
      };
    } catch (err) {
      functions.logger.error("fetchPublicParkings failed", {
        cityId: city.id,
        lat,
        lng,
        message: err?.message || String(err),
      });
      throw new functions.https.HttpsError(
        "internal",
        err?.message || "Unable to fetch public parkings.",
      );
    }
  });

exports.bookSpotSecure = functions
  .runWith({
    cors: true,
  })
  .https.onCall(async (data, context) => {
    const traceId = makeId();
    try {
      if (!context.auth) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "Authentication required.",
        );
      }

      const uid = context.auth.uid;
      const spotId = typeof data?.spotId === "string" ? data.spotId.trim() : "";
      if (!spotId) {
        throw buildHttpsError("invalid-argument", "spot_missing");
      }

      const requestedSessionId =
        typeof data?.bookingSessionId === "string" && data.bookingSessionId
          ? data.bookingSessionId
          : null;
      const requestedBookOpId =
        typeof data?.bookOpId === "string" && data.bookOpId
          ? data.bookOpId
          : null;
      const bookingSessionId = requestedSessionId || makeId();
      const bookOpId = requestedBookOpId || bookingSessionId;

      const bookerName = getSafeBookerName(data?.bookerName);
      const bookerVehiclePlate =
        typeof data?.bookerVehiclePlate === "string"
          ? data.bookerVehiclePlate
          : null;
      const bookerVehicleId =
        typeof data?.bookerVehicleId === "string" ? data.bookerVehicleId : null;

      functions.logger.info("bookSpotSecure:start", {
        traceId,
        uid,
        spotId,
        bookingSessionId,
        bookOpId,
      });

      const spotRef = admin
        .firestore()
        .doc(`artifacts/${projectId}/public/data/spots/${spotId}`);
      const bookerRef = getUserRef(uid);

      const result = await admin.firestore().runTransaction(async (tx) => {
        const spotSnap = await tx.get(spotRef);
        if (!spotSnap.exists) {
          throw buildHttpsError("not-found", "spot_missing");
        }

        const liveSpot = spotSnap.data() || {};
        const status = liveSpot.status;
        const liveSessionId =
          typeof liveSpot.bookingSessionId === "string"
            ? liveSpot.bookingSessionId
            : null;
        const liveBookOpId =
          typeof liveSpot.bookOpId === "string" ? liveSpot.bookOpId : null;

        functions.logger.debug("bookSpotSecure:spot_snapshot", {
          traceId,
          uid,
          spotId,
          status: status || null,
          liveSessionId,
          liveBookOpId,
          liveBookerId: liveSpot.bookerId || null,
          hostId: liveSpot.hostId || null,
        });

        if (status && status !== "available") {
          if (
            status === "booked" &&
            liveSpot.bookerId === uid &&
            liveSessionId === bookingSessionId &&
            liveBookOpId === bookOpId
          ) {
            const priceCents = parsePriceToCents(liveSpot?.price);
            const amountCents = Number.isFinite(priceCents) ? priceCents : 0;
            return {
              ok: true,
              isFree: amountCents <= 0,
              bookingSessionId: liveSessionId,
              alreadyBooked: true,
              hostId: liveSpot.hostId || null,
            };
          }
          throw buildHttpsError("failed-precondition", "spot_not_available");
        }

        const priceCents = parsePriceToCents(liveSpot?.price);
        const amountCents = Number.isFinite(priceCents) ? priceCents : 0;
        const isFree = amountCents <= 0;
        const hostId = liveSpot.hostId || null;
        const hostRef = hostId ? getUserRef(hostId) : null;

        // READ ALL DATA BEFORE ANY WRITES (Firestore transaction requirement)
        const bookerSnap = await tx.get(bookerRef);
        const bookerData = bookerSnap.exists ? bookerSnap.data() : {};

        // Read host wallet BEFORE any writes if payment is needed
        let hostSnap = null;
        let hostData = {};
        if (amountCents > 0 && hostRef && hostId !== uid) {
          hostSnap = await tx.get(hostRef);
          hostData = hostSnap.exists ? hostSnap.data() : {};
        }

        const { available: bookerAvailable } = ensureWalletFields(
          tx,
          bookerRef,
          bookerData,
        );

        functions.logger.debug("bookSpotSecure:wallet_snapshot", {
          traceId,
          uid,
          spotId,
          amountCents,
          isFree,
          bookerAvailable,
          hostId,
        });

        if (isFree) {
          const currentHeartsRaw = Number(bookerData?.premiumParks);
          const currentHearts = Number.isFinite(currentHeartsRaw)
            ? currentHeartsRaw
            : PREMIUM_PARKS_MAX;
          if (currentHearts <= 0) {
            throw buildHttpsError("failed-precondition", "no_premium_parks");
          }
        }

        if (amountCents > 0) {
          if (bookerAvailable < amountCents) {
            throw buildHttpsError("failed-precondition", "insufficient_funds");
          }

          const nextBookerAvailable = bookerAvailable - amountCents;
          tx.set(
            bookerRef,
            {
              [WALLET_AVAILABLE_FIELD]: nextBookerAvailable,
              walletVersion: WALLET_VERSION,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              [WALLET_LEGACY_FIELD]: nextBookerAvailable / 100,
            },
            { merge: true },
          );

          if (hostRef && hostId !== uid) {
            const { available: hostAvailable } = ensureWalletFields(
              tx,
              hostRef,
              hostData,
            );
            const nextHostAvailable = hostAvailable + amountCents;
            tx.set(
              hostRef,
              {
                [WALLET_AVAILABLE_FIELD]: nextHostAvailable,
                walletVersion: WALLET_VERSION,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                [WALLET_LEGACY_FIELD]: nextHostAvailable / 100,
              },
              { merge: true },
            );

            const hostLedgerId = `booking_${spotId}_${bookingSessionId}_${hostId}_credit`;
            tx.set(
              buildWalletLedgerRef(hostLedgerId),
              {
                uid: hostId,
                spotId,
                bookingSessionId,
                type: "booking_credit",
                amountCents,
                balanceAfterCents: nextHostAvailable,
                counterpartyUid: uid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          }

          const bookerLedgerId = `booking_${spotId}_${bookingSessionId}_${uid}_debit`;
          tx.set(
            buildWalletLedgerRef(bookerLedgerId),
            {
              uid,
              spotId,
              bookingSessionId,
              type: "booking_debit",
              amountCents,
              balanceAfterCents: nextBookerAvailable,
              counterpartyUid: hostId,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }

        tx.update(spotRef, {
          status: "booked",
          bookingSessionId,
          bookedAt: admin.firestore.FieldValue.serverTimestamp(),
          bookOpId,
          bookOpAt: admin.firestore.FieldValue.serverTimestamp(),
          bookerId: uid,
          bookerName,
          bookerAccepted: false,
          bookerAcceptedAt: null,
          navOpId: null,
          navOpAt: null,
          bookerVehiclePlate: bookerVehiclePlate || null,
          bookerVehicleId: bookerVehicleId || null,
          premiumParksAppliedAt: null,
          premiumParksAppliedBy: null,
          premiumParksBookerDelta: null,
          premiumParksBookerAfter: null,
          premiumParksHostDelta: null,
          premiumParksHostAfter: null,
          hostVerifiedBookerPlate: false,
          hostVerifiedBookerPlateAt: null,
          hostConfirmedBookerPlate: null,
          hostConfirmedBookerPlateNorm: null,
          bookerVerifiedHostPlate: false,
          bookerVerifiedHostPlateAt: null,
          bookerConfirmedHostPlate: null,
          bookerConfirmedHostPlateNorm: null,
          plateConfirmed: false,
          completedAt: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelledByRole: null,
          cancelledFor: null,
          cancelledForName: null,
        });

        return {
          ok: true,
          isFree,
          bookingSessionId,
          hostId,
        };
      });

      functions.logger.info("bookSpotSecure:success", {
        traceId,
        uid,
        spotId,
        bookingSessionId: result?.bookingSessionId || bookingSessionId,
        isFree: result?.isFree ?? null,
        alreadyBooked: !!result?.alreadyBooked,
      });

      return result;
    } catch (err) {
      const errCode = err?.code || null;
      const errMessage = err?.message || "unknown_error";
      functions.logger.error("bookSpotSecure:error", {
        traceId,
        errCode,
        errMessage,
        stack: err?.stack || null,
      });

      if (err instanceof functions.https.HttpsError) {
        throw err;
      }
      throw new functions.https.HttpsError("internal", errMessage, {
        code: "internal_booking_error",
        traceId,
      });
    }
  });

exports.createKycSession = functions
  .runWith({
    cors: true,
  })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required.",
      );
    }
    if (!stripe) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Stripe is not configured.",
      );
    }

    const uid = context.auth.uid;
    const returnUrl = normalizeReturnUrl(data?.returnUrl) || stripeReturnUrl;

    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      metadata: { uid },
      return_url: returnUrl,
    });

    await getUserRef(uid).set(
      {
        kycStatus: session.status || "processing",
        kycSessionId: session.id,
        kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycProvider: "stripe",
      },
      { merge: true },
    );

    return {
      sessionId: session.id,
      status: session.status,
      url: session.url,
      clientSecret: session.client_secret,
    };
  });

exports.createWalletTopupSession = functions
  .runWith({
    cors: true,
  })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required.",
      );
    }
    if (!stripe) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Stripe is not configured.",
      );
    }

    const uid = context.auth.uid;
    const amountCents = parseAmountToCents(data?.amount);
    if (!Number.isFinite(amountCents)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid amount.",
      );
    }
    const minCents = 100;
    const maxCents = 10000;
    if (amountCents < minCents || amountCents > maxCents) {
      throw new functions.https.HttpsError(
        "out-of-range",
        "Amount out of range.",
      );
    }

    const { feeCents, totalCents } = computeFeeCents(amountCents);
    const returnUrl = normalizeReturnUrl(data?.returnUrl) || stripeReturnUrl;
    const successUrl = buildReturnUrl(returnUrl, {
      topup: "success",
      session_id: "{CHECKOUT_SESSION_ID}",
    });
    const cancelUrl = buildReturnUrl(returnUrl, { topup: "cancel" });

    const amountLabel = (amountCents / 100).toFixed(2).replace(".", ",");
    const feeLabel = (feeCents / 100).toFixed(2).replace(".", ",");

    const lineItems = [
      {
        price_data: {
          currency: "eur",
          unit_amount: amountCents,
          product_data: {
            name: `Recharge wallet ${amountLabel}€`,
          },
        },
        quantity: 1,
      },
    ];

    if (feeCents > 0) {
      lineItems.push({
        price_data: {
          currency: "eur",
          unit_amount: feeCents,
          product_data: {
            name: `Frais de service ${feeLabel}€`,
          },
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: uid,
      metadata: {
        uid,
        amountCents: String(amountCents),
        feeCents: String(feeCents),
        totalCents: String(totalCents),
      },
    });

    return { url: session.url, sessionId: session.id };
  });

exports.stripeIdentityWebhook = functions.https.onRequest(async (req, res) => {
  if (!stripe) {
    res.status(500).send("Stripe is not configured.");
    return;
  }
  if (!stripeWebhookSecret) {
    res.status(500).send("Stripe webhook secret is missing.");
    return;
  }

  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      signature,
      stripeWebhookSecret,
    );
  } catch (err) {
    res
      .status(400)
      .send(`Webhook signature verification failed: ${err.message}`);
    return;
  }

  const object = event?.data?.object;
  if (event?.type?.startsWith("identity.verification_session.")) {
    const uid = object?.metadata?.uid;
    if (uid) {
      const status = object?.status || "processing";
      await getUserRef(uid).set(
        {
          kycStatus: status,
          kycSessionId: object?.id || null,
          kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          kycProvider: "stripe",
        },
        { merge: true },
      );
    }
    res.json({ received: true });
    return;
  }

  if (event?.type === "checkout.session.completed") {
    if (object?.payment_status && object.payment_status !== "paid") {
      res.json({ received: true });
      return;
    }
    const uid = object?.metadata?.uid || object?.client_reference_id;
    const amountCents = Number.parseInt(object?.metadata?.amountCents, 10);
    if (!uid || !Number.isFinite(amountCents)) {
      res.json({ received: true });
      return;
    }

    const topupRef = admin
      .firestore()
      .doc(`artifacts/${projectId}/public/data/walletTopups/${object.id}`);
    const userRef = getUserRef(uid);

    await admin.firestore().runTransaction(async (tx) => {
      const existing = await tx.get(topupRef);
      if (existing.exists) return;
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : {};
      const { available: currentAvailable, reserved: currentReserved } =
        ensureWalletFields(tx, userRef, userData);
      const nextAvailable = currentAvailable + amountCents;
      tx.set(
        topupRef,
        {
          uid,
          amountCents,
          feeCents: Number.parseInt(object?.metadata?.feeCents, 10) || 0,
          totalCents:
            Number.parseInt(object?.metadata?.totalCents, 10) || amountCents,
          status: object?.payment_status || "paid",
          currency: object?.currency || "eur",
          sessionId: object?.id || null,
          paymentIntentId: object?.payment_intent || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(
        userRef,
        {
          [WALLET_AVAILABLE_FIELD]: nextAvailable,
          [WALLET_RESERVED_FIELD]: currentReserved,
          walletVersion: WALLET_VERSION,
          [WALLET_LEGACY_FIELD]: nextAvailable / 100,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      const ledgerId = `topup_${object.id}_${uid}`;
      tx.set(
        buildWalletLedgerRef(ledgerId),
        {
          uid,
          type: "topup",
          amountCents,
          balanceAfterCents: nextAvailable,
          currency: object?.currency || "eur",
          sessionId: object?.id || null,
          paymentIntentId: object?.payment_intent || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    res.json({ received: true });
    return;
  }

  res.json({ received: true });
});
