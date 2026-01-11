"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLiveKitSdk = getLiveKitSdk;
// lib/livekit.ts
let _sdk = null;
async function getLiveKitSdk() {
    if (_sdk)
        return _sdk;
    _sdk = await import("livekit-server-sdk");
    return _sdk;
}
