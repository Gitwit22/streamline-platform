import test from "node:test";
import assert from "node:assert/strict";
import { resolveJobsUrl } from "./runJobsCron.js";

test("resolveJobsUrl: explicit URL wins, else origin of base / legacy expire URL", () => {
  assert.equal(resolveJobsUrl({ MAINTENANCE_JOBS_URL: "https://a.example/x" }), "https://a.example/x");
  assert.equal(resolveJobsUrl({ MAINTENANCE_BASE_URL: "https://b.example/" }), "https://b.example/api/maintenance/jobs/run-due");
  assert.equal(
    resolveJobsUrl({ MAINTENANCE_EXPIRE_URL: "https://c.example/api/maintenance/expire-emergency-recordings" }),
    "https://c.example/api/maintenance/jobs/run-due"
  );
  assert.equal(resolveJobsUrl({ MAINTENANCE_BASE_URL: "not a url", MAINTENANCE_EXPIRE_URL: "https://d.example/z" }), "https://d.example/api/maintenance/jobs/run-due");
  assert.equal(resolveJobsUrl({}), null);
});
