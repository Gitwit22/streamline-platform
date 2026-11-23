/**
 * Live status of each multistream output (main RTMP egress + separate
 * Instagram egress), built from LiveKit EgressInfo.  Lets the host see WHY a
 * destination shows no video (e.g. Instagram rejected the RTMPS connection)
 * instead of a silent black output.  Never exposes RTMP URLs / stream keys.
 */
import { destinationLabel, egressOutcomeFields, redactEgressError, streamResultStatusName } from "./streamSummaryPure";
import { scrubKickKeys } from "./kickDestinationPure";

export type MultistreamOutputKind = "multistream" | "instagram";

export type MultistreamOutputStatus = {
  kind: MultistreamOutputKind;
  egressId: string;
  /** starting | active | ending | complete | failed | aborted | limit_reached | unknown */
  status: string;
  /** True when the egress (or every one of its RTMP pushes) has failed. */
  failed: boolean;
  /** Redacted error from the egress or the first failed RTMP push. */
  error: string | null;
  streams: Array<{ status: string | null; error: string | null }>;
  /**
   * Per-destination push status for this output, in start order (empty when
   * the output predates destination tracking). One RTMP push can fail while
   * the others keep running, e.g. Kick rejects its key next to a live YouTube.
   */
  destinations: DestinationStreamStatus[];
};

/** A destination fed by one egress: its platform and ingest URL minus the key. */
export type OutputTarget = { platform: string; prefix: string };

export type DestinationStreamStatus = {
  platform: string;
  label: string;
  /** active | finished | failed | null (no result reported yet) */
  status: string | null;
  error: string | null;
};

/**
 * Ingest URL without its last path segment (the stream key) or query.
 * Works on raw, masked ("…/***") and LiveKit-redacted URLs alike.
 */
export function ingestPrefix(url: unknown): string {
  const s = typeof url === "string" ? url.split("?")[0].trim() : "";
  const idx = s.lastIndexOf("/");
  return idx > 0 ? s.slice(0, idx).toLowerCase() : "";
}

/**
 * Match LiveKit stream results to the destinations they belong to: by ingest
 * prefix first (order-independent), then by position when the counts line
 * up. Result URLs are only compared, never returned.
 */
export function mapStreamResultsToDestinations(streamResults: unknown, targets: OutputTarget[]): DestinationStreamStatus[] {
  const results: any[] = Array.isArray(streamResults) ? streamResults : [];
  const used = new Set<number>();
  const positional = results.length === targets.length;
  return targets.map((t, i) => {
    let idx = results.findIndex((r, j) => !used.has(j) && !!t.prefix && ingestPrefix(r?.url) === t.prefix);
    if (idx < 0 && positional && !used.has(i)) idx = i;
    const r = idx >= 0 ? results[idx] : null;
    if (idx >= 0) used.add(idx);
    return {
      platform: t.platform,
      label: destinationLabel(t.platform),
      status: r ? streamResultStatusName(r.status) : null,
      error: r ? scrubKickKeys(redactEgressError(r.error)) : null,
    };
  });
}

export function summarizeEgressOutput(
  kind: MultistreamOutputKind,
  egressId: string,
  info: any,
  targets: OutputTarget[] = [],
): MultistreamOutputStatus {
  const pending = (): DestinationStreamStatus[] =>
    targets.map((t) => ({ platform: t.platform, label: destinationLabel(t.platform), status: null, error: null }));
  if (!info) {
    return { kind, egressId, status: "unknown", failed: false, error: null, streams: [], destinations: pending() };
  }
  const o = egressOutcomeFields(info);
  const status = o.egressStatus || "unknown";
  const allStreamsFailed = o.egressStreamResults.length > 0 && o.egressStreamResults.every((s) => s.status === "failed");
  const failed = status === "failed" || status === "aborted" || allStreamsFailed;
  const firstStreamError = o.egressStreamResults.map((s) => s.error).find(Boolean) || null;
  return {
    kind,
    egressId,
    status,
    failed,
    error: scrubKickKeys(o.egressError || firstStreamError),
    streams: o.egressStreamResults.map((r) => ({ ...r, error: scrubKickKeys(r.error) })),
    destinations: targets.length ? mapStreamResultsToDestinations(info.streamResults, targets) : [],
  };
}
