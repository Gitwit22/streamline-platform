import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Regression (audit P1-5): account purge left most user data behind. This
// guards coverage: every user-owned collection listed by the audit must be
// handled by the purge (or be kept on purpose and documented there).
test("account purge covers every user-owned collection", () => {
  const dir = path.resolve(__dirname, "../../../lib/jobs");
  const src = ["accountPurge.ts", "accountPurgeUserData.ts"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  const required = [
    "recordings",
    "saved_videos",
    "editing_assets",
    "uploads/${uid}/",
    "project_assets",
    "projects",
    "projects/${uid}/",
    "rooms",
    "roomInvites",
    "savedEmbeds",
    "brandKits",
    "audioDecks",
    "collaboratorRelationships",
    "auth.deleteUser",
    "recursiveDelete(doc.ref)", // user doc + all subcollections (destinations = stream keys)
  ];
  for (const r of required) assert.ok(src.includes(r), `account purge does not handle ${r}`);
});
