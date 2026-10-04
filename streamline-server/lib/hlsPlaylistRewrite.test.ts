import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafePlaylistPath, resolveObjectKey, rewritePlaylist } from "./hlsPlaylistRewrite";

const PREFIX = "hls/room1/p-abc/";
const resolvers = {
  playlist: (_key: string, rel: string) => `/api/hls/play/room1/${rel}?token=T`,
  media: (key: string) => `https://r2.example/${key}?sig=1`,
};

describe("resolveObjectKey", () => {
  it("resolves relative URIs against the playlist directory", () => {
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}live.m3u8`, "seg-00001.ts"), `${PREFIX}seg-00001.ts`);
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}v1/index.m3u8`, "../v2/index.m3u8"), `${PREFIX}v2/index.m3u8`);
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}live.m3u8`, "./a/b.ts?x=1#f"), `${PREFIX}a/b.ts`);
  });

  it("refuses absolute, root-relative and prefix-escaping URIs", () => {
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}live.m3u8`, "https://cdn/x.ts"), null);
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}live.m3u8`, "//cdn/x.ts"), null);
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}live.m3u8`, "/hls/room1/p-abc/x.ts"), null);
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}live.m3u8`, "../other/x.ts"), null);
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}live.m3u8`, "../../../../etc/passwd"), null);
    assert.equal(resolveObjectKey(PREFIX, `${PREFIX}live.m3u8`, "data:text/plain,abc"), null);
  });
});

describe("rewritePlaylist", () => {
  it("media playlist: segments → presigned, tags kept, CRLF normalized", () => {
    const src = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:6",
      "#EXT-X-MEDIA-SEQUENCE:12",
      "#EXTINF:6.000,",
      "seg-00012.ts",
      "#EXTINF:6.000,",
      "seg-00013.ts",
      "",
    ].join("\r\n");
    const out = rewritePlaylist(src, { prefix: PREFIX, baseKey: `${PREFIX}live.m3u8` }, resolvers);
    assert.equal(
      out,
      [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:6",
        "#EXT-X-MEDIA-SEQUENCE:12",
        "#EXTINF:6.000,",
        `https://r2.example/${PREFIX}seg-00012.ts?sig=1`,
        "#EXTINF:6.000,",
        `https://r2.example/${PREFIX}seg-00013.ts?sig=1`,
        "",
      ].join("\n")
    );
  });

  it("master playlist: variants and EXT-X-MEDIA renditions go back through the API with the token", () => {
    const src = [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="audio/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,AUDIO="aud"',
      "v720/index.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=800000",
      "v360/playlist",
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframes.m3u8"',
    ].join("\n");
    const out = rewritePlaylist(src, { prefix: PREFIX, baseKey: `${PREFIX}master.m3u8` }, resolvers).split("\n");
    assert.equal(out[1], '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="/api/hls/play/room1/audio/en.m3u8?token=T"');
    assert.equal(out[3], "/api/hls/play/room1/v720/index.m3u8?token=T");
    // A URI after EXT-X-STREAM-INF is a playlist even without the extension.
    assert.equal(out[5], "/api/hls/play/room1/v360/playlist?token=T");
    assert.equal(out[6], '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="/api/hls/play/room1/iframes.m3u8?token=T"');
  });

  it("EXT-X-MAP init sections and EXT-X-KEY keys are presigned; skd:/data: keys untouched", () => {
    const src = [
      "#EXTM3U",
      '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/k1.key",IV=0x1',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm-id",KEYFORMAT="com.apple.streamingkeydelivery"',
      "#EXTINF:2,",
      "../p-abc/chunk1.m4s",
    ].join("\n");
    const out = rewritePlaylist(src, { prefix: PREFIX, baseKey: `${PREFIX}live.m3u8` }, resolvers).split("\n");
    assert.equal(out[1], `#EXT-X-MAP:URI="https://r2.example/${PREFIX}init.mp4?sig=1",BYTERANGE="720@0"`);
    assert.equal(out[2], `#EXT-X-KEY:METHOD=AES-128,URI="https://r2.example/${PREFIX}keys/k1.key?sig=1",IV=0x1`);
    assert.equal(out[3], '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm-id",KEYFORMAT="com.apple.streamingkeydelivery"');
    assert.equal(out[5], `https://r2.example/${PREFIX}chunk1.m4s?sig=1`);
  });

  it("leaves absolute and out-of-prefix URIs unchanged", () => {
    const src = ["#EXTM3U", "#EXTINF:6,", "https://elsewhere/x.ts", "#EXTINF:6,", "../../room2/x.ts"].join("\n");
    const out = rewritePlaylist(src, { prefix: PREFIX, baseKey: `${PREFIX}live.m3u8` }, resolvers).split("\n");
    assert.equal(out[2], "https://elsewhere/x.ts");
    assert.equal(out[4], "../../room2/x.ts");
  });

  it("playlist path validation for the play route", () => {
    assert.equal(isSafePlaylistPath("live.m3u8"), true);
    assert.equal(isSafePlaylistPath("v720/index.m3u8"), true);
    assert.equal(isSafePlaylistPath("seg-1.ts"), false);
    assert.equal(isSafePlaylistPath("../x.m3u8"), false);
    assert.equal(isSafePlaylistPath("a//b.m3u8"), false);
    assert.equal(isSafePlaylistPath(".hidden.m3u8"), false);
  });
});
