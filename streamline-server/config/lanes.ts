/**
 * Lane Feature Gate — Server side
 *
 * When `true`  → EDU and Corporate API routes are mounted.
 * When `false` → All /api/edu and /api/corp requests are rejected.
 *
 * To enable side-lanes, set env var LANES_ENABLED=1 or flip this constant.
 */
export const LANES_ENABLED =
  process.env.LANES_ENABLED === "1" || process.env.LANES_ENABLED === "true";
