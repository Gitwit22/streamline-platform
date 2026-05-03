import React, { useState } from "react";

export default function RoomCustomizationPreview() {
  const [activeTab, setActiveTab] = useState("greenroom");
  const [greenroomEnabled, setGreenroomEnabled] = useState(true);
  const [vipList, setVipList] = useState(["StreamerPro", "ModeratorJohn"]);
  const [newVip, setNewVip] = useState("");

  const tabs = [
    { id: "templates", label: "Templates", icon: "📋" },
    { id: "branding", label: "Branding", icon: "🎨" },
    { id: "visuals", label: "Visuals", icon: "🖼️" },
    { id: "audio", label: "Audio", icon: "🎵" },
    { id: "overlays", label: "Overlays", icon: "📺" },
    { id: "alerts", label: "Alerts", icon: "🔔" },
    { id: "greenroom", label: "Greenroom", icon: "🚪" },
  ];

  const addVip = () => {
    if (newVip.trim() && !vipList.includes(newVip.trim())) {
      setVipList([...vipList, newVip.trim()]);
      setNewVip("");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden" style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute animate-pulse" style={{ top: "-10%", left: "-5%", width: "500px", height: "500px", background: "radial-gradient(circle, rgba(220,38,38,0.15) 0%, transparent 70%)", filter: "blur(80px)" }} />
        <div className="absolute animate-pulse" style={{ bottom: "-10%", right: "-5%", width: "600px", height: "600px", background: "radial-gradient(circle, rgba(239,68,68,0.1) 0%, transparent 70%)", filter: "blur(100px)" }} />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b" style={{ background: "rgba(10,10,10,0.8)", backdropFilter: "blur(20px)", borderColor: "rgba(220,38,38,0.2)", padding: "16px 32px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>← Back</button>
            <div>
              <h1 className="text-2xl font-bold" style={{ background: "linear-gradient(135deg, #ffffff 0%, #fecaca 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Room Customization</h1>
              <p className="text-sm text-gray-500 mt-1">Customize your stream's look and feel</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.5)", color: "#3b82f6" }}>💾 Save as Template</button>
            <button className="px-6 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)", boxShadow: "0 4px 20px rgba(220,38,38,0.3)" }}>✓ Apply Changes</button>
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="relative z-10 max-w-7xl mx-auto p-6" style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "24px" }}>
        {/* Sidebar */}
        <nav className="rounded-2xl p-4 h-fit sticky top-6" style={{ background: "rgba(15,15,15,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <div className="flex flex-col gap-1">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className="px-4 py-3 rounded-xl text-sm font-medium text-left flex items-center gap-3" style={{ background: activeTab === tab.id ? "rgba(220,38,38,0.15)" : "transparent", border: activeTab === tab.id ? "1px solid rgba(220,38,38,0.3)" : "1px solid transparent", color: activeTab === tab.id ? "#ef4444" : "#9ca3af" }}>
                <span className="text-lg">{tab.icon}</span>
                {tab.label}
                {tab.id === "greenroom" && <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ background: greenroomEnabled ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)", color: greenroomEnabled ? "#22c55e" : "#ef4444" }}>{greenroomEnabled ? "ON" : "OFF"}</span>}
              </button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <div className="rounded-2xl p-8 overflow-y-auto" style={{ background: "rgba(15,15,15,0.8)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "calc(100vh - 140px)" }}>
          {activeTab === "greenroom" && (
            <div>
              <h2 className="text-xl font-bold mb-2">Greenroom Settings</h2>
              <p className="text-sm text-gray-400 mb-6">Configure your waiting room and guest management</p>

              {/* Status */}
              <div className="mb-8 pb-8 border-b border-white/5">
                <h3 className="text-base font-semibold mb-4">Greenroom Status</h3>
                <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: greenroomEnabled ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${greenroomEnabled ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}` }}>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{greenroomEnabled ? "🟢" : "🔴"}</span>
                    <div>
                      <div className="font-semibold">Greenroom is {greenroomEnabled ? "Enabled" : "Disabled"}</div>
                      <div className="text-xs text-gray-400">{greenroomEnabled ? "Guests will wait for approval before joining" : "Guests can join directly"}</div>
                    </div>
                  </div>
                  <button onClick={() => setGreenroomEnabled(!greenroomEnabled)} className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: greenroomEnabled ? "linear-gradient(135deg, #ef4444, #dc2626)" : "linear-gradient(135deg, #22c55e, #16a34a)" }}>{greenroomEnabled ? "Disable" : "Enable"}</button>
                </div>
              </div>

              {greenroomEnabled && (
                <>
                  {/* Admission */}
                  <div className="mb-8 pb-8 border-b border-white/5">
                    <h3 className="text-base font-semibold mb-4">Guest Admission</h3>
                    {[{ label: "Require Approval", desc: "Manually approve each guest", on: true }, { label: "Auto-Admit VIPs", desc: "VIP users skip waiting room", on: true }].map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-4 rounded-xl mb-3" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)" }}>
                        <div><div className="font-medium">{item.label}</div><div className="text-xs text-gray-400">{item.desc}</div></div>
                        <div className="w-12 h-7 rounded-full relative" style={{ background: item.on ? "#22c55e" : "#374151" }}><div className="absolute w-5 h-5 bg-white rounded-full top-1" style={{ left: item.on ? "26px" : "4px" }} /></div>
                      </div>
                    ))}
                    <div className="mt-4">
                      <label className="block text-xs text-gray-400 mb-2">Max Waiting Guests: 10</label>
                      <input type="range" min="1" max="50" defaultValue="10" className="w-full h-2 rounded-full" style={{ accentColor: "#ef4444" }} />
                    </div>
                  </div>

                  {/* Permissions */}
                  <div className="mb-8 pb-8 border-b border-white/5">
                    <h3 className="text-base font-semibold mb-4">Guest Permissions</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[{ icon: "📹", label: "Allow Video", on: true }, { icon: "🎤", label: "Allow Audio", on: true }, { icon: "🖥️", label: "Screen Share", on: false }, { icon: "🔇", label: "Auto-Mute", on: true }].map((p, i) => (
                        <div key={i} className="p-4 rounded-xl cursor-pointer" style={{ background: p.on ? "rgba(34,197,94,0.1)" : "rgba(0,0,0,0.3)", border: `1px solid ${p.on ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)"}` }}>
                          <div className="flex items-center gap-2"><span className="text-xl">{p.icon}</span><span className="font-semibold text-sm">{p.label}</span><span className="ml-auto w-2 h-2 rounded-full" style={{ background: p.on ? "#22c55e" : "#6b7280" }} /></div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Waiting Room */}
                  <div className="mb-8 pb-8 border-b border-white/5">
                    <h3 className="text-base font-semibold mb-4">Waiting Room Appearance</h3>
                    <div className="mb-4">
                      <label className="block text-xs text-gray-400 mb-2">Welcome Message</label>
                      <textarea defaultValue="Please wait while the host reviews your request to join." rows={2} className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)" }} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-2">Background Theme</label>
                      <div className="flex gap-2">
                        {["#0f0f23", "#1a1a2e", "#000", "#0a0a0a", "#1a2a1a"].map((bg, i) => (
                          <div key={i} className="w-16 h-10 rounded-lg cursor-pointer" style={{ background: bg, border: i === 0 ? "2px solid #ef4444" : "2px solid rgba(255,255,255,0.1)" }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Notifications */}
                  <div className="mb-8 pb-8 border-b border-white/5">
                    <h3 className="text-base font-semibold mb-4">Host Notifications</h3>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      {[{ icon: "🔔", label: "Notify on Join" }, { icon: "👁️", label: "Show Guest Count" }].map((n, i) => (
                        <div key={i} className="flex items-center justify-between p-4 rounded-xl" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)" }}>
                          <div><div className="font-medium">{n.icon} {n.label}</div></div>
                          <input type="checkbox" defaultChecked style={{ accentColor: "#ef4444", width: "20px", height: "20px" }} />
                        </div>
                      ))}
                    </div>
                    <label className="block text-xs text-gray-400 mb-2">Notification Sound</label>
                    <div className="flex gap-2 flex-wrap">
                      {["🔔 Chime", "🎵 Pop", "✨ Ding", "🚪 Knock", "🔇 None"].map((s, i) => (
                        <button key={s} className="px-4 py-2 rounded-lg text-sm" style={{ background: i === 0 ? "rgba(220,38,38,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${i === 0 ? "rgba(220,38,38,0.5)" : "rgba(255,255,255,0.1)"}` }}>{s}</button>
                      ))}
                    </div>
                  </div>

                  {/* VIP List */}
                  <div className="mb-8 pb-8 border-b border-white/5">
                    <h3 className="text-base font-semibold mb-4">VIP List</h3>
                    <div className="flex gap-2 mb-4">
                      <input type="text" value={newVip} onChange={e => setNewVip(e.target.value)} onKeyDown={e => e.key === "Enter" && addVip()} placeholder="Enter username" className="flex-1 px-4 py-3 rounded-xl text-sm outline-none" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)" }} />
                      <button onClick={addVip} className="px-5 py-3 rounded-xl text-sm font-semibold" style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}>+ Add VIP</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {vipList.map(vip => (
                        <div key={vip} className="flex items-center gap-2 px-3 py-2 rounded-full" style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}>
                          <span>⭐</span><span className="text-sm">{vip}</span>
                          <button onClick={() => setVipList(vipList.filter(v => v !== vip))} className="text-red-500 ml-1">×</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Blocked */}
                  <div>
                    <h3 className="text-base font-semibold mb-4">Blocked Users</h3>
                    <div className="flex gap-2 mb-4">
                      <input type="text" placeholder="Enter username to block" className="flex-1 px-4 py-3 rounded-xl text-sm outline-none" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)" }} />
                      <button className="px-5 py-3 rounded-xl text-sm font-semibold" style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}>🚫 Block</button>
                    </div>
                    <div className="p-6 text-center rounded-xl" style={{ background: "rgba(0,0,0,0.2)", border: "1px dashed rgba(255,255,255,0.1)" }}>
                      <span className="text-2xl opacity-50">🚫</span>
                      <p className="text-xs text-gray-500 mt-2">No blocked users</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab !== "greenroom" && (
            <div className="text-center py-20">
              <span className="text-6xl mb-4 block">{tabs.find(t => t.id === activeTab)?.icon}</span>
              <h2 className="text-xl font-bold mb-2">{tabs.find(t => t.id === activeTab)?.label}</h2>
              <p className="text-gray-400">Click on Greenroom tab to see the full demo</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
