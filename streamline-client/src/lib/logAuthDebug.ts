// Utility to log all relevant auth/user info between login/join/room
//
// IMPORTANT:
// - This is a client-side helper intended only for targeted debugging.
// - It is gated by VITE_AUTH_DEBUG so it is off by default in production.
// - For server-side auth logging, use AUTH_DEBUG on the server instead.
export function logAuthDebugContext(contextLabel = "") {
  const enabled =
    // Always allowed in dev
    (import.meta.env.DEV && import.meta.env.VITE_AUTH_DEBUG !== "0") ||
    // In prod, require explicit opt-in
    (import.meta.env.PROD && import.meta.env.VITE_AUTH_DEBUG === "1");

  if (!enabled) return;

  try {
    // LocalStorage values
    const sl_user = localStorage.getItem("sl_user");
    const sl_token = localStorage.getItem("sl_token");
    const sl_userId = localStorage.getItem("sl_userId");
    const sl_displayName = localStorage.getItem("sl_displayName");
    const sl_current_role = localStorage.getItem("sl_current_role");
    const sl_guestId = localStorage.getItem("sl_guestId");
    const sl_created_rooms = localStorage.getItem("sl_created_rooms");
    let cookies = "";
    if (typeof document !== "undefined") {
      cookies = document.cookie;
    }
    console.log(`\n===== [Auth Debug] ${contextLabel} =====`);
    let empty = true;
    const mask = (val: string | null) => {
      if (!val) return null;
      const trimmed = val.trim();
      if (!trimmed) return null;
      if (trimmed.length <= 4) return "***";
      return `***${trimmed.slice(-4)}`;
    };

    let parsedUser: any = null;
    if (sl_user && sl_user !== "undefined") {
      try {
        parsedUser = JSON.parse(sl_user);
      } catch {
        parsedUser = null;
      }
    }

    const safeRows: Array<[string, any]> = [
      ["sl_user", parsedUser
        ? {
            present: true,
            id: mask(String(parsedUser.id || parsedUser.uid || "")),
            emailMasked: parsedUser.email ? `***@${String(parsedUser.email).split("@").pop()}` : null,
            planId: parsedUser.planId || null,
            isAdmin: !!parsedUser.isAdmin,
          }
        : sl_user
        ? { present: true }
        : null],
      ["sl_token", sl_token ? mask(sl_token) : null],
      ["sl_userId", sl_userId ? mask(sl_userId) : null],
      ["sl_displayName", sl_displayName || null],
      ["sl_current_role", sl_current_role || null],
      ["sl_guestId", sl_guestId ? mask(sl_guestId) : null],
      ["sl_created_rooms", sl_created_rooms ? "[redacted list]" : null],
      ["cookies", cookies ? `length=${cookies.length}` : null],
    ];

    safeRows.forEach(([key, value]) => {
      if (value && value !== "undefined" && value !== "") empty = false;
      console.log(`  ${key}:`, value);
    });
    if (empty) {
      console.log("  [Auth Debug] All values are empty or undefined.");
    }
    console.log("====================================\n");
  } catch (err) {
    console.error("[Auth Debug] Failed to log context:", err);
  }
}
