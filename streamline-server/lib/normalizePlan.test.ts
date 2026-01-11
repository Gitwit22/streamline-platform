import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlan } from "./normalizePlan";

test("normalizePlan handles legacy and new keys consistently", () => {
  const doc = {
    name: "Starter",
    description: "Starter plan",
    priceMonthly: "29",
    limits: {
      monthlyMinutesIncluded: "180",
      maxGuests: "5",
      rtmpDestinationsMax: "3",
      maxSessionMinutes: "240",
      maxRecordingMinutesPerClip: "15",
    },
    features: {
      recording: 1,
      rtmp: true,
      multistream: "true",
      advancedPermissions: false,
    },
  };

  const canonical = normalizePlan("starter", doc);

  assert.equal(canonical.id, "starter");
  assert.equal(canonical.name, "Starter");
  assert.equal(canonical.limits.monthlyMinutes, 180);
  assert.equal(canonical.limits.monthlyMinutesIncluded, 180);
  assert.equal(canonical.limits.maxGuests, 5);
  assert.equal(canonical.limits.rtmpDestinationsMax, 3);
  assert.equal(canonical.limits.maxSessionMinutes, 240);
  assert.equal(canonical.limits.maxRecordingMinutesPerClip, 15);
  assert.equal(canonical.limits.maxHoursPerMonth, 3); // 180 / 60
  assert.equal(canonical.features.recording, true);
  assert.equal(canonical.features.multistream, true);
});

test("normalizePlan falls back across legacy minute fields", () => {
  const variants = [
    { limits: { monthlyMinutesIncluded: 120 } },
    { limits: { participantMinutes: 120 } },
    { limits: { monthlyMinutes: 120 } },
    { monthlyMinutesIncluded: 120 },
    { participantMinutes: 120 },
    { monthlyMinutes: 120 },
  ];

  for (const variant of variants) {
    const canonical = normalizePlan("free", variant as any);
    assert.equal(canonical.limits.monthlyMinutes, 120);
    assert.equal(canonical.limits.monthlyMinutesIncluded, 120);
  }
});

test("normalizePlan enforces number types and defaults", () => {
  const canonical = normalizePlan("free", {});
  assert.equal(canonical.limits.monthlyMinutes, 0);
  assert.equal(canonical.limits.maxGuests, 0);
  assert.equal(canonical.limits.rtmpDestinationsMax, 0);
  assert.equal(canonical.limits.maxSessionMinutes, 0);
  assert.equal(canonical.limits.maxRecordingMinutesPerClip, 0);
  assert.equal(canonical.limits.maxHoursPerMonth, 0);
  assert.equal(canonical.limits.maxStorageGB, 0);
  assert.equal(typeof canonical.priceMonthly, "number");
});
