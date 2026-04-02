import admin from "firebase-admin";
import { firestore } from "../firebaseAdmin";

export type CollaboratorInviteStatus = "pending" | "accepted" | "declined" | "revoked";

export type CollaboratorPermissions = {
  createRooms: boolean;
  startRooms: boolean;
  joinInvisibleProducer: boolean;
  manageParticipants: boolean;
  controlLayouts: boolean;
  manageRecording: boolean;
  manageStreaming: boolean;
};

export type CollaboratorRelationshipDoc = {
  ownerUid: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  collaboratorUid: string;
  collaboratorEmail: string | null;
  collaboratorDisplayName: string | null;
  status: CollaboratorInviteStatus;
  permissions: CollaboratorPermissions;
  invitedByUid: string;
  createdAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | number;
  updatedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | number;
  acceptedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | number | null;
  declinedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | number | null;
  revokedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | number | null;
};

export type OwnerActingContext = {
  actorUid: string;
  ownerUid: string;
  isDelegated: boolean;
  relationshipId: string | null;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
  permissions: CollaboratorPermissions | null;
};

export const DEFAULT_COLLABORATOR_PERMISSIONS: CollaboratorPermissions = {
  createRooms: true,
  startRooms: true,
  joinInvisibleProducer: true,
  manageParticipants: true,
  controlLayouts: true,
  manageRecording: true,
  manageStreaming: true,
};

function normalizeBoolean(value: any, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeCollaboratorPermissions(raw: any): CollaboratorPermissions {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    createRooms: normalizeBoolean(source.createRooms, DEFAULT_COLLABORATOR_PERMISSIONS.createRooms),
    startRooms: normalizeBoolean(source.startRooms, DEFAULT_COLLABORATOR_PERMISSIONS.startRooms),
    joinInvisibleProducer: normalizeBoolean(source.joinInvisibleProducer, DEFAULT_COLLABORATOR_PERMISSIONS.joinInvisibleProducer),
    manageParticipants: normalizeBoolean(source.manageParticipants, DEFAULT_COLLABORATOR_PERMISSIONS.manageParticipants),
    controlLayouts: normalizeBoolean(source.controlLayouts, DEFAULT_COLLABORATOR_PERMISSIONS.controlLayouts),
    manageRecording: normalizeBoolean(source.manageRecording, DEFAULT_COLLABORATOR_PERMISSIONS.manageRecording),
    manageStreaming: normalizeBoolean(source.manageStreaming, DEFAULT_COLLABORATOR_PERMISSIONS.manageStreaming),
  };
}

export function normalizeEmail(value: any): string {
  return String(value || "").trim().toLowerCase();
}

export function getCollaboratorRelationshipId(ownerUid: string, collaboratorUid: string): string {
  return `${ownerUid}_${collaboratorUid}`;
}

export async function findUserByEmail(email: string): Promise<{ uid: string; data: Record<string, any> } | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const snap = await firestore.collection("users").where("email", "==", normalized).limit(1).get();
  if (snap.empty) return null;

  const doc = snap.docs[0];
  return {
    uid: doc.id,
    data: (doc.data() as Record<string, any>) || {},
  };
}

export async function getRelationshipById(id: string): Promise<{ id: string; data: CollaboratorRelationshipDoc } | null> {
  const snap = await firestore.collection("collaboratorRelationships").doc(id).get();
  if (!snap.exists) return null;
  return {
    id: snap.id,
    data: (snap.data() as CollaboratorRelationshipDoc) || ({} as CollaboratorRelationshipDoc),
  };
}

export async function getAcceptedCollaboration(ownerUid: string, collaboratorUid: string): Promise<{ id: string; data: CollaboratorRelationshipDoc } | null> {
  const relationshipId = getCollaboratorRelationshipId(ownerUid, collaboratorUid);
  const relationship = await getRelationshipById(relationshipId);
  if (!relationship) return null;
  if (relationship.data.status !== "accepted") return null;
  return relationship;
}

export async function resolveOwnerActingContext(req: any): Promise<OwnerActingContext | null> {
  const actorUid = String(req?.user?.uid || "").trim();
  if (!actorUid) return null;

  const rawHeader = req?.headers?.["x-owner-context-uid"] ?? req?.headers?.["X-Owner-Context-Uid"];
  const requestedOwnerUid = String(rawHeader || req?.body?.actingOwnerUid || "").trim();

  if (!requestedOwnerUid || requestedOwnerUid === actorUid) {
    return {
      actorUid,
      ownerUid: actorUid,
      isDelegated: false,
      relationshipId: null,
      ownerDisplayName: null,
      ownerEmail: null,
      permissions: null,
    };
  }

  const relationship = await getAcceptedCollaboration(requestedOwnerUid, actorUid);
  if (!relationship) return null;

  return {
    actorUid,
    ownerUid: requestedOwnerUid,
    isDelegated: true,
    relationshipId: relationship.id,
    ownerDisplayName: relationship.data.ownerDisplayName || null,
    ownerEmail: relationship.data.ownerEmail || null,
    permissions: normalizeCollaboratorPermissions(relationship.data.permissions),
  };
}

export async function logDelegatedRoomAction(params: {
  actedByUid: string;
  ownerUid: string;
  roomId: string;
  action: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  const roomId = String(params.roomId || "").trim();
  if (!roomId) return;

  await firestore.collection("producerAuditTrail").add({
    actedByUid: params.actedByUid,
    ownerUid: params.ownerUid,
    roomId,
    action: params.action,
    metadata: params.metadata || {},
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}
