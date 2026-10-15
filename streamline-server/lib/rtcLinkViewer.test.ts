import test from "node:test";
import assert from "node:assert/strict";
import { rtcLinkViewerAllowed } from "./roomAccessPolicy";

// Regression (audit P1-1): a pay-per-view channel could be watched for free by
// joining its link/public production room as a viewer.
test("free room viewers must pass the channel's viewer access", () => {
  assert.equal(rtcLinkViewerAllowed("public", false), true);
  assert.equal(rtcLinkViewerAllowed("registered", false), false);
  assert.equal(rtcLinkViewerAllowed("registered", true), true);
  assert.equal(rtcLinkViewerAllowed("pay_per_view", true), false);
  assert.equal(rtcLinkViewerAllowed("subscriber", true), false);
  assert.equal(rtcLinkViewerAllowed("private", true), false);
});
