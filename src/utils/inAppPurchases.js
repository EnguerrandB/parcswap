import { isNativeIosApp } from "./mobile";

const DEFAULT_WALLET_TOPUP_PRODUCTS = [
  { amount: 5, productId: "com.parkswap.app.wallet.5" },
  { amount: 10, productId: "com.parkswap.app.wallet.10" },
  { amount: 20, productId: "com.parkswap.app.wallet.20" },
  { amount: 50, productId: "com.parkswap.app.wallet.50" },
];

const WALLET_TOPUP_PURCHASE_TIMEOUT_MS = 90_000;
const IAP_NAMESPACE_WAIT_MS = 5_000;
const IAP_PRODUCT_READY_WAIT_MS = 10_000;
const IAP_POLL_INTERVAL_MS = 250;

let purchasePluginPromise = null;
let storeReadyPromise = null;
let storeBound = false;
const pendingWalletPurchases = new Map();
let lastStoreError = null;
const latestProductSnapshots = new Map();

const sleep = (timeoutMs) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs);
  });

const readConfiguredWalletProducts = () => {
  const raw = String(
    import.meta.env.VITE_IOS_WALLET_TOPUP_PRODUCTS || "",
  ).trim();
  if (!raw) return DEFAULT_WALLET_TOPUP_PRODUCTS;

  const parsed = raw
    .split(",")
    .map((entry) => {
      const [amountPart, productIdPart] = String(entry).split(":");
      const amount = Number(amountPart);
      const productId = String(productIdPart || "").trim();
      if (!Number.isFinite(amount) || amount <= 0 || !productId) return null;
      return { amount, productId };
    })
    .filter(Boolean);

  return parsed.length ? parsed : DEFAULT_WALLET_TOPUP_PRODUCTS;
};

export const IOS_WALLET_TOPUP_PRODUCTS = readConfiguredWalletProducts();

const createPurchaseError = (code, message, details = {}) => {
  const error = new Error(message || code || "wallet_iap_failed");
  error.code = code || "wallet_iap_failed";
  error.details = details;
  return error;
};

const serializePurchaseError = (error) => {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name || null,
      message: error.message || null,
      code: error.code || null,
      productId: error.productId || null,
      platform: error.platform || null,
      details: error.details || null,
      stack: error.stack || null,
    };
  }
  if (typeof error === "object") {
    return {
      ...error,
      code: error.code ?? null,
      message: error.message ?? null,
      productId: error.productId ?? null,
      platform: error.platform ?? null,
    };
  }
  return {
    message: String(error),
  };
};

const normalizePurchaseError = (error) => {
  if (!error)
    return createPurchaseError("wallet_iap_failed", "wallet_iap_failed");
  if (error instanceof Error) {
    if (!error.code) {
      error.code = "wallet_iap_failed";
    }
    if (!error.details) {
      error.details = serializePurchaseError(error);
    }
    return error;
  }
  const details = serializePurchaseError(error);
  const nextError = createPurchaseError(
    error?.code || "wallet_iap_failed",
    String(error?.message || error?.code || "wallet_iap_failed"),
    details,
  );
  return nextError;
};

const waitForCdvPurchaseNamespace = async () => {
  const deadline = Date.now() + IAP_NAMESPACE_WAIT_MS;
  while (Date.now() < deadline) {
    const namespace = window?.CdvPurchase;
    if (namespace?.store) return namespace;
    await sleep(50);
  }

  throw createPurchaseError(
    "wallet_iap_namespace_missing",
    "CdvPurchase namespace unavailable",
    {
      hasCordova: Boolean(window?.cordova),
      hasCapacitor: Boolean(window?.Capacitor),
      nativePlatform: window?.Capacitor?.getPlatform?.() || null,
    },
  );
};

const snapshotProductState = (product) => ({
  id: product?.id || null,
  title: product?.title || null,
  canPurchase: product?.canPurchase ?? null,
  offersCount: Array.isArray(product?.offers) ? product.offers.length : 0,
  pricing: product?.pricing?.price || null,
});

const snapshotAllKnownProducts = () =>
  IOS_WALLET_TOPUP_PRODUCTS.map((product) => ({
    requestedProductId: product.productId,
    ...latestProductSnapshots.get(product.productId),
  }));

const waitForProductReady = async (store, productId) => {
  const deadline = Date.now() + IAP_PRODUCT_READY_WAIT_MS;
  let lastSnapshot = null;

  while (Date.now() < deadline) {
    const product = store.get(productId);
    lastSnapshot = snapshotProductState(product);
    latestProductSnapshots.set(productId, lastSnapshot);
    if (product?.getOffer()) {
      return product;
    }
    await sleep(IAP_POLL_INTERVAL_MS);
  }

  throw createPurchaseError(
    "wallet_iap_product_unavailable",
    "App Store product not loaded",
    {
      productId,
      product: lastSnapshot,
      lastStoreError,
      products: snapshotAllKnownProducts(),
    },
  );
};

