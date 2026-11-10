import test from "node:test";
import assert from "node:assert/strict";
import {
  broadcastStateFromHls,
  checkStartAgainstBroadcast,
  decidePpvPlayback,
  effectiveEventStatus,
  isCheckoutOpen,
  isLivePaidEvent,
  pickBroadcastEventId,
  planTransition,
  priceChangeRequested,
  PPV_LIFECYCLE_VERSION,
  type BroadcastState,
  type LifecycleEvent,
} from "./ppvLifecyclePure";

const v2 = (id: string, status: "draft" | "live" | "ended", mode = "fixed"): LifecycleEvent => ({
  id,
  roomId: "room1",
  monetizationMode: mode,
  status,
  lifecycleVersion: PPV_LIFECYCLE_VERSION,
});
const legacy = (id: string, status: "draft" | "live" | "ended"): LifecycleEvent => ({
  id,
  roomId: "room1",
  monetizationMode: "fixed",
  status,
});
const OFF_AIR: BroadcastState = { live: false, protected: false, eventId: null };
const onAir = (eventId: string | null, prot = true): BroadcastState => ({ live: true, protected: prot, eventId });

function play(event: LifecycleEvent | null, broadcast: BroadcastState, hasTicket: boolean, extra: Partial<Parameters<typeof decidePpvPlayback>[0]> = {}) {
  const d = decidePpvPlayback({ isHost: false, event, eventInRoom: !!event, broadcast, hasTicket, salesOpen: true, ...extra });
  return d.kind === "deny" ? `deny:${d.error}` : d.kind === "wait" ? `wait:${d.reason}` : d.kind;
}

test("legacy events keep paywalling (draft or live) until ended; v2 drafts are scheduled", () => {
  assert.equal(effectiveEventStatus(legacy("a", "draft")), "live");
  assert.equal(effectiveEventStatus(legacy("a", "live")), "live");
  assert.equal(effectiveEventStatus(legacy("a", "ended")), "ended");
  assert.equal(effectiveEventStatus(v2("b", "draft")), "scheduled");
  assert.equal(isLivePaidEvent(legacy("a", "draft")), true);
  assert.equal(isLivePaidEvent(v2("b", "draft")), false);
  assert.equal(isLivePaidEvent(v2("b", "live")), true);
  assert.equal(isLivePaidEvent(v2("d", "live", "donation")), false);
});

test("checkout: open for scheduled (presale) and live, closed for ended or off", () => {
  assert.equal(isCheckoutOpen(v2("a", "draft")), true);
  assert.equal(isCheckoutOpen(v2("a", "live")), true);
  assert.equal(isCheckoutOpen(v2("a", "ended")), false);
  assert.equal(isCheckoutOpen(v2("a", "live", "off")), false);
  assert.equal(isCheckoutOpen(null), false);
});

test("transitions are validated and idempotent", () => {
  assert.deepEqual(planTransition(v2("a", "draft"), "start"), { ok: true, noop: false, to: "live" });
  assert.deepEqual(planTransition(v2("a", "live"), "start"), { ok: true, noop: true, to: "live" });
  assert.deepEqual(planTransition(v2("a", "live"), "end"), { ok: true, noop: false, to: "ended" });
  assert.deepEqual(planTransition(v2("a", "ended"), "end"), { ok: true, noop: true, to: "ended" });
  const restart = planTransition(v2("a", "ended"), "start");
  assert.equal(restart.ok, false);
  // Legacy draft is effectively live: Start writes the explicit status once.
  assert.deepEqual(planTransition(legacy("l", "draft"), "start"), { ok: true, noop: false, to: "live" });
});

test("price changes are detected (currency case-insensitive), other fields ignored", () => {
  const ev = { monetizationMode: "fixed", currency: "usd", fixedAmountCents: 1000, pwywMinCents: null, name: "x" };
  assert.deepEqual(priceChangeRequested(ev, { name: "y", currency: "USD", fixedAmountCents: 1000 }), []);
  assert.deepEqual(priceChangeRequested(ev, { fixedAmountCents: 1500 }), ["fixedAmountCents"]);
  assert.deepEqual(priceChangeRequested(ev, { monetizationMode: "pwyw", pwywMinCents: 100 }), ["monetizationMode", "pwywMinCents"]);
});

