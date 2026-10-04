import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TICKET_HISTORY,
  allowedNextStatuses,
  applyTicketPatch,
  canTransition,
  normalizeTicketStatus,
  parseTicketPatch,
  storedStatusesFor,
  toTicketDTO,
} from "./supportTicketsPure";

const admin = { uid: "admin1", email: "a@x.io" };

test("normalizeTicketStatus: legacy 'new' and unknown read as open", () => {
  assert.equal(normalizeTicketStatus("new"), "open");
  assert.equal(normalizeTicketStatus(undefined), "open");
  assert.equal(normalizeTicketStatus("In Progress"), "in_progress");
  assert.equal(normalizeTicketStatus("resolved"), "resolved");
  assert.deepEqual(storedStatusesFor("open"), ["open", "new"]);
  assert.deepEqual(storedStatusesFor("closed"), ["closed"]);
});

test("status transitions", () => {
  assert.equal(canTransition("open", "in_progress"), true);
  assert.equal(canTransition("open", "closed"), true);
  assert.equal(canTransition("in_progress", "resolved"), true);
  assert.equal(canTransition("resolved", "open"), true, "reopen");
  assert.equal(canTransition("resolved", "in_progress"), false);
  assert.equal(canTransition("closed", "in_progress"), false, "closed must be reopened first");
  assert.equal(canTransition("closed", "resolved"), false);
  assert.equal(canTransition("closed", "open"), true);
  assert.equal(canTransition("closed", "closed"), true, "no-op");
  assert.deepEqual(allowedNextStatuses("closed"), ["open"]);
});

test("parseTicketPatch validation", () => {
  assert.deepEqual(parseTicketPatch({ status: "resolved" }), { ok: true, value: { status: "resolved" } });
  assert.equal(parseTicketPatch({ status: "new" }).ok, false);
  assert.equal(parseTicketPatch({}).ok, false);
  assert.equal(parseTicketPatch({ internalNote: "   " }).ok, false, "blank note only => nothing to update");
  assert.equal(parseTicketPatch({ internalNote: "x".repeat(5000) }).ok, false);
  assert.deepEqual(parseTicketPatch({ assignee: "" }), { ok: true, value: { assignee: null } });
  assert.equal(parseTicketPatch({ assignee: 5 }).ok, false);
  assert.equal(parseTicketPatch(null).ok, false);
});

test("applyTicketPatch: status change writes history and timestamps", () => {
  const r = applyTicketPatch({ status: "new" }, { status: "in_progress" }, admin, 1000);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.from, "open");
  assert.equal(r.to, "in_progress");
  assert.equal(r.update.status, "in_progress");
  assert.deepEqual(r.update.history, [{ at: 1000, by: "admin1", action: "status", from: "open", to: "in_progress" }]);
  assert.deepEqual(r.changed, ["status"]);
  assert.equal(r.update.updatedAtMs, 1000);

  const resolved = applyTicketPatch({ status: "in_progress", history: r.update.history }, { status: "resolved" }, admin, 2000);
  assert.equal(resolved.ok && resolved.update.resolvedAtMs, 2000);
  assert.equal(resolved.ok && resolved.update.history.length, 2);
});

test("applyTicketPatch: illegal transition is rejected", () => {
  const r = applyTicketPatch({ status: "closed" }, { status: "in_progress" }, admin, 1);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "invalid_transition");
});

test("applyTicketPatch: note + assignee, no status change", () => {
  const r = applyTicketPatch({ status: "open", assignee: null }, { assignee: "sam", internalNote: "called user" }, admin, 5);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.update.status, undefined);
  assert.equal(r.update.assignee, "sam");
  assert.deepEqual(r.update.internalNotes, [{ at: 5, by: "admin1", byEmail: "a@x.io", text: "called user" }]);
  assert.deepEqual(r.changed, ["assignee", "note"]);
});

test("applyTicketPatch: same assignee is a no-op; legacy 'new' + open normalizes status", () => {
  const same = applyTicketPatch({ status: "open", assignee: "sam" }, { assignee: "sam" }, admin, 5);
  assert.equal(same.ok && Object.keys(same.update).length, 0);
  const norm = applyTicketPatch({ status: "new" }, { status: "open" }, admin, 5);
  assert.equal(norm.ok && norm.update.status, "open");
  assert.deepEqual(norm.ok && norm.changed, []);
});

test("applyTicketPatch: history is capped", () => {
  const history = Array.from({ length: MAX_TICKET_HISTORY }, (_, i) => ({ at: i, by: "x", action: "note" }));
  const r = applyTicketPatch({ status: "open", history }, { internalNote: "n" }, admin, 9999);
  assert.equal(r.ok && r.update.history.length, MAX_TICKET_HISTORY);
  assert.equal(r.ok && r.update.history[MAX_TICKET_HISTORY - 1].at, 9999);
});

test("toTicketDTO: maps public-form tickets and hides the ip hash", () => {
  const dto: any = toTicketDTO(
    "t1",
    {
      status: "new",
      createdAt: { toMillis: () => 123 },
      submitter: { uid: null, email: "u@x.io", auth: "anonymous" },
      content: { subject: "Help", message: "It broke", category: "billing", priority: "high" },
      meta: { ipHash: "secret", pageUrl: "/support", userAgent: "ua", context: {} },
    },
    { full: true }
  );
  assert.equal(dto.status, "open");
  assert.equal(dto.subject, "Help");
  assert.equal(dto.message, "It broke");
  assert.equal(dto.createdAtMs, 123);
  assert.deepEqual(dto.allowedNext, ["in_progress", "resolved", "closed"]);
  assert.equal(JSON.stringify(dto).includes("secret"), false);
  const summary: any = toTicketDTO("t1", { status: "closed" });
  assert.equal(summary.message, undefined);
});
