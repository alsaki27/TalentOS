"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  Code2,
  MoreHorizontal,
  Shield,
  Trash2,
  Users,
  UserPlus,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { cn } from "../../lib/utils";

interface TeamMember {
  user_id: string;
  display_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
}

interface MeResponse {
  profile: {
    user_id: string;
    role: string;
  };
}

const roleOptions = [
  { value: "admin", label: "Admin", icon: Shield },
  { value: "manager", label: "Manager", icon: Briefcase },
  { value: "application_engineer", label: "Application Engineer", icon: Code2 },
];

function roleLabel(role: string) {
  return roleOptions.find((r) => r.value === role)?.label || role;
}

function roleIcon(role: string) {
  const Icon = roleOptions.find((r) => r.value === role)?.icon || Users;
  return Icon;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("application_engineer");
  const [formError, setFormError] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [memberToDelete, setMemberToDelete] = useState<TeamMember | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    load();
  }, []);

  function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async function load() {
    setLoading(true);
    setFeedback(null);
    try {
      const [usersRes, meRes] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/bootstrap", { cache: "no-store" }),
      ]);
      if (!usersRes.ok) {
        throw new Error("Could not load team members.");
      }
      const users = (await usersRes.json()) as TeamMember[];
      setMembers(users);
      if (meRes.ok) {
        setMe(await meRes.json());
      }
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Could not load team members." });
    } finally {
      setLoading(false);
    }
  }

  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) => {
        const aRank = a.role === "admin" ? 0 : a.role === "manager" ? 1 : 2;
        const bRank = b.role === "admin" ? 0 : b.role === "manager" ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        return (a.display_name || a.email || "").localeCompare(b.display_name || b.email || "");
      }),
    [members]
  );

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFeedback(null);

    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!isValidEmail(email)) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setFormError("Temporary password must be at least 8 characters.");
      return;
    }

    setFormSaving(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
      }),
    });
    setFormSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error || "Could not create user.");
      return;
    }

    const created = (await res.json()) as TeamMember;
    setMembers((current) => [...current, created]);
    setName("");
    setEmail("");
    setPassword("");
    setRole("application_engineer");
    setModalOpen(false);
    setFeedback({ kind: "success", text: "User created." });
  }

  async function changeRole(memberId: string, newRole: string) {
    setActionId(memberId);
    setFeedback(null);
    const res = await fetch(`/api/users/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    setActionId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not update role." });
      return;
    }
    const updated = (await res.json()) as TeamMember;
    setMembers((current) => current.map((m) => (m.user_id === memberId ? updated : m)));
    setFeedback({ kind: "success", text: "Role updated." });
    setOpenMenuId(null);
  }

  async function toggleStatus(memberId: string) {
    const member = members.find((entry) => entry.user_id === memberId);
    if (!member) return;
    if (me?.profile.user_id === memberId && member.is_active) {
      setFeedback({ kind: "error", text: "You cannot deactivate your own account." });
      return;
    }

    setActionId(memberId);
    setFeedback(null);
    const res = await fetch(`/api/users/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !member.is_active }),
    });
    setActionId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({ kind: "error", text: data.error || "Could not update status." });
      return;
    }
    const updated = (await res.json()) as TeamMember;
    setMembers((current) => current.map((m) => (m.user_id === memberId ? updated : m)));
    setFeedback({ kind: "success", text: updated.is_active ? "User activated." : "User deactivated." });
    setOpenMenuId(null);
  }

  async function permanentlyDeleteMember() {
    if (!memberToDelete || deleteConfirmation !== "DELETE") return;

    setDeleteSaving(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/users/${memberToDelete.user_id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete team member.");

      setMembers((current) => current.filter((member) => member.user_id !== memberToDelete.user_id));
      setFeedback({ kind: "success", text: "User deleted. Past activity is preserved as Deleted member." });
      setMemberToDelete(null);
      setDeleteConfirmation("");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete team member.");
    } finally {
      setDeleteSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p className="page-kicker">Manage users, passwords, and role-based access</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setModalOpen(true)}>
          <UserPlus className="w-4 h-4" />
          Create User
        </button>
      </div>

      {feedback && <div className={`toast ${feedback.kind === "error" ? "toast-error" : ""}`}>{feedback.text}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0 }}>
          Roles:
          {" "}
          <strong>Admin</strong> can access everything.
          {" "}
          <strong>Manager</strong> can access everything except the Team page.
          {" "}
          <strong>Application Engineer</strong> can access everything except Team, Jobs, and Companies.
        </p>
      </div>

      <div>
        <h2 className="section-title flex items-center gap-2">
          <Users className="w-4 h-4 text-ink-soft" />
          Members
        </h2>

        {loading ? (
          <p className="muted">Loading team…</p>
        ) : sortedMembers.length === 0 ? (
          <div className="empty">
            <Users className="w-8 h-8 text-ink-soft mx-auto mb-2" />
            No team members found.
          </div>
        ) : (
          <div className="table-shell" style={{ overflow: "visible" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMembers.map((member) => {
                    const RoleIcon = roleIcon(member.role);
                    return (
                    <tr key={member.user_id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="avatar-circle w-8 h-8 text-xs">
                            {initials(member.display_name || member.email || "User")}
                          </div>
                          <div>
                            <div className="font-semibold text-ink">{member.display_name || member.email || "User"}</div>
                            {me?.profile.user_id === member.user_id && <div className="muted text-xs">You</div>}
                          </div>
                        </div>
                      </td>
                      <td className="muted">{member.email || "—"}</td>
                      <td>
                        <span className="badge flex items-center gap-1 w-fit">
                          <RoleIcon className="w-3 h-3" />
                          {roleLabel(member.role)}
                        </span>
                      </td>
                      <td>
                        <span className={cn("badge", member.is_active ? "bg-accent-soft text-accent" : "bg-gray-100 text-gray-500")}>
                          {member.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="text-right">
                        <DropdownMenu
                          open={openMenuId === member.user_id}
                          onOpenChange={(open) => setOpenMenuId(open ? member.user_id : null)}
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              className="btn btn-compact p-1.5"
                              disabled={actionId === member.user_id}
                              aria-label={`Open actions for ${member.display_name || member.email || "user"}`}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="min-w-[220px] border-border bg-surface p-1 shadow-lg"
                          >
                            <DropdownMenuLabel className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                              Change Role
                            </DropdownMenuLabel>
                            {roleOptions.map((roleOption) => (
                              <DropdownMenuItem
                                key={roleOption.value}
                                className={cn(
                                  "cursor-pointer gap-2 rounded-md px-2 py-1.5 text-sm text-ink focus:bg-bg focus:text-ink",
                                  member.role === roleOption.value && "bg-accent-soft text-accent focus:bg-accent-soft focus:text-accent"
                                )}
                                onSelect={() => changeRole(member.user_id, roleOption.value)}
                                disabled={me?.profile.user_id === member.user_id}
                              >
                                <roleOption.icon className="h-3.5 w-3.5" />
                                {roleOption.label}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator className="my-1 bg-border" />
                            <DropdownMenuItem
                              className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-ink focus:bg-bg focus:text-ink"
                              onSelect={() => toggleStatus(member.user_id)}
                            >
                              {member.is_active ? "Deactivate" : "Activate"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1 bg-border" />
                            <DropdownMenuItem
                              className="cursor-pointer gap-2 rounded-md px-2 py-1.5 text-sm text-danger focus:bg-danger focus:text-white"
                              onSelect={() => {
                                setDeleteError("");
                                setDeleteConfirmation("");
                                setMemberToDelete(member);
                              }}
                              disabled={me?.profile.user_id === member.user_id}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Permanently delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <form className="modal" onSubmit={createMember} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-ink">Create User</h2>
              <button
                type="button"
                className="p-1 rounded-md hover:bg-bg transition-colors"
                onClick={() => setModalOpen(false)}
              >
                <X className="w-4 h-4 text-ink-soft" />
              </button>
            </div>

            <div className="field-group">
              <label>Full Name *</label>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFormError("");
                }}
                placeholder="Jordan Lee"
                autoFocus
              />
            </div>

            <div className="field-group">
              <label>Email Address *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFormError("");
                }}
                placeholder="colleague@company.com"
                className={cn(formError && "border-danger")}
              />
            </div>

            <div className="field-group">
              <label>Temporary Password *</label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFormError("");
                }}
                placeholder="Minimum 8 characters"
              />
            </div>

            <div className="field-group">
              <label>Role *</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {roleOptions.map((roleOption) => (
                  <option key={roleOption.value} value={roleOption.value}>
                    {roleOption.label}
                  </option>
                ))}
              </select>
            </div>

            {formError && (
              <p className="text-xs text-danger mt-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {formError}
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary flex items-center gap-2"
                disabled={formSaving}
              >
                <UserPlus className="w-4 h-4" />
                {formSaving ? "Creating…" : "Create User"}
              </button>
            </div>
          </form>
        </div>
      )}

      {memberToDelete && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!deleteSaving) {
              setMemberToDelete(null);
              setDeleteConfirmation("");
            }
          }}
        >
          <section
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-member-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="rounded-full p-2 text-danger" style={{ backgroundColor: "var(--danger-soft)" }}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 id="delete-member-title" className="text-base font-bold text-ink">Permanently delete team member?</h2>
                <p className="muted mt-1 text-sm">{memberToDelete.display_name || memberToDelete.email || "This user"}{memberToDelete.email ? ` · ${memberToDelete.email}` : ""}</p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-bg p-3 text-sm text-ink-soft">
              <ul className="list-disc space-y-1 pl-5">
                <li>The account will be removed, and extension keys owned or created by this member will be revoked.</li>
                <li>Existing assignments to this member will be cleared.</li>
                <li>Past activity and audit history will remain, attributed to “Deleted member.”</li>
              </ul>
              <p className="mt-2 font-semibold text-danger">This action cannot be undone.</p>
            </div>

            <div className="field-group mt-4">
              <label htmlFor="delete-member-confirmation">Type DELETE to confirm</label>
              <input
                id="delete-member-confirmation"
                value={deleteConfirmation}
                onChange={(event) => {
                  setDeleteConfirmation(event.target.value);
                  setDeleteError("");
                }}
                autoComplete="off"
                autoFocus
                disabled={deleteSaving}
              />
            </div>

            {deleteError && <p className="text-xs text-danger mt-1">{deleteError}</p>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setMemberToDelete(null);
                  setDeleteConfirmation("");
                }}
                disabled={deleteSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger flex items-center gap-2"
                onClick={permanentlyDeleteMember}
                disabled={deleteSaving || deleteConfirmation !== "DELETE"}
              >
                <Trash2 className="h-4 w-4" />
                {deleteSaving ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
