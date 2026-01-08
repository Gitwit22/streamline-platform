import admin from "firebase-admin";
import serviceAccount from "./firebaseServiceAccount.json";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}

export const firestore = admin.firestore();  // 👈 THIS
export const auth = admin.auth();            // optional but nice to have
