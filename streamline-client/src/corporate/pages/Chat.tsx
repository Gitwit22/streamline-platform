import { useEffect, useState, useCallback, useRef } from "react";
import { Hash, Lock, Volume2, Send, Paperclip, Smile, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchChatRooms, fetchMessages, sendMessage, createChatRoom, type ChatRoom, type ChatMessage } from "../api/chat";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";

const demoRooms: ChatRoom[] = [
  { id: "r1", name: "general", section: "department", isPrivate: false, unreadCount: 12, lastMessage: "Sarah K: Did everyone get the policy update?", lastMessageAt: Date.now(), memberCount: 120, createdAt: Date.now() },
  { id: "r2", name: "engineering", section: "department", isPrivate: false, unreadCount: 4, lastMessage: "Dev: Sprint review notes are posted", lastMessageAt: Date.now() - 120_000, memberCount: 45, createdAt: Date.now() },
  { id: "r3", name: "marketing", section: "department", isPrivate: false, unreadCount: 0, lastMessage: "Lisa: Campaign assets are ready", lastMessageAt: Date.now() - 300_000, memberCount: 30, createdAt: Date.now() },
  { id: "r4", name: "hr", section: "department", isPrivate: false, unreadCount: 1, lastMessage: "New hire onboarding checklist updated", lastMessageAt: Date.now() - 600_000, memberCount: 15, createdAt: Date.now() },
  { id: "r5", name: "project-alpha", section: "project", isPrivate: true, unreadCount: 0, lastMessage: "Marcus: Deployment window confirmed", lastMessageAt: Date.now() - 900_000, memberCount: 8, createdAt: Date.now() },
  { id: "r6", name: "merger-team", section: "project", isPrivate: true, unreadCount: 3, lastMessage: "Due diligence docs uploaded", lastMessageAt: Date.now() - 1200_000, memberCount: 5, createdAt: Date.now() },
  { id: "r7", name: "leadership", section: "executive", isPrivate: true, unreadCount: 0, lastMessage: "Q1 targets finalized", lastMessageAt: Date.now() - 1500_000, memberCount: 6, createdAt: Date.now() },
];

