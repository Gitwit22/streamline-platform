/**
 * SSRF allowlist for export source URLs (pure helpers, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_DOWNLOAD_LIMITS,
  getAllowedExportSourceHosts,
  hostFromBase,
  redactUrlForLog,
  resolveRedirectUrl,
  validateExportSourceUrl,
} from "./exportSourceUrl.js";

const ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_BUCKET: "media",
  HLS_PUBLIC_BASE_URL: "https://cdn.example.com/hls/",
  EXPORT_SOURCE_ALLOWED_HOSTS: "assets.example.com, https://files.example.org/base",
};

test("allowlist derives R2 endpoint, bucket host, HLS base and extras", () => {
  const hosts = getAllowedExportSourceHosts(ENV);
  assert.ok(hosts.has("acct123.r2.cloudflarestorage.com"));
  assert.ok(hosts.has("acct123.media.r2.cloudflarestorage.com")); // storageClient.getPublicUrl form
  assert.ok(hosts.has("media.acct123.r2.cloudflarestorage.com")); // S3 virtual-hosted form
  assert.ok(hosts.has("cdn.example.com"));
  assert.ok(hosts.has("assets.example.com"));
  assert.ok(hosts.has("files.example.org"));
  assert.equal(hosts.size, 6);
});

test("allowlist falls back to R2_ENDPOINT when no account id", () => {
  const hosts = getAllowedExportSourceHosts({ R2_ENDPOINT: "https://minio.internal.test:9000", R2_BUCKET: "b" });
  assert.ok(hosts.has("minio.internal.test"));
  // bucket-host variant only applies to cloudflarestorage endpoints
  assert.equal(hosts.size, 1);
});

test("allowlist is empty with no config (fail closed)", () => {
  assert.equal(getAllowedExportSourceHosts({}).size, 0);
  assert.equal(validateExportSourceUrl("https://anything.com/x.mp4", getAllowedExportSourceHosts({})).ok, false);
});

test("hostFromBase handles bare hosts, URLs and garbage", () => {
  assert.equal(hostFromBase("Example.COM"), "example.com");
  assert.equal(hostFromBase("https://a.b.c:8443/path?q=1"), "a.b.c");
  assert.equal(hostFromBase(""), null);
  assert.equal(hostFromBase(undefined), null);
  assert.equal(hostFromBase("http://"), null);
});

test("accepts https URLs on allowlisted hosts (incl. presigned query)", () => {
  const hosts = getAllowedExportSourceHosts(ENV);
  const ok = validateExportSourceUrl(
    "https://acct123.r2.cloudflarestorage.com/media/uploads/u1/a.mp4?X-Amz-Signature=abc",
    hosts
  );
  assert.equal(ok.ok, true);
  assert.equal(validateExportSourceUrl("https://ACCT123.MEDIA.r2.cloudflarestorage.com/uploads/u/x.mp4", hosts).ok, true);
  assert.equal(validateExportSourceUrl("https://cdn.example.com:443/hls/r/live.m3u8", hosts).ok, true);
});

test("rejects SSRF vectors", () => {
  const hosts = getAllowedExportSourceHosts(ENV);
  const cases: Array<[string, string]> = [
    ["http://cdn.example.com/a.mp4", "https_required"],
    ["https://169.254.169.254/latest/meta-data/", "host_not_allowed"],
    ["https://localhost/a.mp4", "host_not_allowed"],
    ["https://127.0.0.1/a.mp4", "host_not_allowed"],
    ["https://cdn.example.com.evil.com/a.mp4", "host_not_allowed"],
    ["https://evilcdn.example.com/a.mp4", "host_not_allowed"],
    ["https://user:pass@cdn.example.com/a.mp4", "credentials_not_allowed"],
    ["https://cdn.example.com:8443/a.mp4", "port_not_allowed"],
    ["file:///etc/passwd", "https_required"],
    ["gopher://cdn.example.com/", "https_required"],
    ["not a url", "invalid_url"],
    ["", "empty_url"],
  ];
  for (const [url, reason] of cases) {
    const r = validateExportSourceUrl(url, hosts);
    assert.equal(r.ok, false, url);
    assert.equal(r.reason, reason, url);
  }
  assert.equal(validateExportSourceUrl(42 as any, hosts).ok, false);
  assert.equal(validateExportSourceUrl("https://cdn.example.com/" + "a".repeat(5000), hosts).reason, "url_too_long");
});

test("trailing-dot host is normalised", () => {
  const hosts = getAllowedExportSourceHosts(ENV);
  assert.equal(validateExportSourceUrl("https://cdn.example.com./a.mp4", hosts).ok, true);
});

test("redirect targets resolve relative to the current URL and must be re-validated", () => {
  const hosts = getAllowedExportSourceHosts(ENV);
  const base = "https://cdn.example.com/hls/a.mp4";
  const rel = resolveRedirectUrl(base, "/other/b.mp4");
  assert.equal(rel, "https://cdn.example.com/other/b.mp4");
  assert.equal(validateExportSourceUrl(rel!, hosts).ok, true);

  const abs = resolveRedirectUrl(base, "http://169.254.169.254/");
  assert.equal(validateExportSourceUrl(abs!, hosts).ok, false);
  assert.equal(resolveRedirectUrl(base, undefined), null);
});

test("redactUrlForLog drops query strings (signatures)", () => {
  assert.equal(
    redactUrlForLog("https://h.example.com/a/b.mp4?X-Amz-Signature=secret"),
    "https://h.example.com/a/b.mp4"
  );
  assert.equal(redactUrlForLog("::"), "<invalid-url>");
});

test("download limits are sane", () => {
  assert.equal(EXPORT_DOWNLOAD_LIMITS.maxRedirects, 3);
  assert.equal(EXPORT_DOWNLOAD_LIMITS.maxBytes, 2 * 1024 * 1024 * 1024);
  assert.ok(EXPORT_DOWNLOAD_LIMITS.idleTimeoutMs <= 60_000);
});
