import { deleteFiles, deletePrefix, isR2Configured } from "./storageClient";

function normalizeStorageKey(key: unknown): string | null {
  const raw = String(key ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("/") ? raw.slice(1) : raw;
}

function uniq(strings: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of strings) {
    const v = String(s || "").trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export type RecordingStorageTargets = {
  keys: string[];
  prefixes: string[];
};

export function collectRecordingStorageTargets(data: any): RecordingStorageTargets {
  const keys: string[] = [];

  const objectKey = normalizeStorageKey(data?.objectKey);
  const downloadPath = normalizeStorageKey(data?.downloadPath);
  if (objectKey) keys.push(objectKey);
  if (downloadPath) keys.push(downloadPath);

  const r2KeysRaw = data?.r2Keys;
  if (Array.isArray(r2KeysRaw)) {
    for (const k of r2KeysRaw) {
      const nk = normalizeStorageKey(k);
      if (nk) keys.push(nk);
    }
  }

  // Future-proofing: if we ever store additional derived assets.
  const maybeThumbnailKey = normalizeStorageKey(data?.thumbnailKey || data?.thumbnailPath);
  if (maybeThumbnailKey) keys.push(maybeThumbnailKey);

  const prefixes: string[] = [];
  const r2Prefix = normalizeStorageKey(data?.r2Prefix);
  if (r2Prefix) prefixes.push(r2Prefix);

  const r2PrefixesRaw = data?.r2Prefixes ?? data?.storagePrefixes;
  if (Array.isArray(r2PrefixesRaw)) {
    for (const p of r2PrefixesRaw) {
      const np = normalizeStorageKey(p);
      if (np) prefixes.push(np);
    }
  }

  return {
    keys: uniq(keys),
    prefixes: uniq(prefixes),
  };
}

export async function deleteRecordingStorage(data: any): Promise<{
  configured: boolean;
  deletedKeys: number;
  deletedPrefixes: number;
  keys: string[];
  prefixes: string[];
}> {
  const targets = collectRecordingStorageTargets(data);
  const configured = isR2Configured();

  if (!configured) {
    return {
      configured: false,
      deletedKeys: 0,
      deletedPrefixes: 0,
      keys: targets.keys,
      prefixes: targets.prefixes,
    };
  }

  let deletedPrefixes = 0;
  for (const p of targets.prefixes) {
    try {
      const resp = await deletePrefix(p);
      deletedPrefixes += resp.deleted;
    } catch (e: any) {
      console.warn("[recordingDeletion] deletePrefix failed", p, e?.message || e);
    }
  }

  try {
    await deleteFiles(targets.keys);
  } catch (e: any) {
    console.warn("[recordingDeletion] deleteFiles failed", e?.message || e);
  }

  return {
    configured: true,
    deletedKeys: targets.keys.length,
    deletedPrefixes,
    keys: targets.keys,
    prefixes: targets.prefixes,
  };
}
