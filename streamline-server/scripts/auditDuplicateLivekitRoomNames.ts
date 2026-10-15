/**
 * READ-ONLY. Lists rooms whose livekitRoomName is shared with another room
 * (audit P0-1, 2026-10-15). Before the fix, new rooms used the typed label as
 * their LiveKit room name, so different hosts could end up in the same
 * LiveKit room. New rooms now use their roomId; this finds existing pairs.
 *
 * Usage: npm run rooms:audit-duplicate-livekit-names
 * Output: one line per shared name with the rooms and owners involved.
 * Writes nothing.
 */
import { firestore } from "../firebaseAdmin";

async function main() {
  const byName = new Map<string, Array<{ roomId: string; ownerId: string }>>();
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;
  for (;;) {
    let q: FirebaseFirestore.Query = firestore.collection("rooms").orderBy("__name__").limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned += 1;
      const d = (doc.data() || {}) as any;
      const name = String(d.livekitRoomName || doc.id).trim();
      const list = byName.get(name) || [];
      list.push({ roomId: doc.id, ownerId: String(d.ownerId || "") });
      byName.set(name, list);
    }
    last = snap.docs[snap.docs.length - 1];
  }
  let shared = 0;
  let crossOwner = 0;
  for (const [name, rooms] of byName) {
    if (rooms.length < 2) continue;
    shared += 1;
    const owners = new Set(rooms.map((r) => r.ownerId));
    if (owners.size > 1) crossOwner += 1;
    console.log(
      `${owners.size > 1 ? "CROSS-OWNER" : "same-owner "}  "${name}"  ${rooms.map((r) => `${r.roomId}(owner ${r.ownerId || "?"})`).join(", ")}`
    );
  }
  console.log(`\nScanned ${scanned} rooms. Shared LiveKit names: ${shared} (${crossOwner} across different owners).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
