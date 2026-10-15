import { describe, expect, it } from "vitest";
import { alreadyRunningEgressId, runningMultistreamEgressId, runningRecordingFromResponse } from "./egressHydration";

describe("runningMultistreamEgressId", () => {
  it("adopts an active stream, preferring the main output", () => {
    expect(
      runningMultistreamEgressId({
        live: true,
        outputs: [
          { kind: "instagram", egressId: "EG_ig", status: "active" },
          { kind: "multistream", egressId: "EG_main", status: "active" },
        ],
      })
    ).toBe("EG_main");
    expect(runningMultistreamEgressId({ live: true, outputs: [{ kind: "instagram", egressId: "EG_ig", status: "starting" }] })).toBe("EG_ig");
  });

  it("treats an unknown status as running so it can still be stopped", () => {
    expect(runningMultistreamEgressId({ live: true, outputs: [{ kind: "multistream", egressId: "EG1", status: "unknown" }] })).toBe("EG1");
  });

  it("ignores ended streams and non-live responses", () => {
    for (const status of ["complete", "failed", "aborted", "ending", "limit_reached"]) {
      expect(runningMultistreamEgressId({ live: true, outputs: [{ kind: "multistream", egressId: "EG1", status }] })).toBeNull();
    }
    expect(runningMultistreamEgressId({ live: false, outputs: [] })).toBeNull();
    expect(runningMultistreamEgressId(null)).toBeNull();
    expect(runningMultistreamEgressId({ live: true, outputs: [{ kind: "multistream", status: "active" }] })).toBeNull();
  });
});

describe("alreadyRunningEgressId", () => {
  it("reads the running egress from a 409 body", () => {
    expect(alreadyRunningEgressId({ error: "multistream_already_running", egressId: "EG1" })).toBe("EG1");
    expect(alreadyRunningEgressId({ error: "multistream_start_in_progress" })).toBeNull();
    expect(alreadyRunningEgressId({ error: "multistream_already_running" })).toBeNull();
  });
});

describe("runningRecordingFromResponse", () => {
  it("parses the active recording", () => {
    expect(runningRecordingFromResponse({ recording: { recordingId: "rec1", startedAtMs: 10 } })).toEqual({ recordingId: "rec1", startedAtMs: 10 });
    expect(runningRecordingFromResponse({ recording: { recordingId: "rec1" } })).toEqual({ recordingId: "rec1", startedAtMs: null });
    expect(runningRecordingFromResponse({ recording: null })).toBeNull();
    expect(runningRecordingFromResponse({})).toBeNull();
  });
});
