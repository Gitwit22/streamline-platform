/**
 * Detect in-app browsers (Facebook, Instagram, TikTok, Twitter, LinkedIn,
 * Snapchat, Pinterest, WhatsApp, WeChat, Line, etc.) that commonly block
 * camera/mic access or have restricted WebRTC support.
 */
const IN_APP_PATTERN =
  /FBAN|FBAV|FBSV|Instagram|TikTok|Twitter|LinkedInApp|Snapchat|Pinterest|WhatsApp|MicroMessenger|Line\//i;

export function detectInAppBrowser(): boolean {
  return IN_APP_PATTERN.test(navigator.userAgent || "");
}

/**
 * Returns a human-readable name for the detected in-app browser,
 * or null if the browser is not an in-app browser.
 */
export function getInAppBrowserName(): string | null {
  const ua = navigator.userAgent || "";
  if (/FBAN|FBAV|FBSV/i.test(ua)) return "Facebook";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/TikTok/i.test(ua)) return "TikTok";
  if (/Twitter/i.test(ua)) return "Twitter";
  if (/LinkedInApp/i.test(ua)) return "LinkedIn";
  if (/Snapchat/i.test(ua)) return "Snapchat";
  if (/Pinterest/i.test(ua)) return "Pinterest";
  if (/WhatsApp/i.test(ua)) return "WhatsApp";
  if (/MicroMessenger/i.test(ua)) return "WeChat";
  if (/Line\//i.test(ua)) return "Line";
  return null;
}

/**
 * Returns platform-specific instructions for opening the current URL
 * in the device's default browser.
 */
export function getOpenInBrowserHint(appName: string | null): string {
  switch (appName) {
    case "Facebook":
    case "Instagram":
      return "Tap ⋯ (menu) → Open in browser";
    case "TikTok":
      return "Tap ⋯ → Open with browser";
    case "Twitter":
      return "Tap the share icon → Open in browser";
    case "LinkedIn":
      return "Tap ⋯ → Open in browser";
    case "Snapchat":
      return "Tap ⋯ → Open in browser";
    case "Pinterest":
      return "Tap ⋯ → Open in browser";
    case "WhatsApp":
      return "Tap ⋯ → Open in browser";
    case "WeChat":
      return "Tap ⋯ → Open in browser";
    case "Line":
      return "Tap the share icon → Open in browser";
    default:
      return "Open this link in your default browser for the best experience";
  }
}
