# Quick Test: Timeline Phase 1 Improvements

## 30-Second Setup

```bash
# Terminal 1
cd streamline-client
npm run dev

# Terminal 2  
cd streamline-server
npm start
```

Open `http://localhost:5173`

---

## Quick Test Flow (2 minutes)

### Step 1: Record a Stream (30 seconds)
```
1. Click "Create Room"
2. Enter room name: "test-timeline"
3. Click "Start Stream"
4. Wait 20 seconds
5. Click "Stop Stream"
```

**Verify:** Recording shows on exit page, status="ready"

---

### Step 2: Navigate to Editor (30 seconds)
```
1. Click "✂️ Go to Editor" button
2. Wait for page to load
3. You should see:
   - Video preview at top (plays video)
   - Timeline at bottom with clip
   - Time controls on left
   - Export settings on right
```

**Verify:** Editor loads, video visible, timeline shows

---

### Step 3: Check Timeline Ruler (30 seconds)
```
1. Look at top of timeline (gray area)
2. You should see:
   - "0:00" at left
   - "0:05", "0:10", "0:15" etc. at intervals
   - Small tick marks between numbers
   - Light grid lines vertically
```

**Verify:** Time markers clear and readable ✅

---

### Step 4: Check Clip Styling (30 seconds)
```
1. Look at the clip block on timeline (blue)
2. You should see:
   - Blue gradient background
   - Clip title text
   - Duration at bottom (e.g., "0:10")
3. Click on the clip
   - It should glow with a ring
   - Yellow dot appears on left
   - Bright colors
```

**Verify:** Clip has professional styling ✅

---

### Step 5: Check Playhead (30 seconds)
```
1. Look at the timeline
2. You should see:
   - Red vertical line (playhead)
   - Triangle at top
   - Time label above (e.g., "0:00")
3. Click different positions on timeline
   - Red line moves to your click
   - Time label updates
```

**Verify:** Playhead clear and responsive ✅

---

### Step 6: Test Playback (30 seconds)
```
1. Click blue ▶ button (play)
2. Watch video in preview
3. Watch red playhead move on timeline
4. Red line should advance smoothly
5. Time label should update
6. Click ⏸ (pause) to stop
```

**Verify:** Playback and playhead sync ✅

---

### Step 7: Test Zoom (30 seconds)
```
1. Find zoom controls (+ and - buttons)
2. Click + button (zoom in)
   - Timeline should get wider
   - More time markers appear
   - Clip gets bigger
3. Click - button (zoom out)
   - Timeline gets narrower
   - Fewer markers visible
   - Clip gets smaller
```

**Verify:** Zoom responsive and smooth ✅

---

## All Tests Pass? 🎉

If you see all these:
- ✅ Clear time ruler
- ✅ Professional clip styling
- ✅ Visible playhead with time
- ✅ Smooth playback
- ✅ Responsive zoom

Then **Phase 1 is complete and working!**

---

## Screenshots to Look For

### Ruler
```
Expected:
┌─────────────────────────────┐
│ 0:00  0:05  0:10  0:15  0:20│  ← Time labels
│ |  | |  | |  | |  | |  | |  │  ← Tick marks
│ ├─────────────────────────┤ │  ← Grid lines
```

### Clip
```
Expected:
┌──────────────────────┐
│ My Video Recording   │  ← Name
│                      │
│                0:15  │  ← Duration
└──────────────────────┘
```

### Playhead
```
Expected:
       ┌─ Time label "0:05"
       │
       ▼
    ╔═════╗
    ║ 0:05║  Red glowing line
    ╚═════╝
      │
      │ Vertical line
      │ through timeline
      ▼
```

---

## Troubleshooting

### No time labels on ruler?
→ Check browser zoom is 100%
→ Clear browser cache
→ Reload page

### Clip not showing?
→ Recording might not be "ready"
→ Wait 30 seconds for processing
→ Check console for errors

### Playhead not moving?
→ Click on timeline to move it
→ Try clicking a different position
→ Verify video loaded

### Can't see trim handles?
→ Hover over the clip
→ They glow yellow on hover
→ They appear at left and right edges

---

## Next Phase

Once Phase 1 verified, Phase 2 adds:
- Drag trim handles to cut clips
- Drag clips to reorder
- Right-click menu for operations
- Keyboard shortcuts for editing

Ready to test? Go ahead and run the quick flow above!
