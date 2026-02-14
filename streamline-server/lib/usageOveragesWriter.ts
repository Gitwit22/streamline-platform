import { firestore } from "../firebaseAdmin";

export async function upsertUsageMonthlyOverageTotals(params: {
  uid: string;
  monthKey: string;
  totals: {
    participantMinutes: number;
    transcodeMinutes: number;
  };
}): Promise<void> {
  const uid = String(params.uid || "").trim();
  const monthKey = String(params.monthKey || "").trim();
  if (!uid || !monthKey) return;

  const participantMinutes = Math.max(0, Math.round(Number(params.totals.participantMinutes || 0)));
  const transcodeMinutes = Math.max(0, Math.round(Number(params.totals.transcodeMinutes || 0)));

  const usageDocId = `${uid}_${monthKey}`;
  const usageRef = firestore.collection("usageMonthly").doc(usageDocId);

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const existing = snap.exists ? (snap.data() as any) : {};

    tx.set(
      usageRef,
      {
        uid,
        monthKey,
        overages: {
          participantMinutes,
          transcodeMinutes,
          updatedAt: new Date(),
        },
        createdAt: existing.createdAt || new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
  });
}
