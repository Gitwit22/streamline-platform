// lib/livekit.ts
let _sdk: any = null;

export async function getLiveKitSdk() {
  if (_sdk) return _sdk;
  _sdk = await import("livekit-server-sdk");
  return _sdk;
}
