import test from "node:test";
import assert from "node:assert/strict";
import { HLS_BRANDING_LIMITS, isValidLogoUrl, publicBranding, validateBrandingInput } from "./hlsBrandingPure";

test("isValidLogoUrl accepts empty and http(s) only", () => {
  assert.equal(isValidLogoUrl(""), true);
  assert.equal(isValidLogoUrl("https://cdn.example.com/logo.png"), true);
  assert.equal(isValidLogoUrl("http://example.com/a.svg"), true);
  assert.equal(isValidLogoUrl("javascript:alert(1)"), false);
  assert.equal(isValidLogoUrl("data:image/png;base64,AAAA"), false);
  assert.equal(isValidLogoUrl("/logo.png"), false);
  assert.equal(isValidLogoUrl("https://" + "a".repeat(HLS_BRANDING_LIMITS.logoUrl)), false);
});

test("validateBrandingInput enforces lengths and logo URL", () => {
  assert.deepEqual(validateBrandingInput({}), { ok: true });
  assert.deepEqual(validateBrandingInput({ title: "My show", logoUrl: "" }), { ok: true });
  const long = validateBrandingInput({ title: "x".repeat(HLS_BRANDING_LIMITS.title + 1) });
  assert.equal(long.ok, false);
  assert.equal(!long.ok && long.field, "title");
  const bad = validateBrandingInput({ logoUrl: "ftp://x/y.png" });
  assert.equal(!bad.ok && bad.field, "logoUrl");
});

test("publicBranding normalizes and drops unsafe logos", () => {
  assert.equal(publicBranding(null), null);
  assert.deepEqual(publicBranding({ title: "T", theme: "light", logoUrl: "javascript:x", enabled: true }), {
    title: "T",
    subtitle: "",
    logoUrl: "",
    offlineMessage: "",
    theme: "light",
  });
  assert.equal(publicBranding({ theme: "neon" })!.theme, "dark");
});
