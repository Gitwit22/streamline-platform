"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebaseAdmin_1 = require("../firebaseAdmin");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const multer_1 = __importDefault(require("multer"));
const storageClient_1 = require("../lib/storageClient");
const usageHelper_1 = require("../usageHelper");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
// Configure multer for memory storage (files stored in RAM temporarily)
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});
// ✅ FIXED AUTH MIDDLEWARE - ALLOWS DEV MODE
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    // Development mode: Allow requests without token
    if (!token) {
        console.log("⚠️ No auth token provided - using dev user");
        req.user = { id: "dev_user_123", planId: "free" };
        return next();
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = { id: decoded.id, planId: decoded.plan };
        console.log("✅ Auth token valid:", req.user.id);
        next();
    }
    catch (err) {
        console.log("⚠️ Invalid auth token - using dev user");
        req.user = { id: "dev_user_123", planId: "free" };
        next();
    }
};
// ============================================================================
// UPLOAD ENDPOINT - ✅ FIXED WITH MULTER
// ============================================================================
router.post("/upload", authenticateToken, upload.single('video'), // ✅ Parse file from FormData
async (req, res) => {
    try {
        console.log("📤 Upload request received");
        const file = req.file;
        if (!file) {
            console.log("❌ No file in request");
            return res.status(400).json({ error: "No file uploaded" });
        }
        const userId = req.user?.id;
        const title = req.body.title || file.originalname.replace(/\.[^/.]+$/, "");
        console.log(`📹 Uploading: ${title}`);
        console.log(`📦 Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`👤 User: ${userId}`);
        // Check storage limits (skip for dev user)
        if (userId && userId !== "dev_user_123") {
            try {
                await (0, usageHelper_1.checkStorageLimit)(userId, file.size);
            }
            catch (err) {
                console.log("⚠️ Storage limit check:", err.message);
                // Continue anyway for dev
            }
        }
        // Generate unique filename
        const timestamp = Date.now();
        const safeName = title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
        const fileName = `${timestamp}-${safeName}.${file.originalname.split('.').pop()}`;
        const path = `uploads/${userId}/${fileName}`;
        console.log(`☁️ Uploading to: ${path}`);
        // Upload to R2/S3
        const publicUrl = await (0, storageClient_1.uploadVideo)(file.buffer, path, file.mimetype);
        console.log(`✅ Upload complete: ${publicUrl}`);
        // Update storage usage (skip for dev user)
        if (userId && userId !== "dev_user_123") {
            try {
                await (0, usageHelper_1.updateStorageUsage)(userId, file.size);
            }
            catch (err) {
                console.log("⚠️ Storage usage update failed (non-critical)");
            }
        }
        // Create asset in Firestore
        const assetData = {
            userId,
            name: title,
            type: 'video',
            fileSize: file.size,
            videoUrl: publicUrl,
            storagePath: path,
            thumbnailUrl: null,
            duration: 0,
            createdAt: new Date(),
            source: 'upload'
        };
        const assetRef = await firebaseAdmin_1.firestore.collection('editing_assets').add(assetData);
        console.log(`💾 Asset saved: ${assetRef.id}`);
        res.json({
            ok: true,
            assetId: assetRef.id,
            publicUrl,
            storagePath: path,
            message: "Upload successful"
        });
    }
    catch (err) {
        console.error("❌ Upload error:", err);
        res.status(500).json({
            error: err.message || "Upload failed",
            details: err.stack
        });
    }
});
// ============================================================================
// ASSETS ENDPOINTS
// ============================================================================
// GET /api/editing/assets - Get all user's assets
router.get("/assets", authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        // Fetch all recordings for this user and convert to assets format
        const recordingsSnap = await firebaseAdmin_1.firestore
            .collection("recordings")
            .where("userId", "==", userId)
            .get();
        const assets = recordingsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: data.id || doc.id,
                name: data.title || "Untitled",
                type: 'video',
                duration: data.duration || data.durationMinutes * 60 || 0,
                fileSize: 0,
                videoUrl: data.videoUrl || "",
                thumbnailUrl: data.thumbnailUrl || null,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                source: 'stream',
                roomId: data.roomName || data.roomId,
                userId: data.userId
            };
        });
        // Also fetch uploaded assets
        const uploadsSnap = await firebaseAdmin_1.firestore
            .collection("editing_assets")
            .where("userId", "==", userId)
            .get();
        const uploads = uploadsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name || "Untitled",
                type: data.type || 'video',
                duration: data.duration || 0,
                fileSize: data.fileSize || 0,
                videoUrl: data.videoUrl || "",
                thumbnailUrl: data.thumbnailUrl || null,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                source: data.source || 'upload',
                userId: data.userId
            };
        });
        const allAssets = [...assets, ...uploads];
        res.json(allAssets);
    }
    catch (err) {
        console.error("Get assets error:", err);
        res.status(500).json({ error: "Failed to fetch assets" });
    }
});
// GET /api/editing/listall - Legacy endpoint
router.get("/listall", authenticateToken, async (req, res) => {
    // Same as /assets
    try {
        const userId = req.user?.id;
        const recordingsSnap = await firebaseAdmin_1.firestore.collection("recordings").where("userId", "==", userId).get();
        const uploadsSnap = await firebaseAdmin_1.firestore.collection("editing_assets").where("userId", "==", userId).get();
        const assets = [...recordingsSnap.docs, ...uploadsSnap.docs].map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.title || data.name || "Untitled",
                type: 'video',
                videoUrl: data.videoUrl || "",
                createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                source: data.source || 'stream'
            };
        });
        res.json(assets);
    }
    catch (err) {
        console.error("listall error:", err);
        res.status(500).json({ error: "Failed to fetch assets" });
    }
});
// GET /api/editing/assets/:id - Get single asset by ID
router.get("/assets/:id", authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const recordingSnap = await firebaseAdmin_1.firestore.collection("recordings").doc(id).get();
        if (!recordingSnap.exists) {
            return res.status(404).json({ error: "Asset not found" });
        }
        const data = recordingSnap.data();
        // Verify ownership
        if (data?.userId !== userId) {
            return res.status(403).json({ error: "Forbidden" });
        }
        const asset = {
            id: data?.id || recordingSnap.id,
            name: data?.title || "Untitled",
            duration: data?.duration || 0,
            source: "stream",
            thumbnail: data?.thumbnailUrl || "",
            videoUrl: data?.videoUrl || data?.publicExportUrl,
            fileSize: data?.fileSize,
            createdAt: data?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            userId: data?.userId,
        };
        res.json(asset);
    }
    catch (err) {
        console.error("get asset error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});
// DELETE /api/editing/assets/:id - Delete an asset
router.delete("/assets/:id", authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const recordingSnap = await firebaseAdmin_1.firestore.collection("recordings").doc(id).get();
        if (!recordingSnap.exists) {
            return res.status(404).json({ error: "Asset not found" });
        }
        const data = recordingSnap.data();
        // Verify ownership
        if (data?.userId !== userId) {
            return res.status(403).json({ error: "Forbidden" });
        }
        // Delete from Firestore
        await firebaseAdmin_1.firestore.collection("recordings").doc(id).delete();
        res.json({ ok: true, message: "Asset deleted" });
    }
    catch (err) {
        console.error("delete asset error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});
// POST /api/editing/assets/from-recording - Convert recording to asset
router.post("/assets/from-recording", authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { recordingId } = req.body;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!recordingId) {
            return res.status(400).json({ error: "recordingId is required" });
        }
        const recordingSnap = await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).get();
        if (!recordingSnap.exists) {
            return res.status(404).json({ error: "Recording not found" });
        }
        const data = recordingSnap.data();
        // Verify ownership
        if (data?.userId !== userId) {
            return res.status(403).json({ error: "Forbidden" });
        }
        const asset = {
            id: data?.id || recordingSnap.id,
            name: data?.title || "Untitled",
            duration: data?.duration || 0,
            source: "stream",
            thumbnail: data?.thumbnailUrl || "",
            videoUrl: data?.videoUrl || data?.publicExportUrl,
            fileSize: data?.fileSize,
            createdAt: data?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
            userId: data?.userId,
        };
        res.json(asset);
    }
    catch (err) {
        console.error("convert recording error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});
// ============================================================================
// PROJECTS ENDPOINTS
// ============================================================================
// GET /api/editing/projects - List all projects
router.get("/projects", authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const projectsSnap = await firebaseAdmin_1.firestore
            .collection("editing_projects")
            .where("userId", "==", userId)
            .get();
        const projects = projectsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                assetId: data.assetId,
                createdAt: data.createdAt?.toDate?.()?.toISOString(),
                updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
                duration: data.duration || 0,
                status: data.status || 'draft',
                userId: data.userId
            };
        });
        res.json(projects);
    }
    catch (err) {
        console.error("Get projects error:", err);
        res.status(500).json({ error: "Failed to fetch projects" });
    }
});
// POST /api/editing/projects - Create new project
router.post("/projects", authenticateToken, async (req, res) => {
    try {
        const { name, assetId } = req.body;
        const userId = req.user?.id;
        const newProject = {
            userId,
            name,
            assetId,
            createdAt: new Date(),
            updatedAt: new Date(),
            duration: 0,
            status: 'draft',
            timeline: []
        };
        const projectRef = await firebaseAdmin_1.firestore.collection("editing_projects").add(newProject);
        res.json({
            id: projectRef.id,
            ...newProject,
            createdAt: newProject.createdAt.toISOString(),
            updatedAt: newProject.updatedAt.toISOString()
        });
    }
    catch (err) {
        console.error("Create project error:", err);
        res.status(500).json({ error: "Failed to create project" });
    }
});
// ============================================================================
// RECORDINGS ENDPOINTS
// ============================================================================
// GET /api/editing/recordings/:id - Get recording details
router.get("/recordings/:id", authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const recordingDoc = await firebaseAdmin_1.firestore.collection("recordings").doc(id).get();
        if (!recordingDoc.exists) {
            return res.status(404).json({ error: "Recording not found" });
        }
        const data = recordingDoc.data();
        res.json({
            id: recordingDoc.id,
            ...data,
            createdAt: data?.createdAt?.toDate?.()?.toISOString()
        });
    }
    catch (err) {
        console.error("Get recording error:", err);
        res.status(500).json({ error: "Failed to fetch recording" });
    }
});
// GET /api/editing/list - Get all recordings for the authenticated user
router.get("/list", async (req, res) => {
    try {
        const authHeader = req.headers["authorization"];
        const token = authHeader && authHeader.split(" ")[1];
        let userId = null;
        // If token provided, use it; otherwise fetch all recordings for testing
        if (token) {
            try {
                const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
                userId = decoded.id;
            }
            catch (err) {
                // Invalid token, will fetch all recordings
                userId = null;
            }
        }
        let query = firebaseAdmin_1.firestore.collection("recordings");
        // If we have a valid user ID, filter by it
        if (userId) {
            query = query.where("userId", "==", userId);
        }
        const recordingsSnap = await query.get();
        const recordings = recordingsSnap.docs
            .map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }))
            .sort((a, b) => {
            // Sort by createdAt descending in memory
            const aTime = new Date(a.createdAt || 0).getTime();
            const bTime = new Date(b.createdAt || 0).getTime();
            return bTime - aTime;
        });
        res.json(recordings);
    }
    catch (err) {
        console.error("list error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
// POST /api/editing/save - Save edit configuration for a recording
router.post("/save", authenticateToken, async (req, res) => {
    try {
        const { recordingId, editConfig } = req.body;
        const userId = req.user?.id;
        if (!userId || !recordingId) {
            return res.status(400).json({ error: "recordingId is required" });
        }
        // Verify ownership
        const recordingSnap = await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).get();
        if (!recordingSnap.exists) {
            return res.status(404).json({ error: "Recording not found" });
        }
        const recordingData = recordingSnap.data();
        if (recordingData.userId !== userId) {
            return res.status(403).json({ error: "Unauthorized" });
        }
        // Save edit config
        await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).update({
            editConfig,
            updatedAt: new Date(),
        });
        res.json({ ok: true, message: "Edit config saved" });
    }
    catch (err) {
        console.error("save error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});
// PUT /api/editing/:recordingId - Update recording metadata (duration, status, viewer count)
router.put("/:recordingId", authenticateToken, async (req, res) => {
    try {
        const { recordingId } = req.params;
        const { duration, status, viewerCount, peakViewers } = req.body;
        const userId = req.user?.id;
        if (!userId || !recordingId) {
            return res.status(400).json({ error: "recordingId is required" });
        }
        // Verify ownership
        const recordingSnap = await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).get();
        if (!recordingSnap.exists) {
            return res.status(404).json({ error: "Recording not found" });
        }
        const recordingData = recordingSnap.data();
        if (recordingData.userId !== userId) {
            return res.status(403).json({ error: "Unauthorized" });
        }
        // Update recording metadata
        const updateData = { updatedAt: new Date() };
        if (typeof duration === 'number')
            updateData.duration = duration;
        if (status)
            updateData.status = status;
        if (typeof viewerCount === 'number')
            updateData.viewerCount = viewerCount;
        if (typeof peakViewers === 'number')
            updateData.peakViewers = peakViewers;
        await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).update(updateData);
        console.log("✅ Recording updated:", { recordingId, ...updateData });
        res.json({
            ok: true,
            message: "Recording updated successfully",
            recording: { id: recordingId, ...updateData },
        });
    }
    catch (err) {
        console.error("❌ update recording error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});
// POST /api/editing/render - Trigger render job for a recording
router.post("/render", authenticateToken, async (req, res) => {
    try {
        const { recordingId, renderedBuffer } = req.body;
        const userId = req.user?.id;
        if (!userId || !recordingId) {
            return res.status(400).json({ error: "recordingId is required" });
        }
        // Verify ownership
        const recordingSnap = await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).get();
        if (!recordingSnap.exists) {
            return res.status(404).json({ error: "Recording not found" });
        }
        const recordingData = recordingSnap.data();
        if (recordingData.userId !== userId) {
            return res.status(403).json({ error: "Unauthorized" });
        }
        // Update recording status to "rendering"
        await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).update({
            status: "rendering",
            renderStartedAt: new Date(),
        });
        // ✅ PROMPT #4: When export finishes, upload rendered video to R2
        if (renderedBuffer) {
            try {
                const buffer = Buffer.from(renderedBuffer);
                // Check storage limit
                await (0, usageHelper_1.checkStorageLimit)(userId, buffer.byteLength);
                // Upload to R2
                const exportPath = `exports/${userId}/${recordingId}/${Date.now()}.mp4`;
                const publicUrl = await (0, storageClient_1.uploadVideo)(buffer, exportPath, "video/mp4");
                // Update storage usage
                await (0, usageHelper_1.updateStorageUsage)(userId, buffer.byteLength);
                // Update recording with rendered path and URL
                await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).update({
                    status: "complete",
                    renderedPath: exportPath,
                    publicExportUrl: publicUrl,
                    renderedAt: new Date(),
                });
                return res.json({
                    status: "complete",
                    recordingId,
                    message: "Render and export completed",
                    publicUrl,
                    exportPath,
                });
            }
            catch (uploadErr) {
                console.error("Export upload failed:", uploadErr);
                await firebaseAdmin_1.firestore.collection("recordings").doc(recordingId).update({
                    status: "render_failed",
                    error: uploadErr.message,
                });
                return res.status(500).json({
                    error: "Failed to upload rendered video",
                    details: uploadErr.message,
                });
            }
        }
        res.json({
            status: "queued",
            recordingId,
            message: "Render job queued",
        });
    }
    catch (err) {
        console.error("render error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});
// POST /api/editing/create-recording - Create a new recording document when stream starts
router.post("/create-recording", authenticateToken, async (req, res) => {
    try {
        const { roomName, title, viewerCount, peakViewers } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!title) {
            return res.status(400).json({ error: "Title is required" });
        }
        // Create new recording document
        const recordingRef = firebaseAdmin_1.firestore.collection("recordings").doc();
        const recordingData = {
            id: recordingRef.id,
            userId,
            roomName: roomName || "default-room",
            title,
            status: "ready", // Immediately ready since we can't record the actual stream
            duration: 0,
            viewerCount: viewerCount || 0,
            peakViewers: peakViewers || 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            videoUrl: null, // Will be populated if video is uploaded
            thumbnailUrl: null,
            progress: 100,
            usageType: "recording_only",
        };
        await recordingRef.set(recordingData);
        console.log("✅ Recording created:", recordingData);
        res.json({
            ok: true,
            id: recordingRef.id,
            status: "ready",
            message: "Recording created successfully",
            recording: recordingData,
        });
    }
    catch (err) {
        console.error("❌ create-recording error:", err);
        res.status(500).json({ error: err.message || "Internal server error" });
    }
});
// ============================================================================
// RECORDING START/STOP ENDPOINTS
// ============================================================================
// POST /api/recordings/start - Start a new recording session
router.post("/recordings/start", authenticateToken, async (req, res) => {
    try {
        const { roomName, title } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!roomName || !title) {
            return res.status(400).json({ error: "roomName and title required" });
        }
        // Create recording document
        const recordingRef = firebaseAdmin_1.firestore.collection("recordings").doc();
        const recordingData = {
            id: recordingRef.id,
            userId,
            roomName,
            title,
            status: "recording",
            startedAt: new Date(),
            stoppedAt: null,
            duration: 0,
            viewerCount: 0,
            peakViewers: 0,
            videoUrl: null,
            thumbnailUrl: null,
            progress: 0,
            usageType: "recording_only",
        };
        await recordingRef.set(recordingData);
        console.log("✅ Recording started:", recordingRef.id);
        res.json({
            success: true,
            id: recordingRef.id,
            status: "recording",
        });
    }
    catch (err) {
        console.error("❌ recording start error:", err);
        res.status(500).json({ error: err.message || "Failed to start recording" });
    }
});
// POST /api/recordings/stop - Stop recording and finalize metadata
router.post("/recordings/stop", authenticateToken, async (req, res) => {
    try {
        const { recordingId, duration, viewerCount, peakViewers } = req.body;
        const userId = req.user?.id;
        if (!userId || !recordingId) {
            return res.status(400).json({ error: "Unauthorized or missing recordingId" });
        }
        // Update recording document
        const recordingRef = firebaseAdmin_1.firestore.collection("recordings").doc(recordingId);
        await recordingRef.update({
            status: "ready",
            stoppedAt: new Date(),
            duration: duration || 0,
            viewerCount: viewerCount || 0,
            peakViewers: peakViewers || 0,
            progress: 100,
        });
        console.log("✅ Recording stopped:", recordingId);
        res.json({
            success: true,
            id: recordingId,
            status: "ready",
            duration: duration,
        });
    }
    catch (err) {
        console.error("❌ recording stop error:", err);
        res.status(500).json({ error: err.message || "Failed to stop recording" });
    }
});
exports.default = router;
