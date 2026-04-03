import { firestore } from "../firebaseAdmin";

export async function logAuthSecurityEvent(input: {
  event: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    await firestore.collection("authAuditLogs").add({
      event: input.event,
      actorUserId: input.actorUserId || null,
      targetUserId: input.targetUserId || null,
      details: input.details || {},
      ip: input.ip || null,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Failed to write auth audit log:", error);
  }
}