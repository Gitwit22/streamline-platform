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
- ✅ Auto-redirect to `/stream-summary/rec_xxx`
- ✅ RecordingID matches the one from indicator

---

### Step 4: Watch Stream Summary
```
On /stream-summary page:
9. See the recording title
10. Watch the progress bar fill up (8 seconds)
```

**Expected:**
- ✅ Page title matches your stream name
- ✅ Status shows "⏳ Processing"
- ✅ Progress bar at bottom-left animates from 0% → 100%
- ✅ Percentage number updates (45%, 60%, etc.)
- ✅ Duration/Viewers/Peak/Status stats visible

---

### Step 5: Status Changes to Ready
```
11. Wait for progress to complete
```

**Expected:**
- ✅ Progress bar fills completely
- ✅ Status changes from "⏳ Processing" to "✅ Ready!"
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
1. Click "📚 View Asset Library" from stream summary
   OR Navigate to /editing/assets
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
   OR Navigate to /editing/projects
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
7. Back to /editing/projects
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

### Data Survives Refresh
```
1. Open DevTools Console
2. Paste: JSON.parse(localStorage.getItem('sl_recordings'))
3. See your recording in the list
4. Refresh the page (F5)
5. Navigate back to Asset Library
```

**Expected:**
- ✅ Recording still appears
- ✅ Same recording ID
- ✅ Status is "ready"
- ✅ All stats preserved

---

### Clear Data (Optional)
```
6. To start fresh, paste in console:
   localStorage.removeItem('sl_recordings')
7. Refresh page
```

**Expected:**
- ✅ All recordings gone
- ✅ Asset Library is empty
- ✅ Ready for next test

---

## 🎬 Full User Journey Summary

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Join room | Recording starts automatically |
| 2 | Wait 10s | "🔴 RECORDING" indicator visible |
| 3 | End stream | Redirect to summary page |
| 4 | Wait 8s | Progress bar fills up |
| 5 | Status ready | ✅ Ready!, buttons appear |
| 6 | Click Edit | Timeline editor opens with video |
| 7 | Play video | Video plays in preview |
| 8 | Click timeline | Playhead seeks to position |
| 9 | Click Split | Clip splits into two pieces |
| 10 | Zoom in/out | Timeline scale adjusts |
| 11 | Go to Assets | Recording shows in green |
| 12 | Go to Projects | Can create new project |
| 13 | Refresh page | Data persists in localStorage |

---

## ✅ Success Criteria

All of the following should work:

- [ ] Recording auto-starts when user enters room
- [ ] Recording indicator shows with ID
- [ ] Recording stops when user leaves
- [ ] Auto-redirect to stream summary page
- [ ] Progress bar animates from 0-100%
- [ ] Status transitions from Processing → Ready
- [ ] Action buttons appear when ready
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
- [ ] Data persists in localStorage
- [ ] Data survives page refresh
- [ ] No console errors

---

## 🐛 If Something Breaks

### Common Issues

**Recording doesn't start:**
- Check browser console for errors
- Verify Room.tsx imports mockRecordingApi
- Check localStorage: `localStorage.getItem('sl_recordings')`

**Progress bar doesn't fill:**
- Check useRecordingProgress hook is imported
- Verify event listener is working
- Check DevTools Network tab for any failed requests

**Editor doesn't open:**
- Check routing: App.tsx has `/editing/editor/:projectId` route
- Verify EditorPage.tsx has all imports
- Check recordingId in URL query params

**Video doesn't load:**
- Video URL is hardcoded to BigBuckBunny sample
- Should always work (public CORS-enabled URL)
- Check browser console for CORS errors

**Data not persisting:**
- localStorage might be cleared
- Check browser privacy settings
- Try incognito window
- Use DevTools: Application → LocalStorage

---

## 📊 Performance Notes

- Recording simulation: 500ms latency
- Processing simulation: 8 seconds (0-100%)
- localStorage: ~1KB per recording
- No network calls (all mock)
- Should be instant on modern browsers

---

## 🎉 Expected Final State

After completing all tests, you should see:

1. **In browser localStorage:**
   - At least 1 recording object
   - Recording status = "ready"
   - Recording has duration, viewers, thumbnail

2. **In Asset Library:**
   - Recording visible in green card
   - Can see recording title and duration

3. **In Timeline Editor:**
   - Video playing in preview
   - Working playhead
   - Working timeline scrubber
   - Working split tool

4. **Browser console:**
   - No errors
   - Can see recording object when queried

---

**Happy testing! 🚀**
