# Editor Technical Implementation Details

## Architecture Overview

### Component Structure
```
EditorPage (Main Container)
├── State Management
│   ├── Project: name, clips, isSaving
│   ├── Playback: playheadTime, isPlaying
│   ├── UI: zoom, selectedClipId, exportResolution/Format
│   └── Refs: videoRef, timelineRef, playAnimationRef
├── Effects
│   ├── Load Project (route-based)
│   ├── Video Sync (playhead ↔ video)
│   ├── Playback Loop (animation frame)
│   ├── Keyboard Shortcuts
│   └── Cleanup Functions
├── Operations
│   ├── Editing: split, trim, delete
│   ├── Timeline: click handling
│   ├── Saving: project persistence
│   └── Export: resolution/format
└── Render
    ├── TopBar
    ├── MainLayout (flex)
    │   ├── LeftSidebar
    │   ├── CenterSection
    │   └── RightSidebar
    └── Nested Components
```

## State Management Details

### Project State
```typescript
type EditorState = {
  projectName: string;          // Editable project title
  clips: TimelineClip[];        // Array of video clips
  isSaving: boolean;            // Saving indicator
  projectId: string | undefined;// Route param
};

type TimelineClip = {
  id: string;              // Unique clip ID
  assetId: string;         // Source asset reference
  startTime: number;       // Timeline position (seconds)
  duration: number;        // How long the clip plays (seconds)
  inPoint: number;         // Start within source (seconds)
  outPoint: number;        // End within source (seconds)
  name: string;            // Display name
  videoUrl: string;        // Source video URL
};
```

### Playback State
```typescript
type PlaybackState = {
  playheadTime: number;    // Current position (seconds)
  isPlaying: boolean;      // Play/pause state
  totalDuration: number;   // Computed from clips
};
```

### UI State
```typescript
type UIState = {
  zoom: number;                    // 0.25 to 4.0 (25% to 400%)
  selectedClipId: string | null;   // Currently selected clip
  exportResolution: string;        // "720p" | "1080p" | "4k"
  exportFormat: string;            // "mp4" | "webm"
};
```

## Core Functions

### Playback Loop (requestAnimationFrame)
```typescript
useEffect(() => {
  if (isPlaying) {
    const startTime = performance.now();
    const startPlayhead = playheadTime;

    const animate = (currentTime: number) => {
      const elapsed = (currentTime - startTime) / 1000;
      const newTime = startPlayhead + elapsed;

      if (newTime >= totalDuration) {
        // Stop at end
        setPlayheadTime(totalDuration);
        setIsPlaying(false);
        return;
      }

      setPlayheadTime(newTime);
      playAnimationRef.current = requestAnimationFrame(animate);
    };

    playAnimationRef.current = requestAnimationFrame(animate);
    videoRef.current?.play();
  } else {
    cancelAnimationFrame(playAnimationRef.current!);
    videoRef.current?.pause();
  }
}, [isPlaying, totalDuration]);
```

**Why requestAnimationFrame?**
- Smooth 60fps animation
- Synced with browser refresh rate
- Better than setInterval (16.67ms precision)
- Auto-pauses when tab inactive
- Battery efficient

### Video Synchronization
```typescript
useEffect(() => {
  const video = videoRef.current;
  if (!video || clips.length === 0) return;

  // Find clip at current playhead position
  const currentClip = clips.find(
    (c) => playheadTime >= c.startTime && 
           playheadTime < c.startTime + c.duration
  );

  // Switch video source if needed
  if (currentClip && video.src !== currentClip.videoUrl) {
    video.src = currentClip.videoUrl;
  }

  // Sync video time
  if (currentClip) {
    const clipTime = currentClip.inPoint + 
                     (playheadTime - currentClip.startTime);
    
    // Only update if significantly off (0.5s buffer)
    if (Math.abs(video.currentTime - clipTime) > 0.5) {
      video.currentTime = clipTime;
    }
  }
}, [playheadTime, clips]);
```

**Why the 0.5s buffer?**
- Prevents constant seeking
- Accounts for natural video drift
- Reduces jank/stuttering
- Improves performance

### Split Operation
```typescript
const handleSplit = useCallback(() => {
  // Find clip at playhead
  const clipAtPlayhead = clips.find(
    (c) => playheadTime > c.startTime && 
           playheadTime < c.startTime + c.duration
  );

  if (!clipAtPlayhead) return;

  // Calculate split point
  const splitPoint = playheadTime - clipAtPlayhead.startTime;

  // Create two new clips
  const clip1: TimelineClip = {
    ...clipAtPlayhead,
    duration: splitPoint,
    outPoint: clipAtPlayhead.inPoint + splitPoint,
  };

  const clip2: TimelineClip = {
    ...clipAtPlayhead,
    id: `clip_${Date.now()}`,
    startTime: playheadTime,
    duration: clipAtPlayhead.duration - splitPoint,
    inPoint: clipAtPlayhead.inPoint + splitPoint,
  };

  // Replace original with two clips
  setClips(
    clips.map((c) => c.id === clipAtPlayhead.id ? clip1 : c)
         .concat(clip2)
  );
}, [clips, playheadTime]);
```

