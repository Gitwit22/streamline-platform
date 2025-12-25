import express from "express";
import { firestore } from "../firebaseAdmin";
import { EgressClient, EncodedFileOutput, EncodedFileType, EgressInfo } from "livekit-server-sdk";
import { S3Upload } from "livekit-server-sdk";
import crypto from "crypto";
import { r2GetStream, r2Delete } from "../lib/r2";
import { r2HeadObjectSize } from "../lib/r2Head";
import { Readable } from "stream";
import { getFileMetadata } from "../lib/storageClient";

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// =============================================================================
// DOWNLOAD RECORDING
// =============================================================================

router.get("/:id/download-link", async (req, res) => {
  const { id } = req.params;

  try {
    const snap = await firestore.collection("recordings").doc(id).get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: "Recording not found" });
    }

    const data = snap.data() as any;

    if (data.status !== "READY" || !data.objectKey) {
      return res.status(409).json({ success: false, error: "Recording not ready yet" });
    }

    const size1 = await r2HeadObjectSize(data.objectKey);
    if (!size1 || size1 === 0) {
      return res.status(409).json({ success: false, error: "Recording file not available or empty" });
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const size2 = await r2HeadObjectSize(data.objectKey);
    if (size2 !== size1) {
      return res.status(409).json({ success: false, error: "Recording file size not stable yet" });
    }

    const rawToken = crypto.randomBytes(24).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    await firestore.collection("recordings").doc(id).set(
      { oneTimeToken: hashedToken, updatedAt: new Date() },
      { merge: true }
    );

    const path = `/api/recordings/${id}/download?token=${rawToken}`;

    return res.status(200).json({
      success: true,
      data: { path },
    });
  } catch (err) {
    console.error("[download-link] failed:", err);
    return res.status(500).json({ success: false, error: "Failed to create download link" });
  }
});

