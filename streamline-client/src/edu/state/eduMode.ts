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
  // Allow bypass in Vite DEV, and also when running a production build on localhost.
  // This keeps the demo bypass from being usable on real deployed domains.
  const isLocalHost = (() => {
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      return host === "localhost" || host === "127.0.0.1";
    } catch {
      return false;
    }
  })();

  if (!import.meta.env.DEV && !isLocalHost) return false;
  try {
    return localStorage.getItem("sl_edu_bypass") === "1";
  } catch {
    return false;
  }
};

export const setEduBypassEnabled = () => {
  const isLocalHost = (() => {
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      return host === "localhost" || host === "127.0.0.1";
    } catch {
      return false;
    }
  })();
  if (!import.meta.env.DEV && !isLocalHost) return;
  try {
    localStorage.setItem("sl_edu_bypass", "1");
  } catch {}
};

export const clearEduBypassEnabled = () => {
  try {
    localStorage.removeItem("sl_edu_bypass");
  } catch {}
};
