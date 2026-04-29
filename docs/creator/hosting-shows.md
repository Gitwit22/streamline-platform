# Hosting Shows & Inviting Guests — Creator Guide

This guide covers how to host multi-participant shows and invite guests to your StreamLine room.

## Hosting a Show

### Planning Your Show

1. **Format** — Decide on your show format (interview, panel, solo with guests, presentation)
2. **Layout** — Choose the appropriate layout mode (speaker, grid, carousel, PIP)
3. **Participants** — Determine who will join and what roles they need

### Room Setup

1. **Create a Room** — Set visibility to Unlisted or Private for invite-only shows
2. **Configure Policies** — Enable authentication requirement if needed
3. **Prepare Destinations** — Set up RTMP destinations if simulcasting

## Inviting Guests

### Creating Invite Links

1. From your room controls, click **Invite**
2. Configure the invite:
   - **Role**: Choose the role for invited guests
     - **Co-Host** — Can manage participants and moderate
     - **Participant** — Can share audio/video
     - **Guest** — Limited interaction, configurable A/V
     - **Viewer** — Watch-only access
   - **Expiry**: Set how long the invite link is valid
   - **Max Uses**: Optionally limit how many times the link can be used
3. Click **Generate Link**
4. Copy and share the link with your guests

### Invite Link Format

Invite links follow the format:
```
https://your-domain.com/i/<invite-token>
```

When a guest clicks the link:
1. They land on the **Invite Landing Page**
2. The invite token is validated (expiry, max uses, room status)
3. If valid, they're prompted to join the room
4. A guest access token is minted with the role specified in the invite

### Guest Experience

Guests joining via invite link:

- **No account required** — Guests can join without creating a StreamLine account
- **Role-scoped access** — Permissions are determined by the invite's role setting
- **Session persistence** — Guest sessions are maintained via cookies (30-minute LiveKit token refresh)
- **Limited navigation** — Guests only see the room interface, not the creator dashboard

## Managing Participants During a Show

### As Host

| Action | How |
|---|---|
| **Mute audio** | Click the participant's mute button |
| **Mute video** | Click the participant's video toggle |
| **Remove from room** | Click the participant's remove button |
| **Promote role** | Change participant's role via room controls |

### Participant Presets

Quick role presets for managing participants:

| Preset | Permissions |
|---|---|
| **Co-Host** | Full audio/video, can moderate, can manage others |
| **Participant** | Audio/video, chat access |

### Moderating Chat

- Delete messages from the chat panel
- Mute specific participants from chatting
- Enable **host-only moderation** if co-hosts shouldn't moderate

## Multi-Camera Production

### Setting Up Multiple Cameras

Each participant's camera acts as a separate video source:

1. **Interview Setup** — Host + guest in speaker layout
2. **Panel Setup** — Multiple participants in grid layout
3. **Presentation** — Speaker with screen share + PIP for webcam

### Switching Layouts

Switch layouts during the show for different segments:

- Start with **Grid** for introductions
- Switch to **Speaker** for the main conversation
- Use **PIP** when showing a screen share with guest overlay

Layout changes apply immediately to:
- All participants' room view
- HLS broadcast output
- Multi-destination RTMP streams
- Recording

## Recording Your Show

### Automatic Recording

When HLS broadcasting is active, recording happens automatically:

- Composite video of all participants
- Layout changes reflected in the recording
- Audio from all unmuted participants

### Post-Show

After ending the broadcast:

1. **Room Exit Page** — View recording summary
2. **Content Library** — Recording appears in your asset library
3. **Video Editor** — Import into a project for post-production editing
4. **Export** — Render final video in your preferred format and resolution

## Tips for Great Shows

1. **Test beforehand** — Do a test run with your guests before going live
2. **Check audio levels** — Ensure all participants have clear audio
3. **Use a stable connection** — Wired connections are preferred over Wi-Fi
4. **Brief your guests** — Explain the format and any controls they'll use
5. **Prepare your layout** — Set the initial layout before starting the broadcast
6. **Monitor chat** — Keep an eye on audience chat during the show
7. **Have a backup plan** — Know how to switch to a different layout or mute a participant quickly
