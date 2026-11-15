import { NextResponse } from "next/server";
import { deleteSharePointItem, openSharePointItem, uploadToSharePoint } from "@/lib/integrations/sharepoint";
import { safeSegment } from "@/lib/integrations/sharepointResumeNaming";
import { MAX_PREPARATION_FILE_BYTES, type InterviewPreparationFile } from "@/lib/applicationInterviewPreparation";
import { query, queryOne } from "@/server/db/neon";
import { APPLICATION_INTERVIEW_ACCESS_SQL, canAccessInterviewDetails } from "@/lib/applicationInterviewAccess";

type Actor = { user_id: string; email: string | null; display_name: string };

const FILE_COLUMNS = "f.id, f.schedule_id, f.filename, f.content_type, f.size_bytes, f.visible_to_candidate";
const DOCUMENT_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
const AUDIO_TYPES = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
} as const;

function matchesType(extension: string, bytes: Uint8Array) {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  const ascii = (value: string, offset = 0) => startsWith(Array.from(value, (char) => char.charCodeAt(0)), offset);
  switch (extension) {
    case "pdf": return ascii("%PDF-");
    case "docx": return startsWith([80, 75, 3, 4]);
    case "doc": return startsWith([208, 207, 17, 224, 161, 177, 26, 225]);
    case "mp3": return ascii("ID3") || (bytes[0] === 255 && (bytes[1] & 224) === 224 && (bytes[1] & 6) !== 0);
    case "m4a": return ascii("ftyp", 4);
    case "wav": return ascii("RIFF") && ascii("WAVE", 8);
    case "ogg":
    case "opus": return ascii("OggS") && (ascii("OpusHead", 28) || (bytes[28] === 1 && ascii("vorbis", 29)));
    case "flac": return ascii("fLaC");
    default: return false;
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function listInterviewPreparationFiles(applicationId: string, candidateVisibleOnly = false) {
  return query<InterviewPreparationFile>(
    `SELECT ${FILE_COLUMNS} FROM interview_preparation_files f
     JOIN applications a ON a.id = f.application_id
     WHERE f.application_id = $1 AND f.removed_at IS NULL AND (NOT $2::boolean OR f.visible_to_candidate)
       AND ${APPLICATION_INTERVIEW_ACCESS_SQL}
       AND (f.content_type NOT LIKE 'audio/%' OR EXISTS (
         SELECT 1 FROM interview_schedules s WHERE s.id = f.schedule_id AND s.application_id = f.application_id
       ))
     ORDER BY f.uploaded_at, f.id`,
    [applicationId, candidateVisibleOnly]
  );
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function uploadInterviewPreparation(request: Request, applicationId: string, scheduleId: string | null, actor: Actor) {
  const audio = scheduleId !== null;
  if (Number(request.headers.get("content-length")) > MAX_PREPARATION_FILE_BYTES + 65536) {
    return error("Files must be 20 MB or smaller.", 413);
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return error("Choose a file.", 400);
  if (file.size > MAX_PREPARATION_FILE_BYTES) return error("Files must be 20 MB or smaller.", 413);

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const types: Readonly<Record<string, string>> = audio ? AUDIO_TYPES : DOCUMENT_TYPES;
  if (!Object.hasOwn(types, extension)) {
    return error(audio ? "Upload an MP3, M4A, WAV, OGG, Opus, or FLAC file." : "Upload a PDF, DOC, or DOCX file.", 400);
  }
  const contentType = types[extension];
  if (!matchesType(extension, new Uint8Array(await file.slice(0, 64).arrayBuffer()))) {
    return error("The file does not match its extension.", 400);
  }

  const record = await queryOne<{ candidate_id: string; candidate_name: string; job_id: string | null; round_number: number | null; status: string; application_stage: string | null; ae_stage: string | null }>(
    `SELECT a.candidate_id, c.name AS candidate_name, a.job_id, s.round_number, a.status, a.application_stage, a.ae_stage
     FROM applications a JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN interview_schedules s ON s.id = $2::uuid AND s.application_id = a.id
     WHERE a.id = $1 AND ($2::uuid IS NULL OR s.id IS NOT NULL)`,
    [applicationId, scheduleId]
  );
  if (!record) return error(audio ? "Interview stage not found." : "Application not found.", 404);
  if (!canAccessInterviewDetails(record.status, record.application_stage, record.ae_stage)) {
    return error("Interview details unlock when the application reaches Interview.", 409);
  }

  const id = crypto.randomUUID();
  const fileLabel = Array.from(file.name.replace(/[/\\\u0000-\u001f\u007f]/g, "").replace(/\.[^.]+$/, "")).slice(0, 100).join("");
  const defaultName = audio ? "Interview audio" : "Preparation";
  const filename = `${fileLabel || defaultName}.${extension}`;
  const candidateFolder = `${safeSegment(record.candidate_name, "Candidate").slice(0, 48)} (${record.candidate_id})`;
  const storedName = `${safeSegment(fileLabel, defaultName).slice(0, 44)}-${id}.${extension}`;
  const base = `${candidateFolder}/${record.job_id || "unlinked"}/Interview preparation/${applicationId}`;
  const path = audio
    ? `${base}/Stage ${record.round_number} (${scheduleId})/Audio/${storedName}`
    : `${base}/Documents/${storedName}`;
  let itemId: string;
  try {
    const uploaded = await uploadToSharePoint(path, file, contentType);
    itemId = uploaded.itemId;
    if (!itemId) throw new Error("SharePoint did not return a drive item ID.");
  } catch (cause) {
    console.error("[interview-preparation] SharePoint upload failed", cause instanceof Error ? cause.name : "unknown");
    return error("Could not upload to SharePoint. Check the storage connection and try again.", 502);
  }

  try {
    const saved = await queryOne<InterviewPreparationFile>(
      `WITH added AS (
         INSERT INTO interview_preparation_files
           (id, application_id, schedule_id, filename, content_type, size_bytes, sharepoint_item_id, visible_to_candidate)
         SELECT $1, a.id, s.id, $4, $5, $6, $7, $8
         FROM applications a
         LEFT JOIN interview_schedules s ON s.id = $3::uuid AND s.application_id = a.id
         WHERE a.id = $2 AND ($3::uuid IS NULL OR s.id IS NOT NULL)
           AND ${APPLICATION_INTERVIEW_ACCESS_SQL}
         RETURNING *
       ), audit AS (
         INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
         SELECT $9, $10, CASE WHEN f.content_type LIKE 'audio/%' THEN 'interview_audio.added' ELSE 'interview_file.added' END, 'application', f.application_id,
           jsonb_build_object('stage_id', f.schedule_id, 'round', s.round_number, 'filename', f.filename, 'actor', $11::text)
         FROM added f LEFT JOIN interview_schedules s ON s.id = f.schedule_id
       )
       SELECT ${FILE_COLUMNS} FROM added f`,
      [id, applicationId, scheduleId, filename, contentType, file.size, itemId, form?.get("visible") === "true",
        actor.user_id, actor.email, actor.display_name || actor.email]
    );
    if (saved) return NextResponse.json(saved, { status: 201 });
  } catch (cause) {
    console.error("[interview-preparation] Could not save uploaded file", cause instanceof Error ? cause.name : "unknown");
    // Check the durable record before cleaning up in case the insert committed
    // but the database response was lost.
    try {
      const saved = await queryOne<InterviewPreparationFile>(
        `SELECT ${FILE_COLUMNS} FROM interview_preparation_files f WHERE f.id = $1`, [id]
      );
      if (saved) return NextResponse.json(saved, { status: 201 });
    } catch {
      return error("Could not confirm the upload. Reload the application before trying again.", 503);
    }
    await deleteSharePointItem(itemId).catch(() => console.error("[interview-preparation] Could not clean up unused upload"));
    return error("The upload could not be saved.", 503);
  }

  const current = await queryOne<{ can_access: boolean; has_stage: boolean }>(
    `SELECT ${APPLICATION_INTERVIEW_ACCESS_SQL} AS can_access,
            ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM interview_schedules s WHERE s.id = $2 AND s.application_id = a.id)) AS has_stage
     FROM applications a WHERE a.id = $1`,
    [applicationId, scheduleId]
  ).catch(() => null);
  await deleteSharePointItem(itemId).catch(() => console.error("[interview-preparation] Could not clean up unused upload"));
  if (!current) return error("Application no longer exists.", 404);
  if (!current.can_access) return error("Interview details unlock when the application reaches Interview.", 409);
  return error(audio && !current.has_stage ? "Interview stage no longer exists." : "The upload could not be saved.", audio && !current.has_stage ? 404 : 503);
}

export async function updateInterviewPreparation(
  applicationId: string, scheduleId: string | null, fileId: string, actor: Actor, change: { visible?: boolean; remove?: true }
) {
  const updated = await queryOne<InterviewPreparationFile>(
    `WITH changed AS (
       UPDATE interview_preparation_files f
       SET visible_to_candidate = COALESCE($4::boolean, f.visible_to_candidate),
           removed_at = CASE WHEN $5::boolean THEN now() ELSE NULL END
       WHERE f.id = $1 AND f.application_id = $2 AND f.removed_at IS NULL
         AND (($3::uuid IS NULL AND f.content_type NOT LIKE 'audio/%') OR f.schedule_id = $3)
         AND EXISTS (SELECT 1 FROM applications a WHERE a.id = f.application_id AND ${APPLICATION_INTERVIEW_ACCESS_SQL})
       RETURNING f.*
     ), audit AS (
       INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
       SELECT $6, $7,
         (CASE WHEN content_type LIKE 'audio/%' THEN 'interview_audio.' ELSE 'interview_file.' END) ||
         (CASE WHEN $5::boolean THEN 'removed' WHEN visible_to_candidate THEN 'shared' ELSE 'hidden' END),
         'application', application_id,
         jsonb_build_object('stage_id', schedule_id, 'filename', filename, 'actor', $8::text)
       FROM changed
     )
     SELECT ${FILE_COLUMNS} FROM changed f`,
    [fileId, applicationId, scheduleId, change.visible ?? null, change.remove === true, actor.user_id, actor.email, actor.display_name || actor.email]
  );
  return updated ? NextResponse.json(updated) : error("Preparation file not found.", 404);
}

export async function downloadInterviewPreparation(
  request: Request, applicationId: string, scheduleId: string | null, fileId: string, candidateId?: string
) {
  const file = await queryOne<{ filename: string; content_type: string; sharepoint_item_id: string }>(
    `SELECT f.filename, f.content_type, f.sharepoint_item_id
     FROM interview_preparation_files f JOIN applications a ON a.id = f.application_id
     WHERE f.id = $1 AND f.application_id = $2 AND f.removed_at IS NULL
       AND (($3::uuid IS NULL AND f.content_type NOT LIKE 'audio/%') OR f.schedule_id = $3)
       AND ${APPLICATION_INTERVIEW_ACCESS_SQL}
       AND ($4::uuid IS NULL OR (a.candidate_id = $4 AND f.visible_to_candidate
         AND (CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END) NOT IN ('assigned', 'stacked', 'in_progress')))`,
    [fileId, applicationId, scheduleId, candidateId ?? null]
  );
  if (!file) return error("Preparation file not found.", 404);

  try {
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    const audio = file.content_type.startsWith("audio/");
    const word = preview && !audio && file.content_type !== DOCUMENT_TYPES.pdf;
    const requestedRange = request.headers.get("range");
    const range = !word && requestedRange && /^bytes=(\d+-\d*|-\d+)$/.test(requestedRange) ? requestedRange : undefined;
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    });
    let upstream: Response;
    try {
      upstream = await openSharePointItem(file.sharepoint_item_id, { range, asPdf: word });
    } catch (cause) {
      if (!word || file.content_type !== DOCUMENT_TYPES.docx) throw cause;
      const original = await openSharePointItem(file.sharepoint_item_id);
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await original.arrayBuffer()) });
      headers.set("Content-Type", "text/plain; charset=utf-8");
      return new Response(value, { headers });
    }
    const name = word ? file.filename.replace(/\.docx?$/i, ".pdf") : file.filename;
    const encodedName = encodeURIComponent(name).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16));
    headers.set("Content-Type", word ? DOCUMENT_TYPES.pdf : file.content_type);
    headers.set("Content-Disposition", `${audio || preview ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`);
    for (const key of ["accept-ranges", "content-range", "content-length"]) {
      const value = upstream.headers.get(key);
      if (value && (key !== "content-length" || !upstream.headers.get("content-encoding"))) headers.set(key, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return error("SharePoint could not open the file. If the preview is unavailable, download the original.", 502);
  }
}
