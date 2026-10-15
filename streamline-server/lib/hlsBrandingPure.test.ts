import test from "node:test";
import assert from "node:assert/strict";
import {
  HLS_BRANDING_LIMITS,
  LEGACY_OFFLINE_PLACEHOLDER,
  isValidLogoUrl,
  normalizeStoredHlsConfig,
  publicBranding,
  validateBrandingInput,
  validateHlsConfigBranding,
} from "./hlsBrandingPure";

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

test("normalizeStoredHlsConfig hides only the seeded placeholder", () => {
  assert.equal(normalizeStoredHlsConfig({ enabled: true, offlineMessage: LEGACY_OFFLINE_PLACEHOLDER }).offlineMessage, "");
  // Typed by the owner: kept even when it matches the old placeholder text.
  assert.equal(
    normalizeStoredHlsConfig({ offlineMessage: LEGACY_OFFLINE_PLACEHOLDER, offlineMessageCustom: true }).offlineMessage,
    LEGACY_OFFLINE_PLACEHOLDER
  );
  assert.equal(normalizeStoredHlsConfig({ offlineMessage: "Back Friday" }).offlineMessage, "Back Friday");
  // Channel creation now validates branding like the editor does.
  assert.equal(validateHlsConfigBranding({ title: "x".repeat(81) }).ok, false);
  assert.equal(validateHlsConfigBranding({ logoUrl: "javascript:alert(1)" }).ok, false);
  assert.equal(validateHlsConfigBranding({ title: "Show", logoUrl: "https://a.example/l.png" }).ok, true);
});

test("isValidLogoUrl refuses private / internal hosts (SSRF from the egress browser)", () => {
  for (const u of [
    "http://localhost/a.png",
    "http://127.0.0.1/a.png",
    "http://0x7f000001/a.png",
    "http://2130706433/a.png",
    "http://10.0.0.5/a.png",
    "http://172.20.1.1/a.png",
    "http://192.168.1.1/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/a.png",
    "http://[fd00::1]/a.png",
    "http://[::ffff:127.0.0.1]/a.png",
    "http://metadata.google.internal/a.png",
    "http://intranet/a.png",
    "https://printer.local/a.png",
  ]) {
    assert.equal(isValidLogoUrl(u), false, u);
  }
  assert.equal(isValidLogoUrl("https://172.15.0.1/a.png"), true);
  assert.equal(isValidLogoUrl("https://8.8.8.8/a.png"), true);
  assert.equal(isValidLogoUrl("http://cdn.example.com/a.png"), true);
});
