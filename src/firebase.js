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
  authDomain: "parcswap.netlify.app",
  projectId: "parkswap-36bb2",
  storageBucket: "parkswap-36bb2.firebasestorage.app",
  messagingSenderId: "931109766836",
  appId: "1:931109766836:web:73321de42e1c5f13cdf9e1",
};

// Robust initialization to prevent hot-reload duplicate app errors
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const functions = getFunctions(app);

// Robust Firestore initialization
// Using default Firestore configuration to avoid CORS issues on Netlify
let db;
try {
  db = getFirestore(app);
} catch (e) {
  // Fallback if getFirestore fails
  db = initializeFirestore(app, {});
}

// --- EMULATEURS EN DEV ---
// Only use emulators when explicitly enabled to avoid desync between devices.
const useEmulators =
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_EMULATOR === "true" &&
  typeof window !== "undefined" &&
  window.location.hostname === "localhost";

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
