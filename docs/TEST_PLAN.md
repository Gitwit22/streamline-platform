# StreamLine - Complete Feature Test Plan

## 🎯 Main Workflow Test (5 minutes)

### Step 1: Start Recording
```
1. Navigate to your app
2. Go to /join
3. Enter a room name: "teststream"
4. Enter your display name: "TestHost"
5. Click "Join Room"
```

**Expected:**
- ✅ LiveKit room connects
- ✅ "🔴 RECORDING" indicator appears in bottom-left
- ✅ Indicator shows recording ID (rec_xxx)
- ✅ "👥 Viewers" counter shows at top-right

---

### Step 2: Stream (Simulate Activity)
```
6. Wait 10-15 seconds in the room
7. Video/audio controls are visible
```

**Expected:**
- ✅ Recording indicator stays visible
- ✅ Room shows other participants (if any)
- ✅ All streaming features work normally

---

### Step 3: End Stream
```
8. Click the "← Back" button (top-left)
```

**Expected:**
- ✅ Button text changes to "⏳ Ending..." and becomes disabled
- ✅ Recording stops
- ✅ Canonical post-stream page is `/room-exit/rec_xxx`
- ✅ Visiting `/stream-summary/rec_xxx` redirects to `/room-exit/rec_xxx` (legacy alias)
- ✅ RecordingID matches the one from indicator

---

### Step 4: Post-Stream Exit
```
On /room-exit page:
9. If a recording exists, try Download MP4
10. Confirm the signed link opens in a new tab
```

**Expected:**
- ✅ Download uses a signed link
- ✅ If the signed link is expired, UI suggests Emergency Download

---

### Step 5: Status Changes to Ready
```
11. Wait for the recording to become ready
```

**Expected:**
- ✅ Status changes from "⏳ Processing" to "✅ Ready!" (or similar)
- ✅ Green success message appears
- ✅ Three action buttons appear:
    - [ ] ✂️ Edit in StreamLine
    - [ ] 📚 View Asset Library
    - [ ] 📥 Download MP4

---

### Step 6: Edit in StreamLine
```
12. Click "✂️ Edit in StreamLine" button
```

**Expected:**
- ✅ Auto-redirect to `/editing/editor/new?recordingId=rec_xxx`
- ✅ Page loads timeline editor
- ✅ Video preview appears at top
- ✅ Project name shows: "Edit: Stream - [date]"

---

### Step 7: Test Timeline Editor
```
13. Click the Play button
14. Video plays in preview
15. Click on the timeline to seek
```

**Expected:**
- ✅ Play/Pause button toggles
- ✅ Video plays and audio works
- ✅ Playhead (red line) appears
- ✅ Time counter updates (MM:SS / MM:SS)
- ✅ Clicking timeline seeks video to that position

---

### Step 8: Test Split Tool
```
16. Click the ✂️ Split button
```

**Expected:**
- ✅ Clip on timeline splits into two pieces
- ✅ Both pieces still show correct duration
- ✅ Can split multiple times
- ✅ Timeline updates visually

---

### Step 9: Test Zoom
```
17. Click + button (zoom in) several times
18. Click - button (zoom out) several times
```

**Expected:**
- ✅ Timeline gets wider when zooming in
- ✅ Timeline fits more when zooming out
- ✅ Zoom percentage shows (50%, 100%, 150%, etc.)
- ✅ Zoom range: 50% - 300%

---

## 🎨 Asset Library Test (3 minutes)

### Access Asset Library
```
1. Click "📚 View Asset Library" from the exit page
   OR Navigate to /content
   OR Navigate to /editing/assets (legacy redirect)
```

**Expected:**
- ✅ Page shows "Asset Library" title
- ✅ "X recordings • Y assets" counter

---

### Check Recording
```
2. Scroll to top
3. Look for "Recent Stream Recordings" section
```

**Expected:**
- ✅ Your recording appears in GREEN card
- ✅ Shows recording title
- ✅ Shows duration (MM:SS)
- ✅ "Ready" badge appears
- ✅ ✂️ Edit This button visible

---

### Test Filters
```
4. Click "All Assets" tab
5. Click "From Streams" tab
6. Click "Uploads" tab
7. Click "Recent Streams (1)" tab
```

**Expected:**
- ✅ Each tab shows different content
- ✅ Recording appears ONLY in green "Recent Streams" tab
- ✅ Sample assets appear in other tabs
- ✅ Active tab is highlighted in blue

---

### Test Search
```
8. Type "Stream" in search box
```

**Expected:**
- ✅ Results filter instantly
- ✅ Only items with "Stream" show
- ✅ Clearing search shows all again

---

## 📁 Projects Dashboard Test (2 minutes)

### Create New Project
```
1. From Asset Library, click "View Projects"
   OR Navigate to /projects
   OR Navigate to /editing/projects (legacy redirect)
```

