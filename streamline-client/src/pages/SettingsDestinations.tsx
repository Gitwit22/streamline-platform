import { useEffect, useState } from "react";
import { fetchDestinations, createDestination, validateDestinationPreCreate, preflight, updateDestination, deleteDestination, type DestinationItem } from "../services/destinations";

function StatusBadge({ status, reason }: { status: string; reason?: string | null }) {
  const color = status === "connected" ? "#16a34a" : status === "disconnected" ? "#6b7280" : "#f59e0b";
  return (
    <span style={{ padding: "2px 8px", borderRadius: 12, background: color, color: "white", fontSize: 12 }}>
      {status}{reason ? ` • ${reason}` : ""}
    </span>
  );
}

export default function SettingsDestinations() {
  const [items, setItems] = useState<DestinationItem[]>([]);
  const [usedCount, setUsedCount] = useState<number | undefined>(undefined);
  const [limit, setLimit] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [platform, setPlatform] = useState("youtube");
  const [name, setName] = useState("");
  const [rtmpUrlBase, setRtmpUrlBase] = useState("");
  const [validation, setValidation] = useState<{ status: string; statusReason?: string | null } | null>(null);

  async function load() {
    try {
      setLoading(true);
      const res = await fetchDestinations();
      setItems(res.items);
      setUsedCount(res.usedCount);
      setLimit(res.limit);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onValidate() {
    setError(null);
    try {
      const res = await validateDestinationPreCreate({ platform, rtmpUrlBase });
      setValidation({ status: res.status, statusReason: res.statusReason ?? null });
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await createDestination({ platform, name, rtmpUrlBase });
      setValidation(res.validation || null);
      setUsedCount(res.usedCount);
      setLimit(res.limit);
      setPlatform("youtube");
      setName("");
      setRtmpUrlBase("");
      await load();
      async function onDelete(id: string) {
        setError(null);
        try {
          await deleteDestination(id);
          setItems(prev => prev.filter(i => i.id !== id));
          // Recompute usedCount quickly without refetch
          const newUsed = (items.filter(i => i.id !== id && i.enabled).length);
          setUsedCount(newUsed);
        } catch (e: any) {
          setError(e?.message || String(e));
        }
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function onPreflight() {
    setError(null);
    try {
      const res = await preflight({});
      alert(`Preflight: ${res.destinations.map(d => `${d.platform}:${d.status}`).join(", ")}`);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "24px auto", padding: 16 }}>
      <h2>Destinations</h2>
      <p>Manage manual RTMP destinations. Keys are encrypted server-side and never returned.</p>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <h3>Add Destination</h3>
        {validation && (
          <div style={{ marginBottom: 8 }}>
            <StatusBadge status={validation.status} reason={validation.statusReason || undefined} />
          </div>
        )}
        <form onSubmit={onCreate}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={platform} onChange={e => setPlatform(e.target.value)}>
              <option value="youtube">YouTube</option>
              <option value="facebook">Facebook</option>
              <option value="twitch">Twitch</option>
              <option value="custom">Custom</option>
            </select>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" />
            <input value={rtmpUrlBase} onChange={e => setRtmpUrlBase(e.target.value)} placeholder="RTMP base (no key)" style={{ flex: 1 }} />
            <button type="button" onClick={onValidate}>Validate</button>
            <button type="submit">Create</button>
          </div>
        </form>
        {error && <div style={{ color: "#b91c1c" }}>{error}</div>}
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Existing Destinations</h3>
          <button onClick={onPreflight}>Run Preflight</button>
        </div>
        {typeof usedCount !== "undefined" && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
            Used {usedCount} / Limit {typeof limit !== "undefined" ? limit : "—"}
          </div>
        )}
        {loading ? (
          <div>Loading…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Platform</th>
                <th align="left">Name</th>
                <th align="left">Base</th>
                <th align="left">Status</th>
                <th align="left">Key</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td>{item.platform}</td>
                  <td>{item.name || "—"}</td>
                  <td>{item.rtmpUrlBase}</td>
                  <td><StatusBadge status={item.status} reason={item.statusReason || undefined} /></td>
                  <td>{item.hasKey ? `••••${item.keyPreview ?? ""}` : "no key"}</td>
                  <td>
                    <button onClick={() => onDelete(item.id)} style={{ fontSize: 12, color: "#ef4444" }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
