// server/livekitClient.ts
import { EgressClient } from 'livekit-server-sdk';


const livekitUrl = process.env.LIVEKIT_URL || '';
const livekitApiKey = process.env.LIVEKIT_API_KEY || '';
const livekitApiSecret = process.env.LIVEKIT_API_SECRET || '';

if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
  throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET must be set');
}

export const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
