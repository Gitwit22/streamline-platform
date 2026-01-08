# Video Editor - Quick Start Guide

## Getting Started

### Opening the Editor

1. **From Asset Library**
   - Go to Asset Library
   - Click any asset to edit
   - Editor opens with asset pre-loaded

2. **From Projects Dashboard**
   - Click "Edit Project"
   - Existing clips load automatically

3. **Creating New Project**
   - Click "New Project" button
   - Empty project opens with sample clip

## Basic Workflow

### 1. Load Your Video
```
Asset Library → Select Video → Editor Opens
```
Video appears in preview area automatically.

### 2. Set Playhead Position
Click anywhere on the timeline to position the red playhead where you want to edit.

```
TIMELINE VIEW
┌──────────────────────────────────────┐
│ 0s  5s  10s  15s  20s  25s  30s      │
│ ┌─────────────────────────┐          │
│ │  Clip 1 (30s)       ║   │          │
│ └─────────────────────────┘          │
│                         ↑
│                    Click here to seek
└──────────────────────────────────────┘
```

### 3. Play and Review
- **Space** or **▶ Button** - Play/Pause
- **⏮ Button** - Go to start
- **⏭ Button** - Go to end
- **← / →** - Jump 1 second (Shift: 5 seconds)

### 4. Edit Your Video

#### Split a Clip
Split a video into two parts at the playhead position.

```
Before:
┌─────────────────────────────────────┐
│  Original Clip (30 seconds)         │
└─────────────────────────────────────┘

After pressing 'S' at 15 seconds:
┌──────────────────────┐┌──────────────┐
│  Clip 1 (15s)      │ │ Clip 2 (15s) │
└──────────────────────┘└──────────────┘
```

**How to split:**
1. Position playhead where you want to cut
2. Press **S** or click **✂️ Split at Playhead**
3. Clip splits into two pieces

#### Trim a Clip
Remove material from the end of a clip (from playhead onwards).

```
Before:
┌─────────────────────────────────────┐
│  Clip (30 seconds)                  │
└─────────────────────────────────────┘

After trimming at 15 seconds:
┌──────────────────────┐
│  Clip (15s)         │
└──────────────────────┘
```

**How to trim:**
1. Select a clip (click on it - it highlights blue)
2. Position playhead where you want to trim
3. Click **📏 Trim to Playhead**
4. Everything after playhead is removed

#### Delete a Clip
Remove a clip entirely from the timeline.

**How to delete:**
1. Click clip to select it
2. Press **Delete** or click **🗑️ Delete Clip**
3. Clip is removed

### 5. Arrange Clips
Position clips on timeline at specific times.

```
Drag edges to adjust timing:
┌─────────┐     ┌──────────┐
│ Clip 1  │ gap │ Clip 2   │
└─────────┘     └──────────┘
                ↑
            Drag to move
```

Click and drag clip positions to rearrange.

### 6. Export Your Video
1. Choose **Resolution** (right sidebar)
   - 720p (HD) - Always available
   - 1080p (Full HD) - Requires Professional plan
   - 4K - Requires Enterprise plan

2. Choose **Format**
   - MP4 - Universal compatibility
   - WebM - Smaller file size

3. Click **[EXPORT VIDEO →]** button

4. Video renders and downloads automatically

## UI Breakdown

### Left Sidebar (Tools)
```
┌──────────────────────┐
│ TOOLS                │
├──────────────────────┤
│ ✂️ Split at Playhead │ ← Press 'S' for shortcut
│ 📏 Trim to Playhead  │ ← Grayed out if no clip selected
│ 🗑️ Delete Clip       │ ← Press 'Delete' for shortcut
├──────────────────────┤
│ Selected Clip Info   │
│ ─────────────────────│
│ Name: Intro Video    │
│ Duration: 00:30:00   │
├──────────────────────┤
│                      │
│  [spacer]            │
│                      │
├──────────────────────┤
│ PLAN LIMITS          │
│ Tracks: 3            │
│ Projects: 10         │
│ AI tools locked 🔒   │
└──────────────────────┘
```

### Center (Main Editor)
```
┌─────────────────────────────────┐
│ [← Projects] Untitled Project    │
├─────────────────────────────────┤
│                                 │
│      🎬 VIDEO PREVIEW           │
│      (Shows current frame)       │
│                                 │
├─────────────────────────────────┤
│ [⏮] [▶] [⏭] | 00:15:00 / 00:30:00 │
│                    [−] 100% [+]  │
├─────────────────────────────────┤
│ TIME RULER:  0s  5s  10s  15s   │
│ Video 1 │ ┌──────┐              │
│         │ │Clip 1│              │
│         └─┴──────┴──────────────│
│           ↑ Playhead            │
└─────────────────────────────────┘
```

### Right Sidebar (Export)
```
┌──────────────────────┐
│ EXPORT SETTINGS      │
├──────────────────────┤
│ Resolution           │
│ [720p         ▼]    │
│  • 720p HD           │
│  • 1080p Full HD    │
│  • 4K Ultra HD 🔒   │
├──────────────────────┤
│ Format               │
│ [MP4          ▼]    │
│  • MP4               │
│  • WebM              │
├──────────────────────┤
│ [EXPORT VIDEO →]     │
├──────────────────────┤
│                      │
│  [spacer]            │
│                      │
├──────────────────────┤
│ PROJECT INFO         │
│ Duration: 00:30:00   │
│ Clips: 1             │
│                      │
│ Tip: Space = Play    │
└──────────────────────┘
```

