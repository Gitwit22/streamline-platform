/**
 * Live status of each multistream output (main RTMP egress + separate
 * Instagram egress), built from LiveKit EgressInfo.  Lets the host see WHY a
 * destination shows no video (e.g. Instagram rejected the RTMPS connection)
 * instead of a silent black output.  Never exposes RTMP URLs / stream keys.
 */
import { egressOutcomeFields } from "./streamSummaryPure";

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
};

export function summarizeEgressOutput(
  kind: MultistreamOutputKind,
  egressId: string,
  info: any,
): MultistreamOutputStatus {
  if (!info) {
    return { kind, egressId, status: "unknown", failed: false, error: null, streams: [] };
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
    error: o.egressError || firstStreamError,
    streams: o.egressStreamResults,
  };
}
