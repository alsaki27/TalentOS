import { deletePrivateCandidateContract, downloadPrivateCandidateContract } from "@/server/storage/storageApi";
import { deleteSharePointItem, openSharePointItem, uploadToSharePoint } from "@/lib/integrations/sharepoint";
import { sha256Hex } from "@/lib/sha256";

const SHAREPOINT_ITEM_PREFIX = "sharepoint-item:";

function contractSharePointFolder(): string {
  const configured = process.env.SHAREPOINT_CONTRACTS_FOLDER?.trim();
  if (configured) return configured.replace(/^\/+|\/+$/g, "");

  const resumeFolder = (process.env.SHAREPOINT_DRIVE_FOLDER || "resumes").replace(/^\/+|\/+$/g, "");
  return `${resumeFolder}/candidate-contracts`;
}

export async function uploadCandidateContract(
  candidateId: string,
  filename: string,
  buffer: Uint8Array,
  contentType: string,
): Promise<{ storageKey: string }> {
  const uploadPath = `${candidateId}/${globalThis.crypto.randomUUID()}-${filename}`;
  const uploaded = await uploadToSharePoint(uploadPath, buffer, contentType, {
    driveFolder: contractSharePointFolder(),
  });
  if (!uploaded.itemId) throw new Error("SharePoint did not return a contract file reference.");

  try {
    const savedResponse = await openSharePointItem(uploaded.itemId);
    const savedBytes = new Uint8Array(await savedResponse.arrayBuffer());
    if (savedBytes.byteLength !== buffer.byteLength || await sha256Hex(savedBytes) !== await sha256Hex(buffer)) {
      throw new Error("SharePoint contract verification failed.");
    }
  } catch (error) {
    await deleteSharePointItem(uploaded.itemId).catch((cleanupError) => {
      console.error("[Candidate contracts] Could not remove an unverified SharePoint upload.", cleanupError instanceof Error ? cleanupError.message : "unknown error");
    });
    throw error;
  }

  return { storageKey: `${SHAREPOINT_ITEM_PREFIX}${uploaded.itemId}` };
}

export function isSharePointCandidateContractStorageKey(storageKey: string): boolean {
  return storageKey.startsWith(SHAREPOINT_ITEM_PREFIX);
}

export async function downloadCandidateContract(storageKey: string) {
  if (storageKey.startsWith(SHAREPOINT_ITEM_PREFIX)) {
    const itemId = storageKey.slice(SHAREPOINT_ITEM_PREFIX.length);
    if (!itemId) throw new Error("SharePoint contract reference is invalid.");
    const response = await openSharePointItem(itemId);
    return {
      buffer: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "application/octet-stream",
    };
  }

  return downloadPrivateCandidateContract(storageKey);
}

export async function deleteCandidateContract(storageKey: string): Promise<void> {
  if (storageKey.startsWith(SHAREPOINT_ITEM_PREFIX)) {
    const itemId = storageKey.slice(SHAREPOINT_ITEM_PREFIX.length);
    if (itemId) await deleteSharePointItem(itemId);
    return;
  }

  await deletePrivateCandidateContract(storageKey);
}
