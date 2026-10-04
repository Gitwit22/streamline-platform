import test from "node:test";
import assert from "node:assert/strict";

import { compositorUrl, egressTemplateBase, egressTemplateBaseSource, instagramAspectFor } from "./egressTemplate";

test("egressTemplateBase prefers EGRESS_TEMPLATE_BASE_URL, then RENDER_EXTERNAL_URL", () => {
  assert.equal(egressTemplateBase({}), null);
  assert.equal(egressTemplateBase({ RENDER_EXTERNAL_URL: "https://api.onrender.com" }), "https://api.onrender.com");
  assert.equal(
    egressTemplateBase({ EGRESS_TEMPLATE_BASE_URL: "https://api.example.com//", RENDER_EXTERNAL_URL: "https://x" }),
    "https://api.example.com",
  );
  assert.equal(egressTemplateBase({ EGRESS_TEMPLATE_BASE_URL: "api.example.com" }), null);
  assert.equal(egressTemplateBaseSource({ RENDER_EXTERNAL_URL: "https://x" }), "RENDER_EXTERNAL_URL");
  assert.equal(egressTemplateBaseSource({}), null);
});

test("compositorUrl appends the orientation", () => {
  const env = { EGRESS_TEMPLATE_BASE_URL: "https://api.example.com/" };
  assert.equal(
    compositorUrl("landscape", env),
    "https://api.example.com/egress-templates/program-compositor.html?aspect=landscape",
  );
  assert.equal(
    compositorUrl("portrait", env),
    "https://api.example.com/egress-templates/program-compositor.html?aspect=portrait",
  );
  assert.equal(compositorUrl("portrait", {}), null);
});

test("instagramAspectFor maps the reels hint (and unknown hints) to portrait", () => {
  assert.equal(instagramAspectFor("instagram_reels_9x16"), "portrait");
  assert.equal(instagramAspectFor(undefined), "portrait");
  assert.equal(instagramAspectFor("whatever"), "portrait");
  assert.equal(instagramAspectFor("landscape_16x9"), "landscape");
});
