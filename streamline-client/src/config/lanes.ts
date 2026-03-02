/**
 * Lane Feature Gate
 *
 * When `true`  → EDU and Corporate lanes are fully accessible.
 * When `false` → All EDU/Corporate routes redirect to the main app;
 *                only the Creator (main) lane is available.
 *
 * Flip this single flag before publishing to disable side-lanes.
 */
export const LANES_ENABLED = false;
