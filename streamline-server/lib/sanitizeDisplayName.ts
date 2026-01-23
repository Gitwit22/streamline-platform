// Shared sanitization for user-facing display/room names.
// Aligns with client-side Join page rules: allow only
// letters, digits, space, hyphen, en dash, apostrophe, ampersand.
export function sanitizeDisplayName(input: any): string {
  if (typeof input !== "string") return "";
  const cleaned = input.replace(/[^A-Za-z0-9 \-–'&]/g, "");
  return cleaned;
}
