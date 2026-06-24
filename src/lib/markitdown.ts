// Client to call the external markitdown service

export interface MarkitdownResult {
  success: boolean;
  markdown?: string;
  error?: string;
}

export async function convertPdfToMarkdown(buffer: Uint8Array, filename: string): Promise<MarkitdownResult> {
  const serviceUrl = process.env.MARKITDOWN_SERVICE_URL || "http://localhost:8000";

  const formData = new FormData();
  // The extra `new Uint8Array(buffer)` copy guarantees a plain ArrayBuffer-backed
  // view (not the generic ArrayBufferLike/SharedArrayBuffer-compatible type some
  // @types/node versions infer for Uint8Array), which is what BlobPart actually
  // requires - same fix as src/lib/integrations/sharepoint.ts.
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/pdf" });
  formData.append("file", blob, filename);

  try {
    const res = await fetch(`${serviceUrl}/parse`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Markitdown service error (${res.status}): ${err}` };
    }

    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error || "Unknown markitdown error" };
    }

    return { success: true, markdown: data.markdown };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to connect to markitdown service" };
  }
}

export function isMarkitdownAvailable(): boolean {
  return !!process.env.MARKITDOWN_SERVICE_URL || process.env.NODE_ENV === "development";
}
