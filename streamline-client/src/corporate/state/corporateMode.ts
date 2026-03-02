const KEY = "sl_entry_lane";

export const setCorporateLane = () => {
  try {
    localStorage.setItem(KEY, "corporate");
    localStorage.setItem("sl_mode", "corporate");
  } catch {}

  try {
    document.body?.classList?.add("sl-corporate");
  } catch {}

  try {
    document.cookie = `corporate_mode=1; path=/; SameSite=Lax`;
  } catch {}
};

export const isCorporateLane = () => {
  try {
    return localStorage.getItem(KEY) === "corporate";
  } catch {
    return false;
  }
};

export const clearCorporateLane = () => {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem("sl_mode");
  } catch {}

  try {
    document.body?.classList?.remove("sl-corporate");
  } catch {}

  try {
    document.cookie = `corporate_mode=; path=/; max-age=0; SameSite=Lax`;
  } catch {}
};

export const isCorporateBypassEnabled = () => {
  try {
    return localStorage.getItem("sl_corporate_bypass") === "1";
  } catch {
    return false;
  }
};

export const setCorporateBypassEnabled = () => {
  try {
    localStorage.setItem("sl_corporate_bypass", "1");
  } catch {}
};

export const clearCorporateBypassEnabled = () => {
  try {
    localStorage.removeItem("sl_corporate_bypass");
  } catch {}
};
