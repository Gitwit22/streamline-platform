import admin from "firebase-admin";
import fs from "fs";
import path from "path";

function initFirebase() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(json)),
    });
    return;
  }

  const local = path.join(process.cwd(), "firebaseServiceAccount.json");
  if (fs.existsSync(local)) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(fs.readFileSync(local, "utf8"))
      ),
    });
    return;
  }

  throw new Error("Missing Firebase credentials");
}

type HlsCaps = {
  enabled: boolean;
  hlsMaxMinutesPerSession: number | null;
  hlsCustomizationEnabled: boolean;
};

function defaultsForPlan(planId: string): HlsCaps {
  switch (planId) {
    case "free":
      return {
        enabled: true,
        hlsMaxMinutesPerSession: 15,
        hlsCustomizationEnabled: false,
      };

    case "basic":
      return {
        enabled: true,
        hlsMaxMinutesPerSession: 30,
        hlsCustomizationEnabled: false,
      };

    case "starter":
      return {
        enabled: true,
        hlsMaxMinutesPerSession: null,
        hlsCustomizationEnabled: true,
      };

    default: // pro, enterprise, internal_unlimited
      return {
        enabled: true,
        hlsMaxMinutesPerSession: null,
        hlsCustomizationEnabled: true,
      };
  }
}

async function run() {
  initFirebase();
  const db = admin.firestore();

  const snap = await db.collection("plans").get();
  console.log(`Found ${snap.size} plans`);

  const batch = db.batch();
  let updated = 0;

  snap.forEach((doc) => {
    const data = doc.data();

    const features = (data.features || {}) as any;
    const caps = (data.caps || {}) as any;

    // If the new canonical fields already exist, skip.
    if (features.hls !== undefined || caps.hlsMaxMinutesPerSession !== undefined) return;

    const defaults = defaultsForPlan(doc.id);

    const nextFeatures = {
      ...(features || {}),
      // Canonical requested flag
      hls: defaults.enabled,
      // Keep common aliases in sync for compatibility
      canHls: defaults.enabled,
      hlsEnabled: defaults.enabled,
      // Customization split (viewer page / setup)
      hlsCustomizationEnabled: defaults.hlsCustomizationEnabled,
      canCustomizeHlsPage: defaults.hlsCustomizationEnabled,
    };

    const nextCaps = {
      ...(caps || {}),
      hlsMaxMinutesPerSession: defaults.hlsMaxMinutesPerSession,
    };

    batch.set(
      doc.ref,
      {
        features: nextFeatures,
        caps: nextCaps,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    updated++;
  });

  if (updated === 0) {
    console.log("No plans needed updates");
    return;
  }

  await batch.commit();
  console.log(`Updated ${updated} plans with HLS config`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