### Trim Operation
```typescript
const handleTrim = useCallback(() => {
  if (!selectedClipId) return;

  const clip = clips.find((c) => c.id === selectedClipId);
  if (!clip) return;

  // Check playhead is within clip
  if (playheadTime <= clip.startTime || 
      playheadTime >= clip.startTime + clip.duration) {
    return;
  }

  // Calculate new duration
  const newDuration = playheadTime - clip.startTime;

  setClips(
    clips.map((c) =>
      c.id === selectedClipId
        ? { 
            ...c, 
            duration: newDuration, 
            outPoint: c.inPoint + newDuration 
          }
        : c
    )
  );
}, [clips, selectedClipId, playheadTime]);
```

## Timeline Calculation System

### Coordinate System
```
Timeline Width in Pixels:
┌────────────────────────────────┐
│ 80px    │ Active Timeline Area │
│ (Track  │ (starts at 80px)    │
│  Label) │                      │
└────────────────────────────────┘

Formula:
pixelPosition = 80 + (timeInSeconds × PIXELS_PER_SECOND × zoomLevel)

Example at 100% zoom:
- Time 0s → pixel 80
- Time 5s → pixel 140 (5 × 12 = 60 pixels)
- Time 10s → pixel 200
```

### Pixel to Time Conversion
```typescript
const handleTimelineClick = (e: React.MouseEvent) => {
  if (!timelineRef.current) return;
  
  // Get click position relative to timeline container
  const rect = timelineRef.current.getBoundingClientRect();
  const scrollLeft = timelineRef.current.scrollLeft;
  const relX = e.clientX - rect.left + scrollLeft;
  
  // Account for 80px track label offset
  const timelineX = relX - 80;
  
  // Convert to seconds
  const newTime = timelineX / (PIXELS_PER_SECOND * zoom);
  
  // Clamp to valid range
  const clampedTime = Math.max(0, Math.min(newTime, totalDuration || 60));
  
  setPlayheadTime(clampedTime);
};
```

### Time to Pixel Conversion
```typescript
// Used for positioning clips and playhead on timeline
const playheadPixel = 80 + (playheadTime * PIXELS_PER_SECOND * zoom);
const clipPixel = 80 + (clip.startTime * PIXELS_PER_SECOND * zoom);
const clipWidth = clip.duration * PIXELS_PER_SECOND * zoom;
```

## Performance Optimizations

### 1. useCallback Dependencies
```typescript
// Split only recalculates when clips or playheadTime changes
const handleSplit = useCallback(() => {
  // ...
}, [clips, playheadTime]);

// Prevents unnecessary function recreation
// Keeps reference stable for child components
```

### 2. Ref-based Updates
```typescript
// Use refs to avoid re-renders
const videoRef = useRef<HTMLVideoElement>(null);
const timelineRef = useRef<HTMLDivElement>(null);
const playAnimationRef = useRef<number | null>(null);

// Directly update DOM when needed
videoRef.current?.play();
videoRef.current.currentTime = newTime;
```

### 3. Computed Values
```typescript
// Calculate once per render, not in render loop
const totalDuration = clips.reduce(
  (sum, c) => Math.max(sum, c.startTime + c.duration), 
  0
);
const timelineWidth = Math.max(800, totalDuration * PIXELS_PER_SECOND * zoom);
const selectedClip = clips.find((c) => c.id === selectedClipId);
```

### 4. Conditional Rendering
```typescript
// Only render what's visible
{clips.length > 0 ? (
  <video src={...} />
) : (
  <div>No clips</div>
)}
```

## Integration Points

### External APIs

#### mockApi
```typescript
// Project operations
await mockApi.getProject(projectId)
await mockApi.saveTimeline(projectId, clips)
await mockApi.getAssets()
```

#### mockRecordingApi
```typescript
// Recording operations
await mockRecordingApi.getRecording(recordingId)
await mockRecordingApi.getAllRecordings()
```

#### useEditingFeatures
```typescript
// Plan-based feature availability
const { features, getFeatureValue } = useEditingFeatures();

// Usage
getFeatureValue("editing.maxTracks")         // Number
getFeatureValue("export.maxResolution")      // String
getFeatureValue("ai.autocut")                // Boolean
```

