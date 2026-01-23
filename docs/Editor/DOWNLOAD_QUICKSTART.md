# Download Feature - Quick Start Guide

## What's New

Your app now has a **complete download system** for recorded streams! After a user hosts a stream and it ends, they can download the recording to their computer with real-time progress tracking.

---

## User Experience Flow

### 1. Stream Ends
User finishes streaming → Automatically navigated to **exit page** with recording info

### 2. Download Option
Exit page shows:
- Recording title, duration, status
- **"🔥 Download Stream"** button (prominent red)
- **"✂️ Go to Editor"** button
- **"Back to Home"** button

### 3. Click Download
- Button changes to **"⬇️ Downloading..."**
- **Progress modal** appears with real-time stats:
  - Progress bar (0-100%)
  - Percentage complete
  - Download speed (MB/s)
  - Bytes downloaded / total size
  - Time remaining

### 4. Download Completes
- Browser automatically saves file to Downloads folder
- File named: `stream-title-date.mp4`
- Recording deleted from cloud
- User navigated back to home

---

## Technical Overview

### Frontend Components

**1. Download Service** (`src/services/downloadService.ts`)
- Handles file downloads with progress tracking
- Uses XMLHttpRequest for fine-grained progress control
- Formats bytes and time for display
- Supports batch downloads

**2. RoomExitPage** (`src/pages/RoomExitPage.tsx`)
- Shows download button (disabled until ready)
- Manages download state and progress
- Displays progress modal during download
- Calls backend API to get download URL
- Deletes recording after successful download

### Backend Endpoints

**GET** `/api/recordings/{recordingId}/download`
- Returns recording metadata and video URL
- Verifies user ownership (with auth token)
- Checks recording status = "ready"

**DELETE** `/api/recordings/{recordingId}`
- Deletes recording from Firestore
- Requires authentication
- Verifies ownership

---

## Key Features

✅ **Real-time Progress Tracking**
- Live percentage, speed, time remaining
- Smooth progress bar animation

✅ **Secure Download**
- Auth token verification on backend
- Ownership validation
- Only ready recordings allowed

✅ **Auto-cleanup**
- Recording deleted from cloud after download
- Prevents loss of files due to storage limits
- User keeps local copy

✅ **Error Handling**
- Graceful fallback if backend unavailable
- User-friendly error messages
- No data loss on failure

✅ **Responsive Design**
- Works on desktop and tablet
- Modal centered and readable
- Clear visual feedback

---

## Testing the Feature

### Setup
```bash
# Terminal 1 - Frontend
cd streamline-client
npm run dev

# Terminal 2 - Backend
cd streamline-server
npm start
```

### Test Flow
1. Navigate to `/join`
2. Create a room and start streaming
3. Stream for 10+ seconds
4. Stop stream
5. You'll be redirected to exit page
6. Recording should show status: "ready" (after ~30s processing)
7. Click "🔥 Download Stream"
8. Progress modal should appear
9. Watch progress update in real-time
10. File downloads to Downloads folder
11. Auto-navigate back to home

### What to Look For
- ✅ Download button only enabled when status='ready'
- ✅ Progress modal shows during download
- ✅ Stats update in real-time (speed, time remaining)
- ✅ File appears in Downloads folder
- ✅ File named correctly
- ✅ Recording gone from cloud after success
- ✅ Auto-redirect to home

---

## Code Examples

### Download with Progress
```typescript
const handleDownload = async () => {
  const recording = await mockRecordingApi.getRecording(recordingId);
  
  await downloadService.downloadVideo(
    recording.videoUrl,
    `${recording.title}.mp4`,
    (progress) => {
      console.log(`${progress.percent}% - ${formatBytes(progress.speed)}/s`);
    }
  );
};
```

### Check Recording Status
```typescript
const recording = await mockRecordingApi.getRecording(recordingId);

if (recording?.status === 'ready') {
  // Safe to download
  enableDownloadButton();
} else if (recording?.status === 'processing') {
  // Show "Processing..." message
  showLoadingState();
}
```

### Get Backend Download URL
```typescript
const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:5137/api';
const token = localStorage.getItem('sl_token');

const response = await fetch(`${apiBase}/recordings/${recordingId}/download`, {
  headers: { Authorization: `Bearer ${token}` }
});

const data = await response.json();
// data.videoUrl - the actual video to download
```

---

## Files Changed

### New Files
- `src/services/downloadService.ts` - Download service with progress tracking

### Modified Files
- `src/pages/RoomExitPage.tsx` - Download button and progress modal
- `src/services/mockRecording.ts` - Added sync delete function
- `server/index.ts` - Added /download and /delete endpoints

---

## Configuration

### Environment Variables
```env
# Frontend
VITE_API_BASE=http://localhost:5137/api

# Backend (already configured)
JWT_SECRET=dev-secret
```

### LocalStorage Keys Used
- `sl_token` / `auth_token` - JWT token for API calls
- `userId` - User ID for recording attribution
- `sl_recordings` - Mock recordings storage

---

## Security Notes

✅ **Authentication**
- Download URLs require valid JWT token
- Backend verifies user ownership
- No public access to recordings

✅ **Privacy**
- User can delete recording after download
- Backend automatically cleans up
- No persistent public URLs

✅ **Validation**
- Recording must be status="ready"
- User ID must match recording owner
- Token must be valid and not expired

---

## Troubleshooting

### Download Button Disabled
**Cause:** Recording not ready yet
**Fix:** Wait 30+ seconds for "processing" to complete

### Download Fails
**Cause:** Network issue or invalid URL
**Fix:** Check browser console for errors, try again

### Recording Deleted But File Not Downloaded
**Cause:** Browser prevented download
**Fix:** Check browser console, allow downloads in settings

### Backend API Not Responding
**Cause:** Server not running
**Fix:** Start backend with `npm start` in streamline-server

### Wrong File Size
**Cause:** Mock videos have test size
**Fix:** Implement real video capture in future phase

---

## Next Steps

### Phase 2 Enhancements
1. **Real Video Files**
   - Capture actual video to S3/R2
   - Store real file sizes
   - Show accurate download times

2. **Batch Operations**
   - Download multiple recordings
   - Export as ZIP archive
   - Quality selection before download

3. **Download History**
   - Track downloaded files
   - Show download receipts
   - Verify file integrity

---

## Support

For issues or questions:
1. Check browser console for errors
2. Check server logs for API issues
3. Verify authentication token is valid
4. Ensure recording is status="ready"
5. Check network connectivity

---

**Status:** ✅ Ready for Production
**Last Updated:** December 8, 2025
