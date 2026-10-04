/**
 * Firestore access for owner role presets (users/{uid}/rolePresets/{id}) and
 * applying them to a participant's room controls doc
 * (rooms/{roomId}/controls/{identity}).
 *
 * Defaults and normalization live in ./roleDefaults (pure).
 */

import admin from "firebase-admin";
import { firestore } from "../../firebaseAdmin";
import {
  ROLE_PRESET_DEFAULTS,
  normalizeRolePreset,
  type RolePresetControls,
  type RolePresetId,
} from "./roleDefaults";

export function rolePresetDocRef(uid: string, presetId: RolePresetId) {
  return firestore.collection("users").doc(uid).collection("rolePresets").doc(presetId);
}

/** The owner's preset (stored values over defaults). Falls back to defaults on errors. */
export async function loadOwnerRolePreset(ownerUid: string | null | undefined, presetId: RolePresetId): Promise<RolePresetControls> {
  if (!ownerUid) return { ...ROLE_PRESET_DEFAULTS[presetId] };
  try {
    const snap = await rolePresetDocRef(ownerUid, presetId).get();
    return normalizeRolePreset(presetId, snap.exists ? ((snap.data() as any) || {}) : null);
  } catch {
    return { ...ROLE_PRESET_DEFAULTS[presetId] };
  }
}

export async function getRoomOwnerUid(roomId: string): Promise<string | null> {
  try {
    const snap = await firestore.collection("rooms").doc(roomId).get();
    const data = (snap.data() || {}) as any;
    const owner = data.ownerId || data.ownerUid || data.hostUid || data.createdBy || null;
    return typeof owner === "string" && owner ? owner : null;
  } catch {
    return null;
  }
}

export function normalizeControlsDocId(raw: unknown): string {
  const id = String(raw ?? "").trim();
  if (!id || id.includes("/")) return "";
  return id.length > 128 ? id.slice(0, 128) : id;
}

/**
 * Firestore fields written when a role preset is applied to an identity.
 * `tokenRefreshRequestedAt` makes the participant's controls SSE stream emit
 * a refresh_token hint so their roomAccessToken picks up the new role.
 */
export function presetControlsPatch(preset: RolePresetControls, updatedBy: string | null): Record<string, unknown> {
  return {
    ...preset,
    appliedPresetId: preset.role,
    lkBasePermission: admin.firestore.FieldValue.delete(),
    tokenRefreshRequestedAt: Date.now(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedByUid: updatedBy,
  };
}

/**
 * Apply the room OWNER's preset to rooms/{roomId}/controls/{identity}.
 * Used when a cohost acceptance is recorded so cohosts get the same scopes
 * no matter how they joined. Best-effort: returns the applied preset or null.
 */
export async function applyOwnerPresetToControls(params: {
  roomId: string;
  identity: string;
  presetId: RolePresetId;
  ownerUid?: string | null;
  updatedBy?: string | null;
  /** Skip when the identity already has a role set by the host. */
  onlyIfUnset?: boolean;
}): Promise<RolePresetControls | null> {
  const docId = normalizeControlsDocId(params.identity);
  if (!params.roomId || !docId) return null;
  try {
    const ownerUid = params.ownerUid ?? (await getRoomOwnerUid(params.roomId));
    const preset = await loadOwnerRolePreset(ownerUid, params.presetId);
    const ref = firestore.collection("rooms").doc(params.roomId).collection("controls").doc(docId);
    if (params.onlyIfUnset) {
      const snap = await ref.get();
      const existingRole = snap.exists ? String((snap.data() as any)?.role || "").trim() : "";
      if (existingRole) return null;
    }
    await ref.set(presetControlsPatch(preset, params.updatedBy ?? ownerUid ?? null), { merge: true });
    return preset;
  } catch (err: any) {
    console.warn("[rolePresetStore] apply preset failed", { roomId: params.roomId, error: err?.message || String(err) });
    return null;
  }
}