const demoMessages: ChatMessage[] = [
  { id: "m1", roomId: "r1", senderUid: "u1", senderName: "Sarah Kim", content: "Did everyone get the policy update? Please review and sign the acknowledgment by Friday.", type: "text", attachmentUrl: "", createdAt: Date.now() - 600_000 },
  { id: "m2", roomId: "r1", senderUid: "u2", senderName: "Dev Patel", content: "Got it. Forwarding to the eng team now.", type: "text", attachmentUrl: "", createdAt: Date.now() - 480_000 },
  { id: "m3", roomId: "r1", senderUid: "u3", senderName: "Marcus Johnson", content: "Can we schedule a quick call to discuss the deployment timeline? I have some concerns about the Friday window.", type: "text", attachmentUrl: "", createdAt: Date.now() - 300_000 },
  { id: "m4", roomId: "r1", senderUid: "corp-demo", senderName: "You", content: "Sure, let's do a 15-min sync at 2 PM. I'll send the invite.", type: "text", attachmentUrl: "", createdAt: Date.now() - 120_000 },
];

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatMsgTime(ms: number | null) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function Chat() {
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      if (bypass) { setRooms(demoRooms); setSelectedRoom("r1"); }
      else { const data = await fetchChatRooms(); setRooms(data); if (data.length > 0) setSelectedRoom(data[0].id); }
    } catch { setRooms([]); }
    finally { setLoading(false); }
  }, [bypass]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const loadMessages = useCallback(async (roomId: string) => {
    if (!roomId) return;
    setMsgLoading(true);
    try {
      if (bypass) { setMessages(demoMessages.filter(m => m.roomId === roomId)); }
      else { const data = await fetchMessages(roomId, { limit: 50 }); setMessages(data); }
    } catch { setMessages([]); }
    finally { setMsgLoading(false); }
  }, [bypass]);

  useEffect(() => { if (selectedRoom) loadMessages(selectedRoom); }, [selectedRoom, loadMessages]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !selectedRoom) return;
    setSending(true);
    try {
      if (bypass) {
        const msg: ChatMessage = { id: `m-${Date.now()}`, roomId: selectedRoom, senderUid: me?.uid || "", senderName: me?.displayName || "You", content: input.trim(), type: "text", attachmentUrl: "", createdAt: Date.now() };
        setMessages(prev => [...prev, msg]);
      } else {
        const msg = await sendMessage(selectedRoom, input.trim());
        setMessages(prev => [...prev, msg]);
      }
      setInput("");
    } finally { setSending(false); }
  };

  const handleCreateRoom = async () => {
    if (!newRoomName.trim()) return;
    try {
      if (bypass) {
        const room: ChatRoom = { id: `room-${Date.now()}`, name: newRoomName.trim().toLowerCase().replace(/\s+/g, "-"), section: "department", isPrivate: false, unreadCount: 0, lastMessage: "", lastMessageAt: Date.now(), memberCount: 1, createdAt: Date.now() };
        setRooms(prev => [room, ...prev]); setSelectedRoom(room.id);
      } else {
        const room = await createChatRoom({ name: newRoomName.trim() });
        setRooms(prev => [room, ...prev]); setSelectedRoom(room.id);
      }
      setNewRoomName(""); setShowNewRoom(false);
    } catch { /* noop */ }
  };

  const currentRoom = rooms.find(r => r.id === selectedRoom);

  const sections = rooms.reduce<Record<string, ChatRoom[]>>((acc, r) => {
    const sec = r.section || "general";
    if (!acc[sec]) acc[sec] = [];
    acc[sec].push(r);
    return acc;
  }, {});

  return (
    <div className="flex h-full animate-fade-in">
      {/* Sidebar */}
      <div className="w-[260px] bg-surface border-r border-border flex flex-col">
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-foreground">Chat</h2>
          <button onClick={() => setShowNewRoom(true)} className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"><Plus className="w-3.5 h-3.5" /></button>
        </div>

        {showNewRoom && (
          <div className="px-3 py-2 border-b border-border flex gap-2">
            <input autoFocus value={newRoomName} onChange={e => setNewRoomName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleCreateRoom()} placeholder="Room name…" className="flex-1 bg-surface-2 border border-border rounded px-2 py-1 text-xs text-foreground outline-none" />
            <button onClick={handleCreateRoom} className="text-xs text-primary font-semibold">Add</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-primary" /></div>}
          {Object.entries(sections).map(([section, sectionRooms]) => (
            <div key={section}>
              <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-muted-foreground tracking-[1.8px] uppercase">{section}</div>
              {sectionRooms.map((room) => (
                <div key={room.id} onClick={() => setSelectedRoom(room.id)} className={cn("flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-surface-2 transition-colors", room.id === selectedRoom && "bg-surface-2")}>
                  {room.isPrivate ? <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <Hash className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground">{room.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{room.lastMessage || "No messages yet"}</div>
                  </div>
                  {room.unreadCount > 0 && <span className="bg-primary text-primary-foreground text-[10px] font-bold font-mono px-[7px] py-0.5 rounded-full">{room.unreadCount}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-2 border border-border cursor-pointer hover:border-border-2 transition-colors">
            <Volume2 className="w-4 h-4 text-sl-green" />
            <div>
              <div className="text-xs font-medium text-foreground">Voice Lounge</div>
              <div className="text-[10px] text-muted-foreground">3 active</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2 bg-surface">
          {currentRoom?.isPrivate ? <Lock className="w-4 h-4 text-muted-foreground" /> : <Hash className="w-4 h-4 text-muted-foreground" />}
          <span className="text-[14px] font-semibold text-foreground">{currentRoom?.name || "Select a room"}</span>
          {currentRoom && <span className="text-xs text-muted-foreground ml-2">{currentRoom.memberCount} members</span>}
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {msgLoading && <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-primary" /></div>}
          {!msgLoading && messages.length === 0 && <div className="text-center py-12 text-sm text-muted-foreground">No messages yet. Start the conversation!</div>}
          {messages.map((msg) => {
            const isMe = msg.senderUid === me?.uid;
            return (
              <div key={msg.id} className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sl-navy to-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground flex-shrink-0">{initials(msg.senderName)}</div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{isMe ? "You" : msg.senderName}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{formatMsgTime(msg.createdAt)}</span>
                  </div>
                  <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">{msg.content}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="px-5 py-3 border-t border-border">
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3.5 py-2.5">
            <Paperclip className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-foreground" />
            <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()} placeholder={`Message #${currentRoom?.name || ""}...`} className="flex-1 bg-transparent border-none outline-none text-foreground text-[13px] placeholder:text-muted-foreground/50" />
            <Smile className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-foreground" />
            <button onClick={handleSend} disabled={sending || !input.trim()} className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground disabled:opacity-50">
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
