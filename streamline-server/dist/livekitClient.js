"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.egressClient = void 0;
// server/livekitClient.ts
const livekit_server_sdk_1 = require("livekit-server-sdk");
const livekitUrl = process.env.LIVEKIT_URL || '';
const livekitApiKey = process.env.LIVEKIT_API_KEY || '';
const livekitApiSecret = process.env.LIVEKIT_API_SECRET || '';
if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET must be set');
}
exports.egressClient = new livekit_server_sdk_1.EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
