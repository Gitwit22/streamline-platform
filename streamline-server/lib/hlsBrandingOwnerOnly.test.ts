import test from "node:test";
import assert from "node:assert/strict";
import { canEditHlsBranding, hlsBrandingChanged } from "../routes/roomsHlsConfig";

// Regression: a co-host with canLayout could rewrite the owner's channel
// branding through PUT /api/rooms/:roomId/hls-config.
test("only the owner or a platform admin may change HLS branding", () => {
  assert.equal(canEditHlsBranding("owner"), true);
  assert.equal(canEditHlsBranding("admin"), true);
  assert.equal(canEditHlsBranding("cohost"), false);
  assert.equal(canEditHlsBranding("participant"), false);
  assert.equal(canEditHlsBranding("viewer"), false);
});

test("hlsBrandingChanged ignores unchanged branding and non-branding toggles", () => {
  const room = { hlsConfig: { enabled: true, title: "Show", theme: "dark" } };
  // Co-host toggling HLS / monetization while echoing the stored branding is allowed.
  assert.equal(hlsBrandingChanged(room, { enabled: false, monetizationEnabled: false }), false);
  assert.equal(hlsBrandingChanged(room, { enabled: true, title: "Show", theme: "dark" }), false);
  assert.equal(hlsBrandingChanged(room, { enabled: true, title: "Hijacked" }), true);
  assert.equal(hlsBrandingChanged(room, { enabled: true, theme: "light" }), true);
  assert.equal(hlsBrandingChanged({}, { enabled: true, logoUrl: "https://x.example/l.png" }), true);
});
