# Invite Link Feature - Room Page

## What's New

An invite link button has been added to the room page header, making it easy for hosts and guests to share the room with others.

---

## Location

The "🔗 Invite" button appears in the top-left section of the room page, next to the room name and exit button.

```
[Exit Room] [room-name] [🔗 Invite]
```

---

## How to Use

### For Everyone (Host & Guests)

1. **Click the "🔗 Invite" button** in the top bar
2. A popup appears saying "Invite link copied to clipboard!"
3. The link is automatically copied to your clipboard
4. **Share it anywhere:**
   - Paste in chat (Discord, Slack, Teams, etc.)
   - Email to friends
   - Text message
   - Social media

### Example Invite Link
```
http://localhost:5173/join?room=gaming-session
```

or for production:
```
https://streamline.app/join?room=gaming-session
```

---

## Features

✅ **One-Click Copy** - Click button, link copied automatically
✅ **Visual Feedback** - Green button with glow effect on hover
✅ **Easy Sharing** - Full URL ready to share anywhere
✅ **Room-Specific** - Generates link for current room
✅ **Auto-Confirmation** - Alert shows link was copied

---

## Visual Design

**Button Appearance:**
- 🔗 Icon + "Invite" text
- Green accent color (matches theme)
- Subtle glow on hover
- Positioned left side of top bar

**Interaction:**
- Hover: Green glow appears
- Click: Link copied, alert shown
- Always visible to all users

---

## How Invite Links Work

When someone clicks an invite link:

1. **Browser navigates to:** `/join?room={roomName}`
2. **Join page loads** with room name pre-filled
3. **Guest enters their name** and clicks "Join Room"
4. **Automatically joins** the streaming room
5. **Can view stream** and chat with others

---

## Technical Details

### Invite Link Format
```javascript
const inviteUrl = `${window.location.origin}/join?room=${encodeURIComponent(roomName)}`;
```

### Copy to Clipboard
```javascript
navigator.clipboard.writeText(inviteUrl);
```

### Room Name Encoding
- URL-encoded for special characters
- Safe for sharing anywhere
- Automatically decoded on join page

---

## Testing

### To Test Invite Link:

1. **Open a room** as a host
2. **Click "🔗 Invite"** button
3. **Check:**
   - ✅ Alert confirms "Invite link copied"
   - ✅ Copy visible in alert text
   - ✅ Can paste anywhere
   - ✅ Link contains correct room name
4. **Share link** with friend
5. **Friend pastes link** in new tab
6. **Verify:** They join same room

---

## Troubleshooting

### Button not working?
- Ensure clipboard access enabled in browser
- Check browser console for errors
- Try refreshing page

### Link doesn't work?
- Verify room name in URL
- Check internet connection
- Ensure both users on same network (for localhost)

### Wrong room name in link?
- Copy button uses current room name
- Verify correct room before sharing
- Re-copy if needed

---

## Browser Compatibility

✅ Chrome / Edge / Brave / Opera
✅ Firefox
✅ Safari
⚠️ Requires HTTPS for production (clipboard access)

---

## Mobile Friendly

The invite button works on mobile:
- Tap button on phone/tablet
- Link copied to mobile clipboard
- Share via apps (WhatsApp, iMessage, etc.)
- Works in portrait and landscape

---

## Future Enhancements

Possible improvements:
- [ ] QR code for quick sharing
- [ ] Email invite option
- [ ] Generate unique join tokens
- [ ] Expiring invite links
- [ ] Invite history/tracking
- [ ] Permission-based invites (host only)

---

## Summary

The invite link feature makes sharing rooms simple:
- 🔗 One click to copy
- 📋 Works with any app
- 🌍 Perfect for remote teams
- 📱 Mobile friendly

Ready to share your stream with others!