test("broadcast state from rooms/{id}.hls", () => {
  assert.deepEqual(broadcastStateFromHls(null), OFF_AIR);
  assert.deepEqual(broadcastStateFromHls({ status: "live", prefix: "hls/r/p-abc/", ppvEventId: "e1" }), onAir("e1"));
  assert.deepEqual(broadcastStateFromHls({ status: "starting", prefix: "hls/r/" }), onAir(null, false));
  assert.equal(broadcastStateFromHls({ status: "idle", prefix: "hls/r/p-x/", ppvEventId: "e1" }).live, false);
});

test("a new broadcast binds to the single live event, an explicit pick, or nothing (fail closed)", () => {
  assert.equal(pickBroadcastEventId(["e1"], null), "e1");
  assert.equal(pickBroadcastEventId([], null), null);
  assert.equal(pickBroadcastEventId(["e1", "e2"], null), null);
  assert.equal(pickBroadcastEventId(["e1", "e2"], "e2"), "e2");
  assert.equal(pickBroadcastEventId(["e1"], "gone"), "e1");
});

test("starting a paid event is refused while the room streams publicly", () => {
  assert.deepEqual(checkStartAgainstBroadcast(OFF_AIR, "e2"), { ok: true, restartRequired: false });
  assert.deepEqual(checkStartAgainstBroadcast(onAir(null, false), "e2"), { ok: false, error: "broadcast_public_restart_required" });
  assert.deepEqual(checkStartAgainstBroadcast(onAir("e1"), "e2"), { ok: true, restartRequired: true });
  assert.deepEqual(checkStartAgainstBroadcast(onAir("e2"), "e2"), { ok: true, restartRequired: false });
});

// ── End-to-end scenario on one room (pure model of the production flow) ──
test("two events on one room: schedule during the first, end it, go live with the second", () => {
  // Week 1 started and on air; week 2 scheduled during the show.
  let week1 = v2("w1", "live");
  let week2 = v2("w2", "draft");
  let broadcast = onAir("w1");

  // Scheduling week 2 changes nothing for week 1 buyers.
  assert.equal(play(week1, broadcast, true), "play");
  assert.equal(isLivePaidEvent(week2), false, "scheduled event does not paywall/claim the room");
  // Week 2 presale works while week 1 is live; a week 2 ticket can't watch week 1.
  assert.equal(play(week2, broadcast, false), "checkout");
  assert.equal(play(week2, broadcast, true), "wait:other_event");
  // A week 1 ticket presented on the week 2 page (wrong event) is not a week 2 ticket.
  assert.equal(play(week2, broadcast, false), "checkout");

  // Week 2 can't be started while week 1 is still started (enforced in the
  // transition transaction: another_event_live) — the lifecycle allows it only after End.
  week1 = { ...week1, status: "ended" };
  assert.equal(play(week1, broadcast, true), "deny:ppv_event_ended", "ending stops live playback");
  assert.equal(isCheckoutOpen(week1), false, "ended event takes no new checkout");

  // Start week 2 while week 1's protected run is still on air → restart needed.
  assert.deepEqual(checkStartAgainstBroadcast(broadcast, "w2"), { ok: true, restartRequired: true });
  week2 = { ...week2, status: "live" };
  assert.equal(play(week2, broadcast, true), "wait:other_event", "old run never serves week 2");

  // Host restarts: the new run binds to the single live event (week 2).
  broadcast = onAir(pickBroadcastEventId([week2.id], null));
  assert.equal(broadcast.eventId, "w2");
  assert.equal(play(week2, broadcast, true), "play");
  assert.equal(play(week1, broadcast, true), "deny:ppv_event_ended", "week 1 ticket can't reach week 2");
  assert.equal(play(week2, broadcast, false), "checkout");
});

test("legacy live broadcast with no event binding fails closed for ticket holders, hosts still watch", () => {
  const ev = legacy("old", "live");
  const unbound = onAir(null, false);
  assert.equal(play(ev, unbound, true), "deny:ppv_broadcast_unassigned");
  assert.equal(play(null, unbound, false), "deny:ppv_broadcast_unassigned");
  assert.equal(decidePpvPlayback({ isHost: true, event: ev, eventInRoom: true, broadcast: unbound, hasTicket: false, salesOpen: true }).kind, "play");
});

test("event from another room, sales closed, and offline states", () => {
  const ev = v2("e", "live");
  assert.equal(play(ev, onAir("e"), true, { eventInRoom: false }), "deny:event_not_found");
  assert.equal(play(ev, onAir("e"), false, { salesOpen: false }), "deny:ppv_unavailable");
  assert.equal(play(ev, OFF_AIR, true), "wait:offline");
  assert.equal(play(v2("d", "live", "donation"), onAir("d"), false), "deny:ppv_unavailable");
});
