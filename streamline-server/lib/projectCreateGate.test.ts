import test from "node:test";
import assert from "node:assert/strict";
import { decideProjectCreate, projectCountNeeded } from "./projectCreateGate";

test("projects: null limit = unlimited (no count query needed)", () => {
  assert.equal(projectCountNeeded(null), false);
  assert.equal(decideProjectCreate({ planHasProjects: true, planId: "pro", limit: null, existingCount: 10_000 }).allowed, true);
});

test("projects: 0 = none included (409, no count query)", () => {
  assert.equal(projectCountNeeded(0), false);
  const d = decideProjectCreate({ planHasProjects: true, planId: "free", limit: 0, existingCount: 0 });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 409);
  assert.equal(d.body?.error, "limit_exceeded");
  assert.match(String(d.body?.reason), /not included/);
});

test("projects: cap n allows up to n existing projects, then 409", () => {
  assert.equal(projectCountNeeded(3), true);
  assert.equal(decideProjectCreate({ planHasProjects: true, planId: "starter", limit: 3, existingCount: 2 }).allowed, true);
  const full = decideProjectCreate({ planHasProjects: true, planId: "starter", limit: 3, existingCount: 3 });
  assert.equal(full.allowed, false);
  assert.equal(full.status, 409);
  assert.equal(full.body?.limit, 3);
  assert.equal(decideProjectCreate({ planHasProjects: true, planId: "starter", limit: 3, existingCount: 7 }).allowed, false);
});

test("projects: plan without the projects feature -> 403 feature_not_entitled", () => {
  const d = decideProjectCreate({ planHasProjects: false, planId: "free", limit: null, existingCount: 0 });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 403);
  assert.equal(d.body?.error, "feature_not_entitled");
});
