# Editor Layout & Component Guide

## Overall Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TOP BAR (h-12)                                     │
│  [← Projects] [Project Name] ............ [💾 Save] [Export →]             │
├─────────────────────────────────────────────────────────────────────────────┤
│       │                                                          │           │
│       │                                                          │           │
│ LEFT  │          CENTER - PREVIEW + TIMELINE                   │  RIGHT    │
│SIDEBAR│                                                         │ SIDEBAR   │
│ w-52  │                                                         │  w-56     │
│       │  ╔════════════════════════════════════════════════╗    │           │
│       │  ║                                                ║    │           │
│       │  ║          VIDEO PREVIEW AREA                   ║    │ EXPORT    │
│       │  ║     (Shows current frame)                     ║    │ SETTINGS  │
│       │  ║                                                ║    │           │
│       │  ╚════════════════════════════════════════════════╝    │ - Res:    │
│       │                                                         │  720p     │
│  Tools│  PLAYBACK CONTROLS h-14                               │  1080p    │
│       │  [⏮] [▶/⏸] [⏭] | --:--:-- / --:--:-- | [-] 100% [+]   │ - Fmt:    │
│ •Split│                                                         │  MP4      │
│ •Trim │  TIMELINE (h-40)                                       │           │
│ •Del  │  ┌─────────────────────────────────────────────────┐  │ [EXPORT] │
│       │  │ Time Ruler: 0s | 5s | 10s | 15s | 20s | 25s     │  │           │
│       │  ├─────────────────────────────────────────────────┤  │           │
│       │  │ Video 1  ┌─────────────────────┐               │  │ Project   │
│       │  │          │ Clip 1  (15s)  ⊡─⊡ │               │  │ Duration: │
│       │  │          └─────────────────────┘               │  │ 00:45:00  │
│       │  │                 │ Playhead (red)              │  │           │
│       │  ├─────────────────────────────────────────────────┤  │ Clips: 3  │
│       │  │                                                 │  │           │
│       │  └─────────────────────────────────────────────────┘  │           │
│       │                                                         │ Tip:      │
│ Info  │                                                         │ Space =   │
│ •Name │                                                         │ Play      │
│ •Time │                                                         │           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Detailed Component Breakdown

### TOP BAR
**Purpose**: Navigation, project management, quick export
- Height: 48px (h-12)
- Background: zinc-900 with border
- Elements:
  - Back button → Projects
  - Editable project name field
  - Save button (blue when saving)
  - Export button (indigo)

### LEFT SIDEBAR (TOOLS)
**Purpose**: Video editing controls and project info
- Width: 208px (w-52)
- Height: Full minus top bar
- Sections:
  1. **Tools Header** - "TOOLS" label
  2. **Action Buttons**:
     - Split at Playhead (Indigo, primary)
     - Trim to Playhead (Gray, disabled if no selection)
     - Delete Clip (Gray, red text, disabled if no selection)
  3. **Selected Clip Info** - Box showing current clip details
  4. **Spacer** - Flexible space
  5. **Plan Limits** - Feature availability based on subscription

### CENTER SECTION
**Purpose**: Media playback and timeline editing

#### Video Preview Area
- Fills available vertical space
- Black background (maximum contrast)
- Shows current frame of video
- Centers video within frame
- Responsive sizing

#### Playback Control Bar
- Height: 56px (h-14)
- Contains:
  - Start/End buttons (⏮ ⏭)
  - Play/Pause button (Indigo circular)
  - Time display (mono font, zinc-800 bg)
  - Zoom controls with percentage

#### Timeline
- Height: 160px (h-40)
- Scrollable horizontally
- Components:
  - **Time Ruler** (6px height)
    - Shows seconds (0s, 5s, 10s, etc.)
    - Zinc background
    - Small text
  - **Track Area** (remaining height)
    - Track label on left (Video 1)
    - Clip visualization (indigo boxes)
    - Playhead overlay (red, always visible)
    - Trim handles on clip edges

