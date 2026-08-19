"use client";

import ApprovalsPanel from "../components/ApprovalsPanel";

export default function ApprovalsPage() {
  return (
    <div className="page" style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px 48px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Communication intelligence</div>
        <h1 style={{ margin: "6px 0 4px" }}>Pending Approvals</h1>
        <p className="page-kicker" style={{ margin: 0 }}>AI-detected status changes from candidate email, waiting on an AE decision.</p>
      </div>
      <ApprovalsPanel />
    </div>
  );
}
