// src/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { Capacitor } from "@capacitor/core";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  onIdTokenChanged,
  setPersistence,
} from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import {
  getFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
} from "firebase/firestore";

// --- FIREBASE SETUP ---
const IOS_DEBUG_BUILD = "IOS_DEBUG_2026_03_25_10";
const IOS_PATCH_LABEL = "PATCH 14";
const ENABLE_NATIVE_AUTH_DEBUG_TIMERS = false;
const isBrowser = typeof window !== "undefined";
const browserHost = isBrowser ? window.location.hostname : "";
const isLocalhost = ["localhost", "127.0.0.1"].includes(browserHost);
const isNativeApp = (() => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
})();

// Capacitor sets window.cordova for backwards-compat with Cordova plugins, but
// Firebase Auth's internal _isCordova() check sees it and tries Cordova redirect
// flows that hang in WKWebView.  Remove the shim before Auth initializes.
if (isNativeApp && typeof window !== "undefined") {
  delete window.cordova;
  delete window.phonegap;
  delete window.PhoneGap;
}

const resolvedAuthDomain =
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
  (isBrowser && !isLocalhost
    ? window.location.host
    : "parkswap-36bb2.firebaseapp.com");

const firebaseConfig = {
  apiKey: "AIzaSyAHL4hpdTDymjXeJCCjCxrsLv-nk33MTEY",
  authDomain: resolvedAuthDomain,
  projectId: "parkswap-36bb2",
  storageBucket: "parkswap-36bb2.firebasestorage.app",
  messagingSenderId: "931109766836",
  appId: "1:931109766836:web:73321de42e1c5f13cdf9e1",
};

// Robust initialization to prevent hot-reload duplicate app errors
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
let auth;
let authInitPath = "uninitialized";
let authInitError = null;
let authDebugMeta = null;
const authPersistenceOrder = isNativeApp
  ? [inMemoryPersistence]
  : [
      indexedDBLocalPersistence,
      browserLocalPersistence,
      browserSessionPersistence,
    ];

const withTimeout = (promise, timeoutMs) => {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error("auth persistence timeout")),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
  });
};

const getAuthDebugSnapshot = (authInstance) => {
  let persistenceType = null;
  try {
    persistenceType = authInstance?._getPersistence?.()?.type || null;
  } catch {
    persistenceType = null;
  }

  const ownProps = authInstance
    ? Object.getOwnPropertyNames(authInstance)
        .filter((name) =>
          /init|current|redirect|persist|popup|config|tenant/i.test(name),
        )
        .slice(0, 20)
    : [];

  return {
    appName: authInstance?.app?.name || null,
    authDomain: authInstance?.app?.options?.authDomain || null,
    currentUserUid: authInstance?.currentUser?.uid || null,
    currentUserVerified: authInstance?.currentUser?.emailVerified ?? null,
    hasAuthStateReady: typeof authInstance?.authStateReady === "function",
    hasInitializationPromise: Boolean(
      authInstance?._initializationPromise?.then,
    ),
    isInitialized: authInstance?._isInitialized ?? null,
    tenantId: authInstance?.tenantId || null,
    persistenceType,
    windowCordovaPresent:
      typeof window !== "undefined" &&
      Boolean(window.cordova || window.phonegap || window.PhoneGap),
    documentReadyState:
      typeof document !== "undefined" ? document.readyState : null,
    ownProps,
  };
};

const installNativeAuthDebugObservers = (authInstance) => {
  if (!isNativeApp || typeof window === "undefined") return;
  if (window.__parkswapFirebaseAuthDebugInstalled) return;
  window.__parkswapFirebaseAuthDebugInstalled = true;

  const logSnapshot = (step) => {
    console.info(
      `[${IOS_DEBUG_BUILD}] Firebase auth debug:${step}`,
      JSON.stringify(getAuthDebugSnapshot(authInstance)),
    );
  };

  logSnapshot("install");

  try {
    authInstance?._initializationPromise
      ?.then(() => {
        logSnapshot("initializationPromise:resolved");
      })
      ?.catch((error) => {
        console.info(
          `[${IOS_DEBUG_BUILD}] Firebase auth debug:initializationPromise:rejected`,
          JSON.stringify({
            message: error?.message || String(error),
            code: error?.code || null,
          }),
        );
      });
  } catch {
    // Ignore internal promise inspection failures.
  }

  onAuthStateChanged(authInstance, (user) => {
    console.info(
      `[${IOS_DEBUG_BUILD}] Firebase auth debug:onAuthStateChanged`,
      JSON.stringify({
        uid: user?.uid || null,
        emailVerified: user?.emailVerified ?? null,
        snapshot: getAuthDebugSnapshot(authInstance),
      }),
    );
  });

  onIdTokenChanged(authInstance, async (user) => {
    let tokenPreview = "";
    try {
      tokenPreview = user
        ? String(await user.getIdToken(false)).slice(0, 18)
        : "";
    } catch {
      tokenPreview = "";
    }

    console.info(
      `[${IOS_DEBUG_BUILD}] Firebase auth debug:onIdTokenChanged`,
      JSON.stringify({
        uid: user?.uid || null,
        tokenPreview,
        snapshot: getAuthDebugSnapshot(authInstance),
      }),
    );
  });

  if (ENABLE_NATIVE_AUTH_DEBUG_TIMERS) {
    [250, 1000, 3000, 8000].forEach((delayMs) => {
      window.setTimeout(() => {
        logSnapshot(`timer:${delayMs}ms`);
      }, delayMs);
    });
  }
};

