import { Router } from "express";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { firestore } from "../firebaseAdmin";
import {
  DEFAULT_COLLABORATOR_PERMISSIONS,
  findUserByEmail,
  getCollaboratorDelegationEnabled,
  getCollaboratorRelationshipId,
  getRelationshipById,
  normalizeCollaboratorPermissions,
  normalizeEmail,
} from "../lib/collaborators";

const router = Router();

router.use(async (_req, res, next) => {
  const enabled = await getCollaboratorDelegationEnabled();
  if (!enabled) {
    return res.status(404).json({ error: "feature_not_found" });
  }
  return next();
});

function serializeRelationship(doc: { id: string; data: any }, viewerUid: string) {
  const data = doc.data || {};
  const viewerIsOwner = data.ownerUid === viewerUid;
  const counterpartyLabel = viewerIsOwner ? data.collaboratorDisplayName : data.ownerDisplayName;
  const counterpartyEmail = viewerIsOwner ? data.collaboratorEmail : data.ownerEmail;
  return {
    id: doc.id,
    status: data.status || "pending",
    ownerUid: data.ownerUid,
    ownerDisplayName: data.ownerDisplayName || null,
    ownerEmail: data.ownerEmail || null,
    collaboratorUid: data.collaboratorUid,
    collaboratorDisplayName: data.collaboratorDisplayName || null,
    collaboratorEmail: data.collaboratorEmail || null,
    invitedByUid: data.invitedByUid || null,
    permissions: normalizeCollaboratorPermissions(data.permissions),
    updatedAt: data.updatedAt || null,
    createdAt: data.createdAt || null,
    acceptedAt: data.acceptedAt || null,
    declinedAt: data.declinedAt || null,
    revokedAt: data.revokedAt || null,
    viewerRole: viewerIsOwner ? "owner" : "collaborator",
    counterpartyLabel: counterpartyLabel || counterpartyEmail || "Unknown account",
    counterpartyEmail: counterpartyEmail || null,
  };
}

router.get("/me", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  const [ownedSnap, collaboratorSnap] = await Promise.all([
    firestore.collection("collaboratorRelationships").where("ownerUid", "==", uid).get(),
    firestore.collection("collaboratorRelationships").where("collaboratorUid", "==", uid).get(),
  ]);

  const outgoing = ownedSnap.docs.map((doc) => serializeRelationship({ id: doc.id, data: doc.data() }, uid));
  const incoming = collaboratorSnap.docs.map((doc) => serializeRelationship({ id: doc.id, data: doc.data() }, uid));
  const linkedOwners = incoming
    .filter((item) => item.status === "accepted")
    .map((item) => ({
      relationshipId: item.id,
      ownerUid: item.ownerUid,
      ownerDisplayName: item.ownerDisplayName,
      ownerEmail: item.ownerEmail,
      permissions: item.permissions,
    }));

  return res.json({
    outgoing,
    incoming,
    linkedOwners,
  });
});

router.post("/invite", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });

  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "email_required" });

  const ownerSnap = await firestore.collection("users").doc(uid).get();
  const ownerData = ownerSnap.exists ? ((ownerSnap.data() as any) || {}) : {};
  const ownerEmail = normalizeEmail(ownerData.email || req.user?.email || "") || null;
  const ownerDisplayName = String(ownerData.displayName || req.user?.displayName || req.user?.name || "").trim() || null;

  if (ownerEmail && ownerEmail === email) {
    return res.status(400).json({ error: "cannot_invite_self" });
  }

  const collaborator = await findUserByEmail(email);
  if (!collaborator) {
    return res.status(404).json({ error: "registered_user_not_found" });
  }

  if (collaborator.uid === uid) {
    return res.status(400).json({ error: "cannot_invite_self" });
  }

  const permissions = normalizeCollaboratorPermissions(req.body?.permissions || DEFAULT_COLLABORATOR_PERMISSIONS);
  const collaboratorDisplayName = String(collaborator.data.displayName || collaborator.data.name || "").trim() || null;
  const collaboratorEmail = normalizeEmail(collaborator.data.email || email) || null;
  const relationshipId = getCollaboratorRelationshipId(uid, collaborator.uid);

  await firestore.collection("collaboratorRelationships").doc(relationshipId).set({
    ownerUid: uid,
    ownerEmail,
    ownerDisplayName,
    collaboratorUid: collaborator.uid,
    collaboratorEmail,
    collaboratorDisplayName,
    status: "pending",
    permissions,
    invitedByUid: uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    acceptedAt: null,
    declinedAt: null,
    revokedAt: null,
  }, { merge: true });

  const relationship = await getRelationshipById(relationshipId);
  return res.status(201).json({ relationship: relationship ? serializeRelationship(relationship, uid) : null });
});

router.post("/:relationshipId/accept", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  const relationshipId = String(req.params.relationshipId || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  if (!relationshipId) return res.status(400).json({ error: "relationship_required" });

  const relationship = await getRelationshipById(relationshipId);
  if (!relationship) return res.status(404).json({ error: "not_found" });
  if (relationship.data.collaboratorUid !== uid) return res.status(403).json({ error: "forbidden" });

  await firestore.collection("collaboratorRelationships").doc(relationshipId).set({
    status: "accepted",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    declinedAt: null,
    revokedAt: null,
  }, { merge: true });

  const updated = await getRelationshipById(relationshipId);
  return res.json({ relationship: updated ? serializeRelationship(updated, uid) : null });
});

router.post("/:relationshipId/decline", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  const relationshipId = String(req.params.relationshipId || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  if (!relationshipId) return res.status(400).json({ error: "relationship_required" });

  const relationship = await getRelationshipById(relationshipId);
  if (!relationship) return res.status(404).json({ error: "not_found" });
  if (relationship.data.collaboratorUid !== uid) return res.status(403).json({ error: "forbidden" });

  await firestore.collection("collaboratorRelationships").doc(relationshipId).set({
    status: "declined",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    declinedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const updated = await getRelationshipById(relationshipId);
  return res.json({ relationship: updated ? serializeRelationship(updated, uid) : null });
});

router.post("/:relationshipId/revoke", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  const relationshipId = String(req.params.relationshipId || "").trim();
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  if (!relationshipId) return res.status(400).json({ error: "relationship_required" });

  const relationship = await getRelationshipById(relationshipId);
  if (!relationship) return res.status(404).json({ error: "not_found" });
  if (relationship.data.ownerUid !== uid) return res.status(403).json({ error: "forbidden" });

  await firestore.collection("collaboratorRelationships").doc(relationshipId).set({
    status: "revoked",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const updated = await getRelationshipById(relationshipId);
  return res.json({ relationship: updated ? serializeRelationship(updated, uid) : null });
});

export default router;
