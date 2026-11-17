const encoder = new TextEncoder();
const lifetimeMs = 5 * 60 * 1000;

function linkKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Approved résumé download signing is unavailable.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function message(applicationId: string, exportId: string, expires: number) {
  return encoder.encode(JSON.stringify(["approved-resume-pdf-download", applicationId, exportId, expires]));
}

export async function signApprovedResumePdfLink(applicationId: string, exportId: string) {
  const expires = Date.now() + lifetimeMs;
  const signature = await crypto.subtle.sign("HMAC", await linkKey(), message(applicationId, exportId, expires));
  const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${expires}.${hex}`;
}

export async function verifyApprovedResumePdfLink(applicationId: string, exportId: string, token: string) {
  const [timestamp, hex, ...extra] = token.split(".");
  const expires = Number(timestamp);
  if (extra.length || !/^[0-9a-f]{64}$/.test(hex ?? "") || !Number.isSafeInteger(expires)
    || expires <= Date.now() || expires > Date.now() + lifetimeMs) return false;
  const signature = Uint8Array.from(hex.match(/../g)!, byte => Number.parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await linkKey(), signature, message(applicationId, exportId, expires));
}