## Common Editing Tasks

### Task 1: Create Highlights Reel
```
Goal: Extract best moments from long recording

1. Load 1-hour stream recording
2. Seek to interesting moment (click timeline)
3. Split at start: Press 'S'
4. Seek to end of interesting part
5. Split at end: Press 'S'
6. Delete the parts you don't want
7. Repeat until only highlights remain
8. Export as MP4 (720p)
```

### Task 2: Combine Multiple Clips
```
Goal: Create montage from different recordings

1. Create new project
2. Add first clip
3. Click timeline at end of first clip
4. Add second clip (starts where first ends)
5. Position clips with drag handles
6. Export combined video
```

### Task 3: Remove Mistakes
```
Goal: Cut out awkward moments

1. Seek to mistake start
2. Split: Press 'S'
3. Seek to mistake end
4. Split: Press 'S'
5. Click middle clip to select
6. Delete: Press 'Delete'
7. Export corrected video
```

### Task 4: Adjust Clip Duration
```
Goal: Shorten a clip without cutting

1. Click clip to select (blue highlight)
2. Position playhead where you want it to end
3. Click "📏 Trim to Playhead"
4. Everything after playhead removed
5. Repeat for other clips as needed
```

## Keyboard Shortcuts

```
PLAYBACK:
  Space     Play/Pause
  ⏮        Go to start (button)
  ⏭        Go to end (button)

NAVIGATION:
  ←        Jump back 1 second
  →        Jump forward 1 second
  Shift+← Jump back 5 seconds
  Shift+→ Jump forward 5 seconds

EDITING:
  S        Split at playhead
  Delete   Delete selected clip
  Backspace Delete selected clip (alternative)

TIPS:
  - Don't hold modifier keys while typing
  - Select a clip before deleting
  - Playhead position matters for split/trim
```

## Tips & Tricks

### ⚡ Pro Tips
1. **Use zoom** - Zoom in (+ button) for precise editing
2. **Play as you edit** - Hit Space to preview your work
3. **Save frequently** - Click 💾 Save often
4. **Check your work** - Play full video before export
5. **Use keyboard** - Faster than clicking (Space, S, Delete)

### 🎯 Best Practices
1. **Start with a copy** - Test edits on backup
2. **Name your project** - Give it a descriptive name
3. **Plan your cuts** - Know where you want to edit
4. **Review first** - Watch entire video before editing
5. **Export format** - MP4 works everywhere

### ⚠️ Common Mistakes
1. **Forgetting to split** - Use S to cut, not delete
2. **Wrong zoom level** - Zoom in for precision
3. **Lost changes** - Remember to click Save!
4. **Exporting too big** - 4K files are huge
5. **Moving wrong clip** - Select before dragging

## Troubleshooting

### Video Not Playing
- **Check**: Is video loaded in preview?
- **Fix**: Click timeline to load video
- **Try**: Refresh page if stuck

### Can't Split Video
- **Check**: Is playhead in a clip?
- **Fix**: Position playhead inside clip area
- **Try**: Click timeline first, then press 'S'

### Export Not Working
- **Check**: Do you have clips?
- **Fix**: Timeline must have at least 1 clip
- **Check**: Plan allows this resolution?
- **Try**: Switch to 720p if locked

### Video Looks Choppy
- **Check**: Browser performance
- **Try**: Close other tabs
- **Try**: Refresh editor
- **Note**: Playback is preview only

## Getting Help

### In the Editor
- **Hover** over buttons to see tooltips
- **Check** right sidebar for plan info
- **Read** this guide for detailed help

### Plan Limitations
```
FREE Plan:
✓ 720p resolution
✓ MP4 format
✓ 3 tracks
✓ 5 projects
✗ 1080p/4K locked
✗ AI tools locked

PRO Plan:
✓ 1080p resolution
✓ MP4, WebM formats
✓ Unlimited tracks
✓ 50 projects
✓ Basic AI tools
✗ 4K locked
✗ Advanced AI locked

ENTERPRISE:
✓ 4K resolution
✓ All formats
✓ Unlimited everything
✓ All AI tools
✓ Priority support
```

## Keyboard Reference Card

```
╔════════════════════════════════════════╗
║        EDITOR KEYBOARD SHORTCUTS       ║
╠════════════════════════════════════════╣
║ SPACE        Play/Pause                ║
║ S            Split at Playhead         ║
║ ←/→          Seek ±1 second            ║
║ Shift←/→     Seek ±5 seconds           ║
║ DELETE       Delete selected clip      ║
║ BACKSPACE    Delete selected clip      ║
╚════════════════════════════════════════╝
```

---

**Last Updated**: 2024
**Version**: 1.0
**Status**: Ready to Use ✅

For video tutorials, visit: [streamline.demo](https://streamline.demo)
