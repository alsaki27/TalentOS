"use client";

import { useEffect, useState } from "react";
import {
  UserPlus,
  Mail,
  MoreHorizontal,
  Shield,
  Briefcase,
  UserCog,
  Code2,
  X,
  Send,
  RotateCcw,
  Ban,
  Users,
  Inbox,
  Clock,
  AlertCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "inactive";
  lastActive: string | null;
  avatarUrl?: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  sentAt: string;
  expiresAt: string;
  status: "pending" | "accepted" | "expired";
}

const roleOptions = [
  { value: "admin", label: "Admin", icon: Shield },
  { value: "manager", label: "Manager", icon: Briefcase },
  { value: "recruiter", label: "Recruiter", icon: UserCog },
  { value: "application_engineer", label: "Application Engineer", icon: Code2 },
];

function roleLabel(role: string) {
  return roleOptions.find((r) => r.value === role)?.label || role;
}

function roleIcon(role: string) {
  const Icon = roleOptions.find((r) => r.value === role)?.icon || UserCog;
  return Icon;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(dateStr: string | null) {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return formatDate(dateStr);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/* Mock data — replace with real API calls in production */
const mockMembers: TeamMember[] = [
  {
    id: "1",
    name: "Alex Morgan",
    email: "alex@company.com",
    role: "admin",
    status: "active",
    lastActive: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: "2",
    name: "Jordan Lee",
    email: "jordan@company.com",
    role: "manager",
    status: "active",
    lastActive: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: "3",
    name: "Taylor Smith",
    email: "taylor@company.com",
    role: "recruiter",
    status: "active",
    lastActive: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: "4",
    name: "Casey Brown",
    email: "casey@company.com",
    role: "application_engineer",
    status: "inactive",
    lastActive: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
  },
];

const mockInvites: PendingInvite[] = [
  {
    id: "i1",
    email: "sam@company.com",
    role: "recruiter",
    invitedBy: "Alex Morgan",
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 6).toISOString(),
    status: "pending",
  },
  {
    id: "i2",
    email: "drew@company.com",
    role: "application_engineer",
    invitedBy: "Jordan Lee",
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
    status: "pending",
  },
];

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("recruiter");
  const [inviteError, setInviteError] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [actionId, setActionId] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    // Simulate API fetch
    const timer = setTimeout(() => {
      setMembers(mockMembers);
      setInvites(mockInvites);
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (!document.querySelector("[data-role-menu]")?.contains(target)) {
        setOpenMenuId(null);
      }
    }
    if (openMenuId) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
  }, [openMenuId]);

  function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async function sendInvite() {
    setInviteError("");
    if (!inviteEmail.trim()) {
      setInviteError("Email is required.");
      return;
    }
    if (!isValidEmail(inviteEmail)) {
      setInviteError("Please enter a valid email address.");
      return;
    }
    setInviteSending(true);
    // Simulate API
    await new Promise((res) => setTimeout(res, 600));
    const newInvite: PendingInvite = {
      id: `i${Date.now()}`,
      email: inviteEmail.trim(),
      role: inviteRole,
      invitedBy: "You",
      sentAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      status: "pending",
    };
    setInvites((current) => [...current, newInvite]);
    setInviteEmail("");
    setInviteRole("recruiter");
    setInviteSending(false);
    setModalOpen(false);
  }

  async function resendInvite(id: string) {
    setActionId(id);
    await new Promise((res) => setTimeout(res, 400));
    setInvites((current) =>
      current.map((inv) =>
        inv.id === id
          ? { ...inv, sentAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString() }
          : inv
      )
    );
    setActionId("");
  }

  async function revokeInvite(id: string) {
    setActionId(id);
    await new Promise((res) => setTimeout(res, 300));
    setInvites((current) => current.filter((inv) => inv.id !== id));
    setActionId("");
  }

  async function changeRole(memberId: string, newRole: string) {
    setActionId(memberId);
    await new Promise((res) => setTimeout(res, 300));
    setMembers((current) =>
      current.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
    );
    setActionId("");
    setOpenMenuId(null);
  }

  async function toggleStatus(memberId: string) {
    setActionId(memberId);
    await new Promise((res) => setTimeout(res, 300));
    setMembers((current) =>
      current.map((m) =>
        m.id === memberId ? { ...m, status: m.status === "active" ? "inactive" : "active" } : m
      )
    );
    setActionId("");
    setOpenMenuId(null);
  }

  async function removeMember(memberId: string) {
    if (!confirm("Remove this member from the workspace?")) return;
    setActionId(memberId);
    await new Promise((res) => setTimeout(res, 300));
    setMembers((current) => current.filter((m) => m.id !== memberId));
    setActionId("");
    setOpenMenuId(null);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p className="page-kicker">Manage members and pending invites</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setModalOpen(true)}>
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Members Section */}
      <div className="mb-10">
        <h2 className="section-title flex items-center gap-2">
          <Users className="w-4 h-4 text-ink-soft" />
          Members
        </h2>

        {loading ? (
          <p className="muted">Loading team…</p>
        ) : members.length === 0 ? (
          <div className="empty">
            <Users className="w-8 h-8 text-ink-soft mx-auto mb-2" />
            No team members yet.
          </div>
        ) : (
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Active</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const RoleIcon = roleIcon(member.role);
                  return (
                    <tr key={member.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="avatar-circle w-8 h-8 text-xs">
                            {initials(member.name)}
                          </div>
                          <span className="font-semibold text-ink">{member.name}</span>
                        </div>
                      </td>
                      <td className="muted">{member.email}</td>
                      <td>
                        <span className="badge flex items-center gap-1 w-fit">
                          <RoleIcon className="w-3 h-3" />
                          {roleLabel(member.role)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={cn(
                            "badge",
                            member.status === "active"
                              ? "bg-accent-soft text-accent"
                              : "bg-gray-100 text-gray-500"
                          )}
                        >
                          {member.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="muted text-sm">{formatRelative(member.lastActive)}</td>
                      <td className="text-right">
                        <div className="relative inline-block" data-role-menu>
                          <button
                            className="btn btn-compact p-1.5"
                            onClick={() =>
                              setOpenMenuId(openMenuId === member.id ? null : member.id)
                            }
                            disabled={actionId === member.id}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          {openMenuId === member.id && (
                            <div className="absolute right-0 top-8 min-w-[160px] bg-surface border border-border rounded-lg shadow-lg p-1 z-50 flex flex-col">
                              <div className="px-2 py-1 text-[10px] font-bold text-ink-soft uppercase tracking-wide">
                                Change Role
                              </div>
                              {roleOptions.map((role) => (
                                <button
                                  key={role.value}
                                  className={cn(
                                    "text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2 hover:bg-bg transition-colors",
                                    member.role === role.value && "bg-accent-soft text-accent"
                                  )}
                                  onClick={() => changeRole(member.id, role.value)}
                                >
                                  <role.icon className="w-3.5 h-3.5" />
                                  {role.label}
                                </button>
                              ))}
                              <div className="border-t border-border my-1" />
                              <button
                                className="text-left px-2 py-1.5 rounded-md text-sm hover:bg-bg transition-colors"
                                onClick={() => toggleStatus(member.id)}
                              >
                                {member.status === "active" ? "Deactivate" : "Activate"}
                              </button>
                              <button
                                className="text-left px-2 py-1.5 rounded-md text-sm text-danger hover:bg-red-50 transition-colors"
                                onClick={() => removeMember(member.id)}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending Invites Section */}
      <div>
        <h2 className="section-title flex items-center gap-2">
          <Mail className="w-4 h-4 text-ink-soft" />
          Pending Invites
        </h2>

        {loading ? (
          <p className="muted">Loading invites…</p>
        ) : invites.length === 0 ? (
          <div className="empty card">
            <Inbox className="w-8 h-8 text-ink-soft mx-auto mb-2" />
            <p className="text-sm font-medium text-ink">No pending invites</p>
            <p className="text-xs text-ink-soft mt-1">
              Invited team members will appear here until they accept.
            </p>
          </div>
        ) : (
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Invited By</th>
                  <th>Sent</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td className="font-medium text-ink">{invite.email}</td>
                    <td>
                      <span className="badge">{roleLabel(invite.role)}</span>
                    </td>
                    <td className="muted">{invite.invitedBy}</td>
                    <td className="muted text-sm">{formatRelative(invite.sentAt)}</td>
                    <td className="muted text-sm">{formatDate(invite.expiresAt)}</td>
                    <td>
                      <span className="badge badge-waiting">{invite.status}</span>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="btn btn-compact flex items-center gap-1"
                          onClick={() => resendInvite(invite.id)}
                          disabled={actionId === invite.id}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {actionId === invite.id ? "Resending…" : "Resend"}
                        </button>
                        <button
                          className="btn-danger btn-compact flex items-center gap-1"
                          onClick={() => revokeInvite(invite.id)}
                          disabled={actionId === invite.id}
                        >
                          <Ban className="w-3.5 h-3.5" />
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-ink">Invite Member</h2>
              <button
                className="p-1 rounded-md hover:bg-bg transition-colors"
                onClick={() => setModalOpen(false)}
              >
                <X className="w-4 h-4 text-ink-soft" />
              </button>
            </div>

            <div className="field-group">
              <label>Email Address *</label>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-ink-soft shrink-0" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    setInviteError("");
                  }}
                  placeholder="colleague@company.com"
                  className={cn(inviteError && "border-danger")}
                  autoFocus
                />
              </div>
              {inviteError && (
                <p className="text-xs text-danger mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {inviteError}
                </p>
              )}
            </div>

            <div className="field-group">
              <label>Role *</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                {roleOptions.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-primary flex items-center gap-2"
                onClick={sendInvite}
                disabled={inviteSending}
              >
                <Send className="w-4 h-4" />
                {inviteSending ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
