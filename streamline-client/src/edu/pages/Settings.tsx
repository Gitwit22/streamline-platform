import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import { isEduBypassEnabled } from "../state/eduMode";
import {
  fetchEduAudit,
  fetchEduOrg,
  fetchEduStorageSummary,
  patchEduOrg,
  type EduAuditAction,
  type EduOrgSettings,
  type EduStorageSummary,
} from "../api/settings";

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={!!disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition-colors ${
        disabled
          ? "cursor-not-allowed border-slate-800/50 bg-slate-900/20 opacity-60"
          : "border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 hover:border-slate-600/70"
      }`}
    >
      <div className="min-w-0">
        <div className="font-medium text-white">{label}</div>
        {hint ? <div className="mt-1 text-sm text-slate-400">{hint}</div> : null}
      </div>
      <div
        aria-hidden
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
          checked ? "bg-orange-500" : "bg-slate-700"
        }`}
      >
        <div
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </div>
    </button>
  );
}

function formatBytes(bytesRaw: number) {
  const bytes = Math.max(0, Number(bytesRaw) || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  const shown = u === 0 ? String(Math.round(v)) : v.toFixed(v >= 10 ? 1 : 2);
  return `${shown} ${units[u]}`;
}

function formatWhen(ts: number | null) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function actionLabel(action: string) {
  if (action === "org.settings_updated") return "Settings updated";
  if (action === "broadcast.started") return "Broadcast started";
  if (action === "broadcast.ended") return "Broadcast ended";
  if (action === "broadcast.emergency_cut") return "Emergency cut";
  return action || "Action";
}

const DEMO_STATE_KEY = "sl_edu_demo_settings_v1";

function readDemoState(): { org: EduOrgSettings; audit: EduAuditAction[]; storage: EduStorageSummary } {
  const now = Date.now();

  const defaults: { org: EduOrgSettings; audit: EduAuditAction[]; storage: EduStorageSummary } = {
    org: {
      id: "edu-demo-org",
      name: "EDU Demo",
      branding: {
        logoDataUrl: null,
        accentColor: null,
        playerTitleText: null,
      },
      defaults: {
        publishToWebsite: true,
        recordToArchive: true,
        defaultLayout: "grid",
        studentProducersCanStart: false,
        requireAssignmentToStart: true,
      },
      accessPolicy: {
        embedVisibility: "public",
        restrictedToSchoolLogin: "coming_soon",
      },
      retentionDays: 30,
    },
    audit: [],
    storage: {
      recordingsCount: 0,
      storageBytes: 0,
      updatedAt: now,
    },
  };

  try {
    const raw = localStorage.getItem(DEMO_STATE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed?.org) return defaults;
    return {
      org: parsed.org as EduOrgSettings,
      audit: Array.isArray(parsed.audit) ? (parsed.audit as EduAuditAction[]) : [],
      storage: parsed.storage
        ? ({
            recordingsCount: Number(parsed.storage.recordingsCount || 0),
            storageBytes: Number(parsed.storage.storageBytes || 0),
            updatedAt: Number(parsed.storage.updatedAt || now),
          } satisfies EduStorageSummary)
        : defaults.storage,
    };
  } catch {
    return defaults;
  }
}

function writeDemoState(next: { org: EduOrgSettings; audit: EduAuditAction[]; storage: EduStorageSummary }) {
  try {
    localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export default function Settings() {
  const nav = useNavigate();
  const me = useEduMe();
  const roleRaw = String(me?.orgRole || me?.role || "viewer");
  const isFacultyAdmin = roleRaw === "faculty_admin";
  const isBypass = isEduBypassEnabled();

  if (!me || !isFacultyAdmin) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 text-slate-200">
        <div className="text-lg font-semibold text-white">No access</div>
        <div className="mt-2 text-sm text-slate-400">This page is only available to Faculty/Admin.</div>
      </div>
    );
  }

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [org, setOrg] = useState<EduOrgSettings | null>(null);
  const [storage, setStorage] = useState<EduStorageSummary | null>(null);
  const [audit, setAudit] = useState<EduAuditAction[]>([]);

  // Editable draft fields
  const [name, setName] = useState<string>("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [playerTitleText, setPlayerTitleText] = useState<string | null>(null);

  const [publishToWebsite, setPublishToWebsite] = useState<boolean>(true);
  const [recordToArchive, setRecordToArchive] = useState<boolean>(true);
  const [defaultLayout, setDefaultLayout] = useState<"grid" | "speaker">("grid");
  const [studentProducersCanStart, setStudentProducersCanStart] = useState<boolean>(false);
  const [requireAssignmentToStart, setRequireAssignmentToStart] = useState<boolean>(true);

  const [embedVisibility, setEmbedVisibility] = useState<"public" | "unlisted">("public");
  const [retentionDays, setRetentionDays] = useState<number | null>(30);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    if (isBypass) {
      const demo = readDemoState();
      setOrg(demo.org);
      setStorage(demo.storage);
      setAudit(demo.audit);

      setName(String(demo.org.name || ""));
      setLogoDataUrl(demo.org.branding?.logoDataUrl || null);
      setAccentColor(demo.org.branding?.accentColor || null);
      setPlayerTitleText(demo.org.branding?.playerTitleText || null);

      setPublishToWebsite(!!demo.org.defaults?.publishToWebsite);
      setRecordToArchive(!!demo.org.defaults?.recordToArchive);
      setDefaultLayout(demo.org.defaults?.defaultLayout === "speaker" ? "speaker" : "grid");
      setStudentProducersCanStart(!!demo.org.defaults?.studentProducersCanStart);
      setRequireAssignmentToStart(!!demo.org.defaults?.requireAssignmentToStart);

      setEmbedVisibility(demo.org.accessPolicy?.embedVisibility === "unlisted" ? "unlisted" : "public");
      setRetentionDays(
        typeof demo.org.retentionDays === "number" || demo.org.retentionDays === null ? demo.org.retentionDays : 30
      );

      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const [orgRes, storageRes, auditRes] = await Promise.all([
          fetchEduOrg(),
          fetchEduStorageSummary(),
          fetchEduAudit(10),
        ]);
        if (cancelled) return;

        setOrg(orgRes);
        setStorage(storageRes);
        setAudit(auditRes);

        setName(String(orgRes.name || ""));
        setLogoDataUrl(orgRes.branding?.logoDataUrl || null);
        setAccentColor(orgRes.branding?.accentColor || null);
        setPlayerTitleText(orgRes.branding?.playerTitleText || null);

        setPublishToWebsite(!!orgRes.defaults?.publishToWebsite);
        setRecordToArchive(!!orgRes.defaults?.recordToArchive);
        setDefaultLayout(orgRes.defaults?.defaultLayout === "speaker" ? "speaker" : "grid");
        setStudentProducersCanStart(!!orgRes.defaults?.studentProducersCanStart);
        setRequireAssignmentToStart(!!orgRes.defaults?.requireAssignmentToStart);

        setEmbedVisibility(orgRes.accessPolicy?.embedVisibility === "unlisted" ? "unlisted" : "public");
        setRetentionDays(typeof orgRes.retentionDays === "number" || orgRes.retentionDays === null ? orgRes.retentionDays : 30);

        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setOrg(null);
        setStorage(null);
        setAudit([]);
        setLoading(false);
        setLoadError(String(e?.message || "Failed to load settings"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me.uid]);

  const retentionOptions = useMemo(() => {
    return [
      { label: "Keep forever", value: null as number | null },
      { label: "30 days", value: 30 },
      { label: "90 days", value: 90 },
      { label: "365 days", value: 365 },
    ];
  }, []);

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      if (isBypass) {
        const base = org || readDemoState().org;
        const now = Date.now();
        const nextOrg: EduOrgSettings = {
          ...base,
          name: name,
          branding: {
            logoDataUrl,
            accentColor,
            playerTitleText,
          },
          defaults: {
            publishToWebsite,
            recordToArchive,
            defaultLayout,
            studentProducersCanStart,
            requireAssignmentToStart,
          },
          accessPolicy: {
            embedVisibility,
            restrictedToSchoolLogin: "coming_soon",
          },
          retentionDays,
        };

        const nextAudit: EduAuditAction[] = [
          {
            id: `demo_${now}`,
            action: "org.settings_updated",
            actorUid: String(me?.uid || "edu-demo"),
            actorName: String(me?.displayName || "EDU Demo"),
            eventId: null,
            eventTitle: null,
            targetId: null,
            createdAt: now,
          },
          ...(audit || []),
        ].slice(0, 10);

        const nextStorage: EduStorageSummary = {
          recordingsCount: Number(storage?.recordingsCount || 0),
          storageBytes: Number(storage?.storageBytes || 0),
          updatedAt: now,
        };

        setOrg(nextOrg);
        setAudit(nextAudit);
        setStorage(nextStorage);
        writeDemoState({ org: nextOrg, audit: nextAudit, storage: nextStorage });
        setSaveOk(true);
        return;
      }

      const next = await patchEduOrg({
        name: name,
        branding: {
          logoDataUrl,
          accentColor,
          playerTitleText,
        },
        defaults: {
          publishToWebsite,
          recordToArchive,
          defaultLayout,
          studentProducersCanStart,
          requireAssignmentToStart,
        },
        accessPolicy: {
          embedVisibility,
          restrictedToSchoolLogin: "coming_soon",
        },
        retentionDays,
      });
      setOrg(next);
      setSaveOk(true);

      // Refresh audit and storage summary (best-effort)
      try {
        const [storageRes, auditRes] = await Promise.all([fetchEduStorageSummary(), fetchEduAudit(10)]);
        setStorage(storageRes);
        setAudit(auditRes);
      } catch {
        // ignore
      }
    } catch (e: any) {
      setSaveError(String(e?.message || "Failed to save"));
    } finally {
      setSaving(false);
      window.setTimeout(() => setSaveOk(false), 2500);
    }
  }

  async function onPickLogo(file: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      setLogoDataUrl(result);
    };
    reader.readAsDataURL(file);
  }

  if (loading) {
    return <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 text-slate-200">Loading…</div>;
  }

  if (loadError) {
    const isUnauthorized = /unauthorized|401/i.test(loadError);
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-slate-200">
        <div className="text-lg font-semibold text-white">Failed to load</div>
        <div className="mt-2 text-sm text-red-200">{loadError}</div>
        {isUnauthorized ? (
          <button
            type="button"
            onClick={() => nav("/streamline/edu/login", { replace: true })}
            className="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
          >
            Go to login
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-bold text-white">Settings</div>
          <div className="mt-1 text-sm text-slate-400">School defaults for branding, broadcast policy, access, and retention.</div>
        </div>
        <div className="flex items-center gap-3">
          {saveOk ? <div className="text-sm text-emerald-300">Saved</div> : null}
          {saveError ? <div className="text-sm text-red-200">{saveError}</div> : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => void onSave()}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
              saving
                ? "cursor-not-allowed bg-slate-700"
                : "bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
            }`}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/* 1) School Branding */}
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">School Branding</h2>
          <p className="mt-1 text-sm text-slate-400">Shown on the viewer and embed experience.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-white">School name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your School"
              className="mt-2 w-full rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-orange-500/40"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-white">Player title text</label>
            <input
              value={playerTitleText || ""}
              onChange={(e) => setPlayerTitleText(e.target.value || null)}
              placeholder="e.g., StreamLine Live"
              className="mt-2 w-full rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-orange-500/40"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
            <div className="text-sm font-medium text-white">Logo</div>
            <div className="mt-1 text-sm text-slate-400">Upload a PNG or JPG.</div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickLogo(f);
                }}
                className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
              />
              <button
                type="button"
                onClick={() => setLogoDataUrl(null)}
                className="rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
            {logoDataUrl ? (
              <div className="mt-4 flex items-center gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                  {/* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */}
                  <img src={logoDataUrl} alt="Logo" className="h-full w-full object-cover" />
                </div>
                <div className="text-xs text-slate-400">Preview</div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
            <div className="text-sm font-medium text-white">Accent color</div>
            <div className="mt-1 text-sm text-slate-400">Used for highlights and accents.</div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="color"
                value={accentColor || "#f97316"}
                onChange={(e) => setAccentColor(e.target.value || null)}
                className="h-10 w-14 rounded-lg border border-slate-800 bg-slate-950"
              />
              <input
                value={accentColor || ""}
                onChange={(e) => setAccentColor(e.target.value.trim() ? e.target.value.trim() : null)}
                placeholder="#f97316"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
              <button
                type="button"
                onClick={() => setAccentColor(null)}
                className="rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2) Broadcast Policy Defaults */}
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Broadcast Policy Defaults</h2>
          <p className="mt-1 text-sm text-slate-400">These defaults pre-fill the Broadcast page.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Toggle
            checked={publishToWebsite}
            onChange={setPublishToWebsite}
            label="Publish to school website by default"
            hint="Controls the default publish toggle in Broadcast"
          />
          <Toggle
            checked={recordToArchive}
            onChange={setRecordToArchive}
            label="Record to archive by default"
            hint="Controls the default record toggle in Broadcast"
          />
          <Toggle
            checked={studentProducersCanStart}
            onChange={setStudentProducersCanStart}
            label="Student producers can start broadcasts"
            hint="If off, only Faculty/Admin can start/stop"
          />
          <Toggle
            checked={requireAssignmentToStart}
            onChange={setRequireAssignmentToStart}
            disabled={!studentProducersCanStart}
            label="Require assignment to start"
            hint={studentProducersCanStart ? "Only assigned student producers can start" : "Enable student producers first"}
          />
        </div>

        <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
          <div className="text-sm font-medium text-white">Default layout</div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {([
              { id: "grid" as const, title: "Grid", desc: "Great for groups" },
              { id: "speaker" as const, title: "Speaker", desc: "Focus on active speaker" },
            ] as const).map((opt) => {
              const active = defaultLayout === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDefaultLayout(opt.id)}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-slate-500/60 bg-slate-950/60 text-white"
                      : "border-slate-700/60 bg-slate-950/30 text-slate-300 hover:bg-slate-900/40"
                  }`}
                >
                  <div className="text-sm font-medium">{opt.title}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3) Access Policy Defaults */}
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Access Policy Defaults</h2>
          <p className="mt-1 text-sm text-slate-400">Controls how viewer links/embeds are shared by default.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setEmbedVisibility("public")}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              embedVisibility === "public"
                ? "border-slate-500/60 bg-slate-950/60 text-white"
                : "border-slate-700/60 bg-slate-950/30 text-slate-300 hover:bg-slate-900/40"
            }`}
          >
            <div className="text-sm font-medium">Public</div>
            <div className="mt-0.5 text-xs text-slate-400">Ok to publish broadly</div>
          </button>
          <button
            type="button"
            onClick={() => setEmbedVisibility("unlisted")}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              embedVisibility === "unlisted"
                ? "border-slate-500/60 bg-slate-950/60 text-white"
                : "border-slate-700/60 bg-slate-950/30 text-slate-300 hover:bg-slate-900/40"
            }`}
          >
            <div className="text-sm font-medium">Unlisted</div>
            <div className="mt-0.5 text-xs text-slate-400">Share via link only</div>
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
          <div className="text-sm font-medium text-white">Restricted to school login</div>
          <div className="mt-1 text-sm text-slate-400">Coming soon</div>
        </div>
      </div>

      {/* 4) Retention & Storage */}
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Retention &amp; Storage</h2>
          <p className="mt-1 text-sm text-slate-400">Summary based on your school’s recordings.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <div className="text-sm font-medium text-white">Retention</div>
            <div className="mt-1 text-sm text-slate-400">Automatically remove recordings after this time.</div>
            <select
              value={retentionDays === null ? "forever" : String(retentionDays)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "forever") {
                  setRetentionDays(null);
                } else {
                  const n = Number(v);
                  setRetentionDays(Number.isFinite(n) ? n : 30);
                }
              }}
              className="mt-3 w-full rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-0 focus:border-slate-500/70"
            >
              {retentionOptions.map((opt) => (
                <option key={opt.label} value={opt.value === null ? "forever" : String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <div className="text-sm font-medium text-white">Storage used</div>
            <div className="mt-1 text-sm text-slate-400">Estimate based on recorded files.</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-3">
                <div className="text-xs text-slate-400">Recordings</div>
                <div className="mt-1 text-lg font-semibold text-white">{storage ? storage.recordingsCount : "—"}</div>
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/30 p-3">
                <div className="text-xs text-slate-400">Storage</div>
                <div className="mt-1 text-lg font-semibold text-white">{storage ? formatBytes(storage.storageBytes) : "—"}</div>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">Updated {storage ? formatWhen(storage.updatedAt) : ""}</div>
          </div>
        </div>
      </div>

      {/* 5) Safety & Audit */}
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Safety &amp; Audit</h2>
          <p className="mt-1 text-sm text-slate-400">Start/stop logging is always on.</p>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
          <div className="text-sm font-medium text-white">Recent actions</div>
          <div className="mt-3 space-y-2">
            {(audit || []).length ? (
              audit.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-4 rounded-lg border border-slate-700/60 bg-slate-950/30 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{actionLabel(String(a.action || ""))}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {String(a.actorName || "User")}
                      {a.eventTitle ? ` • ${a.eventTitle}` : ""}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-xs text-slate-500">{formatWhen(a.createdAt)}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-400">No recent actions yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
