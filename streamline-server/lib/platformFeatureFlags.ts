import { firestore } from "../firebaseAdmin";

const PLATFORM_FLAG_TTL_MS = 30 * 1000;

type CachedFlag = {
  value: boolean;
  at: number;
};

const optInCache = new Map<string, CachedFlag>();

/**
 * Returns true only when featureFlags/<docId>.enabled === true.
 * Missing docs default to false for opt-in platform flags.
 */
export async function getOptInPlatformFlag(docId: string): Promise<boolean> {
  const now = Date.now();
  const cached = optInCache.get(docId);
  if (cached && now - cached.at < PLATFORM_FLAG_TTL_MS) {
    return cached.value;
  }

  try {
    const snap = await firestore.collection("featureFlags").doc(docId).get();
    const data = snap.exists ? ((snap.data() as any) || {}) : {};
    const value = data.enabled === true;
    optInCache.set(docId, { value, at: now });
    return value;
  } catch {
    optInCache.set(docId, { value: false, at: now });
    return false;
  }
}

export async function isRoomCustomizationEnabled(): Promise<boolean> {
  return getOptInPlatformFlag("roomCustomizationEnabled");
}

export async function isGreenroomHlsEnabled(): Promise<boolean> {
  return getOptInPlatformFlag("greenroomHlsEnabled");
}
