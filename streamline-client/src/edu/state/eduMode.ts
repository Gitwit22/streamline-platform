const KEY = "sl_entry_lane";

export const setEduLane = () => {
  try {
    localStorage.setItem(KEY, "edu");
    localStorage.setItem("sl_mode", "edu");
  } catch {}

  try {
    document.body?.classList?.add("sl-edu");
  } catch {}

  try {
    document.cookie = `edu_mode=1; path=/; SameSite=Lax`;
  } catch {}
};

export const isEduLane = () => {
  try {
    return localStorage.getItem(KEY) === "edu";
  } catch {
    return false;
  }
};

export const clearEduLane = () => {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem("sl_mode");
  } catch {}

  try {
    document.body?.classList?.remove("sl-edu");
  } catch {}

  try {
    document.cookie = `edu_mode=; path=/; max-age=0; SameSite=Lax`;
  } catch {}
};

export const isEduBypassEnabled = () => {
  try {
    return localStorage.getItem("sl_edu_bypass") === "1";
  } catch {
    return false;
  }
};

export const setEduBypassEnabled = () => {
  try {
    localStorage.setItem("sl_edu_bypass", "1");
  } catch {}
};

export const clearEduBypassEnabled = () => {
  try {
    localStorage.removeItem("sl_edu_bypass");
    localStorage.removeItem("sl_edu_demo_role");
  } catch {}
};

/* ── Demo role switcher ──────────────────────────────────────── */

export type DemoRoleKey = "admin" | "teacher" | "student_producer";

const DEMO_ROLE_KEY = "sl_edu_demo_role";

const demoRoleListeners = new Set<() => void>();

export function subscribeDemoRole(fn: () => void) {
  demoRoleListeners.add(fn);
  return () => { demoRoleListeners.delete(fn); };
}

export function getDemoRole(): DemoRoleKey {
  try {
    const v = localStorage.getItem(DEMO_ROLE_KEY);
    if (v === "admin" || v === "teacher" || v === "student_producer") return v;
  } catch {}
  return "admin";
}

export function setDemoRole(role: DemoRoleKey) {
  try {
    localStorage.setItem(DEMO_ROLE_KEY, role);
  } catch {}
  demoRoleListeners.forEach((fn) => fn());
}

/** Map DemoRoleKey to the EduMe-compatible fields used by EduProtectedRoute */
export function getDemoPersona(role: DemoRoleKey) {
  switch (role) {
    case "admin":
      return {
        uid: "edu-demo-admin",
        displayName: "Principal Johnson",
        role: "faculty_admin" as const,
        orgRole: "faculty_admin" as const,
      };
    case "teacher":
      return {
        uid: "edu-demo-teacher",
        displayName: "Mr. Carter",
        role: "faculty_admin" as const,
        orgRole: "faculty_admin" as const,
      };
    case "student_producer":
      return {
        uid: "edu-demo-producer",
        displayName: "Jake Thompson",
        role: "student_producer" as const,
        orgRole: "student_producer" as const,
      };
  }
}
