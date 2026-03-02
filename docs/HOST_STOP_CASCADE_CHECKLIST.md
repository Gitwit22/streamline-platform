# Host Stop = Full Cascade (Checklist)

This repo ships fast and changes core plumbing often. The easiest way to prevent regressions is to treat **“Host clicks Stop”** as a **multi-layer cascade** that must complete end-to-end.

This checklist is the contract.

## Goal

When the host stops a stream/session, **every layer** (egress, persistent state, “what’s live” indexes, and viewer UX) must converge to **Ended** with no “ghost live” leftovers.

## Definitions

- **Host Stop**: user intent to end the broadcast session (not just close a tab).
- **Egress**: LiveKit egress jobs (HLS egress, multistream/transcode egress, recording egress).
- **Room state**: Firestore `rooms/{roomId}` state that clients poll and/or use for join gating.
- **Active streams index**: Firestore `activeStreams/*` documents used to represent currently-live streams to other parts of the platform.

## Required Cascade (must all be true)

### 1) Stop all relevant egress jobs

Server-side, best-effort but **must be attempted**:

- Stop HLS egress if present (`stopEgress(egressId)`), and clear runtime HLS state (`rooms/{roomId}.hls`).
- Stop multistream/transcode egress if present (YouTube/Facebook/Twitch destinations).
- Stop recording egress if present.

Acceptance:

- Any known `egressId` is stop-requested.
- Server state reflects no active egress IDs.

### 2) Mark room session ended (durable state)

Persist a durable “ended” signal so all clients converge:

- Update `rooms/{roomId}.status` to `ended`.
- Write `rooms/{roomId}.endedAt` (ISO or Firestore timestamp, consistently).

Acceptance:

- `GET /api/rooms/:roomId/status` (or equivalent) returns `ended`.
- Re-join attempts behave consistently (either blocked or shown an ended UX).

### 3) Update the activeStreams index

If an `activeStreams/*` document exists for the room/session:

- Mark it ended (`status: ended`, `endedAt: now`) OR delete it (choose one pattern and keep it consistent).
- Ensure downstream consumers don’t continue to treat the stream as live.

Acceptance:

- “Live” lists no longer show the stream.
- Any webhook-driven reconciliation won’t resurrect “live”.

### 4) Viewer UX must transition to Ended

Viewer-side behavior is not optional; it’s the visible contract.

- Viewer must **lose playback**.
- Viewer must **receive ended state** (poll/subscribe-driven).
- UI must transition to an **Ended** presentation.

Acceptance:

- The player is torn down (HLS player destroyed, video src cleared; RTC disconnected if applicable).
- Viewer sees an explicit ended state (not “loading forever”).

### 5) Cleanup / teardown

- Any HLS artifacts (manifest/segments) are cleaned up if that’s part of the product contract.
- Any polling/subscriptions are stopped or made harmless.

Acceptance:

- No “ghost” network traffic loops after end.
- No UI stuck in a retry loop.

## Where this maps in the codebase (current)

- HLS stop endpoint: `POST /api/hls/stop/:roomId`.
- Public viewer HLS polling: `GET /api/public/hls/:roomId`.
- HLS viewer page: `streamline-client/src/pages/Live.tsx`.
- Room status endpoint (guest informational poll / join gating): `GET /api/rooms/:roomId/status`.

## Automation requirement (non-negotiable)

Add at least one structured integration-style test that covers:

1. Host starts stream
2. Viewer joins
3. Host stops
4. Viewer must:
   - lose playback
   - observe ended state
   - see UI transition

Until this is automated, these regressions will keep resurfacing.
