"use client";

import ApprovalsPanel from "../components/ApprovalsPanel";

export default function ApprovalsPage() {
  return (
    <div className="page email-approvals-page" style={{ width: "100%", maxWidth: "100%", margin: "0 auto", padding: "20px 20px 40px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Communication intelligence</div>
        <h1 style={{ margin: "6px 0 4px" }}>Pending Approvals</h1>
        <p className="page-kicker" style={{ margin: 0 }}>Review AI-suggested application changes before they are applied.</p>
      </div>
      <ApprovalsPanel />
    </div>
  );
}
