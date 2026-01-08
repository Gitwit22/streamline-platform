# Video Editor - Visual Reference Card

## UI Layout Map

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                          TOP BAR (h-12, bg-zinc-900)                      ║
║  [← Projects] [Project Name▸] ......................... [💾 Save] [Export →] ║
╠═════════════════════════════════════════════════════════════════════════════╣
║ LEFT     │                                                          │ RIGHT  ║
║ SIDEBAR  │         CENTER - VIDEO EDITOR                           │SIDEBAR ║
║ (w-52)   │                                                          │(w-56)  ║
║          │  ╔════════════════════════════════════════════════════╗ │        ║
║ TOOLS    │  ║                                                  ║ │        ║
║ ───────  │  ║          🎬 VIDEO PREVIEW                        ║ │EXPORT  ║
║          │  ║        (Click to focus, Space to play)           ║ │────────║
║ ✂️ Split  │  ║                                                  ║ │Res:    ║
║ 📏 Trim   │  ║  [Shows current video frame]                    ║ │[720p ▼]║
║ 🗑️ Delete │  ║                                                  ║ │1080p   ║
║          │  ╚════════════════════════════════════════════════════╝ │4K 🔒   ║
║ ─────────│                                                          │        ║
║ 📌 Info  │  PLAYBACK (h-14, bg-zinc-900/50)                        │Format: ║
║ Name: .. │  [⏮] [▶/⏸] [⏭] | 00:15:18 / 00:45:00                 │[MP4 ▼]║
║ Time: .. │                              [−] 100% [+]               │WebM    ║
║          │                                                          │        ║
║ ─────────│  TIMELINE (h-40, scrollable horizontal)                  │        ║
║ 📊 Plan  │  ┌────────────────────────────────────────────────┐   │        ║
║ T: 3     │  │ 0s   5s   10s   15s   20s   25s   30s    35s   │   │        ║
║ P: 5     │  ├────────────────────────────────────────────────┤   │        ║
║ AI: 🔒   │  │ V1 │ ┌──────────────────┐                    │   │        ║
║          │  │    │ │ Clip 1 (20s) ⊡─⊡ │                    │   │        ║
║          │  │    │ └──────────────────┘                    │   │[Export]║
║          │  │    │              ║ (playhead)              │   │        ║
║          │  │    │ ┌────────────╩─────────────┐           │   │        ║
║          │  │    │ │ Clip 2 (15s)         ⊡─⊡ │           │   │        ║
║          │  │    │ └─────────────────────────┘           │   │        ║
║          │  │                                              │   │        ║
║          │  └────────────────────────────────────────────────┘   │        ║
║          │                                                          │        ║
║          │                                                          │Duration║
║          │                                                          │00:35:00║
║          │                                                          │        ║
║          │                                                          │Clips: 2║
║          │                                                          │        ║
║          │                                                          │Tip:    ║
║          │                                                          │Space = ║
║          │                                                          │Play    ║
╚═════════════════════════════════════════════════════════════════════════════╝
```

## Component Size Reference

```
┌─────────────────────────────────────────────────────────────────┐
│                        VIEWPORT                                 │
│  (e.g., 1920 × 1200 or responsive)                             │
├─────────────────────────────────────────────────────────────────┤
│
│ TOP BAR
│ Height: 48px (h-12)
│ Contains: Navigation, project name, save, export
│
├────────────────────────────────────────────────────────────────
│
│ MAIN CONTENT AREA
│ Height: Remaining (calc(100vh - 48px))
│ Display: flex (horizontal)
│
│ ├─ LEFT SIDEBAR: w-52 (208px)
│ │  ├─ Tools section
│ │  ├─ Info section  
│ │  └─ Plan section
│ │
│ ├─ CENTER SECTION: flex-1 (takes remaining)
│ │  ├─ Video preview: flex-1
│ │  ├─ Playback controls: h-14 (56px)
│ │  └─ Timeline: h-40 (160px)
│ │
│ └─ RIGHT SIDEBAR: w-56 (224px)
│    ├─ Export settings
│    ├─ Spacer
│    └─ Info section
│
└────────────────────────────────────────────────────────────────
```

## Color Palette

### Backgrounds
```
▮ Primary BG     #09090b  zinc-950   (main background)
▮ Secondary BG   #18181b  zinc-900   (surfaces, bars)
▮ Tertiary BG    #27272a  zinc-800   (inputs, buttons)
▮ Hover BG       #3f3f46  zinc-700   (hover states)
```

### Accents & Interactive
```
▮ Accent         #4f46e5  indigo-600 (primary buttons, highlights)
▮ Accent Hover   #4338ca  indigo-700 (button hover)
▮ Accent Light   #a5b4fc  indigo-300 (text on accent)
▮ Success        #10b981  emerald-500
▮ Error          #ef4444  red-500    (delete, trim handles)
▮ Warning        #f59e0b  amber-500
```

### Text
```
▮ Primary Text   #ffffff  white      (main text)
▮ Secondary Text #a1a1aa  zinc-400   (labels, muted)
▮ Tertiary Text  #71717a  zinc-600   (very muted)
▮ Disabled Text  #52525b  zinc-600   (disabled state)
```

### Special
```
▮ Playhead      #ef4444  red-500    (timeline indicator)
▮ Selection     ring: indigo-400 with offset
▮ Border        #27272a  zinc-800   (borders, dividers)
```

## Button Styles

### Primary Button (Indigo)
```
Default:   bg-indigo-600 text-white
Hover:     bg-indigo-500 text-white  
Active:    bg-indigo-700 text-white
Disabled:  opacity-40 cursor-not-allowed
```

### Secondary Button (Zinc)
```
Default:   bg-zinc-800 text-white
Hover:     bg-zinc-700 text-white
Active:    bg-zinc-600 text-white
Disabled:  opacity-40 cursor-not-allowed
```

### Ghost Button (Text only)
```
Default:   text-zinc-400
Hover:     text-white
Active:    text-indigo-400
Disabled:  opacity-40
```

### Danger Button
```
Default:   bg-zinc-800 text-red-400
Hover:     bg-zinc-700 text-red-300
Disabled:  opacity-40
```

## Typography Scale

```
Page Title       32px  font-bold
Section Header   16px  font-semibold  uppercase text-zinc-400
Button Text      14px  font-medium
Body Text        14px  font-normal    text-white
Small Text       12px  font-normal    text-zinc-500
Label            12px  font-semibold  text-zinc-400  uppercase
Mono (Time)      14px  font-mono      bg-zinc-800
Hint Text        11px  font-normal    text-zinc-600
```

## Spacing Scale

```
xs  2px   (0.125rem)   - Minimal spacing
sm  4px   (0.25rem)    - Small gaps
md  8px   (0.5rem)     - Standard padding
lg  12px  (0.75rem)    - Section padding
xl  16px  (1rem)       - Major sections
2xl 24px  (1.5rem)     - Large sections
3xl 32px  (2rem)       - Huge sections
```

## Shadows

```
No Shadow          (most elements)
sm Shadow          (dropdowns, modals)
md Shadow          (important cards)
lg Shadow          (video preview)
xl Shadow          (floating panels)
```

## Transitions

```
Fast     150ms  (opacity, color, scale)
Normal   300ms  (position, size)
Slow     500ms  (route transitions)
Default  ease-in-out
```

## Breakpoints (Responsive)

```
sm   640px   (tablets)
md   768px   (small laptops)
lg   1024px  (standard laptops)
xl   1280px  (large displays)
2xl  1536px  (ultra-wide)
```

## Icon Reference

```
Navigation
  ⏮  Go to start
  ▶  Play
  ⏸  Pause
  ⏭  Go to end
  ←  Back
  →  Forward

