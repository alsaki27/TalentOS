/**
 * Executive Candidate Performance Metrics & Feedback Parser
 * Ported verbatim from skarion-student-audit's src/utils/auditAnalysisParser.js.
 * Converts structured audit analysis text into a clean, rich JSON object
 * for the Executive Audit Report card/modal.
 */

export interface AuditMetric {
  name: string;
  score: number | null;
  maxScore: number;
  note: string;
}

export interface AuditStrength {
  title: string;
  description: string;
}

export interface AuditWeakness {
  title: string;
  mistake: string;
  quote: string;
  correction: string;
}

export interface AuditActionItem {
  title: string;
  action: string;
}

export interface ParsedAuditAnalysis {
  candidateName: string;
  targetRole: string;
  overallScore: number | null;
  overallSummary: string;
  metrics: AuditMetric[];
  strengths: AuditStrength[];
  weaknesses: AuditWeakness[];
  actionItems: AuditActionItem[];
  rawText: string;
}

export function parseAuditAnalysis(rawText: string | null | undefined): ParsedAuditAnalysis | null {
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    return null;
  }

  const cleanText = rawText.trim();
  const lines = cleanText.split(/\r?\n/);

  const result: ParsedAuditAnalysis = {
    candidateName: "",
    targetRole: "",
    overallScore: null,
    overallSummary: "",
    metrics: [],
    strengths: [],
    weaknesses: [],
    actionItems: [],
    rawText: cleanText,
  };

  type Section = "HEADER" | "METRICS" | "STRENGTHS" | "WEAKNESSES" | "ACTIONS" | "OTHER";
  let currentSection: Section = "HEADER";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const lower = line.toLowerCase();

    if (lower.startsWith("candidate:") || lower.startsWith("candidate name:")) {
      result.candidateName = line.split(":")[1]?.trim() || "";
      continue;
    }
    if (lower.startsWith("target role:") || lower.startsWith("role:") || lower.startsWith("applied role:")) {
      result.targetRole = line.split(":")[1]?.trim() || "";
      continue;
    }
    if (lower.startsWith("overall assessment:") || lower.startsWith("overall score:") || lower.startsWith("assessment:")) {
      const content = line.substring(line.indexOf(":") + 1).trim();
      const scoreMatch = content.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?/);
      if (scoreMatch) {
        result.overallScore = parseFloat(scoreMatch[1]);
      }
      const parenMatch = content.match(/\((.*?)\)/);
      if (parenMatch) {
        result.overallSummary = parenMatch[1].trim();
      } else {
        result.overallSummary = content.replace(/\d+(?:\.\d+)?\s*\/\s*\d+/, "").replace(/^[\s\-:,]+/, "").trim();
      }
      continue;
    }

    if (lower.includes("performance metrics") || lower.includes("evaluation metrics") || lower.includes("scoring breakdown")) {
      currentSection = "METRICS";
      continue;
    }
    if (lower.includes("strengths") || lower.includes("key strengths") || lower.includes("what went well") || lower.includes("pros:")) {
      currentSection = "STRENGTHS";
      continue;
    }
    if (
      lower.includes("critical weaknesses") ||
      lower.includes("weaknesses") ||
      lower.includes("areas for improvement") ||
      lower.includes("misconceptions") ||
      lower.includes("mistakes")
    ) {
      currentSection = "WEAKNESSES";
      continue;
    }
    if (
      lower.includes("action items") ||
      lower.includes("mentor action") ||
      lower.includes("recommendations") ||
      lower.includes("next steps") ||
      lower.includes("remediation")
    ) {
      currentSection = "ACTIONS";
      continue;
    }

    if (currentSection === "METRICS") {
      const metricLine = line.replace(/^[*\-•\d+.]\s*/, "").trim();
      if (!metricLine) continue;

      const colonIdx = metricLine.indexOf(":");
      if (colonIdx > 0) {
        const name = metricLine.substring(0, colonIdx).trim();
        const rest = metricLine.substring(colonIdx + 1).trim();

        const scoreMatch = rest.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
        let score: number | null = null;
        let maxScore = 10;
        if (scoreMatch) {
          score = parseFloat(scoreMatch[1]);
          maxScore = parseFloat(scoreMatch[2]) || 10;
        }

        let note = "";
        const parenMatch = rest.match(/\((.*?)\)/);
        if (parenMatch) {
          note = parenMatch[1].trim();
        } else {
          note = rest.replace(/\d+(?:\.\d+)?\s*\/\s*\d+/, "").replace(/^[\s\-:,]+/, "").trim();
        }

        result.metrics.push({ name, score, maxScore, note });
      }
    } else if (currentSection === "STRENGTHS") {
      const strengthLine = line.replace(/^[*\-•\d+.]\s*/, "").trim();
      if (!strengthLine) continue;

      const colonIdx = strengthLine.indexOf(":");
      if (colonIdx > 0) {
        const title = strengthLine.substring(0, colonIdx).trim();
        const description = strengthLine.substring(colonIdx + 1).trim();
        result.strengths.push({ title, description });
      } else {
        result.strengths.push({ title: "Strength", description: strengthLine });
      }
    } else if (currentSection === "WEAKNESSES") {
      const weaknessLine = line.replace(/^[*\-•\d+.]\s*/, "").trim();
      if (!weaknessLine) continue;

      const colonIdx = weaknessLine.indexOf(":");
      let title = "Critical Observation";
      let body = weaknessLine;

      if (colonIdx > 0 && colonIdx < 80) {
        title = weaknessLine.substring(0, colonIdx).trim();
        body = weaknessLine.substring(colonIdx + 1).trim();
      }

      let quote = "";
      const quoteMatch =
        body.match(/\(Quote:\s*["“']?(.*?)["”']?\)/i) || body.match(/Quote:\s*["“']?(.*?)["”']?(?=\.\s*Correction|\.|$)/i);
      if (quoteMatch) {
        quote = quoteMatch[1].trim();
      }

      let correction = "";
      const corrMatch = body.match(/Correction:\s*(.*?)$/i) || body.match(/Mentor Fix:\s*(.*?)$/i) || body.match(/Fix:\s*(.*?)$/i);
      if (corrMatch) {
        correction = corrMatch[1].trim();
      }

      let mistake = body;
      if (quoteMatch) {
        mistake = mistake.replace(quoteMatch[0], "");
      }
      if (corrMatch) {
        mistake = mistake.replace(corrMatch[0], "");
      }
      mistake = mistake.replace(/\s+/g, " ").trim();

      result.weaknesses.push({ title, mistake, quote, correction });
    } else if (currentSection === "ACTIONS") {
      const actionLine = line.replace(/^[*\-•\d+.]\s*/, "").trim();
      if (!actionLine) continue;

      const colonIdx = actionLine.indexOf(":");
      if (colonIdx > 0) {
        const title = actionLine.substring(0, colonIdx).trim();
        const action = actionLine.substring(colonIdx + 1).trim();
        result.actionItems.push({ title, action });
      } else {
        result.actionItems.push({ title: "Action Item", action: actionLine });
      }
    }
  }

  if (result.metrics.length === 0 && result.strengths.length === 0 && result.weaknesses.length === 0) {
    result.overallSummary = cleanText;
  }

  return result;
}

/** Serializes a parsed audit analysis object back into standard structured report text */
export function serializeAuditAnalysis(parsed: ParsedAuditAnalysis | null): string {
  if (!parsed) return "";

  let text = `CANDIDATE PERFORMANCE METRICS & FEEDBACK\n\n`;

  if (parsed.candidateName) text += `Candidate: ${parsed.candidateName}\n`;
  if (parsed.targetRole) text += `Target Role: ${parsed.targetRole}\n`;
  if (parsed.overallScore !== null && parsed.overallScore !== undefined) {
    const summary = parsed.overallSummary ? ` (${parsed.overallSummary})` : "";
    text += `Overall Assessment: ${parsed.overallScore} / 10${summary}\n`;
  }

  text += `\nPERFORMANCE METRICS:\n`;
  if (parsed.metrics && parsed.metrics.length > 0) {
    parsed.metrics.forEach((m) => {
      const note = m.note ? ` (${m.note})` : "";
      text += `* ${m.name}: ${m.score} / ${m.maxScore || 10}${note}\n`;
    });
  } else {
    text += `* Communication & Delivery: 8 / 10 (Clear articulation and pacing)\n`;
    text += `* Technical & Domain Knowledge: 7 / 10 (Good foundational grasp)\n`;
    text += `* Tools & Practical Workflow: 8 / 10 (Hands-on software workflow)\n`;
    text += `* Problem-Solving & Methodology: 7 / 10 (Structured problem decomposition)\n`;
    text += `* Standards & Quality Processes: 7 / 10 (Adheres to core guidelines)\n`;
  }

  if (parsed.strengths && parsed.strengths.length > 0) {
    text += `\nSTRENGTHS:\n`;
    parsed.strengths.forEach((s) => {
      text += `* ${s.title}: ${s.description}\n`;
    });
  }

  if (parsed.weaknesses && parsed.weaknesses.length > 0) {
    text += `\nCRITICAL WEAKNESSES:\n`;
    parsed.weaknesses.forEach((w) => {
      let line = `* ${w.title}: ${w.mistake || ""}`;
      if (w.quote) line += ` (Quote: "${w.quote}")`;
      if (w.correction) line += ` Correction: ${w.correction}`;
      text += `${line.trim()}\n`;
    });
  }

  if (parsed.actionItems && parsed.actionItems.length > 0) {
    text += `\nACTION ITEMS FOR MENTOR:\n`;
    parsed.actionItems.forEach((a) => {
      text += `* ${a.title}: ${a.action}\n`;
    });
  }

  return text.trim();
}
