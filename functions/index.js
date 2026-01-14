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

  const session = event?.data?.object;
  const uid = session?.metadata?.uid;
  if (!uid) {
    res.json({ received: true });
    return;
  }

  const status = session?.status || 'processing';

  await getUserRef(uid).set(
    {
      kycStatus: status,
      kycSessionId: session?.id || null,
      kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      kycProvider: 'stripe',
    },
    { merge: true },
  );

  res.json({ received: true });
});
