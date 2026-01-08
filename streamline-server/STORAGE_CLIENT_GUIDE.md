# Cloudflare R2 Storage Client

This module provides a TypeScript-based interface to Cloudflare R2 for storing and managing video recordings and thumbnails.

## Setup

### 1. Environment Variables

Add these to your `.env` file in `streamline-server/`:

```env
R2_ACCOUNT_ACCESS_KEY_ID=your_access_key_id
R2_ACCOUNT_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=streamline-recordings
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
```

### 2. Get Cloudflare R2 Credentials

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select **R2** from the left sidebar
3. Create a new bucket (or use existing)
4. Create an API token:
   - Click **Manage R2 API tokens**
   - Create token with permissions: `Object Read & Write`
   - Save `Access Key ID` and `Secret Access Key`
5. Get your account ID from the R2 bucket URL

## Usage

### Import the client

```typescript
import {
  uploadVideo,
  getSignedDownloadUrl,
  getSignedUploadUrl,
  deleteFile,
  checkFileExists,
  generateRecordingPath,
  generateThumbnailPath,
} from "../lib/storageClient";
```

### Upload a recording

```typescript
import fs from "fs";

const buffer = fs.readFileSync("local-video.mp4");
const path = generateRecordingPath(userId, roomName, Date.now());

const publicUrl = await uploadVideo(buffer, path, "video/mp4");
console.log("Video available at:", publicUrl);
```

### Generate a signed download URL

```typescript
const path = "recordings/user123/room456/1702000000.mp4";
const downloadUrl = await getSignedDownloadUrl(path, 3600); // Valid for 1 hour

// Send this URL to client to download
res.json({ downloadUrl });
```

### Generate a signed upload URL

```typescript
// Client can upload directly to R2 using this URL
const uploadUrl = await getSignedUploadUrl(
  "recordings/user123/room456/1702000000.mp4",
  "video/mp4",
  3600
);

res.json({ uploadUrl });
```

### Check if file exists

```typescript
const exists = await checkFileExists("recordings/user123/room456/1702000000.mp4");
if (exists) {
  console.log("File found!");
}
```

### Delete a file

```typescript
await deleteFile("recordings/user123/room456/1702000000.mp4");
```

## API Reference

### `uploadVideo(buffer, remotePath, contentType)`

Upload a file to R2.

**Parameters:**
- `buffer: Buffer` - File content
- `remotePath: string` - Path in R2 (e.g., `recordings/userId/roomName/timestamp.mp4`)
- `contentType: string` - MIME type (default: `video/mp4`)

**Returns:** `Promise<string>` - Public URL of uploaded file

**Example:**
```typescript
const url = await uploadVideo(videoBuffer, "recordings/user1/room1/1702000000.mp4", "video/mp4");
```

---

### `getSignedDownloadUrl(remotePath, expiresIn)`

Generate a temporary signed URL for downloading a file.

**Parameters:**
- `remotePath: string` - Path in R2
- `expiresIn: number` - Expiration time in seconds (default: `3600`)

**Returns:** `Promise<string>` - Signed URL valid for specified duration

**Example:**
```typescript
const url = await getSignedDownloadUrl("recordings/user1/room1/1702000000.mp4", 7200);
// URL expires in 2 hours
```

---

### `getSignedUploadUrl(remotePath, contentType, expiresIn)`

Generate a temporary signed URL for uploading a file directly from the browser.

**Parameters:**
- `remotePath: string` - Path in R2
- `contentType: string` - MIME type (default: `video/mp4`)
- `expiresIn: number` - Expiration time in seconds (default: `3600`)

**Returns:** `Promise<string>` - Signed URL for direct upload

**Example:**
```typescript
const url = await getSignedUploadUrl(
  "recordings/user1/room1/1702000000.mp4",
  "video/mp4",
  3600
);
// Client can POST/PUT to this URL
```

---

### `deleteFile(remotePath)`

Delete a file from R2.

**Parameters:**
- `remotePath: string` - Path in R2

**Returns:** `Promise<void>`

**Example:**
```typescript
await deleteFile("recordings/user1/room1/1702000000.mp4");
```

---

### `checkFileExists(remotePath)`

Check if a file exists in R2.

**Parameters:**
- `remotePath: string` - Path in R2

**Returns:** `Promise<boolean>` - `true` if file exists, `false` otherwise

**Example:**
```typescript
const exists = await checkFileExists("recordings/user1/room1/1702000000.mp4");
if (exists) {
  console.log("File found!");
}
```

---

### `getFileMetadata(remotePath)`

Get metadata about a file (size, last modified, etc.).

**Parameters:**
- `remotePath: string` - Path in R2

**Returns:** `Promise<HeadObjectCommandOutput>` - File metadata object

**Example:**
```typescript
const metadata = await getFileMetadata("recordings/user1/room1/1702000000.mp4");
console.log("File size:", metadata.ContentLength);
console.log("Last modified:", metadata.LastModified);
```

---

### `generateRecordingPath(userId, roomName, timestamp)`

Generate a standardized path for recording files.

**Parameters:**
- `userId: string` - User ID
- `roomName: string` - Room name
- `timestamp: number` - Unix timestamp

**Returns:** `string` - Formatted path

**Example:**
```typescript
const path = generateRecordingPath("user123", "gaming-room", Date.now());
// Returns: "recordings/user123/gaming-room/1702000000.mp4"
```

---

### `generateThumbnailPath(userId, roomName, timestamp)`

Generate a standardized path for thumbnail files.

**Parameters:**
- `userId: string` - User ID
- `roomName: string` - Room name
- `timestamp: number` - Unix timestamp

**Returns:** `string` - Formatted path

**Example:**
```typescript
const path = generateThumbnailPath("user123", "gaming-room", Date.now());
// Returns: "thumbnails/user123/gaming-room/1702000000.jpg"
```

---

## File Path Structure

### Recordings
```
recordings/{userId}/{roomName}/{timestamp}.mp4
```

Example: `recordings/user123/gaming-room/1702000000.mp4`

### Thumbnails
```
thumbnails/{userId}/{roomName}/{timestamp}.jpg
```

Example: `thumbnails/user123/gaming-room/1702000000.jpg`

---

## Error Handling

All functions include try-catch blocks and throw descriptive errors:

```typescript
try {
  const url = await uploadVideo(buffer, path, "video/mp4");
} catch (error) {
  console.error("Upload failed:", error.message);
  // Handle error gracefully
}
```

---

## Integration with Multistream Routes

Example usage in `multistream.ts`:

```typescript
import { uploadVideo, generateRecordingPath } from "../lib/storageClient";

// When stream ends:
const recordingPath = generateRecordingPath(userId, roomName, Date.now());
const videoUrl = await uploadVideo(recordingBuffer, recordingPath, "video/mp4");

// Save to Firestore
await db.collection("recordings").add({
  userId,
  roomId: roomName,
  storagePath: recordingPath,
  publicUrl: videoUrl,
  title: `Stream - ${new Date().toLocaleString()}`,
  createdAt: new Date(),
  status: "ready",
});
```

---

## Notes

- All URLs are HTTPS
- Signed URLs include full query parameters for S3-compatible access
- Default expiration for signed URLs is 1 hour (3600 seconds)
- Public URLs are permanently available unless the file is deleted
- R2 is 10x cheaper than S3 and includes unlimited bandwidth
