import test from "node:test";
import assert from "node:assert/strict";
import { resolveMaxDestinations } from "./planLimits";

test("resolveMaxDestinations table", () => {
  const cases: Array<{ limits: any; expected: number }> = [
    { limits: { maxDestinations: 3 }, expected: 3 },
    { limits: { rtmpDestinationsMax: 2 }, expected: 2 },
    { limits: { rtmpDestinations: 1 }, expected: 1 },
    { limits: {}, expected: 0 },
    { limits: null, expected: 0 },
    { limits: undefined, expected: 0 },
  ];

  for (const { limits, expected } of cases) {
    assert.equal(resolveMaxDestinations(limits as any), expected);
  }
});
