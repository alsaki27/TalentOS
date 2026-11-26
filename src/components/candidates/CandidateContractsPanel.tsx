"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { CandidateAgreementEditor } from "./CandidateAgreementEditor";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ContractFile {
  delivery_status?: string | null;
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
  const [previewFile, setPreviewFile] = useState<ContractFile | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewRequestId = useRef(0);
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

  async function showContract(file: ContractFile) {
    const requestId = ++previewRequestId.current;
    setPreviewFile(file);
    setPreviewText("");
    setPreviewError("");
    setPreviewLoading(false);
    const isDocx = file.filename.toLowerCase().endsWith(".docx")
      || file.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (file.content_type === "application/pdf" || !isDocx) return;

    setPreviewLoading(true);
    try {
      const response = await fetch(`/api/candidates/${candidateId}/contracts/${file.id}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Could not load this contract for preview.");
      }
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer: await response.arrayBuffer() });
      if (previewRequestId.current === requestId) setPreviewText(result.value);
    } catch (previewLoadError) {
      if (previewRequestId.current === requestId) {
        setPreviewError(previewLoadError instanceof Error ? previewLoadError.message : "Could not preview this Word document.");
      }
    } finally {
      if (previewRequestId.current === requestId) setPreviewLoading(false);
    }
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
          <p className="muted">Uploaded and electronically signed agreements for {candidateName}.</p>
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

          {!hasContract && <CandidateAgreementEditor key={candidateId} candidateId={candidateId} />}

          <div className="candidate-contract-upload">
            <div>
              <strong>Add a contract file</strong>
              <p className="muted">PDF, DOC, or DOCX · up to 20 MB · saved in SharePoint.</p>
            </div>
            <input id={`candidate-contract-upload-${candidateId}`} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={selectFile} disabled={uploading} />
            {selectedFile && <button className="btn-primary" type="button" onClick={uploadFile} disabled={uploading}>{uploading ? "Uploading securely…" : "Upload agreement"}</button>}
          </div>

          <div className="candidate-contract-file-list" aria-live="polite">
            <h3>Agreement documents</h3>
            {loading ? <p className="muted">Loading private files…</p> : files.length === 0 ? <p className="muted">No contract file uploaded yet.</p> : (
              <ul>
                {files.map((file) => (
                  <li key={file.id}>
                    <div>
                      <strong>{file.filename}</strong>
                      <span>{new Date(file.created_at).toLocaleString()} · {Math.max(1, Math.ceil(file.size_bytes / 1024))} KB</span>
                      {file.delivery_status && <span>{file.delivery_status}</span>}
                    </div>
                    <button className="candidate-contract-show-button" type="button" onClick={() => void showContract(file)}>
                      Show Contract
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="candidate-contract-restricted">Contract files are restricted to admins, managers, and co-managers. The contract status is visible to your role.</p>
      )}

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <Dialog open={Boolean(previewFile)} onOpenChange={(open) => {
          if (!open) {
            previewRequestId.current += 1;
            setPreviewFile(null);
            setPreviewLoading(false);
          }
      }}>
        {previewFile && (
          <DialogContent className="candidate-contract-preview-dialog">
            <DialogHeader>
              <DialogTitle>Contract document</DialogTitle>
              <DialogDescription>
                {previewFile.filename}
                {(previewFile.filename.toLowerCase().endsWith(".docx") || previewFile.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                  && " · Text preview; download to preserve the original layout."}
              </DialogDescription>
            </DialogHeader>
            <div className="candidate-contract-preview-body">
              {previewFile.content_type === "application/pdf" ? (
                <iframe
                  title={`Contract: ${previewFile.filename}`}
                  src={`/api/candidates/${candidateId}/contracts/${previewFile.id}?view=inline`}
                  className="candidate-contract-pdf-preview"
                />
              ) : previewFile.filename.toLowerCase().endsWith(".docx") || previewFile.content_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? (
                <div className="candidate-contract-docx-preview" aria-live="polite">
                  {previewLoading ? <p className="muted">Loading contract preview…</p> : previewError ? <p className="alert alert-error" role="alert">{previewError}</p> : previewText ? <pre>{previewText}</pre> : <p className="muted">No readable text was found in this document.</p>}
                </div>
              ) : (
                <div className="candidate-contract-preview-unavailable">
                  <strong>This legacy Word format can’t be previewed here.</strong>
                  <p>Download the private file to view the complete contract in Word or another compatible app.</p>
                </div>
              )}
            </div>
            <DialogFooter className="candidate-contract-preview-footer">
              <a
                className="btn-primary candidate-contract-download-button"
                href={`/api/candidates/${candidateId}/contracts/${previewFile.id}`}
              >
                <Download size={16} aria-hidden="true" />
                Download contract
              </a>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
