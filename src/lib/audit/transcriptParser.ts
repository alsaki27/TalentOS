/**
 * Universal Transcript Auto-Organizer Utility
 * Clean Chat Bubble Parser for MS Teams, Zoom, & Google Meet Transcripts
 * Ported verbatim from skarion-student-audit's src/utils/transcriptParser.js.
 * Evaluator Whitelist: Kasshaf, Faisal, Saki, Ferdous, Piyas, Mayukh, Tashfia
 * Candidate Matching: ANY non-evaluator speaker name is dynamically recognized as a Candidate!
 */

export const ALLOWED_EVALUATOR_NAMES = [
  "kasshaf", "faisal", "saki", "ferdous", "piyas", "mayukh", "tashfia",
];

export function isEvaluatorName(cleanedName: string): boolean {
  return ALLOWED_EVALUATOR_NAMES.includes(cleanedName.toLowerCase());
}

export function cleanSpeakerName(name: string | null | undefined): string {
  if (!name) return "";
  let cleaned = name.replace(/\d+.*$/, "").replace(/[\(\)\[\]:]/g, "").trim();
  const lower = cleaned.toLowerCase();

  if (lower.includes("mayukh")) return "Mayukh";
  if (lower.includes("avirup")) return "Avirup";
  if (lower.includes("faisal")) return "Faisal";
  if (lower.includes("ferdous")) return "Ferdous";
  if (lower.includes("kasshaf")) return "Kasshaf";
  if (lower.includes("piyas")) return "Piyas";
  if (lower.includes("saki")) return "Saki";
  if (lower.includes("tashfia")) return "Tashfia";

  cleaned = cleaned.replace(/^(md|mr|ms|mrs|dr)\.?\s+/i, "");
  const parts = cleaned
    .split(/\s+/)
    .filter(
      (p) =>
        !["md", "ali", "ahnaf", "abid", "hasan", "akash", "bhattacharjee", "mahmud", "ahmad", "azmain", "chowdhury", "roy", "alam"].includes(
          p.toLowerCase()
        )
    );
  return parts[0] || cleaned;
}

export function extractTimestamp(str: string | null | undefined): string {
  if (!str) return "";
  const s = str.trim();

  const minSecMatch = s.match(/(\d+)\s*minutes?\s*(\d+)?\s*seconds?/i);
  if (minSecMatch) {
    const mins = String(minSecMatch[1]).padStart(2, "0");
    const secs = String(minSecMatch[2] || "0").padStart(2, "0");
    return `${mins}:${secs}`;
  }

  const colonMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (colonMatch) {
    if (colonMatch[3]) {
      return `${colonMatch[1]}:${colonMatch[2]}:${colonMatch[3]}`;
    }
    const mins = String(colonMatch[1]).padStart(2, "0");
    const secs = String(colonMatch[2]).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  if (/^\d{1,2}$/.test(s)) {
    const secs = String(s).padStart(2, "0");
    return `00:${secs}`;
  }

  return "";
}

function timestampToMs(ts: string): number | null {
  if (!ts) return null;
  const parts = ts.split(":").map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 3) return ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return null;
}

interface TranscriptBlock {
  speaker: string;
  timestamp: string;
  text: string;
}

const isSystemMetadataLine = (line: string): boolean => {
  if (!line) return false;
  const lower = line.toLowerCase().trim();
  return (
    lower.includes("meeting recording") ||
    lower.includes("started transcription") ||
    lower.includes("stopped transcription") ||
    lower.includes("started recording") ||
    lower.includes("stopped recording") ||
    lower.includes("joined the meeting") ||
    lower.includes("left the meeting") ||
    /^\d{1,2}m\s*\d{1,2}s$/i.test(lower) ||
    /^\d{1,2}h\s*\d{1,2}m(?:\s*\d{1,2}s)?$/i.test(lower) ||
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}/i.test(lower)
  );
};

