// src/lib/storage.ts
// Best-effort cleanup of files in the shared "resumes" Supabase Storage bucket
// (also used for candidate avatars under an avatars/ prefix). Deleting/replacing
// a DB row must not fail just because storage cleanup failed, so errors are
// logged, not thrown.

import { supabase } from "@/lib/supabase";

const BUCKET_MARKER = "/storage/v1/object/public/resumes/";

export async function deleteStorageFile(url: string | null | undefined) {
  if (!url) return;
  const idx = url.indexOf(BUCKET_MARKER);
  if (idx === -1) return;
  const path = decodeURIComponent(url.slice(idx + BUCKET_MARKER.length));
  const { error } = await supabase.storage.from("resumes").remove([path]);
  if (error) console.error(`Failed to delete storage file ${path}:`, error.message);
}
