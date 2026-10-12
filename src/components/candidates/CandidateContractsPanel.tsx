"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";

interface ContractFile {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export function CandidateContractsPanel({
  candidateId,
  candidateName,
  hasContract,
  canManage,
  onContractStatusChange,
  onContractUploaded,
}: {
  candidateId: string;
  candidateName: string;
  hasContract: boolean;
  canManage: boolean;
  onContractStatusChange: (hasContract: boolean) => Promise<void>;
  onContractUploaded: () => void;
}) {
  const [files, setFiles] = useState<ContractFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [uploading, setUploading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [error, setError] = useState("");

  const loadFiles = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/candidates/${candidateId}/contracts`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not load contract files.");
      setFiles(payload.files ?? []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load contract files.");
    } finally {
      setLoading(false);
    }
  }, [candidateId, canManage]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  async function saveStatus(nextStatus: boolean) {
    setSavingStatus(true);
    setError("");
    try {
      await onContractStatusChange(nextStatus);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Could not update contract status.");
    } finally {
      setSavingStatus(false);
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0] ?? null);
    setError("");
  }

  async function uploadFile() {
    if (!selectedFile) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const response = await fetch(`/api/candidates/${candidateId}/contracts`, { method: "POST", body: form, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not upload the contract.");
      setSelectedFile(null);
      const input = document.getElementById(`candidate-contract-upload-${candidateId}`) as HTMLInputElement | null;
      if (input) input.value = "";
      onContractUploaded();
      await loadFiles();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the contract.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="card candidate-contract-panel" aria-labelledby="candidate-contract-heading">
      <div className="candidate-contract-panel-heading">
        <div>
          <span className="candidate-contract-eyebrow">Candidate documents</span>
          <h2 id="candidate-contract-heading">Contract and agreement</h2>
          <p className="muted">Private agreement files for {candidateName}.</p>
        </div>
        <span className={`candidate-contract-status-pill ${hasContract ? "is-yes" : "is-no"}`}>
          {hasContract ? "Has contract" : "No contract"}
        </span>
      </div>

      {canManage ? (
        <>
          <div className="candidate-contract-status-control">
            <label htmlFor="candidate-has-contract-status">Contract status</label>
            <select id="candidate-has-contract-status" value={hasContract ? "yes" : "no"} disabled={savingStatus} onChange={(event) => saveStatus(event.target.value === "yes")}>
              <option value="yes">Yes — has a signed agreement</option>
              <option value="no">No — agreement not on file</option>
            </select>
            {!hasContract && <p className="muted">The candidate must accept the portal agreement and complete onboarding before portal access is granted.</p>}
          </div>

          <div className="candidate-contract-upload">
            <div>
              <strong>Add a contract file</strong>
              <p className="muted">PDF, DOC, or DOCX · up to 20 MB · stored in private document storage.</p>
            </div>
            <input id={`candidate-contract-upload-${candidateId}`} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={selectFile} disabled={uploading} />
            {selectedFile && <button className="btn-primary" type="button" onClick={uploadFile} disabled={uploading}>{uploading ? "Uploading securely…" : "Upload agreement"}</button>}
          </div>

          <div className="candidate-contract-file-list" aria-live="polite">
            <h3>Uploaded agreements</h3>
            {loading ? <p className="muted">Loading private files…</p> : files.length === 0 ? <p className="muted">No contract file uploaded yet.</p> : (
              <ul>
                {files.map((file) => (
                  <li key={file.id}>
                    <div>
                      <strong>{file.filename}</strong>
                      <span>{new Date(file.created_at).toLocaleString()} · {Math.max(1, Math.ceil(file.size_bytes / 1024))} KB</span>
                    </div>
                    <a href={`/api/candidates/${candidateId}/contracts/${file.id}`} target="_blank" rel="noreferrer">Download</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="candidate-contract-restricted">Contract files are restricted to managers. The contract status is visible to your role.</p>
      )}

      {error && <p className="alert alert-error" role="alert">{error}</p>}
    </section>
  );
}
