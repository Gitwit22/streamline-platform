import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Unified R2 env scheme
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ENDPOINT = R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : process.env.R2_ENDPOINT;

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_ENDPOINT) {
  console.warn("⚠️  R2 storage env vars incomplete. Required: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
}

const s3Client = new S3Client({
  region: "auto",
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || "",
    secretAccessKey: R2_SECRET_ACCESS_KEY || "",
  },
  endpoint: R2_ENDPOINT,
  forcePathStyle: true,
});

export function isR2Configured(): boolean {
  return !!(R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_ENDPOINT);
}

/**
 * HEAD check on R2 to verify object exists and get size.
 * Returns 0 when not found or when R2 is not configured.
 */
export async function headObjectSize(remotePath: string): Promise<number> {
  const key = String(remotePath || "").trim().replace(/^\//, "");
  if (!key) return 0;
  if (!R2_BUCKET || !isR2Configured()) return 0;

  try {
    const resp = await s3Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return typeof resp.ContentLength === "number" ? resp.ContentLength : 0;
  } catch (err: any) {
    if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
      return 0;
    }
    console.warn(`[r2] headObjectSize error for ${key}:`, err?.message || err);
    return 0;
  }
}

/**
 * Generate R2 public URL for a given storage path
 */
function getPublicUrl(remotePath: string): string {
  if (!R2_ENDPOINT || !R2_BUCKET) return "";
  const publicUrl = R2_ENDPOINT.replace("r2.cloudflarestorage.com", `${R2_BUCKET}.r2.cloudflarestorage.com`);
  return `${publicUrl}/${remotePath}`;
}

/**
 * Upload a video file to R2
 * @param buffer - File content as Buffer
 * @param remotePath - Path in R2 (e.g., "recordings/userId/roomName/timestamp.mp4")
 * @param contentType - MIME type (e.g., "video/mp4")
 * @returns Public URL of the uploaded file
 */
export async function uploadVideo(
  buffer: Buffer,
  remotePath: string,
  contentType: string = "video/mp4"
): Promise<string> {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: remotePath,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);
    console.log(`✅ Uploaded: ${remotePath}`);

    return getPublicUrl(remotePath);
  } catch (error) {
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
export async function getSignedDownloadUrl(
  remotePath: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: remotePath,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    console.log(`✅ Generated download URL for: ${remotePath}`);

    return url;
  } catch (error) {
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
export async function getSignedUploadUrl(
  remotePath: string,
  contentType: string = "video/mp4",
  expiresIn: number = 3600
): Promise<string> {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: remotePath,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    console.log(`✅ Generated upload URL for: ${remotePath}`);

    return url;
  } catch (error) {
    console.error(`❌ Failed to generate signed upload URL for ${remotePath}:`, error);
    throw new Error(`Failed to generate signed upload URL: ${error}`);
  }
}

/**
 * Delete a file from R2
 * @param remotePath - Path in R2
 */
export async function deleteFile(remotePath: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: remotePath,
    });

    await s3Client.send(command);
    console.log(`✅ Deleted: ${remotePath}`);
  } catch (error) {
    console.error(`❌ Failed to delete ${remotePath}:`, error);
    throw new Error(`Failed to delete file from R2: ${error}`);
  }
}

/**
 * Delete multiple files from R2 (idempotent).
 * Uses batch delete when possible, falling back to single deletes.
 */
export async function deleteFiles(remotePaths: string[]): Promise<void> {
  const keys = (remotePaths || []).map(String).map((s) => s.trim()).filter(Boolean);
  if (keys.length === 0) return;

  // S3 DeleteObjects supports up to 1000 keys per request.
  const chunkSize = 1000;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    try {
      const command = new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      });
      await s3Client.send(command);
      for (const k of chunk) console.log(`✅ Deleted: ${k}`);
    } catch (error) {
      // Batch delete sometimes fails on providers; fall back to single deletes.
      console.warn("⚠️  Batch delete failed; falling back to single deletes", (error as any)?.message || error);
      for (const k of chunk) {
        try {
          await deleteFile(k);
        } catch (singleErr) {
          console.warn(`⚠️  Failed to delete ${k}:`, (singleErr as any)?.message || singleErr);
        }
      }
    }
  }
}

/**
 * List object keys under a prefix.
 */
export async function listKeysByPrefix(prefix: string, maxKeys: number = 1000): Promise<string[]> {
  const p = String(prefix || "").trim();
  if (!p) return [];

  const keys: string[] = [];
  let continuationToken: string | undefined;

  while (true) {
    const command = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: p,
      ContinuationToken: continuationToken,
      MaxKeys: Math.min(1000, Math.max(1, maxKeys - keys.length)),
    });

    const resp = await s3Client.send(command);
    const contents = resp.Contents || [];
    for (const obj of contents) {
      if (obj.Key) keys.push(obj.Key);
      if (keys.length >= maxKeys) return keys;
    }

    if (!resp.IsTruncated || !resp.NextContinuationToken) break;
    continuationToken = resp.NextContinuationToken;
  }

  return keys;
}

/**
 * Delete all objects under a prefix (idempotent).
 */
export async function deletePrefix(prefix: string, maxKeys: number = 5000): Promise<{ deleted: number }> {
  const keys = await listKeysByPrefix(prefix, maxKeys);
  if (keys.length === 0) return { deleted: 0 };
  await deleteFiles(keys);
  return { deleted: keys.length };
}

/**
 * Check if a file exists in R2
 * @param remotePath - Path in R2
 * @returns true if file exists, false otherwise
 */
export async function checkFileExists(remotePath: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET,
      Key: remotePath,
    });

    await s3Client.send(command);
    return true;
  } catch (error: any) {
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
export async function getFileMetadata(remotePath: string): Promise<HeadObjectCommandOutput> {
  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET,
      Key: remotePath,
    });

    const metadata = await s3Client.send(command);
    return metadata;
  } catch (error) {
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
export function generateRecordingPath(userId: string, roomName: string, timestamp: number): string {
  return `recordings/${userId}/${roomName}/${timestamp}.mp4`;
}

/**
 * Generate a thumbnail file path based on userId, roomName, and timestamp
 * @param userId - User ID
 * @param roomName - Room name
 * @param timestamp - Unix timestamp
 * @returns Formatted path for thumbnails
 */
export function generateThumbnailPath(userId: string, roomName: string, timestamp: number): string {
  return `thumbnails/${userId}/${roomName}/${timestamp}.jpg`;
}

export default {
  uploadVideo,
  getSignedDownloadUrl,
  getSignedUploadUrl,
  deleteFile,
  checkFileExists,
  getFileMetadata,
  generateRecordingPath,
  generateThumbnailPath,
};
