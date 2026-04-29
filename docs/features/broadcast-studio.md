# Broadcast Studio

The Broadcast Studio is StreamLine's live streaming and broadcasting system. It enables hosts to go live with multi-participant video, broadcast to large audiences via HLS, restream to external platforms via RTMP, and record sessions for later playback.

## Starting a Broadcast

### HLS Broadcast

An HLS broadcast creates a server-side composite of all participant video/audio tracks and delivers it as an HLS stream viewable by unlimited audience members.

**How it works:**

1. Host creates a room and joins with participants
2. Host clicks **Go Live** to start the HLS broadcast
3. Server initiates a LiveKit **RoomComposite egress**, which:
   - Composites all participant tracks into a single video according to the selected layout
   - Encodes to H.264/AAC
   - Outputs HLS segments (`.ts` files) to Cloudflare R2 storage
   - Generates playlist files (`room.m3u8` for VOD, `live.m3u8` for live viewers)
4. Viewers access the HLS stream via the public HLS endpoint

**API Flow:**

```
POST /api/rooms/:roomId/controls/start-hls
→ Starts RoomComposite egress
→ Returns: { egressId, hlsUrl }

GET /api/public/hls/:roomId
→ Returns HLS playlist for viewers (no auth required)

POST /api/rooms/:roomId/controls/stop-hls
→ Stops egress, finalizes recording
```

### RTMP Multi-Destination Streaming

Multi-destination streaming sends the room's composite video to external platforms simultaneously via RTMP.

**Supported Destinations:**

| Platform | Type |
|---|---|
| YouTube Live | RTMP |
| Twitch | RTMP |
| Facebook Live | RTMP |
| Instagram Live Producer | RTMP |
| Custom RTMP | Any RTMP endpoint |

**How it works:**

1. Host configures destinations in **Settings → Destinations**
2. During a live room, host clicks **Start Multistream**
3. Server creates LiveKit `StreamOutput` egress with all configured RTMP destinations
4. Stream keys are decrypted from storage (AES-256-GCM encrypted at rest)
5. LiveKit sends the composite video to all destinations simultaneously
6. Egress health is monitored with auto-retry on failure

**API Flow:**

```
POST /api/rooms/:roomId/start-multistream
→ Reads saved + session destinations
→ Decrypts stream keys
→ Creates StreamOutput egress
→ Returns: { egressId, destinations[] }

POST /api/rooms/:roomId/stop-multistream
→ Stops RTMP egress
```

## Multi-Camera Production

StreamLine supports multi-camera production through multiple participant video tracks and layout switching.

### Layout Modes

| Mode | Description | Best For |
|---|---|---|
| **Speaker** | Active speaker highlighted, others in sidebar | Interviews, presentations |
| **Grid** | Equal-sized tiles for all participants | Panel discussions, meetings |
| **Carousel** | Scrollable participant list with featured speaker | Large groups |
| **PIP** | Picture-in-Picture with main speaker and small overlay | Solo presentations with guest |

Layout changes apply in real-time to both the room view and the composite recording/stream.

**API:**

```
PUT /api/rooms/:roomId/layout
Body: { mode: "speaker" | "grid" | "carousel" | "pip" }
```

## Screen Sharing

Participants with `canScreenShare` permission can share their screen, which appears as an additional video track in the room layout.

- Screen sharing works alongside camera video
- The shared screen can be featured as the primary video in speaker layout
- Screen shares are included in recordings and broadcasts

## Recording

All HLS broadcasts are automatically recorded. Recordings include:

- **Composite video** — All participants combined according to the active layout
- **HLS segments** — Individual `.ts` segment files for flexible playback
- **Metadata** — Duration, participant count, room configuration

Recordings are stored in Cloudflare R2 and accessible via signed download URLs.

### Post-Stream Summary

After ending a broadcast, the host is directed to the **Room Exit Page** (`/room-exit/:recordingId`) which shows:

- Recording details and duration
- Download options
- Stream statistics

## HLS Playback

Audience members can view live broadcasts via HLS:

- **Public endpoint** — `/api/public/hls/:roomId` serves playlists without authentication
- **Live playlist** — `live.m3u8` with sliding window for live viewers
- **VOD playlist** — `room.m3u8` for full recording playback after the stream ends
- **CDN delivery** — HLS segments served via Cloudflare R2 with CDN caching

### Encoding

| Setting | Value |
|---|---|
| Default resolution | 720p |
| Codec | H.264 + AAC |
| Segment duration | Standard HLS segments |
| Higher resolutions | Plan-gated (1080p for higher tiers) |
