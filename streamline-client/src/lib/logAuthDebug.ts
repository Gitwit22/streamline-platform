// Utility to log all relevant auth/user info between login/join/room
export function logAuthDebugContext(contextLabel = "") {
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
    [
      ["sl_user", sl_user],
      ["sl_token", sl_token],
      ["sl_userId", sl_userId],
      ["sl_displayName", sl_displayName],
      ["sl_current_role", sl_current_role],
      ["sl_guestId", sl_guestId],
      ["sl_created_rooms", sl_created_rooms],
      ["cookies", cookies],
    ].forEach(([key, value]) => {
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
