import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  attachmentContentDisposition,
  buildAttachmentKey,
  fileExtension,
  publicAttachment,
  resolveAttachmentContentType,
  roomAttachmentPrefix,
  sanitizeAttachmentName,
} from "./chatAttachmentsPure";

test("max size is 25 MB", () => {
  assert.equal(CHAT_ATTACHMENT_MAX_BYTES, 25 * 1024 * 1024);
});

test("fileExtension handles dotfiles, no ext and case", () => {
  assert.equal(fileExtension("Report.PDF"), "pdf");
  assert.equal(fileExtension(".env"), "");
  assert.equal(fileExtension("README"), "");
  assert.equal(fileExtension("a.tar.gz"), "gz");
  assert.equal(fileExtension("trailing."), "");
});

test("content type comes from the allowlist, not the client", () => {
  assert.equal(resolveAttachmentContentType("deck.pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(resolveAttachmentContentType("notes.txt"), "text/plain");
  assert.equal(resolveAttachmentContentType("photo.JPG"), "image/jpeg");
  // Never allowed: active content / executables.
  for (const bad of ["page.html", "page.htm", "image.svg", "run.exe", "x.js", "x.sh", "noext", ".pdf", "x.constructor", "x.__proto__"]) {
    assert.equal(resolveAttachmentContentType(bad), null, bad);
  }
});

test("sanitizeAttachmentName strips paths, control chars and leading dots", () => {
  assert.equal(sanitizeAttachmentName("../../etc/passwd.txt"), "passwd.txt");
  assert.equal(sanitizeAttachmentName("C:\\Users\\me\\Plan Q3.docx"), "Plan Q3.docx");
  assert.equal(sanitizeAttachmentName("...hidden.pdf"), "hidden.pdf");
  assert.equal(sanitizeAttachmentName("a\u0000b\u001Fc.pdf"), "abc.pdf");
  assert.equal(sanitizeAttachmentName('q"<x>|?.pdf'), "q__x___.pdf");
  assert.equal(sanitizeAttachmentName("   "), "");
  assert.equal(sanitizeAttachmentName("Résumé.pdf"), "Résumé.pdf");
});

test("sanitizeAttachmentName caps length but keeps the extension", () => {
  const long = "a".repeat(300) + ".pdf";
  const out = sanitizeAttachmentName(long);
  assert.ok(out.length <= 120);
  assert.ok(out.endsWith(".pdf"));
});

test("buildAttachmentKey stays inside room/session/message and is ASCII", () => {
  const key = buildAttachmentKey({ roomId: "room_1", sessionId: "s1", messageId: "m1", fileName: "Résumé final.pdf" });
  assert.equal(key, "room-chat/room_1/s1/m1/R_sum__final.pdf");
  const odd = buildAttachmentKey({ roomId: "r", sessionId: "s", messageId: "m", fileName: "../../x.pdf" });
  assert.equal(odd, "room-chat/r/s/m/_.._x.pdf");
  assert.equal(odd.split("/").length, 5);
  // Ids are rejected, never rewritten (rewriting could collide two rooms).
  assert.throws(() => buildAttachmentKey({ roomId: "../r", sessionId: "s", messageId: "m", fileName: "a.pdf" }));
  assert.throws(() => buildAttachmentKey({ roomId: "r", sessionId: "s/x", messageId: "m", fileName: "a.pdf" }));
  assert.throws(() => buildAttachmentKey({ roomId: "", sessionId: "s", messageId: "m", fileName: "a.pdf" }));
});

test("roomAttachmentPrefix scopes to one room", () => {
  assert.equal(roomAttachmentPrefix("abc"), "room-chat/abc/");
  assert.throws(() => roomAttachmentPrefix("../"));
  assert.throws(() => roomAttachmentPrefix("a.b"));
});

test("attachmentContentDisposition forces download with UTF-8 name", () => {
  const cd = attachmentContentDisposition("Résumé.pdf");
  assert.ok(cd.startsWith("attachment;"));
  assert.ok(cd.includes('filename="R_sum_.pdf"'));
  assert.ok(cd.includes("filename*=UTF-8''R%C3%A9sum%C3%A9.pdf"));
});

test("publicAttachment never exposes the storage key", () => {
  const pub = publicAttachment({ key: "room-chat/r/s/m/a.pdf", name: "a.pdf", size: 10, contentType: "application/pdf" });
  assert.deepEqual(pub, { name: "a.pdf", size: 10, contentType: "application/pdf" });
  assert.equal(publicAttachment(null), null);
  assert.equal(publicAttachment({ name: "no-key.pdf" }), null);
});
