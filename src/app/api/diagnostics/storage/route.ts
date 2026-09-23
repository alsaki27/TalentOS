import { NextRequest, NextResponse } from "next/server";
import { uploadResumeFile, activeResumeStorageProvider, isProviderConfigured } from "@/lib/resumeStorage";

export async function GET(_req: NextRequest) {
  const provider = activeResumeStorageProvider();
  const configured = isProviderConfigured(provider);

  if (!configured) {
    return NextResponse.json({
      provider,
      configured: false,
      error: `Provider '${provider}' is not configured. Check env vars.`,
    }, { status: 500 });
  }

  // Try a small test upload
  const testBuffer = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic bytes
  try {
    const result = await uploadResumeFile("diagnostics/test.txt", testBuffer, "text/plain");
    return NextResponse.json({
      provider,
      configured: true,
      uploadTest: "success",
      url: result.url,
    });
  } catch (err: any) {
    return NextResponse.json({
      provider,
      configured: true,
      uploadTest: "failed",
      error: err.message,
    }, { status: 500 });
  }
}
