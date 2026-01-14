const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();

const firebaseConfig = (() => {
  try {
    return process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : {};
  } catch (_) {
    return {};
  }
})();

const projectId =
  firebaseConfig.projectId || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'parkswap-36bb2';

const stripeConfig = functions.config().stripe || {};
const stripeSecret = stripeConfig.secret || process.env.STRIPE_SECRET_KEY || '';
const stripeWebhookSecret = stripeConfig.webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || '';
const stripeReturnUrl = stripeConfig.return_url || process.env.STRIPE_RETURN_URL || 'https://parkswap.app';
const stripeFeePercent = Number(stripeConfig.fee_percent ?? process.env.STRIPE_FEE_PERCENT ?? 1.4);
const stripeFeeFixed = Number(stripeConfig.fee_fixed ?? process.env.STRIPE_FEE_FIXED ?? 0.25);

const stripe = stripeSecret
  ? new Stripe(stripeSecret, {
      apiVersion: '2024-04-10',
    })
  : null;

const getUserRef = (uid) =>
  admin.firestore().doc(`artifacts/${projectId}/public/data/users/${uid}`);

const normalizeReturnUrl = (value) => {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseAmountToCents = (value) => {
  const raw = typeof value === 'string' ? value.replace(',', '.') : value;
  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100);
  if (!Number.isFinite(rounded)) return null;
  return rounded;
};

const buildReturnUrl = (baseUrl, params = {}) => {
  const normalized = normalizeReturnUrl(baseUrl) || stripeReturnUrl;
  if (!normalized) return '';
  const url = new URL(normalized);
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

const computeFeeCents = (amountCents) => {
  const percent = Number.isFinite(stripeFeePercent) ? stripeFeePercent / 100 : 0;
  const fixed = Number.isFinite(stripeFeeFixed) ? stripeFeeFixed : 0;
  const total = (amountCents / 100 + fixed) / Math.max(0.01, 1 - percent);
  const totalCents = Math.round(total * 100);
  const feeCents = Math.max(0, totalCents - amountCents);
  return { feeCents, totalCents };
};

exports.createKycSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  if (!stripe) {
    throw new functions.https.HttpsError('failed-precondition', 'Stripe is not configured.');
  }

  const uid = context.auth.uid;
  const returnUrl = normalizeReturnUrl(data?.returnUrl) || stripeReturnUrl;

  const session = await stripe.identity.verificationSessions.create({
    type: 'document',
    metadata: { uid },
    return_url: returnUrl,
  });

  await getUserRef(uid).set(
    {
      kycStatus: session.status || 'processing',
      kycSessionId: session.id,
      kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      kycProvider: 'stripe',
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

exports.createWalletTopupSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  if (!stripe) {
    throw new functions.https.HttpsError('failed-precondition', 'Stripe is not configured.');
  }

  const uid = context.auth.uid;
  const amountCents = parseAmountToCents(data?.amount);
  if (!Number.isFinite(amountCents)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid amount.');
  }
  const minCents = 100;
  const maxCents = 10000;
  if (amountCents < minCents || amountCents > maxCents) {
    throw new functions.https.HttpsError('out-of-range', 'Amount out of range.');
  }

  const { feeCents, totalCents } = computeFeeCents(amountCents);
  const returnUrl = normalizeReturnUrl(data?.returnUrl) || stripeReturnUrl;
  const successUrl = buildReturnUrl(returnUrl, {
    topup: 'success',
    session_id: '{CHECKOUT_SESSION_ID}',
  });
  const cancelUrl = buildReturnUrl(returnUrl, { topup: 'cancel' });

  const amountLabel = (amountCents / 100).toFixed(2).replace('.', ',');
  const feeLabel = (feeCents / 100).toFixed(2).replace('.', ',');

  const lineItems = [
    {
      price_data: {
        currency: 'eur',
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
        currency: 'eur',
        unit_amount: feeCents,
        product_data: {
          name: `Frais de service ${feeLabel}€`,
        },
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
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
    res.status(500).send('Stripe is not configured.');
    return;
  }
  if (!stripeWebhookSecret) {
    res.status(500).send('Stripe webhook secret is missing.');
    return;
  }

  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, signature, stripeWebhookSecret);
  } catch (err) {
    res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    return;
  }

  const object = event?.data?.object;
  if (event?.type?.startsWith('identity.verification_session.')) {
    const uid = object?.metadata?.uid;
    if (uid) {
      const status = object?.status || 'processing';
      await getUserRef(uid).set(
        {
          kycStatus: status,
          kycSessionId: object?.id || null,
          kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          kycProvider: 'stripe',
        },
        { merge: true },
      );
    }
    res.json({ received: true });
    return;
  }

  if (event?.type === 'checkout.session.completed') {
    if (object?.payment_status && object.payment_status !== 'paid') {
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
      tx.set(
        topupRef,
        {
          uid,
          amountCents,
          feeCents: Number.parseInt(object?.metadata?.feeCents, 10) || 0,
          totalCents: Number.parseInt(object?.metadata?.totalCents, 10) || amountCents,
          status: object?.payment_status || 'paid',
          currency: object?.currency || 'eur',
          sessionId: object?.id || null,
          paymentIntentId: object?.payment_intent || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(
        userRef,
        {
          wallet: admin.firestore.FieldValue.increment(amountCents / 100),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    res.json({ received: true });
    return;
  }

  res.json({ received: true });
});
