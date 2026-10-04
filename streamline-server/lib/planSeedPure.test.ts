import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_CATALOG_V2 } from "./entitlements/planCatalog";
import { normalizePlanDoc } from "./entitlements/normalizePlanV2";
import { flattenLeaves, planMissingFieldsPatch, planResetDiff, sanitizePlanMetaInput } from "./planSeedPure";

const pro = PLAN_CATALOG_V2.pro;

test("seed missing-only: creates a plan that does not exist", () => {
  const r = planMissingFieldsPatch("pro", null, pro);
  assert.equal(r.created, true);
  assert.equal(r.patch.priceMonthly, 79);
  assert.equal(r.patch.id, "pro");
});

test("seed missing-only: never overwrites admin edits (incl. null = unlimited and 0 = none)", () => {
  const existing = {
    ...JSON.parse(JSON.stringify(pro)),
    id: "pro",
    priceMonthly: 99,
    name: "Pro+",
    limits: { ...pro.limits, guests: null, destinations: 0 },
    features: { ...pro.features, hls: false },
  };
  const r = planMissingFieldsPatch("pro", existing, pro);
  assert.equal(r.created, false);
  assert.equal(r.converted, false);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.patch, {});
});

test("seed missing-only: fills only the missing fields", () => {
  const existing: any = JSON.parse(JSON.stringify(pro));
  existing.id = "pro";
  delete existing.description;
  delete existing.limits.projects;
  delete existing.features.watermark;
  existing.limits.guests = 99;
  const r = planMissingFieldsPatch("pro", existing, pro);
  assert.deepEqual(r.added.sort(), ["description", "features.watermark", "limits.projects"].sort());
  assert.deepEqual(r.patch, {
    description: pro.description,
    features: { watermark: false },
    limits: { projects: 10 },
  });
  assert.equal("guests" in r.patch.limits, false);
});

test("seed missing-only: legacy price is kept as priceMonthly (not the catalog price)", () => {
  const existing: any = JSON.parse(JSON.stringify(pro));
  delete existing.priceMonthly;
  existing.price = 49;
  existing.id = "pro";
  const r = planMissingFieldsPatch("pro", existing, pro);
  assert.equal(r.patch.priceMonthly, 49);
});

test("seed missing-only: legacy v1 doc is converted with the same meaning", () => {
  // Legacy: 0 = unlimited for maxGuests.
  const legacy = {
    id: "starter",
    name: "Starter",
    description: "x",
    price: 29,
    limits: { maxGuests: 0, monthlyMinutesIncluded: 600, rtmpDestinationsMax: 3 },
    features: { recording: true, rtmp: true },
  };
  const before = normalizePlanDoc("starter", legacy);
  const r = planMissingFieldsPatch("starter", legacy, PLAN_CATALOG_V2.starter);
  assert.equal(r.converted, true);
  assert.equal(r.patch.limitsVersion, 2);
  const after = normalizePlanDoc("starter", { ...legacy, ...r.patch, limits: r.patch.limits, features: r.patch.features });
  assert.deepEqual(after.limits, before.limits);
  assert.deepEqual(after.features, before.features);
  assert.equal(r.patch.priceMonthly, 29);
});

test("reset diff: lists exactly the fields that would change", () => {
  const existing: any = JSON.parse(JSON.stringify(pro));
  existing.priceMonthly = 99;
  existing.limits.guests = null;
  existing.stripePriceId = "price_123";
  const diff = planResetDiff("pro", existing, pro);
  const byPath = Object.fromEntries(diff.map((d) => [d.path, d]));
  assert.deepEqual(Object.keys(byPath).sort(), ["limits.guests", "priceMonthly"]);
  assert.deepEqual(byPath["priceMonthly"], { path: "priceMonthly", current: 99, next: 79 });
  assert.deepEqual(byPath["limits.guests"], { path: "limits.guests", current: null, next: 10 });
  assert.deepEqual(planResetDiff("pro", JSON.parse(JSON.stringify(pro)), pro), []);
});

test("reset diff: missing doc shows every catalog field", () => {
  const diff = planResetDiff("free", null, PLAN_CATALOG_V2.free);
  assert.equal(diff.length, Object.keys(flattenLeaves(PLAN_CATALOG_V2.free)).length);
});

test("sanitizePlanMetaInput: price alias -> priceMonthly, validation, unknown keys dropped", () => {
  const ok = sanitizePlanMetaInput({
    name: " Pro ",
    price: "19.5",
    visibility: "hidden",
    editing: { maxTracks: 4, exportsPerMonth: 9, ai: { autoCut: true } },
    stripePriceId: "price_x",
    multistreamEnabled: true,
  });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.meta, { name: "Pro", priceMonthly: 19.5, visibility: "hidden", editing: { maxTracks: 4 } });
  assert.equal(sanitizePlanMetaInput({ priceMonthly: 5, price: 1 }).meta.priceMonthly, 5, "priceMonthly wins");
  const bad = sanitizePlanMetaInput({ priceMonthly: -1, visibility: "secret", name: "", editing: { maxTracks: true } });
  assert.equal(bad.errors.length, 4);
});
