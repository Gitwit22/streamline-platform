import test from "node:test";
import assert from "node:assert/strict";
import { claimAndDeleteDoc } from "./claimDelete";

// Regression (audit): two concurrent deletes each released the file's bytes,
// so repeating it pushed the storage counter down and bypassed the limit.
test("only one of two concurrent deletes gets the data (and releases quota)", async () => {
  const store = new Map<string, any>([["a1", { userId: "u1", fileSize: 500 }]]);
  // Serialized transactions over an in-memory store (like Firestore's retry
  // semantics: each transaction sees the previous one's commit).
  let chain: Promise<unknown> = Promise.resolve();
  const runTransaction = <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    const run = chain.then(() =>
      fn({
        get: async (ref: any) => ({ exists: store.has(ref.id), data: () => store.get(ref.id) }),
        delete: (ref: any) => store.delete(ref.id),
      })
    );
    chain = run.catch(() => {});
    return run;
  };
  const ref = { id: "a1" } as any;
  const isOwner = (d: any) => d?.userId === "u1";
  const [a, b] = await Promise.all([
    claimAndDeleteDoc(ref, isOwner, runTransaction),
    claimAndDeleteDoc(ref, isOwner, runTransaction),
  ]);
  const deleted = [a, b].filter((r) => r.status === "deleted");
  assert.equal(deleted.length, 1);
  assert.equal([a, b].filter((r) => r.status === "not_found").length, 1);
  assert.equal(store.has("a1"), false);
  assert.equal((await claimAndDeleteDoc({ id: "x" } as any, isOwner, runTransaction)).status, "not_found");
  store.set("b1", { userId: "someone-else" });
  assert.equal((await claimAndDeleteDoc({ id: "b1" } as any, isOwner, runTransaction)).status, "forbidden");
  assert.equal(store.has("b1"), true);
});
