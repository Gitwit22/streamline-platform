# Feature Completion Plan — October 2026

Goal: finish every feature behind the admin feature flags except the AI tools. The AI tools come last and will be renamed **Intelligent Tools**.

**Decisions (from the owner):**
- Creator payouts: **later**. Keep "Payouts coming soon".
- "Subscriber" viewer access: **leave as coming soon**.
- Editor extras to build: **transitions, export options, watermark, direct upload**.

Each phase ships as its own commit (or small set of commits) on `creator`. Every phase is verified the same way:
- server: `npm run build && npm test`
- client: `tsc`, `vitest` and `build`
- a browser or ffmpeg smoke test of the real feature

---

## Phase 1 — Audio mixer: send the mix to the stream (`audioMixerEnabled`) — ✅ DONE

**Today:** the mixer UI and engine work (`lib/audioMixer.ts`, `AudioMixerModal`, `MixerBridge`). The mixed output only reaches the host's own speakers and local recording; viewers never hear it.

**Build:**
1. **A "broadcast" output in `AudioMixer` that excludes guest audio.** Guests are already in the room, so sending their audio back would make them hear an echo of themselves. The broadcast mix carries the host mic, screen-share audio and music. Music is currently `program: false`, so it gets a per-bus "send to stream" toggle.
2. **A new `useMixerBroadcast` hook.** When the mixer is on and the host turns on "Send mix to stream", the hook:
   - replaces the host's mic track in LiveKit with the broadcast track (`LocalAudioTrack.replaceTrack(..., { userProvidedTrack: true })`);
   - keeps the raw mic feeding the mixer, so the mic doesn't loop back into itself;
   - restores the raw mic when the toggle is turned off or the host leaves.
3. **Re-apply after the mic is toggled or recovered.** These code paths can swap the mic track: `HostControlsEnforcer`, `lib/mediaRecovery.ts`, mute/unmute and device changes. Mute keeps working: muting silences the broadcast track.
4. **Server:** add an `audioMixer` plan feature in the entitlements engine, so plans can include or exclude it like other features. The platform switch stays the master kill switch.
   - This replaces the deleted `useMixedAudioPublish` hook, which published a second track and echoed guests back to themselves.

**Verify:** a browser smoke test with two clients on a local LiveKit server. The host plays music through the mixer, and the guest's received audio track contains it. Mute and unmute still work.

## Phase 2 — Advanced screen share: consistent gating (`advancedScreenShareEnabled`) — ✅ DONE

**Today:** the pop-out window and screen routing are hidden in the UI. The basic auto/manual screen-share mode, also reachable from the Layout panel, is meant to stay available to everyone.

**Build:**
1. **Treat the flag like other features.** Add it to the server-computed feature access response (`effectiveFeatureAccess`) as a plan feature plus platform switch, so the admin plan editor can grant it per plan.
2. **Server check in `PATCH /program-state`.** Reject only advanced-only values when the feature is off. Today that is none of them (auto/manual are basic), so nothing basic breaks; the check covers advanced modes added later.
3. **Test** the pop-out route end to end in the browser smoke test.

## Phase 3 — Editor: export options + plan limits — ✅ DONE

**Today:** export always sends `1080p / mp4 / standard`. Quality is ignored (CRF is hardcoded) and fps is hardcoded to 30. The plan fields `maxResolution`, `exportsPerMonth` and `unlimitedExports` are not enforced.

**Build:**
1. **Export options panel** in `RenderAndUploadPage`:
   - resolution 720p / 1080p / 4K (limited by plan)
   - format mp4 / webm / mov
   - quality draft / standard / high
   - frame rate 24 / 30 / 60
2. **Server:**
   - `normalizeExportSettings` clamps choices to the plan.
   - `renderPlan` maps quality to CRF and preset, and uses the chosen fps.
   - `editing.ts` enforces `exportsPerMonth` with a monthly counter, refunded if the export fails.
   - The admin plan editor exposes these fields; they come off `UNENFORCED_EDITING_KEYS`.
3. **Priority queue:** paid plans with `editing.export.priorityQueue` jump ahead in `exportQueue`.

## Phase 4 — Editor: transitions — ✅ DONE

**Build:**
1. Add a `transitionIn` field to each clip (`{ type: "fade" | "crossfade" | "dip_to_black", durationMs }`) in:
   - the client `TimelineClip`
   - the server `EditorClip` / `ExportTimelineClip`
2. **Editor UI:** a transition chip between adjacent clips on the same track. Click it to choose the type and duration.
3. **Renderer (`renderPlan.ts`):**
   - fades as alpha fades on each overlay input (fits the current overlay design);
   - crossfade as overlapping alpha fades, with clips extended by the transition length;
   - audio uses `afade` / `acrossfade`.
4. **Plan gating:** `transitions.basic` (fade, dip to black) and `transitions.advanced` (crossfade). Both are enforced on the server.

**Verify:** render a 3-clip timeline with ffmpeg. Check the frames around each cut, and check that audio has no click.

## Phase 5 — Editor: watermark

**Build:**
1. **Export option:** watermark image (from the content library or an upload) or text, plus position, size and opacity.
2. **Renderer:** one `overlay` (image) or `drawtext` (text) stage before the final output.
3. **Plan rules:**
   - `editing.export.watermark` lets a plan add a custom watermark.
   - Optionally, free plans get a forced "Made with Streamline" mark (admin setting, default off).

## Phase 6 — Editor: direct upload (YouTube first)

**Build:**
1. **YouTube connect.** The OAuth backend fields already exist and the UI is hidden.
   - Finish the Google OAuth flow (`youtube.upload` scope).
   - Store refresh tokens encrypted with the existing stream-key encryption.
   - Add a connect/disconnect UI in Settings → Destinations.
