import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithCustomToken,
  signOut as signOutWeb,
} from "firebase/auth";
import { getFirebaseAuthDebugMeta } from "../firebase";
import { isNativeApp } from "./mobile";

const NATIVE_AUTH_DEBUG_BUILD = "IOS_NATIVE_AUTH_2026_03_25_08";
const CREATE_WEB_CUSTOM_TOKEN_HTTP_FUNCTION = "createWebCustomTokenHttp";
const WEB_BRIDGE_TIMEOUT_MS = 15_000;

const logNativeAuth = (step, payload = {}) => {
  if (typeof console === "undefined") return;
  console.info(`[${NATIVE_AUTH_DEBUG_BUILD}] NativeAuth:${step}`, payload);
};

export const shouldUseNativeFirebaseAuth = () => isNativeApp();

const getWebRuntimeSnapshot = () => {
  if (typeof window === "undefined") {
    return {
      href: "",
      origin: "",
      protocol: "",
      host: "",
      hostname: "",
    };
  }

  return {
    href: window.location.href || "",
    origin: window.location.origin || "",
    protocol: window.location.protocol || "",
    host: window.location.host || "",
    hostname: window.location.hostname || "",
  };
};

const getWebAuthSnapshot = (auth) => {
  let persistenceType = null;
  try {
    persistenceType = auth?._getPersistence?.()?.type || null;
  } catch {
    persistenceType = null;
  }

  const debugMeta = getFirebaseAuthDebugMeta?.() || null;

  return {
    currentUserUid: auth?.currentUser?.uid || null,
    currentUserVerified: auth?.currentUser?.emailVerified ?? null,
    hasAuthStateReady: typeof auth?.authStateReady === "function",
    hasInitializationPromise: Boolean(auth?._initializationPromise?.then),
    isInitialized: auth?._isInitialized ?? null,
    persistenceType,
    appName: auth?.app?.name || null,
    authDomain: auth?.app?.options?.authDomain || null,
    documentReadyState:
      typeof document !== "undefined" ? document.readyState : null,
    authInitPath: debugMeta?.authInitPath || null,
    authInitError: debugMeta?.authInitError || null,
    isNativeAppAtInit: debugMeta?.isNativeAppAtInit ?? null,
    authPersistenceOrder: debugMeta?.authPersistenceOrder || null,
    windowCapacitorPlatform: debugMeta?.windowCapacitorPlatform || null,
    windowCordovaPresent: debugMeta?.windowCordovaPresent ?? null,
  };
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          const error = new Error(`${label} timed out.`);
          error.code = "auth/web-bridge-timeout";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

const resolveProjectId = ({ auth, functions }) => {
  const projectId =
    auth?.app?.options?.projectId ||
    functions?.app?.options?.projectId ||
    "parkswap-36bb2";
  return String(projectId || "parkswap-36bb2").trim();
};

const fetchWebCustomToken = async ({ auth, functions, idToken }) => {
  const projectId = resolveProjectId({ auth, functions });
  const endpoint = `https://us-central1-${projectId}.cloudfunctions.net/${CREATE_WEB_CUSTOM_TOKEN_HTTP_FUNCTION}`;
  logNativeAuth("bridge:httpStart", { endpoint, projectId });

  const response = await withTimeout(
    fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ idToken }),
    }),
    WEB_BRIDGE_TIMEOUT_MS,
    "createWebCustomTokenHttp",
  );

  const text = await withTimeout(
    response.text(),
    WEB_BRIDGE_TIMEOUT_MS,
    "createWebCustomTokenHttp.readBody",
  );
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  logNativeAuth("bridge:httpComplete", {
    status: response.status,
    ok: response.ok,
    hasCustomToken: Boolean(payload?.customToken),
    error: payload?.error || null,
    message: payload?.message || null,
    bodyPreview: text ? String(text).slice(0, 280) : "",
  });

  if (!response.ok) {
    const errorMessage =
      [payload?.error, payload?.message].filter(Boolean).join(" | ") ||
      `createWebCustomTokenHttp failed with status ${response.status}`;
    const error = new Error(errorMessage);
    error.code = "auth/web-bridge-http-error";
    throw error;
  }

  const customToken = String(payload?.customToken || "").trim();
  if (!customToken) {
    throw new Error("Missing custom token from createWebCustomTokenHttp.");
  }

  return customToken;
};

const getNativeUserAndIdToken = async ({ forceRefresh = false } = {}) => {
  const currentUserResult = await FirebaseAuthentication.getCurrentUser();
  const nativeUser = currentUserResult?.user || null;
  if (!nativeUser?.uid) {
    return { nativeUser: null, idToken: "" };
  }

  const tokenResult = await FirebaseAuthentication.getIdToken({ forceRefresh });
  return {
    nativeUser,
    idToken: String(tokenResult?.token || "").trim(),
  };
};

