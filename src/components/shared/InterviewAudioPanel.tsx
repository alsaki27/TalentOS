"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Headphones, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { MAX_PREPARATION_FILE_BYTES, type InterviewPreparationFile } from "@/lib/applicationInterviewPreparation";
import styles from "./InterviewAudioPanel.module.css";

async function readResult(response: Response) {
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "The request could not be completed.");
  return result;
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Size unavailable";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function InterviewAudioPanel({ endpoint, files, onChange, onBusyChange }: {
  endpoint: string;
  files: InterviewPreparationFile[];
  onChange?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [currentFiles, setCurrentFiles] = useState(files);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => setCurrentFiles(files), [endpoint, files]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) return setError("Choose an audio recording first.");
    if (file.size > MAX_PREPARATION_FILE_BYTES) return setError("Recordings must be 20 MB or smaller.");

    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setMessage("");
    try {
      const replacingId = replacingFileId;
      const formData = new FormData(form);
      formData.set("visible", "true");
      const added = await readResult(await fetch(endpoint, { method: "POST", body: formData, cache: "no-store" }));
      if (!added.id) throw new Error("The recording was uploaded but could not be confirmed.");

      if (replacingId) {
        try {
          await readResult(await fetch(`${endpoint}/${replacingId}`, { method: "DELETE", cache: "no-store" }));
          setCurrentFiles((existing) => [...existing.filter((item) => item.id !== replacingId && item.id !== added.id), added]);
          setMessage("Recording replaced in SharePoint.");
        } catch (cause) {
          setCurrentFiles((existing) => [...existing.filter((item) => item.id !== added.id), added]);
          setMessage(`The new recording was saved, but the previous one is still available: ${cause instanceof Error ? cause.message : "SharePoint could not remove it."}`);
        }
      } else {
        setCurrentFiles((existing) => [...existing.filter((item) => item.id !== added.id), added]);
        setMessage("Recording uploaded to SharePoint.");
      }
      onChange?.();
      form.reset();
      setFileName("");
      setReplacingFileId(null);
      setUploadOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recording could not be uploaded.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  async function remove(file: InterviewPreparationFile) {
    if (!window.confirm(`Remove “${file.filename}” from TalentOS, the candidate portal, and SharePoint?`)) return;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setMessage("");
    try {
      await readResult(await fetch(`${endpoint}/${file.id}`, { method: "DELETE", cache: "no-store" }));
      setCurrentFiles((existing) => existing.filter((item) => item.id !== file.id));
      if (replacingFileId === file.id) closeUpload();
      onChange?.();
      setMessage("Recording removed from TalentOS and SharePoint.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recording could not be removed.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFileName(event.currentTarget.files?.[0]?.name || "");
    setError("");
    setMessage("");
  }

  function closeUpload() {
    formRef.current?.reset();
    setFileName("");
    setReplacingFileId(null);
    setError("");
    setUploadOpen(false);
  }

  function replace(file: InterviewPreparationFile) {
    formRef.current?.reset();
    setFileName("");
    setReplacingFileId(file.id);
    setError("");
    setMessage("");
    setUploadOpen(true);
  }

  return (
    <section className={styles.panel} aria-label="Interview recordings">
      <div className={styles.heading}>
        <span className={styles.icon}><Headphones size={16} /></span>
        <div><strong>Interview recordings</strong><span>{currentFiles.length} saved</span></div>
        <button type="button" className={styles.toggleUpload} onClick={() => {
          if (uploadOpen) closeUpload();
          else { setUploadOpen(true); setMessage(""); }
        }} aria-expanded={uploadOpen}>
          {uploadOpen ? <><X size={14} />Close</> : <><Upload size={14} />Upload</>}
        </button>
      </div>

      {currentFiles.length > 0 ? <div className={styles.fileList}>
        {currentFiles.map((file) => (
          <article className={styles.file} key={file.id}>
            <div className={styles.fileHeading}><strong title={file.filename}>{file.filename}</strong><span>{formatSize(Number(file.size_bytes))}</span></div>
            <audio className={styles.player} controls preload="metadata" src={`${endpoint}/${file.id}`} aria-label={`Play ${file.filename}`}>
              Audio playback is not supported by this browser.
            </audio>
            <div className={styles.fileActions}>
              <button type="button" disabled={busy} onClick={() => replace(file)} title="Replace recording" aria-label={`Replace ${file.filename}`}><RefreshCw size={12} /></button>
              <button type="button" disabled={busy} onClick={() => void remove(file)} title="Remove recording" aria-label={`Remove ${file.filename}`}><Trash2 size={12} /></button>
            </div>
          </article>
        ))}
      </div> : <p className={styles.empty}>No recording yet.</p>}

      {uploadOpen && <form ref={formRef} className={styles.upload} onSubmit={upload}>
        {replacingFileId && <strong className={styles.replaceHint}>Replacing {currentFiles.find((file) => file.id === replacingFileId)?.filename || "recording"}</strong>}
        <label className={styles.picker}>
          <input name="file" type="file" accept=".mp3,.m4a,.wav,.ogg,.opus,.flac,audio/*" disabled={busy} onChange={selectFile} required />
          <span className={styles.pickerText}>{fileName || "Select an audio recording"}</span>
          <span className={styles.browse}>Browse</span>
        </label>
        <div className={styles.uploadFooter}>
          <span>MP3, M4A, WAV, OGG, Opus or FLAC · up to 20 MB</span>
          <button type="submit" disabled={busy || !fileName}><Upload size={14} />{busy ? "Uploading…" : replacingFileId ? "Save replacement" : "Save recording"}</button>
        </div>
      </form>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.success} role="status">{message}</p>}
    </section>
  );
}