Editing
  ✂️  Split
  📏  Trim
  🗑️  Delete
  🎬  Video
  📊  Stats
  📌  Pin/Mark

Status
  💾  Save
  📤  Export
  🔒  Locked
  ⚙️  Settings
  ℹ️  Info
  ✅  Complete
  ❌  Error
  ⚠️  Warning
```

## Keyboard Shortcut Reference

```
╔════════════════════════════════════╗
║    KEYBOARD SHORTCUTS REFERENCE    ║
╠════════════════════════════════════╣
║ SPACE        ▶ Play/Pause           ║
║ S            ✂️ Split at Playhead   ║
║ ←            ◀ Seek -1s             ║
║ Shift+←      ◀◀ Seek -5s            ║
║ →            ▶ Seek +1s             ║
║ Shift+→      ▶▶ Seek +5s            ║
║ DELETE       🗑️ Delete Clip         ║
║ BACKSPACE    🗑️ Delete Clip         ║
╚════════════════════════════════════╝
```

## Timeline Grid Reference

```
Timeline Ruler (at different zoom levels):
                                                    
100% (12px per second):
0s  5s  10s 15s 20s 25s 30s 35s 40s 45s 50s 55s 60s
├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤

50% (6px per second):
0s     10s    20s    30s    40s    50s    60s
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤

200% (24px per second):
0s 5s 10s 15s 20s 25s 30s 35s 40s 45s 50s 55s 60s
├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤
```

## Clip Representation

```
┌─────────────────────────┐
│ Clip Name (15s)         │  ← Name label
│                         │
│ ⊡─────────────────────⊡ │  ← Trim handles
└─────────────────────────┘
  ↑                       ↑
  Drag to trim left    Drag to trim right

States:
  Normal:    bg-indigo-600/80
  Hover:     bg-indigo-500/80
  Selected:  bg-indigo-500 with ring-2 ring-indigo-400
```

## Playhead Indicators

```
Timeline View (Red playhead):

┌────────────────────────────────────────┐
│ 0s  5s  10s  15s  20s  25s  30s        │
│ ┌──────────────┐                       │
│ │ Clip 1   ║   │                       │  Triangle at top
│ └──────────────┘                       │  (indicator)
│                  ║                     │  
│                  │                     │  Vertical red line
│                  │                     │  (playhead)
│ ┌──────────────────┐                   │
│ │ Clip 2       ║   │                   │
│ └──────────────────┘                   │
└────────────────────────────────────────┘
   ↑                         ↑
   Position: 10 seconds      Position: 20 seconds
```

## Select & Highlight States

```
Unselected Clip:
┌────────────────────────────────┐
│ bg-indigo-600/80 opacity-normal│
└────────────────────────────────┘

Selected Clip:
╭════════════════════════════════╮    ← ring-indigo-400
║ bg-indigo-500                  ║      (2px solid)
║                                ║    ← ring-offset-zinc-950
╰════════════════════════════════╯      (1px transparent)

Hover State:
┌────────────────────────────────┐
│ bg-indigo-500/80 cursor-pointer│
└────────────────────────────────┘

Disabled State:
┌────────────────────────────────┐
│ opacity-40 cursor-not-allowed  │
└────────────────────────────────┘
```

## Accessibility Features

### Focus Indicators
```
All interactive elements have visible focus:
- Ring: 2px indigo-400
- Outline: Visible on keyboard navigation
- Color contrast: WCAG AAA (4.5:1+)
```

### Keyboard Navigation
```
Tab Order:
1. Back button
2. Project name input
3. Save button
4. Export button
5. Sidebar tools
6. Timeline area
7. Zoom controls
8. Export settings
```

### Text Alternatives
```
- All icon buttons have aria-labels (recommended)
- Form labels associated with inputs
- Status messages announced
- Errors highlighted with text
- Color not only indicator
```

## Performance Indicators

### Smooth Targets
```
Playback:     30+ FPS    ✅ (smooth video)
Timeline:     60 FPS     ✅ (smooth scrolling)
Zoom:         100ms      ✅ (quick transition)
Split:        50ms       ✅ (instant feel)
Memory:       <200MB     ✅ (efficient)
```

### Visual Feedback
```
Loading:      Spinner or "Saving..." text
Success:      Blue button feedback
Error:        Red highlight + message
Disabled:     Dimmed with cursor: not-allowed
Hover:        Color change + scale
Active:       Darker shade
Focus:        Ring highlight
```

## Quick Start Visual Map

```
FIRST TIME USER FLOW:
┌──────────────┐
│  Open Editor │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Video loads in   │
│ preview area     │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐     Press SPACE
│  Click timeline  │◄────to play/pause
│  to seek         │     or click ▶
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Find moment to   │
│ edit            │
└──────┬───────────┘
       │
       ├─→ SPLIT (Press S)
       │   Cut video in two
       │
       ├─→ TRIM (Click 📏)
       │   Remove from end
       │
       ├─→ DELETE (Press Delete)
       │   Remove clip
       │
       └─→ ZOOM (Use +-buttons)
           Get precise control
       │
       ▼
┌──────────────────┐
│ Review video     │
│ (Press SPACE)    │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Click EXPORT     │
│ button           │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Choose settings: │
│ • Resolution     │
│ • Format         │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Click [EXPORT]   │
│ button           │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Video exported!  │
│ Download ready   │
└──────────────────┘
```

---

**Last Updated**: 2024
**Version**: 1.0
**Status**: Ready for Reference ✅

Print this card and keep it handy for quick reference!