const ensureWebAuthReady = async (auth) => {
  if (!auth || typeof auth.authStateReady !== "function") {
    logNativeAuth("bridge:authStateReady:unsupported", {
      authSnapshot: getWebAuthSnapshot(auth),
    });
    return;
  }

  const eventLog = [];
  const unsubscribeAuthState = onAuthStateChanged(auth, (user) => {
    eventLog.push({
      type: "authState",
      uid: user?.uid || null,
      at: Date.now(),
    });
    logNativeAuth("bridge:authStateReady:onAuthStateChanged", {
      uid: user?.uid || null,
      authSnapshot: getWebAuthSnapshot(auth),
    });
  });
  const unsubscribeIdToken = onIdTokenChanged(auth, (user) => {
    eventLog.push({
      type: "idToken",
      uid: user?.uid || null,
      at: Date.now(),
    });
    logNativeAuth("bridge:authStateReady:onIdTokenChanged", {
      uid: user?.uid || null,
      authSnapshot: getWebAuthSnapshot(auth),
    });
  });

  const timers = [500, 2000, 7000, 14000].map((delayMs) =>
    window.setTimeout(() => {
      logNativeAuth("bridge:authStateReady:timer", {
        delayMs,
        authSnapshot: getWebAuthSnapshot(auth),
        eventLog,
      });
    }, delayMs),
  );

  logNativeAuth("bridge:authStateReady:start", {
    authSnapshot: getWebAuthSnapshot(auth),
  });

  try {
    auth?._initializationPromise
      ?.then(() => {
        logNativeAuth("bridge:authStateReady:initPromiseResolved", {
          authSnapshot: getWebAuthSnapshot(auth),
        });
      })
      ?.catch((error) => {
        logNativeAuth("bridge:authStateReady:initPromiseRejected", {
          message: error?.message || String(error),
          code: error?.code || null,
          authSnapshot: getWebAuthSnapshot(auth),
        });
      });
  } catch {
    // Ignore internal promise inspection failures.
  }

  try {
    await withTimeout(
      auth.authStateReady(),
      WEB_BRIDGE_TIMEOUT_MS,
      "authStateReady",
    );
    logNativeAuth("bridge:authStateReady:resolved", {
      authSnapshot: getWebAuthSnapshot(auth),
      eventLog,
    });
  } catch (error) {
    logNativeAuth("bridge:authStateReady:failed", {
      message: error?.message || String(error),
      code: error?.code || null,
      authSnapshot: getWebAuthSnapshot(auth),
      eventLog,
    });
    throw error;
  } finally {
    timers.forEach((timerId) => window.clearTimeout(timerId));
    unsubscribeAuthState();
    unsubscribeIdToken();
  }
};

export const bridgeNativeSessionToWeb = async ({
  auth,
  functions,
  forceRefresh = false,
  reason = "unspecified",
}) => {
  if (!shouldUseNativeFirebaseAuth()) return null;

  const { nativeUser, idToken } = await getNativeUserAndIdToken({
    forceRefresh,
  });
  logNativeAuth("bridge:start", {
    reason,
    nativeUid: nativeUser?.uid || null,
    hasIdToken: Boolean(idToken),
    currentWebUid: auth.currentUser?.uid || null,
    webRuntime: getWebRuntimeSnapshot(),
    authDomain: auth?.app?.options?.authDomain || null,
    authSnapshot: getWebAuthSnapshot(auth),
  });

  if (!nativeUser?.uid || !idToken) {
    return null;
  }

  const customToken = await fetchWebCustomToken({ auth, functions, idToken });

  logNativeAuth("bridge:webAuthReadyBypass", {
    reason,
    nativeUid: nativeUser.uid,
  });

  logNativeAuth("bridge:webSignInStart", {
    reason,
    nativeUid: nativeUser.uid,
  });
  const credential = await withTimeout(
    signInWithCustomToken(auth, customToken),
    WEB_BRIDGE_TIMEOUT_MS,
    "signInWithCustomToken",
  );
  logNativeAuth("bridge:complete", {
    reason,
    nativeUid: nativeUser.uid,
    webUid: credential?.user?.uid || null,
    emailVerified: credential?.user?.emailVerified ?? null,
  });
  return credential?.user || null;
};

export const signInWithNativeEmailAndPassword = async ({
  auth,
  functions,
  email,
  password,
}) => {
  if (!shouldUseNativeFirebaseAuth()) {
    throw new Error("Native Firebase auth is not available on this platform.");
  }

  logNativeAuth("emailSignIn:start", { email: String(email || "").trim() });
  await FirebaseAuthentication.signInWithEmailAndPassword({
    email: String(email || "").trim(),
    password: String(password || ""),
  });
  return bridgeNativeSessionToWeb({
    auth,
    functions,
    forceRefresh: true,
    reason: "email-sign-in",
  });
};

export const createUserWithNativeEmailAndPassword = async ({
  auth,
  functions,
  email,
  password,
}) => {
  if (!shouldUseNativeFirebaseAuth()) {
    throw new Error("Native Firebase auth is not available on this platform.");
  }

  logNativeAuth("emailRegister:start", { email: String(email || "").trim() });
  await FirebaseAuthentication.createUserWithEmailAndPassword({
    email: String(email || "").trim(),
    password: String(password || ""),
  });
  return bridgeNativeSessionToWeb({
    auth,
    functions,
    forceRefresh: true,
    reason: "email-register",
  });
};

export const signOutFromAllLayers = async ({
  auth,
  reason = "manual-sign-out",
}) => {
  const errors = [];

  if (shouldUseNativeFirebaseAuth()) {
    try {
      await FirebaseAuthentication.signOut();
      logNativeAuth("signOut:native", { reason });
    } catch (error) {
      errors.push(error);
      logNativeAuth("signOut:nativeError", {
        reason,
        message: error?.message || String(error),
      });
    }
  }

  try {
    await signOutWeb(auth);
    logNativeAuth("signOut:web", { reason });
  } catch (error) {
    errors.push(error);
    logNativeAuth("signOut:webError", {
      reason,
      message: error?.message || String(error),
    });
  }

  if (errors.length) {
    throw errors[0];
  }
};

export const restoreNativeSessionToWeb = async ({ auth, functions }) => {
  if (!shouldUseNativeFirebaseAuth()) return null;

  if (auth.currentUser?.uid) {
    logNativeAuth("restore:skipExistingWebUser", { uid: auth.currentUser.uid });
    return auth.currentUser;
  }

  return bridgeNativeSessionToWeb({
    auth,
    functions,
    forceRefresh: false,
    reason: "app-boot",
  });
};
