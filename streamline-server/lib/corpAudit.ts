import { firestore } from "../firebaseAdmin";

export type CorpAuditParams = {
  orgId: string;
  action: string;
  actorUid: string;
  actorName: string;
  targetId?: string | null;
  meta?: Record<string, any> | null;
};

export async function writeCorpAudit(params: CorpAuditParams) {
  const now = Date.now();
  const doc = {
    orgId: params.orgId,
    action: params.action,
    actorUid: params.actorUid,
    actorName: params.actorName,
    targetId: params.targetId ?? null,
    meta: params.meta ?? null,
    createdAt: now,
  };

  const id = `${params.orgId}_${now}_${Math.random().toString(36).slice(2, 8)}`;
  await firestore.collection("corpAudit").doc(id).set(doc, { merge: true });
}
