# Timeline Styling Roadmap - Build Piece by Piece

## Current State
The timeline exists and works functionally, but needs visual polish. We'll improve it **incrementally** so you can verify each piece.

---

## Phase 1: Timeline Visual Foundation

### Step 1.1: Enhance Ruler & Time Markers
**File:** `src/editing/EditorPage.tsx` (Timeline section)

**Goal:** Make time ruler clear with markers every second

**Changes Needed:**
- Add grid lines to timeline
- Add time text labels (0:00, 0:05, 0:10, etc.)
- Add waveform background (optional)
- Improve playhead styling

**Verification Point:** 
- Can clearly see where in the video you are
- Time markers help with precise editing

---

### Step 1.2: Improved Clip Rendering
**File:** `src/editing/EditorPage.tsx` (Clip rendering)

**Goal:** Make clips visually distinct and interactive

**Changes Needed:**
- Better clip background color (blue gradient)
- Show clip name on clip itself
- Add duration text
- Highlight selected clips
- Add visual feedback on hover

**Verification Point:**
- Clips look like actual video segments
- Clear which clip is selected
- Duration visible at a glance

---

### Step 1.3: Better Playhead & Controls
**File:** `src/editing/EditorPage.tsx` (Playhead rendering)

**Goal:** Make playhead position crystal clear

**Changes Needed:**
- Red/bright playhead line (vertical)
- Playhead position indicator at top
- Smooth playhead movement
- Current time display above playhead

**Verification Point:**
- Know exactly where in video you're looking
- Can click to move playhead precisely

---

## Phase 2: Interactive Editing UI

### Step 2.1: Trim Handles on Clips
**File:** `src/editing/EditorPage.tsx`

**Goal:** Visual trim handles at clip edges that users can drag

**Changes Needed:**
- Left edge: resize handle (drag left/right to trim start)
- Right edge: resize handle (drag left/right to trim end)
- Hover effect shows handles
- Numbers show new duration as you drag

**Verification Point:**
- Can visually grab and drag clip edges
- See duration change in real-time
- Video reflects trimmed portion

---

### Step 2.2: Drag to Reorder Clips
**File:** `src/editing/EditorPage.tsx`

**Goal:** Users can drag clips left/right on timeline

**Changes Needed:**
- Detect mouse down on clip
- Track mouse movement
- Show ghost clip while dragging
- Update startTime on drop
- Re-order clips in timeline

**Verification Point:**
- Can grab and drag clips around
- Timeline rearranges
- Video playback respects new order

---

### Step 2.3: Clip Selection & Context Menu
**File:** `src/editing/EditorPage.tsx`

**Goal:** Right-click context menu with clip operations

**Changes Needed:**
- Right-click on clip
- Show menu: Split, Trim, Delete, Copy
- Execute operation
- Close menu

**Verification Point:**
- Right-click shows menu
- Operations work correctly
- Menu closes after action

---

## Phase 3: Timeline Information Display

### Step 3.1: Timeline Metrics Panel
**File:** `src/editing/EditorPage.tsx`

**Goal:** Show editing stats in sidebar

**Information to Display:**
- Project name (editable)
- Total duration
- Number of clips
- Selected clip duration
- Selected clip position

**Verification Point:**
- Stats update as you edit
- Can see project overview at glance

---

### Step 3.2: Waveform Display (Optional)
**File:** `src/editing/EditorPage.tsx`

**Goal:** Show audio waveform in clip background

**Note:** This is advanced - shows where sound is loud

**Verification Point:**
- Can see audio levels visually
- Helps identify silent parts to cut

---

## Phase 4: Export Implementation

### Step 4.1: Export Panel
**File:** `src/editing/EditorPage.tsx`

**Goal:** Create export dialog with options

**Options Needed:**
```
┌─ Export Settings
├─ Resolution
│  ├─ 720p
│  ├─ 1080p
│  └─ 4K
├─ Format
│  ├─ MP4
│  ├─ WebM
│  └─ MOV
└─ Quality
   ├─ Draft
   ├─ Standard
   └─ High
```

**Verification Point:**
- Dialog opens when clicking export
- Can select all options
- Settings persist

---

### Step 4.2: Export Button & Handler
**File:** `src/editing/EditorPage.tsx`

