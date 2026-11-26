"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, FileText, Headphones, X } from "lucide-react";
import { MAX_INTERVIEW_AUDIO_MB, MAX_PREPARATION_FILE_BYTES, type InterviewPreparationFile } from "@/lib/applicationInterviewPreparation";
import { uploadInterviewRecording } from "@/lib/uploadInterviewRecording";
import styles from "./CandidateApplicationWorkspace.module.css";

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || "The request could not be completed.");
  return data;
}

function DocumentPreview({ file, url, onClose }: { file: InterviewPreparationFile; url: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ url: string; type: string; text?: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | undefined;
    fetch(url + "?preview=1", { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable. Download the original to open it.");
        const blob = await response.blob();
        if (blob.type.startsWith("text/plain")) {
          const body = await blob.text();
          if (!abort.signal.aborted) setPreview({ url: "", type: blob.type, text: body });
        } else if (blob.type === "application/pdf" && !abort.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ url: objectUrl, type: blob.type });
        } else if (!abort.signal.aborted) {
          throw new Error("Preview unavailable. Download the original to open it.");
        }
      })
      .catch((cause: Error) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <dialog ref={dialog} className={styles.documentDialog} aria-label={file.filename}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.documentDialogContent}>
        <header className={styles.stageModalHeader}>
          <h2>{file.filename}</h2>
          <div className={styles.actions}>
            <a className={styles.linkButton} href={url} download><Download size={15} /> Download</a>
            <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close document preview"><X size={19} /></button>
          </div>
        </header>
        <div className={styles.documentBody}>
          {error ? <p role="alert">{error}</p> : !preview ? <p role="status">Loading preview…</p> : preview.text !== undefined
            ? <><p className={styles.muted}>Text preview</p><pre>{preview.text}</pre></>
            : <object data={preview.url} type={preview.type} aria-label={file.filename}>
              <p>This browser cannot display the PDF here. <a href={preview.url} target="_blank" rel="noreferrer">Open preview</a> or download the original.</p>
            </object>}
        </div>
      </div>
    </dialog>
  );
}

export default function ApplicationPreparationFiles({ files, endpoint, audio = false, editable = false,
  showManager = editable, onChange, onBusyChange }: {
  files: InterviewPreparationFile[];
  endpoint: string;
  audio?: boolean;
  editable?: boolean;
  showManager?: boolean;
  onChange?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [selected, setSelected] = useState<InterviewPreparationFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(request: () => Promise<unknown>) {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      await request();
      onChange?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formNode = event.currentTarget;
    const form = new FormData(formNode);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || (!audio && file.size > MAX_PREPARATION_FILE_BYTES)) {
      setError(audio ? "Choose a non-empty audio recording." : "Choose a file up to 20 MB.");
      return;
    }
    form.set("visible", String(form.has("publish")));
    void change(async () => {
      if (audio) await uploadInterviewRecording(endpoint, file, form.has("publish"));
      else await requestJson(endpoint, { method: "POST", body: form });
      formNode.reset();
    });
  }

  function updateFile(file: InterviewPreparationFile, remove: boolean) {
    if (remove && !window.confirm(`Remove “${file.filename}” from the application and candidate portal?`)) return;
    void change(() => requestJson(`${endpoint}/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(remove ? { remove: true } : { visible: !file.visible_to_candidate }),
    }));
  }

  return (
    <div className={styles.modalFileList}>
      {!files.length && <p className={styles.muted}>{audio ? "No audio added." : "No preparation documents added."}</p>}
      {files.map((file) => {
        const url = `${endpoint}/${file.id}`;
        return (
          <div className={styles.preparationFileRow} key={file.id}>
            <span className={styles.fileIcon}>{audio ? <Headphones size={17} /> : <FileText size={17} />}</span>
            <span className={styles.fileName}>
              {audio ? <strong>{file.filename}</strong> : <button type="button" className={styles.filePreviewButton} onClick={() => setSelected(file)}>{file.filename}</button>}
              {editable && <small>{file.visible_to_candidate ? "Shared with candidate" : "Staff only"}</small>}
            </span>
            <span className={styles.fileType}>{file.filename.split(".").pop()?.toUpperCase()}</span>
            {audio && <audio className={styles.audioPlayer} controls preload="none" src={url} aria-label={file.filename} />}
            {!audio && <a className={styles.linkButton} href={url} download aria-label={`Download ${file.filename}`}><Download size={15} /></a>}
            {showManager && <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => updateFile(file, false)}>{file.visible_to_candidate ? "Hide from portal" : "Share with candidate"}</button>
              <button type="button" disabled={busy} onClick={() => updateFile(file, true)}>Remove</button>
            </div>}
          </div>
        );
      })}
      {showManager && <form className={styles.uploadPanel} onSubmit={upload}>
        <label className={styles.uploadPicker}>
          {audio ? "Choose an audio recording" : "Choose a preparation document"}
          <input name="file" type="file" accept={audio ? ".mp3,.m4a,.wav,.ogg,.opus,.flac" : ".pdf,.doc,.docx"} required disabled={busy} />
        </label>
        <span className={styles.muted}>{audio ? "MP3, M4A, WAV, OGG, Opus, or FLAC" : "PDF, DOC, or DOCX"} · up to {audio ? MAX_INTERVIEW_AUDIO_MB : 20} MB per file</span>
        <label className={styles.checkbox}><input name="publish" type="checkbox" defaultChecked disabled={busy} /> Share with candidate in the portal</label>
        <button type="submit" disabled={busy}>{busy ? "Working…" : "Upload to SharePoint"}</button>
      </form>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {selected && <DocumentPreview key={selected.id} file={selected} url={`${endpoint}/${selected.id}`} onClose={() => setSelected(null)} />}
    </div>
  );
}
