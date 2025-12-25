import express from "express";
import crypto from "crypto";
import { WebhookReceiver } from "livekit-server-sdk";
import { firestore } from "../firebaseAdmin";

const router = express.Router();

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ✅ Use LiveKit API key + secret for verification
const LIVEKIT_API_KEY = mustGetEnv("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = mustGetEnv("LIVEKIT_API_SECRET");
const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

// Try multiple shapes LiveKit might send
function extractObjectKey(egressInfo: any): string | null {
  const candidates = [
    egressInfo?.file?.filepath,
    egressInfo?.file?.results?.[0]?.filename,
    egressInfo?.file?.results?.[0]?.location,
    egressInfo?.fileResults?.[0]?.filepath,
    egressInfo?.fileResults?.[0]?.filename,
    egressInfo?.fileResults?.[0]?.location,
    egressInfo?.result?.filename,
    egressInfo?.result?.location,
    egressInfo?.outputs?.[0]?.filename,
    egressInfo?.outputs?.[0]?.location,
  ];

  const hit = candidates.find((x) => typeof x === "string" && x.length > 0);
  return hit ?? null;
}

// POST /api/livekit/webhook
// IMPORTANT: mount this route with express.raw({ type: "application/json" })
router.post("/", async (req, res) => {
  try {
    const authHeader = String(req.headers["authorization"] || "");
    const rawBody = req.body as Buffer;

    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ ok: false, error: "Expected raw body Buffer" });
    }

    // ✅ Verify + parse event (use the raw string)
    const event = await receiver.receive(rawBody.toString("utf8"), authHeader);

    const eventName = String((event as any)?.event || "");
    const egressInfo = (event as any)?.egressInfo;

    const isEgressEnded = eventName === "egress_ended" || eventName === "egress.ended";
    if (!isEgressEnded) {
      return res.status(200).json({ ok: true, ignored: true, event: eventName });
    }

    const recordingId = String(egressInfo?.egressId || "");
    if (!recordingId) {
      return res.status(400).json({ ok: false, error: "Missing egressId" });
    }

    // 1) Try to pull the objectKey from the webhook payload
    let objectKey = extractObjectKey(egressInfo);

    // 2) ✅ Fallback: if missing, use Firestore filepath (your doc already has it)
    const ref = firestore.collection("recordings").doc(recordingId);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as any) : null;

    if (!objectKey && existing?.filepath) {
      objectKey = existing.filepath;
    }

    // Generate one-time token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    // Only mark READY if egressInfo.status is COMPLETE
    const egressStatus = String(egressInfo?.status || "").toUpperCase();
    let finalStatus = "PROCESSING";
    if (egressStatus === "COMPLETE" && objectKey) {
      finalStatus = "READY";
    } else if (!objectKey) {
      finalStatus = "FAILED";
    }

    await ref.set(
      {
        objectKey: objectKey ?? null,
        oneTimeToken: hashedToken,
        status: finalStatus,
        updatedAt: new Date(),
        endedAt: new Date(),
        livekitStatus: egressStatus,
      },
      { merge: true }
    );

    // Helpful for testing (you can remove later)
    console.log("✅ Webhook finalized recording:", {
      recordingId,
      status: finalStatus,
      objectKey,
      livekitStatus: egressStatus,
      testDownloadUrl: `/api/recordings/${recordingId}/download?token=${rawToken}`,
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("❌ LiveKit webhook error:", err?.message || err);
    return res.status(400).json({ ok: false, error: err?.message || "Webhook error" });
  }
});

export default router;
