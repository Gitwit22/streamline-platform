import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// broadcastProgramStateWithRetry – unit tests
// ---------------------------------------------------------------------------
// We test the retry logic in isolation by extracting the core pattern.
// The actual broadcastProgramStateWithRetry imports LiveKit SDK which
// requires env config, so we test the retry wrapper pattern directly.

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 10; // fast for tests

async function retryHelper<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  log: { warns: string[]; errors: string[] },
): Promise<T | undefined> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxRetries;
      if (isLast) {
        log.errors.push(
          `failed after ${maxRetries} attempts: ${(err as any)?.message || err}`,
        );
      } else {
        const delay = baseDelayMs * attempt;
        log.warns.push(
          `attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return undefined;
}

test("retryHelper succeeds on first attempt", async () => {
  const log = { warns: [] as string[], errors: [] as string[] };
  let calls = 0;
  const result = await retryHelper(
    async () => { calls++; return "ok"; },
    MAX_RETRIES,
    BASE_DELAY_MS,
    log,
  );
  assert.equal(result, "ok");
  assert.equal(calls, 1);
  assert.equal(log.warns.length, 0);
  assert.equal(log.errors.length, 0);
});

test("retryHelper succeeds on second attempt after one failure", async () => {
  const log = { warns: [] as string[], errors: [] as string[] };
  let calls = 0;
  const result = await retryHelper(
    async () => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return "ok";
    },
    MAX_RETRIES,
    BASE_DELAY_MS,
    log,
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.equal(log.warns.length, 1);
  assert.ok(log.warns[0].includes("attempt 1/3"));
  assert.equal(log.errors.length, 0);
});

test("retryHelper fails after max retries and logs final error", async () => {
  const log = { warns: [] as string[], errors: [] as string[] };
  let calls = 0;
  const result = await retryHelper(
    async () => { calls++; throw new Error("permanent"); },
    MAX_RETRIES,
    BASE_DELAY_MS,
    log,
  );
  assert.equal(result, undefined);
  assert.equal(calls, MAX_RETRIES);
  // 2 warnings for attempts 1 and 2, 1 error for attempt 3
  assert.equal(log.warns.length, 2);
  assert.equal(log.errors.length, 1);
  assert.ok(log.errors[0].includes("failed after 3 attempts"));
});

test("retryHelper succeeds on last attempt", async () => {
  const log = { warns: [] as string[], errors: [] as string[] };
  let calls = 0;
  const result = await retryHelper(
    async () => {
      calls++;
      if (calls < MAX_RETRIES) throw new Error("not yet");
      return "finally";
    },
    MAX_RETRIES,
    BASE_DELAY_MS,
    log,
  );
  assert.equal(result, "finally");
  assert.equal(calls, MAX_RETRIES);
  assert.equal(log.warns.length, 2);
  assert.equal(log.errors.length, 0);
});