const getCdvPurchaseNamespace = async () => {
  if (!isNativeIosApp()) {
    throw createPurchaseError(
      "wallet_iap_unavailable",
      "wallet_iap_unavailable",
    );
  }

  if (!purchasePluginPromise) {
    purchasePluginPromise = import("cordova-plugin-purchase").catch((error) => {
      purchasePluginPromise = null;
      throw error;
    });
  }

  await purchasePluginPromise;

  return waitForCdvPurchaseNamespace();
};

const getProductIdFromTransaction = (transaction) => {
  if (typeof transaction?.productId === "string" && transaction.productId) {
    return transaction.productId;
  }
  if (Array.isArray(transaction?.products) && transaction.products[0]?.id) {
    return String(transaction.products[0].id);
  }
  if (typeof transaction?.id === "string" && transaction.id) {
    return transaction.id;
  }
  return "";
};

const getTransactionId = (transaction) => {
  if (
    typeof transaction?.transactionId === "string" &&
    transaction.transactionId
  ) {
    return transaction.transactionId;
  }
  if (typeof transaction?.purchaseId === "string" && transaction.purchaseId) {
    return transaction.purchaseId;
  }
  if (typeof transaction?.id === "string" && transaction.id) {
    return transaction.id;
  }
  return "";
};

const resolvePendingPurchase = (productId, payload) => {
  const pending = pendingWalletPurchases.get(productId);
  if (!pending) return;
  pendingWalletPurchases.delete(productId);
  window.clearTimeout(pending.timeoutId);
  pending.resolve(payload);
};

const rejectPendingPurchase = (productId, error) => {
  const pending = pendingWalletPurchases.get(productId);
  if (!pending) return;
  pendingWalletPurchases.delete(productId);
  window.clearTimeout(pending.timeoutId);
  pending.reject(normalizePurchaseError(error));
};

const bindStore = (namespace) => {
  if (storeBound) return;
  storeBound = true;

  namespace.store.error((error) => {
    lastStoreError = serializePurchaseError(error);
    console.error("CdvPurchase store error", lastStoreError);
  });

  namespace.store
    .when()
    .productUpdated((product) => {
      latestProductSnapshots.set(product.id, snapshotProductState(product));
    })
    .approved((transaction) => {
      const productId = getProductIdFromTransaction(transaction);
      resolvePendingPurchase(productId, {
        productId,
        transactionId: getTransactionId(transaction),
        transaction,
      });
      if (typeof transaction?.finish === "function") {
        transaction.finish();
      }
    })
    .cancelled((transaction) => {
      rejectPendingPurchase(
        getProductIdFromTransaction(transaction),
        new Error("wallet_iap_cancelled"),
      );
    })
    .error((error) => {
      IOS_WALLET_TOPUP_PRODUCTS.forEach((product) => {
        rejectPendingPurchase(product.productId, error);
      });
    });
};

export const ensureIosWalletIapReady = async () => {
  if (!storeReadyPromise) {
    storeReadyPromise = (async () => {
      const namespace = await getCdvPurchaseNamespace();
      bindStore(namespace);

      namespace.store.register(
        IOS_WALLET_TOPUP_PRODUCTS.map((product) => ({
          id: product.productId,
          platform: namespace.Platform.APPLE_APPSTORE,
          type: namespace.ProductType.CONSUMABLE,
        })),
      );

      await namespace.store.initialize([
        {
          platform: namespace.Platform.APPLE_APPSTORE,
          options: {
            needAppReceipt: true,
          },
        },
      ]);

      return namespace.store;
    })().catch((error) => {
      storeReadyPromise = null;
      throw error;
    });
  }

  return storeReadyPromise;
};

export const purchaseIosWalletTopup = async (productId) => {
  const store = await ensureIosWalletIapReady();
  const product = await waitForProductReady(store, productId);
  const offer =
    typeof product?.getOffer === "function" ? product.getOffer() : null;

  if (!product || !offer || typeof offer.order !== "function") {
    throw createPurchaseError(
      "wallet_iap_product_unavailable",
      "wallet_iap_product_unavailable",
      {
        productId,
        product: snapshotProductState(product),
      },
    );
  }

  const resultPromise = new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingWalletPurchases.delete(productId);
      reject(new Error("wallet_iap_timeout"));
    }, WALLET_TOPUP_PURCHASE_TIMEOUT_MS);

    pendingWalletPurchases.set(productId, { resolve, reject, timeoutId });
  });

  const orderError = await offer.order();
  if (orderError) {
    rejectPendingPurchase(productId, orderError);
  }

  return resultPromise;
};