router.get("/:id/download", async (req, res) => {
  const { id } = req.params;
  const token = String(req.query.token || "");

  try {
    const snap = await firestore.collection("recordings").doc(id).get();
    if (!snap.exists) {
      return res.status(404).send("Recording not found");
    }

    const data = snap.data() as any;

    if (!token) {
      return res.status(401).send("Missing token");
    }

    if (!data.oneTimeToken) {
      return res.status(403).send("Token expired or missing");
    }

    const hashed = crypto.createHash("sha256").update(token).digest("hex");
    if (hashed !== data.oneTimeToken) {
      return res.status(403).send("Invalid token");
    }

    if (!data.objectKey) {
      return res.status(409).send("Recording file not available");
    }

    const body: any = await r2GetStream(data.objectKey);

    let nodeStream: NodeJS.ReadableStream;

    if (body && typeof body.pipe === "function") {
      nodeStream = body;
    } else if (body && typeof body.getReader === "function") {
      nodeStream = Readable.fromWeb(body);
    } else {
      throw new Error("R2 returned an unsupported body type");
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${id}.mp4"`);

    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;

      try {
        await r2Delete(data.objectKey);
        await firestore.collection("recordings").doc(id).set(
          {
            status: "DOWNLOADED",
            oneTimeToken: null,
            downloadedAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      } catch (err) {
        console.error("[download cleanup] failed:", err);
      }
    };

    res.on("finish", cleanup);
    res.on("close", cleanup);

    nodeStream.pipe(res);

  } catch (err) {
    console.error("[download] failed:", err);
    return res.status(500).send("Download failed");
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  
  console.log(`📋 GET /api/recordings/${id} - Fetching recording status`);
  
  if (!id) {
    return res.status(400).json({
      success: false,
      error: "Recording ID is required",
    });
  }
  
  try {
    const snap = await firestore.collection("recordings").doc(id).get();
    
    if (!snap.exists) {
      console.log(`❌ Recording ${id} not found in Firestore`);
      return res.status(404).json({
        success: false,
        error: "Recording not found",
      });
    }
    
    const data = snap.data();

    let downloadReady = false;

    if (data?.objectKey) {
      try {
        const meta = await getFileMetadata(data.objectKey);
        const sizeNow = meta?.ContentLength ?? 0;

        const lastSize = typeof data.lastSize === "number" ? data.lastSize : null;
        const lastSizeAt = typeof data.lastSizeAt === "number" ? data.lastSizeAt : null;
        const now = Date.now();

        const stable =
          sizeNow > 0 &&
          lastSize !== null &&
          sizeNow === lastSize &&
          lastSizeAt !== null &&
          now - lastSizeAt >= 2000;

        await snap.ref.set(
          {
            lastSize: sizeNow,
            lastSizeAt: now,
            ...(stable && data.status !== "READY"
              ? { status: "READY", readyAt: new Date() }
              : {}),
            updatedAt: new Date(),
          },
          { merge: true }
        );

        downloadReady = stable;
      } catch (err) {
        console.warn("⚠️ Failed to check file size for readiness", err);
      }
    }

    console.log(`✅ Recording ${id} status:`, data?.status);
    
    return res.status(200).json({
      success: true,
      data: {
        id,
        status: data?.status || "PROCESSING",
        roomName: data?.roomName,
        objectKey: data?.objectKey,
        createdAt: data?.createdAt,
        updatedAt: data?.updatedAt,
        endedAt: data?.endedAt,
        layout: data?.layout,
        downloadReady,
      },
    });
    
  } catch (err: any) {
    console.error(`❌ Failed to fetch recording ${id}:`, err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch recording",
      details: err?.message || String(err),
    });
  }
});

router.post("/start", async (req, res) => {
  const { roomName, layout } = req.body as {
    roomName?: string;
    layout?: "speaker" | "grid";
  };

  console.log("=".repeat(80));
  console.log("🎬 /api/recordings/start called");
  console.log("Room:", roomName, "Layout:", layout);

  if (!roomName) {
    const errorData = { success: false, error: "roomName is required" };
    console.log("📤 Sending error:", errorData);
    return res.status(400).json(errorData);
  }

  const chosenLayout: "speaker" | "grid" = layout === "speaker" ? "speaker" : "grid";

  try {
    console.log("🔑 Initializing LiveKit client...");
    
    const LIVEKIT_URL = mustGetEnv("LIVEKIT_URL");
    const LIVEKIT_API_KEY = mustGetEnv("LIVEKIT_API_KEY");
    const LIVEKIT_API_SECRET = mustGetEnv("LIVEKIT_API_SECRET");
    const R2_ACCESS_KEY_ID = mustGetEnv("R2_ACCESS_KEY_ID");
    const R2_SECRET_ACCESS_KEY = mustGetEnv("R2_SECRET_ACCESS_KEY");
    const R2_BUCKET = mustGetEnv("R2_BUCKET");
    const R2_ENDPOINT = mustGetEnv("R2_ENDPOINT");
    const R2_REGION = process.env.R2_REGION ?? "auto";

    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const filepath = `recordings/${roomName}/${Date.now()}.mp4`;

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath,
      output: {
        case: "s3",
        value: new S3Upload({
          accessKey: R2_ACCESS_KEY_ID,
          secret: R2_SECRET_ACCESS_KEY,
          bucket: R2_BUCKET,
          endpoint: R2_ENDPOINT,
          region: R2_REGION,
          forcePathStyle: true,
        }),
      },
    });

    console.log("🚀 Starting egress...");
    const info: EgressInfo = await egressClient.startRoomCompositeEgress(roomName, {
      file: output,
    });

    const egressId =
      (info as any)?.egressId ||
      (info as any)?.info?.egressId ||
      (info as any)?.result?.egressId ||
      (info as any)?.data?.egressId;

    if (!egressId) {
      const errorData = { success: false, error: "No egressId returned" };
      console.log("📤 Sending error:", errorData);
      return res.status(500).json(errorData);
    }

    console.log("✅ Egress ID:", egressId);

    await firestore.collection("recordings").doc(egressId).set(
      {
        roomName,
        layout: chosenLayout,
        status: "RECORDING",
        objectKey: filepath,
        filepath,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );

    const payload = {
      success: true,
      data: {
        recordingId: egressId,
        roomName,
        layout: chosenLayout,
        status: "RECORDING",
        startedAt: new Date().toISOString(),
      },
    };

    console.log("📤 FINAL recording response:", payload);
    return res.status(200).json(payload);

  } catch (err: any) {
    console.error("❌ ERROR:", err?.message);
    const errorData = {
      success: false,
      error: err?.message ?? "Failed to start recording",
    };
    console.log("📤 Sending error:", errorData);
    return res.status(500).json(errorData);
  }
});

router.post("/stop", async (req, res) => {
  const { recordingId } = req.body;

  console.log("=".repeat(80));
  console.log("ℹ️ /api/recordings/stop called");
  console.log("=".repeat(80));
  console.log("Recording ID:", recordingId);

  if (!recordingId) {
    console.error("❌ Missing recordingId");
    return res.status(400).json({
      success: false,
      error: "recordingId is required",
    });
  }

  try {
    const LIVEKIT_URL = mustGetEnv("LIVEKIT_URL");
    const LIVEKIT_API_KEY = mustGetEnv("LIVEKIT_API_KEY");
    const LIVEKIT_API_SECRET = mustGetEnv("LIVEKIT_API_SECRET");

    console.log("🔑 LiveKit credentials loaded");

    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    console.log("🛑 Stopping egress...");
    const response: EgressInfo = await egressClient.stopEgress(recordingId);

    const stoppedEgressId = response?.egressId || recordingId;

    console.log("✅ Egress stop requested:", stoppedEgressId);

    console.log("💾 Updating Firestore status...");
    const ref = firestore.collection("recordings").doc(stoppedEgressId);

    await ref.set(
      {
        status: "STOP_REQUESTED",
        stoppedAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );

    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data() as any;

      if (data?.filepath && !data?.objectKey) {
        await ref.set(
          {
            objectKey: data.filepath,
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        recordingId: stoppedEgressId,
        status: "STOP_REQUESTED",
        stoppedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("=".repeat(80));
    console.error("❌ RECORDING STOP FAILED");
    console.error("=".repeat(80));
    console.error("Error:", err?.message);
    console.error("Stack:", err?.stack);
    console.error("=".repeat(80));

    return res.status(500).json({
      success: false,
      error: "Failed to stop recording",
      details: err?.message || String(err),
    });
  }
});

export default router;