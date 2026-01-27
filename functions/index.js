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
    tx.set(
      userRef,
      {
        [WALLET_AVAILABLE_FIELD]: normalized.available,
        [WALLET_RESERVED_FIELD]: normalized.reserved,
        walletVersion: WALLET_VERSION,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
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

exports.bookSpotSecure = functions
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

      const bookerSnap = await tx.get(bookerRef);
      const bookerData = bookerSnap.exists ? bookerSnap.data() : {};
      const { available: bookerAvailable } = ensureWalletFields(
        tx,
        bookerRef,
        bookerData,
      );

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
          const hostSnap = await tx.get(hostRef);
          const hostData = hostSnap.exists ? hostSnap.data() : {};
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

    return result;
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
