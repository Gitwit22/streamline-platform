import test from "node:test";
import assert from "node:assert/strict";
import {
  brandAssetContentType,
  brandAssetFileName,
  brandAssetKey,
  brandAssetKeyFromParams,
  brandAssetPrefix,
  brandAssetPublicUrl,
  detectImageType,
  resolvePublicApiBase,
} from "./brandAssetsPure";
import { isValidLogoUrl } from "./hlsBrandingPure";
import { parseKitVideoInput } from "./programOverlayPure";

const bytes = (...xs: Array<number | string>) =>
  Uint8Array.from(xs.flatMap((x) => (typeof x === "string" ? Array.from(x, (c) => c.charCodeAt(0)) : [x])));

test("detectImageType: recognizes png/jpg/gif/webp from magic bytes", () => {
  assert.equal(detectImageType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))?.ext, "png");
  assert.equal(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))?.contentType, "image/jpeg");
  assert.equal(detectImageType(bytes("GIF89a", 0, 0))?.ext, "gif");
  assert.equal(detectImageType(bytes("GIF87a", 0, 0))?.ext, "gif");
  assert.equal(detectImageType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))?.ext, "webp");
});

test("detectImageType: rejects SVG, HTML, truncated and look-alike files", () => {
  assert.equal(detectImageType(bytes("<svg xmlns")), null);
  assert.equal(detectImageType(bytes("<!DOCTYPE html>")), null);
  assert.equal(detectImageType(bytes("<?xml ver")), null);
  assert.equal(detectImageType(bytes(0x89, "PN")), null);
  assert.equal(detectImageType(bytes("RIFF", 0, 0, 0, 0, "WAVE")), null); // audio, not webp
  assert.equal(detectImageType(new Uint8Array()), null);
});

test("keys stay under brand-assets/{uid}/ and reject traversal", () => {
  const file = brandAssetFileName("a".repeat(24), "png");
  assert.equal(brandAssetKey("user_1", file), `brand-assets/user_1/${file}`);
  assert.equal(brandAssetPrefix("user_1"), "brand-assets/user_1/");
  assert.throws(() => brandAssetPrefix("../x"));
  assert.throws(() => brandAssetPrefix(""));
  assert.throws(() => brandAssetKey("u", "../../recordings/x.png"));
  assert.throws(() => brandAssetFileName("XYZ", "png"));
});

test("brandAssetKeyFromParams: only resolves well-formed brand asset names", () => {
  const ok = `${"0123456789abcdef01234567"}.webp`;
  assert.equal(brandAssetKeyFromParams("uid1", ok), `brand-assets/uid1/${ok}`);
  for (const [u, f] of [
    ["uid1", "..%2f..%2fsecret.png"],
    ["uid1", "0123456789abcdef01234567.svg"],
    ["uid1", "0123456789abcdef01234567.png.html"],
    ["uid1", "short.png"],
    ["a/b", ok],
    ["..", ok],
    [undefined, ok],
    ["uid1", 7],
  ] as Array<[unknown, unknown]>) {
    assert.equal(brandAssetKeyFromParams(u, f), null, `${String(u)}/${String(f)}`);
  }
  assert.equal(brandAssetContentType(ok), "image/webp");
  assert.equal(brandAssetContentType("x.svg"), null);
});

test("public URL passes the existing logo and background validators unchanged", () => {
  const file = brandAssetFileName("b".repeat(24), "jpg");
  const url = brandAssetPublicUrl("https://api.example.com/", "uid1", file);
  assert.equal(url, `https://api.example.com/api/public/brand-assets/uid1/${file}`);
  assert.equal(isValidLogoUrl(url), true);
  assert.equal(parseKitVideoInput({ backgroundImageUrl: url }).ok, true);
});

test("resolvePublicApiBase: configured origin wins, else the request origin", () => {
  assert.equal(resolvePublicApiBase("https://cfg.example.com/", "http", "x"), "https://cfg.example.com");
  assert.equal(resolvePublicApiBase(null, "https", "api.example.com"), "https://api.example.com");
  assert.equal(resolvePublicApiBase("not-a-url", "https", "api.example.com"), "https://api.example.com");
  assert.equal(resolvePublicApiBase(null, "https", ""), null);
  assert.equal(resolvePublicApiBase(null, "ftp", "x.com"), null);
});