**Expected:**
- ✅ Page shows "Your Projects" title
- ✅ "X / 100 projects used" counter
- ✅ "+ New Project" button visible

---

### Create Project Modal
```
2. Click "+ New Project" button
3. See modal form
```

**Expected:**
- ✅ Modal appears with overlay
- ✅ "Select asset" dropdown
- ✅ "Project name" input field
- ✅ Cancel and Create buttons

---

### Complete Project Creation
```
4. Select an asset from dropdown
5. Type project name: "Test Project"
6. Click Create button
```

**Expected:**
- ✅ Modal closes
- ✅ Auto-redirect to editor: `/editing/editor/proj_xxx`
- ✅ Project name shows in editor
- ✅ Video loads in preview

---

### Project Card Actions
```
7. Back to /projects
8. See your new project card
```

**Expected:**
- ✅ Shows project thumbnail
- ✅ Shows project name
- ✅ Shows duration
- ✅ Shows status badge (draft/complete/rendering)
- ✅ Three action buttons:
    - [ ] Open Editor (blue)
    - [ ] Dup (duplicate)
    - [ ] Del (delete)

---

## 🔄 Persistence Test (1 minute)

### Recording Survives Refresh
```
1. Complete a short recording (host joins, then ends the session)
2. Navigate to the Asset Library
3. Refresh the page (F5)
4. Navigate back to the Asset Library
```

**Expected:**
- ✅ Recording still appears after refresh
- ✅ Same recording ID
- ✅ Status reflects backend state (e.g., ready/rendering/complete)

Optional verification:
- In DevTools Network tab, confirm the Asset Library loads recordings from the API (not localStorage)

---

## 🎬 Full User Journey Summary

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Join room | Recording starts automatically |
| 2 | Wait 10s | "🔴 RECORDING" indicator visible |
| 3 | End stream | Redirect to exit page (`/room-exit/:recordingId`) |
| 4 | Wait | Exit page status becomes ready |
| 5 | Status ready | Action buttons appear (Edit/Library/Download) |
| 6 | Click Edit | Timeline editor opens with video |
| 7 | Play video | Video plays in preview |
| 8 | Click timeline | Playhead seeks to position |
| 9 | Click Split | Clip splits into two pieces |
| 10 | Zoom in/out | Timeline scale adjusts |
| 11 | Go to Assets | Recording shows in green |
| 12 | Go to Projects | Can create new project |
| 13 | Refresh page | Recording still appears (backend persistence) |

---

## ✅ Success Criteria

All of the following should work:

- [ ] Recording auto-starts when user enters room
- [ ] Recording indicator shows with ID
- [ ] Recording stops when user leaves
- [ ] Auto-redirect to the exit page (`/room-exit/:recordingId`)
- [ ] Exit page shows a clear status (e.g., rendering/ready)
- [ ] Download actions work when recording is ready (when storage is configured)
- [ ] Edit button redirects to editor with video loaded
- [ ] Video player controls work (play, pause, seek)
- [ ] Timeline shows clip with correct duration
- [ ] Split button creates two clips
- [ ] Zoom buttons adjust timeline scale
- [ ] Asset Library shows recording in green
- [ ] Asset Library filters work
- [ ] Asset Library search works
- [ ] Projects Dashboard shows projects
- [ ] New Project modal works
- [ ] Projects can be created and edited
- [ ] Recording data persists via backend (refresh-safe)
- [ ] No console errors

---

## 🐛 If Something Breaks

### Common Issues

**Recording doesn't start:**
- Check browser console for errors
- Verify the server is running and `/api/*` calls succeed
- Verify entitlements/permissions allow recording for the current role

**Recording not ready / download fails:**
- Check DevTools Network tab for failed requests
- Confirm the signed download link endpoint returns `200` (or a clear `402/410`)
- If the signed link is expired, use Emergency Download in Settings → Usage

**Editor doesn't open:**
- Check routing: App.tsx has `/editing/editor/:projectId` route
- Verify EditorPage.tsx has all imports
- Check recordingId in URL query params

**Video doesn't load:**
- Video URL is hardcoded to BigBuckBunny sample
- Should always work (public CORS-enabled URL)
- Check browser console for CORS errors

**Data not persisting:**
- Check Firestore permissions and server logs
- Confirm the recording document is being created/updated

---

## 📊 Performance Notes

- Performance depends on LiveKit + storage + backend processing
- Expect normal API network calls to `/api/*`
- Should be instant on modern browsers

---

## 🎉 Expected Final State

After completing all tests, you should see:

1. **In Asset Library:**
   - Recording visible in green card
   - Can see recording title and duration

2. **In Timeline Editor:**
   - Video playing in preview
   - Working playhead
   - Working timeline scrubber
   - Working split tool

3. **Browser console:**
   - No errors
   - No repeated failing `/api/*` requests

---

**Happy testing! 🚀**