try {
  authInitPath = "initializeAuth:start";
  auth = initializeAuth(app, {
    persistence: authPersistenceOrder,
    ...(isNativeApp
      ? {}
      : { popupRedirectResolver: browserPopupRedirectResolver }),
  });
  authInitPath = "initializeAuth:returned";
} catch (error) {
  authInitPath = "initializeAuth:threw";
  authInitError = {
    message: error?.message || String(error),
    code: error?.code || null,
    name: error?.name || null,
  };
  auth = getAuth(app);
  authInitPath = "getAuth:fallback";
}

authDebugMeta = {
  authInitPath,
  authInitError,
  isNativeAppAtInit: isNativeApp,
  browserHost,
  resolvedAuthDomain,
  authPersistenceOrder: authPersistenceOrder.map(
    (entry) => entry?.type || "unknown",
  ),
  windowCapacitorPlatform:
    typeof Capacitor?.getPlatform === "function"
      ? Capacitor.getPlatform()
      : null,
  windowCordovaPresent:
    typeof window !== "undefined" &&
    Boolean(window.cordova || window.phonegap || window.PhoneGap),
};

if (typeof console !== "undefined") {
  console.info(
    `[${IOS_DEBUG_BUILD}] Firebase init`,
    JSON.stringify({
      patch: IOS_PATCH_LABEL,
      isNativeApp,
      isBrowser,
      browserHost,
      resolvedAuthDomain,
      authInitPath,
      authInitError,
      popupRedirectResolverEnabled: !isNativeApp,
      authPersistenceOrder: authPersistenceOrder.map(
        (entry) => entry.type || "unknown",
      ),
      authDebugMeta,
      authSnapshot: getAuthDebugSnapshot(auth),
    }),
  );
}

installNativeAuthDebugObservers(auth);

const functions = getFunctions(app);
const storage = getStorage(app);

const useEmulators =
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_EMULATOR === "true" &&
  isLocalhost;

// Robust Firestore initialization
// Let the SDK choose the transport by default. Recent Firestore versions already
// auto-detect when long-polling is needed, and forcing it can trigger hosted
// CORS failures on some browsers/CDNs.
let db;
const shouldForceLongPolling =
  import.meta.env.VITE_FIRESTORE_FORCE_LONG_POLLING === "true";

const firestoreSettings =
  useEmulators || isLocalhost
    ? {}
    : shouldForceLongPolling
      ? {
          experimentalForceLongPolling: true,
          useFetchStreams: false,
        }
      : {};

try {
  db = initializeFirestore(app, firestoreSettings);
} catch {
  // Fall back to the existing instance during hot reload or repeated imports.
  db = getFirestore(app);
}

// --- EMULATEURS EN DEV ---
// Only use emulators when explicitly enabled to avoid desync between devices.
if (useEmulators) {
  try {
    // Auth Emulator (par défaut port 9099)
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });

    // Firestore Emulator (par défaut port 8080)
    connectFirestoreEmulator(db, "localhost", 8080);

    // Functions Emulator (par défaut port 5001)
    connectFunctionsEmulator(functions, "localhost", 5001);

    // Storage Emulator (par défaut port 9199)
    connectStorageEmulator(storage, "localhost", 9199);

    // Optionnel: petit log pour debug
    // console.log('[Firebase] Connected to local emulators (auth + firestore)');
  } catch {
    // console.error('Error connecting to Firebase emulators:', e);
  }
}

const appId = "parkswap-36bb2";

const resolveAuthPersistence = async () => {
  if (typeof window === "undefined" || isNativeApp) return;

  const attempts = [
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
  ];

  for (const persistence of attempts) {
    try {
      await withTimeout(
        setPersistence(auth, persistence),
        isNativeApp ? 2_500 : 4_500,
      );
      return;
    } catch {
      // Try the next persistence backend.
    }
  }
};

const authPersistenceReady =
  typeof window === "undefined"
    ? Promise.resolve()
    : isNativeApp
      ? Promise.resolve()
      : resolveAuthPersistence().catch(() => undefined);

const getFirebaseAuthDebugMeta = () => authDebugMeta;

export {
  app,
  auth,
  authPersistenceReady,
  db,
  appId,
  functions,
  getFirebaseAuthDebugMeta,
  storage,
};
