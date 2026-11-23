import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  normalizeStartLivePayloadFromDestinationsKeys,
  useDestinationsStartPayload,
  type PlatformKey,
  type PlatformState,
} from "../useDestinationsStartPayload";
import { destinationApiErrorMessage, kickErrorMessage, kickServerUrlProblem, kickStreamKeyProblem } from "../../../lib/kickDestination";

const KICK_URL = "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app";
const KEY = "sk_us-west-2_AbCdEf123456";
const ORDER: PlatformKey[] = ["youtube", "facebook", "twitch", "kick", "instagram", "custom"];

function emptyState(): Record<PlatformKey, PlatformState> {
  return Object.fromEntries(ORDER.map((p) => [p, { selected: false, manualFields: [], error: null, info: null }])) as any;
}

function compute(state: Record<PlatformKey, PlatformState>, main: Partial<Record<PlatformKey, any>>) {
  const { result } = renderHook(() =>
    useDestinationsStartPayload({ platformState: state, platformOrder: ORDER, mainByPlatform: main as any })
  );
  return result.current.compute();
}

const savedKick = { id: "dest-kick", targetId: "tgt-kick", platform: "kick", hasKey: true, mode: "manual", rtmpUrlBase: KICK_URL };
const savedYoutube = { id: "dest-yt", targetId: "tgt-yt", platform: "youtube", hasKey: true, mode: "manual", rtmpUrlBase: "rtmp://a.rtmp.youtube.com/live2" };

describe("Kick in the Go Live payload", () => {
  it("saved Kick destination alone: sent by id, no key in the payload", () => {
    const state = emptyState();
    state.kick.selected = true;
    const r = compute(state, { kick: savedKick });
    expect(r.isValid).toBe(true);
    expect(r.payload?.enabledTargetIds).toEqual(["dest-kick"]);
    expect(r.payload?.sessionKeys).toBeUndefined();
    expect(JSON.stringify(r.payload)).not.toContain("sk_");
  });

  it("Kick alongside YouTube: both saved destinations are sent", () => {
    const state = emptyState();
    state.kick.selected = true;
    state.youtube.selected = true;
    const r = compute(state, { kick: savedKick, youtube: savedYoutube });
    expect(r.isValid).toBe(true);
    expect(r.payload?.enabledTargetIds).toEqual(["dest-yt", "dest-kick"]);
  });

  it("replacement key for this stream overrides the saved key (saved Server URL reused)", () => {
    const state = emptyState();
    state.kick.manualFields = [{ id: "f1", value: ` ${KEY} `, base: KICK_URL }];
    const r = compute(state, { kick: savedKick });
    expect(r.isValid).toBe(true);
    expect(r.payload?.enabledTargetIds).toEqual(["dest-kick"]);
    expect(r.payload?.sessionKeys).toEqual({ "tgt-kick": { rtmpUrlBase: KICK_URL, streamKey: KEY } });
  });

  it("session-only Kick (nothing saved) is marked as a Kick session key after normalization", () => {
    const state = emptyState();
    state.kick.manualFields = [{ id: "f1", value: KEY, base: KICK_URL }];
    const r = compute(state, {});
    expect(r.isValid).toBe(true);
    const start = normalizeStartLivePayloadFromDestinationsKeys(r.payload as any);
    expect(start.sessionKeys).toEqual({ "kick-1": { rtmpUrlBase: KICK_URL, streamKey: KEY, platform: "kick" } });
    expect(start.enabledTargetIds).toBeUndefined();
  });

  it("rtmp:// (not rtmps) and missing pieces are caught before sending", () => {
    const state = emptyState();
    state.kick.manualFields = [{ id: "f1", value: KEY, base: "rtmp://ingest.example.net/app" }];
    let r = compute(state, {});
    expect(r.isValid).toBe(false);
    expect(r.nextPlatformState.kick.error).toMatch(/rtmps:\/\//);

    const noKey = emptyState();
    noKey.kick.selected = true;
    r = compute(noKey, {});
    expect(r.isValid).toBe(false);
    expect(r.nextPlatformState.kick.error).toMatch(/Server URL and Stream Key/);

    const keyIsUrl = emptyState();
    keyIsUrl.kick.manualFields = [{ id: "f1", value: `${KICK_URL}/${KEY}`, base: KICK_URL }];
    r = compute(keyIsUrl, {});
    expect(r.isValid).toBe(false);
    expect(r.nextPlatformState.kick.error).toMatch(/Stream Key isn't valid/);
  });

  it("a Kick error never blocks the other platforms' validation state", () => {
    const state = emptyState();
    state.youtube.selected = true;
    state.kick.manualFields = [{ id: "f1", value: KEY, base: "rtmp://bad" }];
    const r = compute(state, { youtube: savedYoutube });
    expect(r.nextPlatformState.youtube.error).toBeNull();
    expect(r.nextPlatformState.kick.error).not.toBeNull();
  });
});

describe("kickDestination helpers", () => {
  it("server URL and key checks", () => {
    expect(kickServerUrlProblem(`${KICK_URL}/`)).toBeNull();
    expect(kickServerUrlProblem("")).toMatch(/Server URL/);
    expect(kickServerUrlProblem("rtmp://x/app")).toMatch(/rtmps/);
    expect(kickServerUrlProblem("https://kick.com")).toMatch(/rtmps/);
    expect(kickServerUrlProblem("rtmps://x/app?t=1")).toMatch(/isn't valid/);
    expect(kickStreamKeyProblem(KEY)).toBeNull();
    expect(kickStreamKeyProblem("")).toMatch(/Stream Key/);
  });

  it("error messages: server text preferred, codes mapped, never the input", () => {
    expect(kickErrorMessage("kick_server_url_not_rtmps")).toMatch(/rtmps/);
    expect(kickErrorMessage("kick_profile_incompatible", "Kick was skipped: x")).toBe("Kick was skipped: x");
    expect(kickErrorMessage("duplicate_name")).toBeNull();
    const err = Object.assign(new Error("HTTP 400"), { body: { error: "kick_stream_key_invalid" } });
    expect(destinationApiErrorMessage(err)).toMatch(/Stream Key isn't valid/);
    expect(destinationApiErrorMessage(Object.assign(new Error("HTTP 409"), { body: { error: "duplicate_stream_key" } }))).toMatch(
      /already saved/
    );
  });
});
