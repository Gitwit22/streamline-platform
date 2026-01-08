export function useEditingFeatures() {
  const user = localStorage.getItem("sl_user");
  const userData = user ? JSON.parse(user) : null;
  const planId = userData?.plan || "free";

  const FEATURE_MATRIX = {
    free: {
      editing: { access: true, maxTracks: 2, maxProjects: 3 },
      ai: { autocut: false, captions: false, highlights: false },
      export: { maxResolution: "720p", formats: ["mp4"] },
    },
    starter: {
      editing: { access: true, maxTracks: 4, maxProjects: 10 },
      ai: { autocut: false, captions: false, highlights: false },
      export: { maxResolution: "1080p", formats: ["mp4", "webm"] },
    },
    pro: {
      editing: { access: true, maxTracks: 8, maxProjects: 100 },
      ai: { autocut: true, captions: true, highlights: true },
      export: { maxResolution: "4k", formats: ["mp4", "webm", "mov"] },
    },
    enterprise: {
      editing: { access: true, maxTracks: 16, maxProjects: 1000 },
      ai: { autocut: true, captions: true, highlights: true },
      export: { maxResolution: "4k", formats: ["mp4", "webm", "mov", "prores"] },
    },
  };

  const features = FEATURE_MATRIX[planId as keyof typeof FEATURE_MATRIX] || FEATURE_MATRIX.free;

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
}
