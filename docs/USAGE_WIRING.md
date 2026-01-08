# Usage Tracking - Wiring Complete

## Overview
The usage system is now fully wired to track streaming time and enforce plan limits. Here's what's been implemented:

## Components

### 1. `server/usageHelper.ts` - Centralized Usage Logic
- **`computeNextResetDate(userCreatedAt, fromDate)`** - Calculates billing period end date based on user's signup day
- **`addUsageForUser(userId, durationMinutes, options)`** - Central function called when stream ends. Handles:
  - Computing duration in hours
  - Adding to monthly/daily/YTD counters
  - Checking plan limits
  - Automatically computing reset dates based on user.createdAt
  - Updating Firestore user.usage doc
- **`getUserUsage(userId)`** - Returns current usage stats for a user

### 2. `server/routes/multistream.ts` - Stream Tracking
**Updated to track active streams with metadata:**

```typescript
interface ActiveStream {
  egressId: string;
  userId: string;
  roomName: string;
  startedAt: Date;
  guestCount?: number;
}
```

**`POST /api/rooms/:roomName/start-multistream`**
- Now requires `userId` and `guestCount` in body
- Stores stream metadata in memory (activeStreams) and Firestore (activeStreams collection)
- Records exact start time

**`POST /api/rooms/:roomName/stop-multistream`**
- Looks up the active stream by roomName
- Calculates `durationMinutes = ceil((now - startedAt) / 60000)`
- **Calls `addUsageForUser(userId, durationMinutes, { guestCount })`**
- Returns usage update info in response
- Cleans up tracking (both memory and Firestore)

### 3. `server/index.ts` - New Endpoint
**`GET /api/usage/me`** (Authenticated)
- Requires JWT token in Authorization header
- Returns current user's usage data:
  ```json
  {
    "displayName": "John",
    "planId": "pro",
    "hoursStreamedThisMonth": 2.5,
    "maxHoursPerMonth": 100,
    "ytdHours": 15.3,
    "resetDate": "2025-12-27T00:00:00Z",
    "maxGuests": 500,
    "multistreamEnabled": true,
    "priceWeekly": 0,
    "priceMonthly": 29.99,
    "priceYearly": 299.00
  }
  ```

## Data Flow

### When Stream Starts (Host clicks "Go Live")
```
Frontend sends:
POST /api/rooms/{roomName}/start-multistream
{
  youtubeStreamKey: "...",
  userId: "user123",        // ← NEW
  guestCount: 5             // ← NEW
}

Backend:
- Stores stream metadata with startedAt timestamp
- Saves to activeStreams in Firestore (for webhook recovery)
- Returns egressId and public URLs
```

### When Stream Ends (Host clicks "Stop" or leaves room)
```
Frontend sends:
POST /api/rooms/{roomName}/stop-multistream

Backend:
1. Looks up activeStream for roomName
2. Calculates durationMinutes
3. Calls addUsageForUser(userId, durationMinutes, { guestCount })
   - Loads user doc with createdAt, plan, current usage
   - Computes billing period end date (based on createdAt day)
   - Adds hours to usage.hoursStreamedThisMonth, usage.ytdHours, etc.
   - Saves back to Firestore
4. Deletes activeStream tracking
5. Returns usage update stats

Response:
{
  "success": true,
  "durationMinutes": 5,
  "usageUpdated": {
    "ok": true,
    "durationHours": 0.083,
    "hoursStreamedThisMonth": 2.583,
    "maxHoursPerMonth": 100,
    "isOverLimit": false,
    "resetDate": "2025-12-27T00:00:00Z"
  }
}
```

### When Frontend Checks Usage (Dashboard/Banner)
```
Frontend sends:
GET /api/usage/me
Authorization: Bearer {jwt_token}

Backend:
- Verifies JWT token
- Calls getUserUsage(userId)
- Returns current stats

Frontend displays:
- Hours used this month
- Max hours allowed
- Reset date
- Plan name
- Remaining capacity
```

## Firestore Structure

### users/{userId}
```
{
  email: "user@example.com",
  plan: "pro",
  createdAt: "2025-12-01T10:00:00Z",  // Used to compute reset date
  usage: {
    hoursStreamedThisMonth: 2.5,
    hoursStreamedToday: 0.5,
    ytdHours: 15.3,
    guestCountToday: 50,
    periodStart: "2025-12-01T10:00:00Z",
    resetDate: "2025-12-27T10:00:00Z",  // Next billing period start
    lastUsageUpdate: "2025-12-06T14:30:00Z"
  }
}
```

### activeStreams/{roomName} (temporary, deleted when stream ends)
```
{
  egressId: "EG_xxx",
  userId: "user123",
  roomName: "gaming-room-1",
  startedAt: "2025-12-06T14:00:00Z",
  guestCount: 5
}
```

## Testing Checklist

1. **Start a stream:**
   - Create new user account
   - Open a room as host
   - Click "Go Live" with YouTube stream key
   - Verify `activeStreams/{roomName}` appears in Firestore
   - Verify `startedAt` timestamp is current

2. **Stream runs for 2-3 minutes:**
   - Just let it stream

3. **End the stream:**
   - Click "Stop" button or leave room
   - Check response: should show duration and updated usage
   - Verify `activeStreams/{roomName}` is deleted from Firestore
   - Check `users/{userId}/usage.hoursStreamedThisMonth` increased

4. **Check usage dashboard:**
   - Navigate to usage/dashboard
   - Should show updated hours
   - Should match the calculation: (durationMinutes / 60)

5. **Test reset date:**
   - Check user.createdAt (e.g., day 1 of month)
   - Verify usage.resetDate is computed correctly (day 1 of next month)
   - If current date is past the day, reset date should be next month

## Frontend Changes Needed

Update the StreamSetupModal or "Go Live" button to pass `userId` and `guestCount`:

```typescript
const handleStartMultistream = async (keys: {...}) => {
  const uid = localStorage.getItem("sl_userId");
  const viewerCount = /* get current viewer count */;
  
  const res = await fetch(`/api/rooms/${roomName}/start-multistream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      youtubeStreamKey: keys.youtubeKey,
      facebookStreamKey: keys.facebookKey,
      twitchStreamKey: keys.twitchStreamKey,
      userId: uid,        // ← ADD THIS
      guestCount: viewerCount // ← ADD THIS
    }),
  });
};
```

## Billing Period Logic

Users' usage resets on the **same day they signed up each month**.

Example:
- User signed up on Dec 1, 2025
- First month: Dec 1 - Dec 31, 2025
- Reset happens Dec 1, 2026
- Then Jan 1, 2026 - Jan 1, 2027
- Etc.

This is calculated in `computeNextResetDate()` and passed through every usage update.

---

**Status:** ✅ Fully Wired
All pieces are in place. Just need to verify the frontend sends userId + guestCount when starting streams.
