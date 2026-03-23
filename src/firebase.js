// src/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import {
  getFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
} from "firebase/firestore";

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: "AIzaSyAHL4hpdTDymjXeJCCjCxrsLv-nk33MTEY",
  authDomain: "parkswap-36bb2.firebaseapp.com",
  projectId: "parkswap-36bb2",
  storageBucket: "parkswap-36bb2.firebasestorage.app",
  messagingSenderId: "931109766836",
  appId: "1:931109766836:web:73321de42e1c5f13cdf9e1",
};

// Robust initialization to prevent hot-reload duplicate app errors
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const functions = getFunctions(app);

const isLocalhost =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

const useEmulators =
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_EMULATOR === "true" &&
  isLocalhost;

// Robust Firestore initialization
// Firestore's default browser transport can fail behind some proxies/CDNs with
// opaque CORS errors on hosted builds. Force long-polling and disable fetch
// streams outside localhost to use the most compatible transport.
let db;
const firestoreSettings = useEmulators || isLocalhost
  ? {}
  : {
      experimentalForceLongPolling: true,
      useFetchStreams: false,
    };

try {
  db = initializeFirestore(app, firestoreSettings);
} catch (e) {
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

    // Optionnel: petit log pour debug
    // console.log('[Firebase] Connected to local emulators (auth + firestore)');
  } catch (e) {
    // console.error('Error connecting to Firebase emulators:', e);
  }
}

const appId = "parkswap-36bb2";

export { app, auth, db, appId, functions };
