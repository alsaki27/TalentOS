"use client";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
export default function ResetPasswordPage() {
  const router = useRouter(); const params = useSearchParams(); const [password, setPassword] = useState(""); const [message, setMessage] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); const res = await fetch("/api/portal/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: params.get("token"), password }) }); const data = await res.json(); setMessage(res.ok ? "Password changed. You can sign in now." : data.error); if (res.ok) setTimeout(() => router.push("/portal/login"), 1000); }
  return <div className="portal-auth-shell"><form className="portal-auth-card" onSubmit={submit}><h1 className="portal-h1">Choose a new password</h1><div className="portal-field"><label>New password</label><input type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></div>{message && <p className="portal-sub">{message}</p>}<button className="portal-btn portal-btn-primary">Save password</button></form></div>;
}
