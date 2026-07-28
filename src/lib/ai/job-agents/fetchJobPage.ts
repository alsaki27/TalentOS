// SSRF guard: source_url is untrusted, externally-ingested data (OpenJobData
// rows, ultimately anyone who can get a row into job_ceo_staging). Without
// this check, Deep Fetch would fetch whatever URL a "job posting" carries -
// including internal services and cloud metadata endpoints
// (169.254.169.254, localhost, etc.) reachable from wherever this Worker
// runs. This is defense-in-depth on top of whatever the platform itself
// blocks; it does not attempt DNS-rebinding protection (checking the
// hostname the app resolves separately from the one fetch() actually
// connects to), since Workers has no synchronous pre-resolution API - it
// only rejects url shapes that are unambiguously non-public.
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localdomain"];

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((p) => Number(p) > 255)) return false;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1") return true; // loopback
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique local
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10 link-local
  return false;
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  if (isPrivateIPv4(hostname)) return false;
  if (hostname.includes(":") && isPrivateIPv6(hostname)) return false;

  return true;
}

export async function fetchJobPageText(url: string): Promise<string> {
  if (!isSafeExternalUrl(url)) return "";

  try {
    var controller = new AbortController();
    // 8s timeout: jina.ai needs a few seconds to render JS, but keeps it under 60s total workflow limit.
    var timeout = setTimeout(function () { controller.abort(); }, 8000);

    var jinaUrl = `https://r.jina.ai/${url}`;
    var response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "text/plain",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return "";

    var text = await response.text();
    // Jina returns markdown. We just truncate it if it's too massive.
    return text.length > 15000 ? text.slice(0, 15000) : text;
  } catch (_err) {
    return "";
  }
}