function extractBlocks(rawText: string): TranscriptBlock[] {
  const lines = rawText.split("\n");
  const blocks: TranscriptBlock[] = [];
  let currentSpeaker = "";
  let currentTimestamp = "";
  let currentLines: string[] = [];

  const flush = () => {
    if (currentSpeaker && currentLines.length > 0) {
      const textContent = currentLines.join(" ").trim();
      if (textContent) {
        if (blocks.length > 0 && blocks[blocks.length - 1].speaker === currentSpeaker) {
          blocks[blocks.length - 1].text += " " + textContent;
        } else {
          blocks.push({ speaker: currentSpeaker, timestamp: currentTimestamp, text: textContent });
        }
      }
      currentLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isSystemMetadataLine(line)) continue;

    let detectedSpeaker = "";
    let detectedTime = "";
    let contentAfterHeader = "";

    const formattedMatch = line.match(/^([^:\[\n]{2,35})(?:\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\])?\s*:(.*)$/);
    if (formattedMatch) {
      const candidateName = cleanSpeakerName(formattedMatch[1]);
      if (candidateName && candidateName.length >= 2) {
        detectedSpeaker = candidateName;
        detectedTime = formattedMatch[2] || "";
        contentAfterHeader = formattedMatch[3].trim();
      }
    }

    if (
      !detectedSpeaker &&
      (/^[A-Za-z\s.\-]{2,45}\s+\d+(?::\d{2}){1,2}$/i.test(line) || /^[A-Za-z\s.\-]{2,45}\s+\d+\s*minutes?/i.test(line))
    ) {
      const parts = line.match(/^(.*?)\s+(\d+(?::\d{2}){1,2}|\d+\s*minutes?.*)$/i);
      if (parts) {
        const candidateName = cleanSpeakerName(parts[1]);
        if (candidateName && candidateName.length >= 2) {
          detectedSpeaker = candidateName;
          detectedTime = extractTimestamp(parts[2]);
        }
      }
    }

    if (detectedSpeaker) {
      flush();
      currentSpeaker = detectedSpeaker;
      if (detectedTime) currentTimestamp = detectedTime;
      if (contentAfterHeader) currentLines.push(contentAfterHeader);
    } else if (currentSpeaker && !isSystemMetadataLine(line)) {
      currentLines.push(line);
    }
  }
  flush();

  return blocks;
}

/** Verbatim port of parseAndOrganizeTranscript — reformats raw paste into "Speaker [MM:SS]: text" blocks. */
export function parseAndOrganizeTranscript(rawText: string): string {
  if (!rawText || !rawText.trim()) return "";

  const blocks = extractBlocks(rawText);
  if (blocks.length > 0) {
    return blocks
      .map((b) => {
        const timeStr = b.timestamp ? ` [${b.timestamp}]` : "";
        const cleanText = b.text
          .replace(/^\d{1,2}\s+/, "")
          .replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]:?\s*/, "")
          .trim();
        return `${b.speaker}${timeStr}: ${cleanText}`;
      })
      .join("\n\n");
  }

  return rawText.trim();
}

export interface ParsedTranscriptLine {
  seq: number;
  speaker: string;
  isCandidate: boolean;
  timestampMs: number | null;
  text: string;
}

/**
 * Extension beyond the verbatim port: exposes the same block-extraction
 * logic as structured rows (seq/speaker/isCandidate/timestampMs/text) so
 * they can be persisted to mock_transcript_lines, not just reformatted
 * back into a display string.
 */
export function parseTranscriptToLines(rawText: string): ParsedTranscriptLine[] {
  if (!rawText || !rawText.trim()) return [];
  return extractBlocks(rawText).map((b, i) => ({
    seq: i,
    speaker: b.speaker,
    isCandidate: !isEvaluatorName(b.speaker),
    timestampMs: timestampToMs(b.timestamp),
    text: b.text
      .replace(/^\d{1,2}\s+/, "")
      .replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]:?\s*/, "")
      .trim(),
  }));
}