## Data Flow Diagram

```
┌─────────────────────────────────────────┐
│ Route Params / Query Params             │
│ ├─ projectId: string                   │
│ ├─ recordingId?: string                │
│ └─ assetId?: string                    │
└──────────────┬──────────────────────────┘
               │
               ▼
        ┌─────────────────┐
        │ Load Project    │ (useEffect)
        │ useEffect       │
        └────────┬────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
 [New Project] [Existing] [Asset Based]
    │            │            │
    └────────────┼────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │ clips: Clip[]      │
        │ projectName: str   │
        └────────┬───────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
    ▼                         ▼
┌─────────────┐         ┌──────────────┐
│ Video Sync  │         │ Playback     │
│ useEffect   │         │ Loop        │
└─────────────┘         └──────────────┘
    │                         │
    ├─ videoRef.src ◄────────┘
    ├─ videoRef.currentTime
    └─ video.play/pause

    ▼
┌─────────────────────────────┐
│ User Interactions           │
│ ├─ Click timeline (seek)    │
│ ├─ Press Space (play)       │
│ ├─ Press S (split)          │
│ ├─ Click clip (select)      │
│ └─ Click Delete (remove)    │
└────────────┬────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌──────────┐    ┌──────────────┐
│ Update   │    │ Save to      │
│ State    │    │ Backend      │
└──────────┘    └──────────────┘
    │
    └─► Re-render
        ├─ TimelineClip positions
        ├─ Playhead position
        ├─ Selected state
        └─ UI controls
```

## Error Handling Strategy

### Graceful Degradation
```typescript
// Video loading
if (!video.src || video.readyState === 0) {
  // Show loading state
  return <Spinner />;
}

// Clips array
if (clips.length === 0) {
  // Show placeholder
  return <NoClipsMessage />;
}

// Timeline click
if (!timelineRef.current) {
  // Silently ignore
  return;
}
```

### User Feedback
```typescript
// Saving
const [isSaving, setIsSaving] = useState(false);

const handleSave = async () => {
  setIsSaving(true);
  await mockApi.saveTimeline(projectId!, clips);
  setTimeout(() => setIsSaving(false), 1000);
};

// Button shows: "Saving..." while isSaving
```

## Browser APIs Used

### HTML5 Video API
```typescript
videoRef.current?.play()           // Start playback
videoRef.current?.pause()          // Stop playback
videoRef.current.currentTime = n   // Seek to time
video.readyState                   // Check if loaded
video.duration                     // Get total length
video.volume                       // Control volume (future)
```

### Canvas/DOM APIs
```typescript
timelineRef.current.getBoundingClientRect()  // Get position
timelineRef.current.scrollLeft                // Get scroll
requestAnimationFrame(callback)               // Smooth animation
cancelAnimationFrame(id)                      // Cancel animation
```

### React Hooks Used
```typescript
useState()      // Component state
useEffect()     // Side effects, initialization
useRef()        // Persistent values, DOM access
useCallback()   // Memoized functions
useNavigate()   // Router navigation
useParams()     // Route parameters
useSearchParams() // Query parameters
```

## Constants Configuration

### Timeline Configuration
```typescript
const PIXELS_PER_SECOND = 12;  // Resolution of timeline ruler
const SAMPLE_VIDEO_URL = "...";// Fallback video for demo

// Adjustable:
const MIN_ZOOM = 0.25;         // 25% minimum
const MAX_ZOOM = 4.0;          // 400% maximum
const ZOOM_STEP = 0.25;        // Step size for zoom buttons
```

### Plan Configuration
Connected to `useEditingFeatures()`:
```
Free:
  - maxTracks: 3
  - maxProjects: 5
  - maxResolution: "720p"
  
Pro:
  - maxTracks: 10
  - maxProjects: 50
  - maxResolution: "1080p"
  
Enterprise:
  - maxTracks: unlimited
  - maxProjects: unlimited
  - maxResolution: "4k"
```

## Testing Hooks

### Manual Testing Points
```typescript
// Check state in DevTools
console.log('clips:', clips);
console.log('playheadTime:', playheadTime);
console.log('zoom:', zoom);

// Inspect video element
console.log('videoRef.current:', videoRef.current);
console.log('videoRef.src:', videoRef.current?.src);
console.log('videoRef.currentTime:', videoRef.current?.currentTime);
```

### React DevTools
- Monitor component re-renders
- Check state updates
- Verify effect dependencies
- Profile performance

---

**Last Updated**: 2024
**Complexity**: Medium
**Maintainability**: High
**Test Coverage**: Foundation Ready

For debugging, use:
- React DevTools for state inspection
- Chrome DevTools for performance profiling
- Network tab for video loading issues
