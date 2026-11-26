import { AUDIO_SIZE_ERROR, INTERVIEW_AUDIO_CHUNK_BYTES, MAX_INTERVIEW_AUDIO_BYTES, MAX_PREPARATION_FILE_BYTES, type InterviewPreparationFile } from "./applicationInterviewPreparation";

async function responseData(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || "The recording upload could not be confirmed.");
  return data;
}

async function sendFragment(endpoint: string, handle: string, file: File, offset: number, end: number) {
  const fragment = file.slice(offset, end);
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetch(endpoint, {
        method: "PUT", cache: "no-store",
        headers: { "X-Recording-Upload": handle, "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
        body: fragment,
      });
    } catch (cause) {
      if (attempt >= 2) throw cause;
    }
    if (response && (attempt >= 2 || (response.status < 500 && response.status !== 429))) return responseData(response);
    await response?.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

export async function uploadInterviewRecording(endpoint: string, file: File, visible = true, progress?: (percent: number) => void): Promise<InterviewPreparationFile> {
  if (!file.size) throw new Error("Choose a non-empty audio recording.");
  if (file.size > MAX_INTERVIEW_AUDIO_BYTES) throw new Error(AUDIO_SIZE_ERROR);
  if (file.size <= MAX_PREPARATION_FILE_BYTES) {
    const form = new FormData();
    form.set("file", file);
    form.set("visible", String(visible));
    return responseData(await fetch(endpoint, { method: "POST", body: form, cache: "no-store" }));
  }
  const { handle } = await responseData(await fetch(endpoint, {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, size: file.size, visible }),
  }));
  if (!handle) throw new Error("Could not start the recording upload.");
  for (let offset = 0; offset < file.size; offset += INTERVIEW_AUDIO_CHUNK_BYTES) {
    const end = Math.min(file.size, offset + INTERVIEW_AUDIO_CHUNK_BYTES);
    const data = await sendFragment(endpoint, handle, file, offset, end);
    if (end === file.size && data.id) return data;
    if (data.nextOffset !== end) throw new Error("SharePoint could not confirm recording progress.");
    progress?.(Math.floor(end * 100 / file.size));
  }
  throw new Error("The recording upload could not be confirmed.");
}
