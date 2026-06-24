"use client";

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  channel: "email" | "sms" | "in_app";
  subject?: string | null;
  body: string;
  sender_name?: string | null;
  sender_id?: string | null;
  read_at?: string | null;
  created_at: string;
}

interface CandidateInfo {
  id: string;
  name: string;
  avatar_url?: string | null;
}

interface MessageThreadProps {
  messages: Message[];
  candidate: CandidateInfo;
  currentUserId?: string;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MessageThread({ messages, candidate, currentUserId }: MessageThreadProps) {
  const grouped: Record<string, Message[]> = {};
  for (const msg of messages) {
    const label = formatDateLabel(msg.created_at);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(msg);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {Object.entries(grouped).map(([dateLabel, msgs]) => (
        <div key={dateLabel}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>{dateLabel}</span>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {msgs.map((msg) => {
              const isOutbound = msg.direction === "outbound";
              const senderName = isOutbound ? (msg.sender_name || "You") : candidate.name;
              const avatar = isOutbound
                ? null
                : (candidate.avatar_url ? (
                    <img className="avatar-circle" src={candidate.avatar_url} alt={candidate.name} style={{ width: 32, height: 32 }} />
                  ) : (
                    <span className="avatar-circle" style={{ width: 32, height: 32 }}>{initials(candidate.name)}</span>
                  ));

              return (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    flexDirection: isOutbound ? "row-reverse" : "row",
                    alignItems: "flex-start",
                  }}
                >
                  <div>{avatar}</div>
                  <div
                    style={{
                      maxWidth: "70%",
                      background: isOutbound ? "var(--accent-soft)" : "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{senderName}</span>
                      <span className="muted" style={{ fontSize: 11 }}>{formatTime(msg.created_at)}</span>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {msg.channel === "email" && "📧"}
                        {msg.channel === "sms" && "📱"}
                        {msg.channel === "in_app" && "💬"}
                      </span>
                      {isOutbound && msg.read_at && (
                        <span className="muted" style={{ fontSize: 11 }} title={`Read at ${new Date(msg.read_at).toLocaleString()}`}>
                          ✓ Read
                        </span>
                      )}
                    </div>
                    {msg.subject && (
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{msg.subject}</div>
                    )}
                    <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
