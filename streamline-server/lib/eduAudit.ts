import { firestore } from "../firebaseAdmin";

export type EduAuditParams = {
  orgId: string;
  action: string;
  actorUid: string;
  actorName: string;
  eventId?: string | null;
  eventTitle?: string | null;
  targetId?: string | null;
};

export async function writeEduAudit(params: EduAuditParams) {
  const now = Date.now();
  const doc = {
    orgId: params.orgId,
    action: params.action,
    actorUid: params.actorUid,
    actorName: params.actorName,
    eventId: params.eventId ?? null,
    eventTitle: params.eventTitle ?? null,
    targetId: params.targetId ?? null,
    createdAt: now,
  };

  const id = `${params.orgId}_${now}_${Math.random().toString(36).slice(2, 8)}`;
  await firestore.collection("audit").doc(id).set(doc, { merge: true });
}