2. **"Upload to YouTube" after export:** title, description, privacy and tags. The upload runs as a job with resumable upload from R2, with progress and a final link shown on the export page.
3. **`multiPlatform`:** the same job design supports more platforms later. Start with YouTube only.
4. **Plan gating:** `editing.export.directUpload` / `multiPlatform`.

**Owner setup required:**
- a Google Cloud OAuth client with the YouTube Data API enabled
- Google app verification for the `youtube.upload` scope (can take weeks; testing works with up to 100 test users before then)
- env vars `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`

## Phase 7 — Monetization gaps (no Connect needed)

- **Disputes:** handle `charge.dispute.closed`. A dispute the creator wins restores the ledger row and the viewer's access. Record dispute status changes.
- **Events:** creators can delete or archive a pay-per-view event. Past purchases keep their ledger rows.
- **Earnings:** paginate the earnings ledger; it currently stops at 1000 rows.
- **Donations:** donors can add an optional name and message, and creators see them on the earnings card. Donations stay a per-event mode.
- **Unchanged:** "Payouts coming soon" and "Subscriber: coming soon" stay as they are, per the decisions above.

## Phase 8 — Editor end-to-end test + full smoke

Run a full browser test of the editor:
- create a project, upload media, trim clips, add music
- add transitions and a watermark
- export at each allowed resolution, save the result to the library, and download it

Then rerun the deploy runbook smoke checks.

## Phase 9 (last) — Intelligent Tools (currently "AI")

- Rename the AI category in admin flags, plans and marketing copy to **Intelligent Tools**.
- Then plan and build the tools themselves:
  - auto-captions
  - silence/auto-cut
  - highlight reels
  - live captions

This phase will be scoped separately.

---

**Order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

## Progress

| Phase | Status |
|---|---|
| 1 Audio mixer | ✅ Done. "Send mix to stream" swaps the host's published mic for the mix (mic + music; guests and screen share excluded). Toolbar mute mutes the mix. Per-plan "Audio mixer" feature. Verified in a two-browser LiveKit test (6/6 states). |
| 2 Advanced screen share | ✅ Done. Per-plan "Advanced screen share" feature + platform switch. The server refuses Main/Pop-out routing (controls PATCH) when the room owner isn't entitled; Off always works. A stale saved route falls back to Off, and a refused route resets with a message. |
| 3 Export options | ✅ Done. Export settings card (resolution, format, quality, fps) before rendering. Plan max resolution and monthly exports are enforced on the server (failed/canceled exports are refunded). Priority render queue. Admin plan controls. Verified with real ffmpeg renders. |
| 4 Transitions | ✅ Done. Fade, dip to black and crossfade per video clip (inspector picker + timeline marker + preview fade); linked audio fades with it. Rendered by ffmpeg (verified frame colours and audio levels). Plan tiers: basic (fade/dip) and advanced (crossfade), enforced on export; admin checkboxes. |
| 5 Watermark | ⏳ Next |
| 6–9 | Not started |

Phases 1–5 and 7 need no new outside accounts. Phase 6 needs the Google OAuth setup, so start that application early; it can run in parallel while the other phases are built.

---

## Secondary improvements (paused — scheduled after the main phases)

The owner chose these on 2026-10-05. **Don't start them until the owner says so.**

### S1. Audio: soundboard + playlist (through the mixer)

**Today:** the mixer has one music slot.
- It uses a file picker and always loops, with play, stop and remove.
- It plays through the Music channel, and viewers hear it when "Send mix to stream" is on.
- There's no drag and drop, no queue, no progress bar or seek, and no per-clip volume.
- The file is lost on refresh, and the player is only reachable inside the mixer pop-up.

**Build:**
- **Drag and drop** audio files onto the room or the mixer.
- **Playlist** for background music: queue, next/previous, progress and seek, loop toggle.
- **Soundboard** pads for one-shot sounds: intros, applause, stingers.
- **Per-item volume** on both.
- **Mixer routing:** everything stays on the mixer's Music channel, so volume, mute, ducking and "Send mix to stream" all apply.
- **Persistence:** files are saved to the content library so they're still there next session.

### S2. Room customization

**Today:**
- Channel branding (title, subtitle, logo, offline message, theme) appears only on the `/live/...` viewer page.
- Room layout reaches every output.
- Nothing brands the video itself: the compositor background is hard-coded black.

**Build:**
1. **Branding on the video.** Logo or watermark (position, size, opacity) and a background color or image drawn by the program compositor. It reaches YouTube, Facebook, Twitch, Instagram, the HLS video and recordings.
2. **Lower thirds and banners.** Name tags and a static or scrolling text banner, shown or hidden live from the room, on all outputs.
3. **Rename room + join page branding.** Rename a room after creation. Show the channel logo and title on the join page and in the room header.
4. **Fix the bugs found in the audit:**
   - A co-host with `canLayout` can rewrite the owner's channel branding (`roomsHlsConfig.ts`). Restrict it to the owner, or add a dedicated permission.
   - `POST /api/saved-embeds` accepts `hlsConfig` without the branding validation (no length limits, no logo URL check). Validate it or drop it.
   - An offline message equal to the old default text is silently replaced on the viewer page (`hlsBranding.ts`).
   - Branding changes only reach open viewer pages on reload. Re-fetch the channel branding live.
   - Branding can only be edited for a channel's home room; other rooms that go live on the channel show the home room's branding.
   - Minor:
     - `hlsConfig.enabled` has no UI.
     - The room theme is never used.
     - The editor's "platform disabled" notice can't be reached.
