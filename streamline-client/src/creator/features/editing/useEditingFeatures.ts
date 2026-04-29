import { useEffect, useMemo, useState } from "react";
import { getMeCached } from "../../../lib/meCache";
import { API_BASE } from "../../../lib/apiBase";
import { apiFetchAuth } from "../../../lib/api";

type EditingFeatures = {
  editing: { access: boolean; maxTracks: number; maxProjects: number };
  ai: { autocut: boolean; captions: boolean; highlights: boolean };
  export: { maxResolution: "720p" | "1080p" | "4k"; formats: string[] };
};

const FALLBACK_FEATURES: EditingFeatures = {
  editing: { access: false, maxTracks: 0, maxProjects: 0 },
  ai: { autocut: false, captions: false, highlights: false },
  export: { maxResolution: "720p", formats: ["mp4"] },
};

function pickMaxResolution(raw: any): "720p" | "1080p" | "4k" {
  const v = String(raw || "").toLowerCase();
  if (v === "4k") return "4k";
  if (v === "1080p") return "1080p";
  return "720p";
}

export function useEditingFeatures() {
  const [planId, setPlanId] = useState("free");
  const [features, setFeatures] = useState<EditingFeatures>(FALLBACK_FEATURES);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const me = await getMeCached();
        const pid = String(me?.planId || me?.effectiveEntitlements?.planId || "free");
        if (cancelled) return;
        setPlanId(pid);

        const resp = await apiFetchAuth(`${API_BASE}/api/plans/${encodeURIComponent(pid)}`, {}, { allowNonOk: true });
        if (!resp.ok) {
          if (!cancelled) setFeatures(FALLBACK_FEATURES);
          return;
        }
        const body = await resp.json();
        const plan = body?.plan;
        const rawEditing = plan?.raw?.editing || plan?.editing || {};

        const access = rawEditing?.access === true;
        const maxTracks = Number(rawEditing?.maxTracks ?? 0);
        const maxProjects = Number(rawEditing?.maxProjects ?? 0);
        const maxResolution = pickMaxResolution(rawEditing?.maxResolution);

        const next: EditingFeatures = {
          editing: {
            access,
            maxTracks: Number.isFinite(maxTracks) ? Math.max(0, Math.round(maxTracks)) : 0,
            maxProjects: Number.isFinite(maxProjects) ? Math.max(0, Math.round(maxProjects)) : 0,
          },
          ai: {
            autocut: rawEditing?.ai?.autoCut === true || rawEditing?.ai?.autocut === true,
            captions: rawEditing?.ai?.captions === true,
            highlights: rawEditing?.ai?.highlights === true,
          },
          export: {
            maxResolution,
            formats: ["mp4"],
          },
        };

        if (!cancelled) setFeatures(next);
      } catch {
        if (!cancelled) {
          setPlanId("free");
          setFeatures(FALLBACK_FEATURES);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo(() => {
    return {
      planId,
      features,
      canUseFeature: (path: string) => {
        const keys = path.split(".");
        let val: any = features;
        for (const key of keys) {
          val = val?.[key];
        }
        return !!val;
      },
      getFeatureValue: (path: string) => {
        const keys = path.split(".");
        let val: any = features;
        for (const key of keys) {
          val = val?.[key];
        }
        return val;
      },
    };
  }, [planId, features]);

  return api;
}
