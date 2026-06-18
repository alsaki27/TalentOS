"use client";

import { useEffect, useState } from "react";

interface TeamUser {
  user_id: string;
  email: string | null;
  display_name: string;
  role: string;
  is_active: boolean;
}

interface MeResponse {
  profile: {
    role: string;
  };
}

const roles = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "application_engineer", label: "Application engineer" },
  { value: "recruiter", label: "Recruiter" },
];

export default function TeamPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savingId, setSavingId] = useState("");
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({
    display_name: "",
    email: "",
    role: "application_engineer",
    password: "",
  });

  async function load() {
    setLoading(true);
    const meRes = await fetch("/api/auth/me");
    if (!meRes.ok) {
      setError("Authentication required.");
      setLoading(false);
      return;
    }
    const meData = await meRes.json();
    setMe(meData);
    if (meData.profile?.role !== "admin") {
      setLoading(false);
      return;
    }

    const res = await fetch("/api/users");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not load team.");
      setLoading(false);
      return;
    }
    setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function updateUser(user: TeamUser, patch: Partial<TeamUser>) {
    setSavingId(user.user_id);
    setError("");
    setSuccess("");
    const res = await fetch(`/api/users/${user.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSavingId("");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update user.");
      return;
    }
    const updated = await res.json();
    setUsers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item));
  }

  async function createUser() {
    setCreating(true);
    setError("");
    setSuccess("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser),
    });
    setCreating(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not create user.");
      return;
    }
    const created = await res.json();
    setUsers((current) => [...current, created].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    setSuccess(`Created ${created.display_name}. Give them the temporary password you set.`);
    setNewUser({ display_name: "", email: "", role: "application_engineer", password: "" });
  }

  return (
    <>
      <div className="page-header">
        <h1>Team</h1>
      </div>

      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}

      {!loading && me?.profile.role !== "admin" && (
        <div className="empty">Only admins can manage team access.</div>
      )}

      {me?.profile.role === "admin" && <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="section-title">Add user</h2>
        <div className="team-create-grid">
          <div className="field-group">
            <label>Name</label>
            <input
              value={newUser.display_name}
              onChange={(event) => setNewUser((current) => ({ ...current, display_name: event.target.value }))}
              placeholder="Application engineer name"
            />
          </div>
          <div className="field-group">
            <label>Email</label>
            <input
              type="email"
              value={newUser.email}
              onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
              placeholder="name@company.com"
            />
          </div>
          <div className="field-group">
            <label>Role</label>
            <select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value }))}>
              {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label>Temporary password</label>
            <input
              type="password"
              value={newUser.password}
              onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
              placeholder="At least 8 characters"
            />
          </div>
        </div>
        <button className="btn-primary" onClick={createUser} disabled={creating}>
          {creating ? "Creating..." : "Create user"}
        </button>
      </div>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : me?.profile.role === "admin" ? (
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.user_id}>
                <td>
                  <input
                    value={user.display_name}
                    onChange={(event) => setUsers((current) => current.map((item) => (
                      item.user_id === user.user_id ? { ...item, display_name: event.target.value } : item
                    )))}
                    onBlur={() => updateUser(user, { display_name: user.display_name })}
                    placeholder={user.email ?? "Name"}
                  />
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{user.email}</div>
                </td>
                <td>
                  <select value={user.role} onChange={(event) => updateUser(user, { role: event.target.value })}>
                    {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </td>
                <td>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={user.is_active}
                      onChange={(event) => updateUser(user, { is_active: event.target.checked })}
                    />
                    Active
                  </label>
                </td>
                <td className="muted">{savingId === user.user_id ? "Saving..." : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
