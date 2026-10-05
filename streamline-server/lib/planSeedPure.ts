/**
 * Plan seeding / reset / admin edit validation (pure, no I/O).
 *
 *   POST /api/admin/plans/seed                 -> planMissingFieldsPatch (never overwrites)
 *   GET  /api/admin/plans/:id/reset-preview    -> planResetDiff
 *   POST /api/admin/plans/:id/reset            -> canonical values (after the diff was shown)
 *   PUT  /api/admin/plans/:id                  -> sanitizePlanMetaInput (non-entitlement fields)
 */
import { isV2PlanDoc, normalizePlanDoc, toPlanDocV2 } from "./entitlements/normalizePlanV2";
import type { PlanDocV2 } from "./entitlements/planCatalog";

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/** Leaf paths of an object ("limits.guests" -> value). null and arrays are leaves. */
export function flattenLeaves(obj: any, prefix = ""): Record<string, any> {
  const out: Record<string, any> = {};
  if (!isPlainObject(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length > 0) Object.assign(out, flattenLeaves(v, path));
    else out[path] = v;
  }
  return out;
}

function setPath(target: Record<string, any>, path: string, value: any) {
  const keys = path.split(".");
  let o = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isPlainObject(o[keys[i]])) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, k) => (acc !== null && typeof acc === "object" ? acc[k] : undefined), obj);
}

/**
 * "Add missing plans/fields only": a merge patch holding ONLY fields the
 * stored plan lacks (undefined). Existing values, including null (=
 * Unlimited) and 0 (= none), are never touched.
 *
 * A legacy (v1) plan doc is first converted to v2 with the SAME meaning
 * (legacy "0 = unlimited" -> null), so filling v2 keys can't flip limits.
 * A legacy `price` is copied to `priceMonthly` instead of taking the
 * catalog price.
 */
export function planMissingFieldsPatch(
  planId: string,
  existing: any | null,
  canonical: PlanDocV2
): { patch: Record<string, any>; added: string[]; converted: boolean; created: boolean } {
  if (!existing) {
    return { patch: { ...canonical, id: planId }, added: Object.keys(flattenLeaves(canonical)), converted: false, created: true };
  }
  const base: any = { ...existing };
  const patch: Record<string, any> = {};
  const added: string[] = [];
  let converted = false;

  if (!isV2PlanDoc(existing)) {
    const v2 = toPlanDocV2(planId, existing);
    base.limitsVersion = v2.limitsVersion;
    base.features = v2.features;
    base.limits = v2.limits;
    patch.limitsVersion = v2.limitsVersion;
    patch.features = { ...v2.features };
    patch.limits = { ...v2.limits };
    converted = true;
  }

  if (base.priceMonthly === undefined && typeof base.price === "number" && Number.isFinite(base.price)) {
    patch.priceMonthly = base.price;
    base.priceMonthly = base.price;
    added.push("priceMonthly");
  }

  for (const [path, value] of Object.entries(flattenLeaves(canonical))) {
    if (getPath(base, path) !== undefined) continue;
    // Don't create a leaf under a stored non-object (e.g. features: true).
    const parent = path.includes(".") ? getPath(base, path.slice(0, path.lastIndexOf("."))) : base;
    if (parent !== undefined && !isPlainObject(parent)) continue;
    setPath(patch, path, value);
    added.push(path);
  }
  if (!existing.id) {
    patch.id = planId;
  }
  return { patch, added, converted, created: false };
}

export type PlanDiffEntry = { path: string; current: any; next: any };

/**
 * What "Reset plan to defaults" changes, compared on the plan's effective
 * meaning (legacy docs read as v2), field by field.
 */
export function planResetDiff(planId: string, existing: any | null, canonical: PlanDocV2): PlanDiffEntry[] {
  const current: Record<string, any> = existing
    ? (() => {
        const n = normalizePlanDoc(planId, existing);
        const v2 = toPlanDocV2(planId, existing);
        return {
          name: existing.name,
          description: existing.description,
          priceMonthly: existing.priceMonthly ?? existing.price,
          visibility: n.visibility,
          limitsVersion: existing.limitsVersion,
          features: v2.features,
          limits: v2.limits,
          customizable: existing.customizable,
          contactSales: existing.contactSales,
        };
      })()
    : {};
  const curFlat = flattenLeaves(current);
  const nextFlat = flattenLeaves(canonical);
  const diff: PlanDiffEntry[] = [];
  for (const [path, next] of Object.entries(nextFlat)) {
    const cur = path in curFlat ? curFlat[path] : getPath(current, path);
    const enc = (v: any) => (v === undefined ? "__missing__" : JSON.stringify(v));
    if (enc(cur) !== enc(next)) {
      diff.push({ path, current: cur === undefined ? null : cur, next });
    }
  }
  return diff;
}

