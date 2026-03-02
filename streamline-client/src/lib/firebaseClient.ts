import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  type Auth,
  type User,
  signInWithCustomToken,
  sendPasswordResetEmail,
  type ActionCodeSettings,
} from "firebase/auth";

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
};

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let warnedMissingConfig = false;

function readConfig(): FirebaseWebConfig | null {
  const apiKey = String(import.meta.env.VITE_FIREBASE_API_KEY || "").trim();
  const authDomain = String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "").trim();
  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || "").trim();
  const appId = String(import.meta.env.VITE_FIREBASE_APP_ID || "").trim();
  const storageBucket = String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "").trim();
  const messagingSenderId = String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "").trim();

  if (!apiKey || !authDomain || !projectId || !appId) return null;

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket: storageBucket || undefined,
    messagingSenderId: messagingSenderId || undefined,
  };
}

export function isFirebaseWebConfigured(): boolean {
  return !!readConfig();
}

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;

  const cfg = readConfig();
  if (!cfg) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        "[firebase] Missing web config. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID."
      );
    }
    throw new Error("firebase_not_configured");
  }

  const apps = getApps();
  cachedApp = apps.length ? apps[0]! : initializeApp(cfg);
  cachedAuth = getAuth(cachedApp);
  return cachedAuth;
}

export function onFirebaseAuthStateChanged(cb: (user: User | null) => void): () => void {
  try {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, cb);
  } catch {
    // Not configured => behave like signed-out.
    cb(null);
    return () => {};
  }
}

export async function getFirebaseIdToken(opts?: { forceRefresh?: boolean }): Promise<string | null> {
  try {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(!!opts?.forceRefresh);
  } catch {
    return null;
  }
}

export async function firebaseSignInWithCustomToken(customToken: string) {
  const auth = getFirebaseAuth();
  return signInWithCustomToken(auth, customToken);
}

export async function firebaseSendPasswordReset(email: string, actionCodeSettings?: ActionCodeSettings) {
  const auth = getFirebaseAuth();
  return sendPasswordResetEmail(auth, email, actionCodeSettings);
}
