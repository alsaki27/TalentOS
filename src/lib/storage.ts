// src/lib/storage.ts
// Re-export storage helpers from the REST API wrapper.
// Best-effort cleanup of files in the shared "resumes" Storage bucket.
// Deleting/replacing a DB row must not fail just because storage cleanup failed,
// so errors are logged, not thrown.

export { deleteStorageFile } from "@/server/storage/storageApi";