const VISIBILITIES = new Set(["public", "hidden", "admin"]);

/** Editor sub-options not enforced yet (ignored on save). export.* other than priorityQueue is still pending. */
export const UNENFORCED_EDITING_KEYS = ["unlimitedExports", "ai"];

/**
 * Validate the non-entitlement part of PUT /api/admin/plans/:id. Entitlement
 * fields (features / limits) go through sanitizePlanV2Input.
 * `price` is accepted as an alias and written to `priceMonthly` (the field
 * the product reads); Stripe prices are configured separately.
 */
export function sanitizePlanMetaInput(body: any): { meta: Record<string, any>; errors: string[] } {
  const errors: string[] = [];
  const meta: Record<string, any> = {};
  if (!isPlainObject(body)) return { meta, errors: ["body must be an object"] };

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80) errors.push("name must be a non-empty string (max 80)");
    else meta.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || body.description.length > 500) errors.push("description must be a string (max 500)");
    else meta.description = body.description;
  }
  const priceRaw = body.priceMonthly !== undefined ? body.priceMonthly : body.price;
  if (priceRaw !== undefined) {
    const n = typeof priceRaw === "string" && priceRaw.trim() !== "" ? Number(priceRaw) : priceRaw;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100000) errors.push("priceMonthly must be a number >= 0");
    else meta.priceMonthly = Math.round(n * 100) / 100;
  }
  if (body.visibility !== undefined) {
    if (!VISIBILITIES.has(body.visibility)) errors.push("visibility must be public | hidden | admin");
    else meta.visibility = body.visibility;
  }
  for (const k of ["customizable", "contactSales"]) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== "boolean") errors.push(`${k} must be boolean`);
      else meta[k] = body[k];
    }
  }
  if (body.editing !== undefined) {
    if (!isPlainObject(body.editing)) errors.push("editing must be an object");
    else {
      const editing: Record<string, any> = {};
      if (body.editing.maxTracks !== undefined) {
        const n = Number(body.editing.maxTracks);
        if (typeof body.editing.maxTracks === "boolean" || !Number.isFinite(n) || n < 0) errors.push("editing.maxTracks must be a number >= 0");
        else editing.maxTracks = Math.floor(n);
      }
      // Export resolution cap: "720p" | "1080p" | "4k"; null/"" = no cap.
      const mr = body.editing.maxResolution;
      if (mr !== undefined) {
        if (mr === null || mr === "") editing.maxResolution = null;
        else if (typeof mr === "string" && ["720p", "1080p", "4k"].includes(mr.trim().toLowerCase())) {
          editing.maxResolution = mr.trim().toLowerCase();
        } else errors.push('editing.maxResolution must be "720p", "1080p", "4k" or null');
      }
      // Monthly exports use the v2 convention (null = unlimited, 0 = none) and
      // are only accepted when marked limitsVersion 2: older admin clients
      // echo legacy values (where 0 meant unlimited) on every save.
      if (body.editing.exportsPerMonth !== undefined && Number(body.editing.limitsVersion) === 2) {
        const v = body.editing.exportsPerMonth;
        if (v === null || v === "") editing.exportsPerMonth = null;
        else {
          const n = Number(v);
          if (typeof v === "boolean" || !Number.isFinite(n) || n < 0) errors.push("editing.exportsPerMonth must be null or a number >= 0");
          else editing.exportsPerMonth = Math.floor(n);
        }
        editing.limitsVersion = 2;
      }
      const tr = body.editing.transitions;
      if (isPlainObject(tr)) {
        const transitions: Record<string, boolean> = {};
        for (const k of ["basic", "advanced"]) {
          if (tr[k] === undefined) continue;
          if (typeof tr[k] !== "boolean") errors.push(`editing.transitions.${k} must be boolean`);
          else transitions[k] = tr[k];
        }
        if (Object.keys(transitions).length) editing.transitions = transitions;
      }
      const ex = body.editing.export;
      if (isPlainObject(ex) && ex.priorityQueue !== undefined) {
        if (typeof ex.priorityQueue !== "boolean") errors.push("editing.export.priorityQueue must be boolean");
        else editing.export = { priorityQueue: ex.priorityQueue };
      }
      if (Object.keys(editing).length) meta.editing = editing;
    }
  }
  return { meta, errors };
}
