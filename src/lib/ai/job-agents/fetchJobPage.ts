export async function fetchJobPageText(url: string): Promise<string> {
  try {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 10000);

    var response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TalentOS-JobCEO/1.0 (job-ingestion-bot; +https://skarion-talent-os.skarion-talentos.workers.dev)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return "";

    var html = await response.text();

    var text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text.length > 15000 ? text.slice(0, 15000) : text;
  } catch (_err) {
    return "";
  }
}
