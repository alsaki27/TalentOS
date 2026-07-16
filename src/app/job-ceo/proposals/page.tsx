"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ProposalRow {
  id: string;
  target_automation_id: string;
  proposed_changes: Record<string, unknown>;
  rationale: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
}

export default function JobCeoProposalsPage() {
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchProposals() {
    try {
      const res = await fetch("/api/job-ceo/proposals?status=pending", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setProposals(data.proposals ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProposals();
  }, []);

  async function handleApprove(id: string) {
    try {
      const res = await fetch(`/api/job-ceo/proposals/${id}/approve`, { method: "POST" });
      if (res.ok) {
        await fetchProposals();
      }
    } catch {
      // ignore
    }
  }

  async function handleReject(id: string) {
    try {
      const res = await fetch(`/api/job-ceo/proposals/${id}/reject`, { method: "POST" });
      if (res.ok) {
        await fetchProposals();
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Agent Config Proposals</h1>
          <p className="text-sm text-ink-soft mt-1">Changes proposed by the Job CEO for human approval</p>
        </div>
        <Link
          href="/job-ceo"
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-surface text-ink-soft hover:text-ink hover:border-ink-soft transition-colors"
        >
          Back to CEO
        </Link>
      </div>

      {loading && (
        <p className="text-sm text-ink-soft py-8 text-center">Loading proposals...</p>
      )}

      {!loading && proposals.length === 0 && (
        <p className="text-sm text-ink-soft py-8 text-center">No pending proposals.</p>
      )}

      {proposals.map((p) => (
        <div key={p.id} className="p-4 rounded-lg border border-border bg-bg mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-ink font-mono">{p.target_automation_id}</p>
              <p className="text-xs text-ink-soft mt-0.5">
                Proposed by {p.created_by ?? "job_ceo"} &middot; {new Date(p.created_at).toLocaleString()}
              </p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900 text-yellow-200">Pending</span>
          </div>

          {p.rationale && (
            <div className="mb-3">
              <p className="text-xs font-medium text-ink-soft mb-1">Rationale:</p>
              <p className="text-sm text-ink">{p.rationale}</p>
            </div>
          )}

          <div className="mb-4">
            <p className="text-xs font-medium text-ink-soft mb-1">Proposed Changes:</p>
            <div className="p-2 rounded bg-surface border border-border">
              <pre className="text-xs text-ink font-mono whitespace-pre-wrap">
                {JSON.stringify(p.proposed_changes, null, 2)}
              </pre>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleApprove(p.id)}
              className="px-3 py-1 text-xs font-medium rounded bg-green-800 text-green-100 hover:bg-green-700 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => handleReject(p.id)}
              className="px-3 py-1 text-xs font-medium rounded bg-red-800 text-red-100 hover:bg-red-700 transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
