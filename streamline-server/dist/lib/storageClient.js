"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadVideo = uploadVideo;
exports.getSignedDownloadUrl = getSignedDownloadUrl;
exports.getSignedUploadUrl = getSignedUploadUrl;
exports.deleteFile = deleteFile;
exports.checkFileExists = checkFileExists;
exports.getFileMetadata = getFileMetadata;
exports.generateRecordingPath = generateRecordingPath;
exports.generateThumbnailPath = generateThumbnailPath;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
/**
 * Cloudflare R2 Storage Client
 * R2 is S3-compatible, so we use AWS SDK with R2 endpoint
 */
// Configuration from environment variables
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCOUNT_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_ACCOUNT_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
// Validate required environment variables
if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_ENDPOINT) {
    console.warn("⚠️  R2 storage environment variables not fully configured");
    console.warn("   Required: R2_ACCOUNT_ACCESS_KEY_ID, R2_ACCOUNT_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT");
}
// Initialize S3 client with R2 endpoint
const s3Client = new client_s3_1.S3Client({
    region: "auto",
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID || "",
        secretAccessKey: R2_SECRET_ACCESS_KEY || "",
    },
    endpoint: R2_ENDPOINT || "https://r2.cloudflarestorage.com",
});
/**
 * Generate R2 public URL for a given storage path
 */
function getPublicUrl(remotePath) {
    // Extract bucket domain from R2_ENDPOINT
    // Format: https://df4e3cd2d3e39008194313b377227e8d.r2.cloudflarestorage.com
    const publicUrl = R2_ENDPOINT?.replace("r2.cloudflarestorage.com", `${R2_BUCKET_NAME}.r2.cloudflarestorage.com`) || "";
    return `${publicUrl}/${remotePath}`;
}
/**
 * Upload a video file to R2
 * @param buffer - File content as Buffer
 * @param remotePath - Path in R2 (e.g., "recordings/userId/roomName/timestamp.mp4")
 * @param contentType - MIME type (e.g., "video/mp4")
 * @returns Public URL of the uploaded file
 */
async function uploadVideo(buffer, remotePath, contentType = "video/mp4") {
    try {
        const command = new client_s3_1.PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: remotePath,
            Body: buffer,
            ContentType: contentType,
        });
        await s3Client.send(command);
        console.log(`✅ Uploaded: ${remotePath}`);
        return getPublicUrl(remotePath);
    }
    catch (error) {
        console.error(`❌ Failed to upload ${remotePath}:`, error);
        throw new Error(`Failed to upload video to R2: ${error}`);
    }
}
/**
 * Generate a signed download URL for a file in R2
 * @param remotePath - Path in R2 (e.g., "recordings/userId/roomName/timestamp.mp4")
 * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 * @returns Signed URL valid for specified duration
 */
async function getSignedDownloadUrl(remotePath, expiresIn = 3600) {
    try {
        const command = new client_s3_1.GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: remotePath,
        });
        const url = await (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn });
        console.log(`✅ Generated download URL for: ${remotePath}`);
        return url;
    }
    catch (error) {
        console.error(`❌ Failed to generate signed URL for ${remotePath}:`, error);
        throw new Error(`Failed to generate signed download URL: ${error}`);
    }
}
/**
 * Generate a signed upload URL (for direct browser uploads)
 * @param remotePath - Path in R2 (e.g., "recordings/userId/roomName/timestamp.mp4")
 * @param contentType - MIME type of the file being uploaded
 * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 * @returns Signed URL that client can POST to for direct upload
 */
async function getSignedUploadUrl(remotePath, contentType = "video/mp4", expiresIn = 3600) {
    try {
        const command = new client_s3_1.PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: remotePath,
            ContentType: contentType,
        });
        const url = await (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn });
        console.log(`✅ Generated upload URL for: ${remotePath}`);
        return url;
    }
    catch (error) {
        console.error(`❌ Failed to generate signed upload URL for ${remotePath}:`, error);
        throw new Error(`Failed to generate signed upload URL: ${error}`);
    }
}
/**
 * Delete a file from R2
 * @param remotePath - Path in R2
 */
async function deleteFile(remotePath) {
    try {
        const command = new client_s3_1.DeleteObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: remotePath,
        });
        await s3Client.send(command);
        console.log(`✅ Deleted: ${remotePath}`);
    }
    catch (error) {
        console.error(`❌ Failed to delete ${remotePath}:`, error);
        throw new Error(`Failed to delete file from R2: ${error}`);
    }
}
/**
 * Check if a file exists in R2
 * @param remotePath - Path in R2
 * @returns true if file exists, false otherwise
 */
async function checkFileExists(remotePath) {
    try {
        const command = new client_s3_1.HeadObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: remotePath,
        });
        await s3Client.send(command);
        return true;
    }
    catch (error) {
        if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
            return false;
        }
        console.error(`⚠️  Error checking file existence for ${remotePath}:`, error);
        throw new Error(`Failed to check file existence: ${error}`);
    }
}
/**
 * Get file metadata (size, last modified, etc.)
 * @param remotePath - Path in R2
 * @returns Object metadata
 */
async function getFileMetadata(remotePath) {
    try {
        const command = new client_s3_1.HeadObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: remotePath,
        });
        const metadata = await s3Client.send(command);
        return metadata;
    }
    catch (error) {
        console.error(`❌ Failed to get metadata for ${remotePath}:`, error);
        throw new Error(`Failed to get file metadata: ${error}`);
    }
}
/**
 * Generate a recording file path based on userId, roomName, and timestamp
 * @param userId - User ID
 * @param roomName - Room name
 * @param timestamp - Unix timestamp
 * @returns Formatted path for recordings
 */
function generateRecordingPath(userId, roomName, timestamp) {
    return `recordings/${userId}/${roomName}/${timestamp}.mp4`;
}
/**
 * Generate a thumbnail file path based on userId, roomName, and timestamp
 * @param userId - User ID
 * @param roomName - Room name
 * @param timestamp - Unix timestamp
 * @returns Formatted path for thumbnails
 */
function generateThumbnailPath(userId, roomName, timestamp) {
    return `thumbnails/${userId}/${roomName}/${timestamp}.jpg`;
}
exports.default = {
    uploadVideo,
    getSignedDownloadUrl,
    getSignedUploadUrl,
    deleteFile,
    checkFileExists,
    getFileMetadata,
    generateRecordingPath,
    generateThumbnailPath,
};
