import { useEffect, useMemo, useState } from "react";
import {
  type TeacherPermissions,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  TEACHER_PERMISSION_KEYS,
} from "../types/teacherPermissions";

/* ── Props ──────────────────────────────────────────────────────── */

interface Props {
  teacherName: string;
  initial: TeacherPermissions;
  busy?: boolean;
  onSave: (next: TeacherPermissions) => void;
  onCancel: () => void;
}

/* ── Checkbox with indeterminate support ────────────────────────── */

function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
  bold,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  bold?: boolean;
}) {
  return (
    <label className="flex items-center gap-2.5 select-none cursor-pointer group">
      <span className="relative flex items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          ref={(el) => {
            if (el) el.indeterminate = !!indeterminate;
          }}
          onChange={(e) => onChange(e.target.checked)}
          className="peer h-4.5 w-4.5 rounded border border-slate-600 bg-slate-900/60 text-orange-500 accent-orange-500 focus:ring-2 focus:ring-orange-500/30 transition-colors cursor-pointer"
        />
      </span>
      <span
        className={`text-sm transition-colors group-hover:text-white ${
          bold ? "font-semibold text-slate-100" : "text-slate-300"
        }`}
      >
        {label}
      </span>
    </label>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

export default function PermissionsModal({ teacherName, initial, busy, onSave, onCancel }: Props) {
  const [perms, setPerms] = useState<TeacherPermissions>({ ...initial });

  // Close on escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  function toggle(key: keyof TeacherPermissions, val: boolean) {
    setPerms((prev) => ({ ...prev, [key]: val }));
  }

  function toggleGroup(keys: (keyof TeacherPermissions)[], val: boolean) {
    setPerms((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = val;
      return next;
    });
  }

  /** Check if any permission changed compared to initial */
  const isDirty = useMemo(() => {
    for (const k of TEACHER_PERMISSION_KEYS) {
      if (perms[k] !== initial[k]) return true;
    }
    return false;
  }, [perms, initial]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* backdrop */}
      <button
        type="button"
        onClick={() => !busy && onCancel()}
        className="absolute inset-0 bg-black/60"
        aria-label="Close"
      />

      {/* modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-900/40 shadow-xl flex flex-col">
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-700/60 px-6 py-5">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-white truncate">
              Edit Permissions — {teacherName}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Control what this teacher can access. Changes are saved when you click Save.
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onCancel()}
            className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {PERMISSION_GROUPS.map((group) => {
            const allChecked = group.keys.every((k) => perms[k]);
            const noneChecked = group.keys.every((k) => !perms[k]);
            const indeterminate = !allChecked && !noneChecked;

            return (
              <div
                key={group.id}
                className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-3"
              >
                {/* parent checkbox */}
                <Checkbox
                  checked={allChecked}
                  indeterminate={indeterminate}
                  onChange={(v) => toggleGroup(group.keys, v)}
                  label={group.parentLabel}
                  bold
                />

                {/* child checkboxes */}
                <div className="ml-7 space-y-2">
                  {group.keys.map((k) => (
                    <Checkbox
                      key={k}
                      checked={perms[k]}
                      onChange={(v) => toggle(k, v)}
                      label={PERMISSION_LABELS[k]}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-700/60 px-6 py-4">
          <button
            type="button"
            disabled={!!busy}
            onClick={onCancel}
            className={`rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 ${
              busy ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!!busy || !isDirty}
            onClick={() => onSave(perms)}
            className={`rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:from-orange-400 hover:to-amber-500 ${
              busy || !isDirty ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