**Goal:** Wire export button to backend

**Backend Endpoint Needed:**
```
POST /api/editing/export
Body: {
  projectId: string,
  clips: TimelineClip[],
  format: 'mp4' | 'webm' | 'mov',
  resolution: '720p' | '1080p' | '4k',
  quality: 'draft' | 'standard' | 'high'
}
Response: {
  exportId: string,
  status: 'queued'
}
```

**Verification Point:**
- Click export button
- Settings sent to backend
- Receive exportId

---

### Step 4.3: Export Progress Tracking
**File:** `src/editing/EditorPage.tsx`

**Goal:** Show export progress as video is processed

**Display:**
- Progress bar (0-100%)
- "Processing..." message
- Estimated time remaining
- Cancel button

**Verification Point:**
- Progress updates in real-time
- Can see processing happening
- Can cancel if needed

---

### Step 4.4: Download Trigger
**File:** `src/editing/EditorPage.tsx`

**Goal:** When export completes, download file

**Flow:**
1. Export completes
2. Get download URL from backend
3. Trigger browser download
4. User gets file in Downloads folder

**Verification Point:**
- File appears in Downloads
- Can open in media player
- Has correct name and format

---

## Implementation Order (Build Piece by Piece)

```
Week 1: Timeline Foundation
  ✅ 1.1: Ruler & time markers
  ✅ 1.2: Improved clip styling
  ✅ 1.3: Better playhead

Week 2: Interactive Features
  ✅ 2.1: Trim handles
  ✅ 2.2: Drag to reorder
  ✅ 2.3: Context menu

Week 3: Polish & Info
  ✅ 3.1: Metrics panel
  ⏳ 3.2: Waveform (optional)

Week 4: Export
  ✅ 4.1: Export panel
  ✅ 4.2: Backend integration
  ✅ 4.3: Progress tracking
  ✅ 4.4: Download trigger
```

---

## Code Structure Overview

### Timeline Component Breakdown
```
EditorPage.tsx
├─ Main Layout
│  ├─ Left Sidebar (Tools)
│  ├─ Center (Preview + Timeline)
│  └─ Right Sidebar (Properties)
│
├─ Preview Section
│  ├─ Video element
│  └─ Playback controls
│
├─ Timeline Section
│  ├─ Ruler (with time markers)
│  ├─ Clips area (with draggable clips)
│  ├─ Playhead indicator
│  └─ Scrollable container
│
└─ Export Section
   ├─ Export button
   ├─ Settings dialog
   ├─ Progress modal
   └─ Download trigger
```

---

## Testing Each Piece

### For Ruler & Time Markers (Step 1.1)
```
Test: Can I see time labels?
Test: Are they spaced evenly?
Test: Do they update when I zoom?
```

### For Clip Styling (Step 1.2)
```
Test: Do clips look like video segments?
Test: Can I see clip names?
Test: Does selection highlight work?
```

### For Playhead (Step 1.3)
```
Test: Is playhead clearly visible?
Test: Can I click anywhere to move it?
Test: Does video preview update?
```

### For Trim Handles (Step 2.1)
```
Test: Do handles appear on hover?
Test: Can I drag left edge?
Test: Can I drag right edge?
Test: Duration updates correctly?
```

### For Export (Step 4)
```
Test: Does dialog open?
Test: Can I select options?
Test: Does backend receive settings?
Test: Does progress show?
Test: Does file download?
```

---

## Key Files to Modify

1. **src/editing/EditorPage.tsx** - Main editor component
   - Timeline rendering (500+ lines)
   - Clip interactions
   - Export controls

2. **src/editing/components/** - Modular components (to create)
   - TimelineRuler.tsx
   - TimelineClip.tsx
   - PlayheadCursor.tsx
   - ExportDialog.tsx
   - ProgressModal.tsx

3. **server/routes/editing.ts** - Backend processing
   - POST /api/editing/export endpoint
   - Video processing logic
   - File encoding

4. **src/services/downloadService.ts** - Already exists
   - Export uses this for final download

---

## Next Action

**Ready to start with Step 1.1?**

I can immediately:
1. Add ruler with time markers
2. Improve clip rendering
3. Enhance playhead styling

Then you verify each piece works before moving to interactive features.

Which would you like to tackle first?
