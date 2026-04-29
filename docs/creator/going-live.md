# Going Live — Creator Guide

This guide walks you through starting a live broadcast on StreamLine.

## Before You Go Live

### Check Your Setup

1. **Camera and Microphone** — Ensure your camera and microphone are connected and working
2. **Internet Connection** — A stable connection with at least 5 Mbps upload speed is recommended
3. **Browser** — Use a modern browser (Chrome, Firefox, Edge) for the best experience
4. **Plan** — HLS broadcasting requires a Starter plan or higher

### Configure Destinations (Optional)

If you want to simulcast to external platforms:

1. Go to **Settings → Destinations**
2. Add your streaming platforms (YouTube, Twitch, Facebook, Instagram, or custom RTMP)
3. Enter your stream key for each destination (stored encrypted)

## Starting a Broadcast

### Step 1: Create a Room

1. From the dashboard, click **Create Room** (or **Go Live**)
2. Configure room settings:
   - **Room Type**: Choose **RTC** (interactive) or **HLS** (broadcast)
   - **Visibility**: Public, Unlisted, or Private
   - **Presence Mode**: Normal (default)
3. Click **Create**

### Step 2: Join the Room

1. You'll be redirected to the room page (`/room/:roomId`)
2. Grant camera and microphone permissions when prompted
3. Your video preview will appear in the room grid

### Step 3: Start HLS Broadcast

1. Click the **Go Live** button in the room controls
2. The server starts compositing all video tracks into an HLS stream
3. A live indicator appears when the broadcast is active
4. Viewers can now watch via the HLS player

### Step 4: Multi-Destination Streaming (Optional)

1. Click **Start Multistream** in the room controls
2. Your configured destinations will receive the composite video
3. Each destination's status is shown in the controls panel

## During Your Broadcast

### Layout Switching

Switch between layouts during your broadcast:

| Layout | Description | Best For |
|---|---|---|
| **Speaker** | Active speaker large, others small | Presentations, interviews |
| **Grid** | Equal tiles for all participants | Panel discussions |
| **Carousel** | Scrollable list with featured speaker | Large groups |
| **PIP** | Picture-in-Picture overlay | Solo with guest |

### Screen Sharing

1. Click the **Screen Share** button
2. Select the screen, window, or tab to share
3. Your screen appears as an additional video source in the layout
4. Click **Stop Sharing** to end

### Managing Participants

As the host, you can:

- **Mute** a participant's audio or video
- **Remove** a participant from the room
- **Change roles** — Promote guests to participants or co-hosts

### Chat Moderation

- Delete inappropriate messages
- Mute disruptive participants from chat

## Ending the Broadcast

1. Click **Stop Broadcast** to end the HLS stream
2. Click **Stop Multistream** if active
3. Leave the room or close it
4. You'll be redirected to the **Room Exit Page** with your recording summary

## After the Broadcast

### Recording

- Your broadcast recording is automatically saved (if recording was enabled)
- Access recordings from the **Room Exit Page** or your **Content Library**
- Download recordings for local use

### Content Library

Recordings are available in your Content Library at `/content`, where you can:
- Browse past recordings
- Import recordings into editing projects
- Share or download recordings

### Video Editing

Import your recording into the **Video Editor**:
1. Go to **Projects** (`/projects`)
2. Create a new project
3. Add your recording from the Content Library
4. Edit on the timeline (trim, arrange, multi-track)
5. Export the final video
