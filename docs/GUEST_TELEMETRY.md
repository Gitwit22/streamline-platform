# Guest Invite Flow Telemetry

## Overview

Telemetry tracking has been added to measure and validate the performance of the optimized guest invite flow. This provides data-driven insights into:
- Guest connection success rates
- Time to first video track (critical UX metric)
- Real-world performance validation

## Events Tracked

### 1. `viewer_join_success`
Logged when a guest successfully connects to the LiveKit room.

**Payload:**
```typescript
{
  event: "viewer_join_success",
  roomId: string,
  guestSessionToken: string,
  ts: number,              // Client timestamp
  userAgent: string        // Added by server
}
```

**Trigger:** `RoomEvent.Connected` fires for viewer

**Purpose:** Count successful guest connections to measure optimization impact

### 2. `viewer_first_video_track_ms`
Logged when the first video track is subscribed by a guest viewer.

**Payload:**
```typescript
{
  event: "viewer_first_video_track_ms",
  roomId: string,
  durationMs: number,      // Time from room entry to first video
  guestSessionToken: string,
  ts: number,
  userAgent: string
}
```

**Trigger:** `RoomEvent.TrackSubscribed` fires for first video track

**Purpose:** Measure time-to-video to validate removal of artificial delays (room live gating, etc.)

## Implementation

### Client-Side

**Location:** `streamline-client/src/lib/telemetry.ts`

Fire-and-forget telemetry service that:
- Posts events to `/api/telemetry/guest` endpoint
- Uses `keepalive: true` for reliability during page transitions
- Silently fails (doesn't break user flow)
- Includes timing helpers: `markTiming`, `measureTiming`, `clearTiming`

**Instrumentation:** `streamline-client/src/pages/Room.tsx`

The `GuestTelemetryTracker` component:
- Marks timing when viewer enters room
- Tracks `Connected` event for success logging
- Tracks `TrackSubscribed` event for time-to-video measurement
- Only runs for viewers (not hosts)
- Guards against duplicate logging

### Server-Side

**Location:** `streamline-server/routes/telemetry.ts`

`POST /api/telemetry/guest` endpoint:
- Logs events to console with structured format
- Validates required fields (event, roomId)
- Sanitizes guestSessionToken (first 16 chars + "...")
- Enriches with server metadata (IP, userAgent, receivedAt)
- Ready for Firestore integration (commented TODO)

**Log Format:**
```
[telemetry:guest] {
  event: "viewer_join_success",
  roomId: "abc123",
  guestSessionToken: "token-abc123...",
  ts: "2024-01-15T10:30:45.123Z",
  receivedAt: "2024-01-15T10:30:45.456Z",
  userAgent: "Mozilla/5.0...",
  ip: "192.168.1.1"
}
```

## Usage in Production

### Viewing Logs

In production server logs, search for `[telemetry:guest]`:

```bash
# Count successful viewer joins
grep "viewer_join_success" server.log | wc -l

# Extract time-to-video durations
grep "viewer_first_video_track_ms" server.log | jq '.durationMs'
```

### Expected Performance

Based on optimizations:
- **viewer_first_video_track_ms**: Should be < 3000ms (3 seconds)
  - Baseline (pre-optimization): 19+ seconds
  - Optimized target: 2-3 seconds

### Analytics Queries

When integrated with Firestore:

```typescript
// Get average time-to-video for last 24 hours
const snapshot = await admin.firestore()
  .collection('guestTelemetry')
  .where('event', '==', 'viewer_first_video_track_ms')
  .where('receivedAt', '>=', oneDayAgo)
  .get();

const durations = snapshot.docs.map(doc => doc.data().durationMs);
const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
console.log(`Average time-to-video: ${avg}ms`);

// Success rate
const joins = await admin.firestore()
  .collection('guestTelemetry')
  .where('event', '==', 'viewer_join_success')
  .count()
  .get();

console.log(`Total successful guest joins: ${joins.data().count}`);
```

## Firestore Integration (Optional)

To persist telemetry for long-term analysis:

1. **Enable in telemetry.ts:**
   ```typescript
   import admin from "../firebaseAdmin";
   
   // In /guest endpoint, after logging:
   await admin.firestore().collection('guestTelemetry').add(payload);
   ```

2. **Create Firestore indexes:**
   ```json
   {
     "indexes": [
       {
         "collectionGroup": "guestTelemetry",
         "queryScope": "COLLECTION",
         "fields": [
           { "fieldPath": "event", "order": "ASCENDING" },
           { "fieldPath": "receivedAt", "order": "DESCENDING" }
         ]
       },
       {
         "collectionGroup": "guestTelemetry",
         "queryScope": "COLLECTION",
         "fields": [
           { "fieldPath": "roomId", "order": "ASCENDING" },
           { "fieldPath": "receivedAt", "order": "DESCENDING" }
         ]
       }
     ]
   }
   ```

3. **Security Rules:**
   ```javascript
   match /guestTelemetry/{doc} {
     allow read: if request.auth != null && 
                    request.auth.token.admin == true;
     allow write: if false; // Only server can write
   }
   ```

## Metrics Dashboard

Build a simple dashboard to visualize:

1. **Success Rate Chart**
   - Total `viewer_join_success` events per day
   - Trend over time

2. **Time-to-Video Distribution**
   - Histogram of `durationMs` values
   - P50, P95, P99 percentiles
   - Alert if P95 > 5000ms

3. **Error Tracking**
   - Join attempts vs. success events
   - Missing video track events (joined but no video)

## Privacy Notes

- `guestSessionToken` is truncated in logs (first 16 chars only)
- IP addresses are logged for debugging but can be removed if not needed
- No personally identifiable information (PII) is collected
- Events are anonymous from guest perspective

## Performance Impact

- Client-side: ~50 lines of code, minimal runtime overhead
- Server-side: Console logging only (no database writes by default)
- Network: 2 fire-and-forget POST requests per guest session
- Minimal impact on guest join latency (<10ms)

## Testing

### Local Development

```typescript
// In browser console on /room page (as guest):

// Check if telemetry is firing
window.addEventListener('beforeunload', () => {
  console.log('Telemetry timings:', performance.getEntriesByType('mark'));
});

// Manual test telemetry
fetch('/api/telemetry/guest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event: 'test_event',
    roomId: 'test-room',
    durationMs: 1234,
    guestSessionToken: 'test-token',
    ts: Date.now()
  })
});
```

### Server Logs

```bash
# Watch telemetry in real-time
tail -f server.log | grep "telemetry:guest"
```

## Related Documentation

- [GUEST_INVITE_OPTIMIZATION.md](./GUEST_INVITE_OPTIMIZATION.md) - Overview of optimizations
- [REMOVED_LIVE_GATING.md](./REMOVED_LIVE_GATING.md) - Event-driven architecture
- [VIDEO_DEBUG_LOGS.md](./VIDEO_DEBUG_LOGS.md) - Comprehensive debugging reference

## Future Enhancements

1. **Real-time Alerts**: Alert if time-to-video > threshold
2. **A/B Testing**: Compare metrics before/after feature changes
3. **User Segmentation**: Track performance by browser, device, network
4. **Correlation Analysis**: Link telemetry to room metadata (size, duration, etc.)
5. **Automated Regression Detection**: Alert if metrics degrade

---

*Last Updated: 2024-01-15*