### RIGHT SIDEBAR (EXPORT)
**Purpose**: Export configuration
- Width: 224px (w-56)
- Height: Full minus top bar
- Sections:
  1. **Export Settings Header**
  2. **Resolution Selector**
     - Options: 720p, 1080p (locked?), 4K (locked?)
     - Dropdown styling
  3. **Format Selector**
     - Options: MP4, WebM
     - Dropdown styling
  4. **Export Button**
     - Gradient background
     - Disabled when no clips
     - Large touch target
  5. **Spacer**
  6. **Project Info**
     - Duration display
     - Clip count
     - Quick tips

## Color Scheme

### Primary Colors
```
Background: #09090b (zinc-950)
Surface: #18181b (zinc-900)
Border: #27272a (zinc-800)
Accent: #4f46e5 (indigo-600)
Hover: #4338ca (indigo-700)
Text: #ffffff (white)
Muted: #a1a1aa (zinc-400)
Error: #ef4444 (red-500)
```

### Interactive States
```
Button Default:     bg-indigo-600
Button Hover:       bg-indigo-500
Button Disabled:    opacity-40, cursor-not-allowed
Input Focus:        border-indigo-500
Selected Clip:      ring-2 ring-indigo-400
```

## Responsive Timeline

### Zoom Levels
- Minimum: 25% (3px per second)
- Maximum: 400% (48px per second)
- Default: 100% (12px per second)
- Controls at bottom of preview area

### Timeline Width Calculation
```typescript
timelineWidth = Math.max(800, totalDuration * 12 * zoom)
```

### Pixel-to-Time Conversion
```typescript
// Click position to time
const newTime = (clickX - leftOffset) / (PIXELS_PER_SECOND * zoom)

// Time to position
const pixelPos = (time * PIXELS_PER_SECOND * zoom) + leftOffset
```

## Keyboard Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| Space | Play/Pause | Anytime |
| S | Split at Playhead | Timeline focus |
| ← | Seek back 1s | Anytime |
| Shift+← | Seek back 5s | Anytime |
| → | Seek forward 1s | Anytime |
| Shift+→ | Seek forward 5s | Anytime |
| Delete | Delete selected | Clip selected |
| Backspace | Delete selected | Clip selected |

## Data Flow

```
EditorPage
├── State (clips, playhead, zoom, etc.)
├── Effects
│   ├── loadProject() - Initialize clips
│   ├── syncVideo() - Video ↔ Playhead sync
│   ├── playbackLoop() - Animation frame loop
│   └── handleKeyDown() - Keyboard handling
├── Operations
│   ├── handleSplit() - Cut clip at playhead
│   ├── handleTrim() - Trim from playhead
│   ├── handleDelete() - Remove clip
│   └── handleSave() - Save to backend
└── Render
    ├── TopBar
    ├── LeftSidebar
    ├── CenterSection
    │   ├── VideoPreview
    │   ├── PlaybackControls
    │   └── Timeline
    └── RightSidebar
```

## Time Format

All times displayed in SMPTE timecode format:
```
MM:SS:FF
├─ MM: Minutes (00-59)
├─ SS: Seconds (00-59)
└─ FF: Frames (00-29 at 30fps)
```

Example: `02:35:18` = 2 minutes, 35 seconds, 18 frames

## Accessibility Considerations

### Current
- Keyboard navigation support
- High contrast colors (WCAG AAA)
- Clear visual feedback
- Semantic HTML structure

### Recommended Additions
- Aria-labels on icon buttons
- Aria-descriptions for complex interactions
- Focus indicators (visible outline)
- Screen reader announcements for state changes
- Keyboard-only navigation path
- Voice control integration

## Mobile/Tablet Considerations

Current design is **desktop-optimized**. For mobile adaptation:
1. Stack sidebars vertically
2. Use bottom sheet for export settings
3. Full-width timeline
4. Larger touch targets (min 44px)
5. Simplified controls

---

**Last Updated**: 2024
**Component Status**: Production Ready ✅
