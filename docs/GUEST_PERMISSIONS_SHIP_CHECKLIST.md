# Guest Permissions Ship Checklist

## Pre-Deployment Testing (3 Critical Checks)

### ✅ Test 1: Old Invite Link Backward Compatibility
**Steps:**
1. Find an old invite link sent via Messenger/email (created before role rename)
2. Click the link
3. Verify: Lands in room as "guest"
4. Verify: Mic/cam controls appear in UI
5. Verify: Can enable microphone
6. Verify: Can enable camera

**Pass Criteria:**
- No 401/403 errors
- Guest role displays (not "viewer")
- Audio/video tracks publish successfully

---

### ✅ Test 2: In-App Browser Permission Banner
**Steps:**
1. Click invite link inside Facebook Messenger in-app browser (iOS or Android)
2. If camera/microphone permission is blocked/denied:
   - **Verify:** Red/amber permission error banner appears
   - **Verify:** Banner shows error message (e.g., "🔒 Camera/mic blocked...")
   - **Verify:** "Open in Browser" button is visible
3. **Android:** Tap "Open in Browser" → Opens in Chrome (intent://)
4. **iOS:** Tap "Open in Browser" → Copies URL to clipboard
5. Paste in Safari → Join again → Mic/cam permission should work

**Pass Criteria:**
- Banner appears immediately on permission denial
- "Open in Browser" button works on both platforms
- Clear instructions for user to recover

**Supported In-App Browsers:**
- Facebook (FBAN/FBAV)
- Instagram
- TikTok
- Twitter
- LinkedIn

---

### ✅ Test 3: Host Moderation Still Works
**Steps:**
1. Host creates room
2. Guest joins via invite link
3. Guest enables mic/cam
4. **Host actions:**
   - Mute guest's microphone → Verify guest muted
   - Toggle guest's camera off → Verify camera disabled
   - Kick guest from room → Verify guest disconnected
5. **Verify:** Host controls appear in participant list
6. **Verify:** Guest receives moderation events (mute notification, kick)

**Pass Criteria:**
- Host can control guest mic/cam remotely
- Host can remove guests
- LiveKit moderation APIs work end-to-end

---

## If All 3 Pass: ✅ Ready to Deploy

**Security Guarantees:**
- ✅ Unknown/corrupted roles are rejected (not defaulted to guest)
- ✅ Legacy "viewer" tokens still work (mapped to guest)
- ✅ Permission errors have clear user recovery path
- ✅ Host moderation unaffected

**Backward Compatibility:**
- ✅ Old JWTs with `role: "viewer"` → Mapped to `guest`
- ✅ Old Firestore docs with `role: "viewer"` → Mapped to `guest`
- ✅ Legacy invite tokens → Valid roles accepted, garbage rejected

**Next Steps After Deployment:**
1. Monitor Sentry/logs for "INVALID_ROLE" rejections (indicates corrupted tokens)
2. Check for MediaDevicesError events (permission denials in wild)
3. Track "Open in Browser" button click rate (in-app browser usage)

---

## Rollback Criteria

**Roll back if:**
- Legitimate old invites return 401/403 (backward compat broken)
- No permission banner appears in in-app browsers
- Host moderation stops working

**How to Roll Back:**
- Revert to previous `feature/hls-dev` commit
- Role mapping will be loose again (any unknown → guest)
- Trade: Security for compatibility
