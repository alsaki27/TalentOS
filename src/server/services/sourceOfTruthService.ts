import type { AiProvider } from "@/lib/ai/provider";
import { findSoTByCandidateId, upsertSoT, updatePendingSkills, updateConfirmedSkills, type PendingSkill } from "@/server/repositories/sourceOfTruthRepository";
import { queryOne } from "@/server/db/neon";
import { inferAdjacentSkills } from "@/lib/ai/source-of-truth/inferAdjacentSkills";
import { extractProfessionalSkills } from "@/lib/ai/source-of-truth/extractProfessionalSkills";

export interface CandidateSoT {
  confirmedSkills: string[];
  pendingSkills: PendingSkill[];
  lastParsedAt: string | null;
  parsedFromResumeName?: string | null;
}

export async function parseSourceOfTruth(
  candidateId: string,
  baseResumeId: string | undefined,
  provider: AiProvider
): Promise<CandidateSoT> {
  // Load base resume
  let baseResume;
  if (baseResumeId) {
    baseResume = await queryOne<any>("SELECT * FROM base_resumes WHERE id = $1 AND candidate_id = $2", [baseResumeId, candidateId]);
  } else {
    baseResume = await queryOne<any>("SELECT * FROM base_resumes WHERE candidate_id = $1 ORDER BY updated_at DESC LIMIT 1", [candidateId]);
  }

  if (!baseResume) {
    throw new Error("No base resume found for candidate.");
  }

  const content = baseResume.content;
  if (!content || typeof content !== "object") {
    throw new Error("Base resume has no valid content.");
  }

  // Extract highly relevant professional skills using AI
  const aiExtractedSkills = await extractProfessionalSkills(content, provider);
  const extractedSkills = new Set<string>(aiExtractedSkills);

  // Fetch existing Source of Truth to preserve manually confirmed skills
  const existingSoT = await findSoTByCandidateId(candidateId);
  const existingConfirmed = existingSoT?.confirmed_skills ?? [];

  // Merge existing confirmed skills with newly extracted skills
  const confirmed_skills = Array.from(new Set([...existingConfirmed, ...Array.from(extractedSkills)]));

  // Infer adjacent skills
  const inferred = await inferAdjacentSkills(confirmed_skills, provider, { maxSuggestions: 50 });

  // Map to pending status
  const pending_skills: PendingSkill[] = inferred.map(s => ({
    skill: s.skill,
    category: s.category,
    reason: s.reason,
    confidence: s.confidence,
    status: "pending"
  }));

  const last_parsed_at = new Date().toISOString();
  const parsed_from_resume_id = baseResume.id;

  const result = await upsertSoT(candidateId, {
    confirmed_skills,
    pending_skills,
    parsed_from_resume_id,
    last_parsed_at
  });

  return {
    confirmedSkills: result.confirmed_skills,
    pendingSkills: result.pending_skills,
    lastParsedAt: result.last_parsed_at,
    parsedFromResumeName: baseResume.name || baseResume.filename
  };
}

export async function updatePendingSkillStatus(
  candidateId: string,
  skill: string,
  status: "accepted" | "rejected"
): Promise<void> {
  const sot = await findSoTByCandidateId(candidateId);
  if (!sot) throw new Error("Source of Truth not found for candidate.");

  let skillMovedToConfirmed = false;
  const newPending = sot.pending_skills.map(s => {
    if (s.skill === skill) {
      if (status === "accepted" && !sot.confirmed_skills.includes(skill)) {
        skillMovedToConfirmed = true;
      }
      return { ...s, status };
    }
    return s;
  });

  await updatePendingSkills(candidateId, newPending);

  if (skillMovedToConfirmed) {
    const newConfirmed = [...sot.confirmed_skills, skill];
    await updateConfirmedSkills(candidateId, newConfirmed);
  }
}

export async function autoAcceptHighConfidenceSkills(
  candidateId: string
): Promise<{ acceptedCount: number }> {
  const sot = await findSoTByCandidateId(candidateId);
  if (!sot) throw new Error("Source of Truth not found for candidate.");

  const pending = sot.pending_skills.filter(s => s.status === "pending" && s.confidence === "high");
  if (pending.length === 0) return { acceptedCount: 0 };

  const newConfirmed = [...sot.confirmed_skills];
  let acceptedCount = 0;

  const newPending = sot.pending_skills.map(s => {
    if (s.status === "pending" && s.confidence === "high") {
      if (!newConfirmed.includes(s.skill)) {
        newConfirmed.push(s.skill);
      }
      acceptedCount++;
      return { ...s, status: "accepted" as const };
    }
    return s;
  });

  await updateConfirmedSkills(candidateId, newConfirmed);
  await updatePendingSkills(candidateId, newPending);

  return { acceptedCount };
}

export async function bulkUpdatePendingSkills(
  candidateId: string,
  updates: { skill: string; status: "accepted" | "rejected" }[]
): Promise<void> {
  const sot = await findSoTByCandidateId(candidateId);
  if (!sot) throw new Error("Source of Truth not found for candidate.");

  const updateMap = new Map(updates.map(u => [u.skill, u.status]));
  const newConfirmed = [...sot.confirmed_skills];

  const newPending = sot.pending_skills.map(s => {
    const newStatus = updateMap.get(s.skill);
    if (newStatus) {
      if (newStatus === "accepted" && !newConfirmed.includes(s.skill)) {
        newConfirmed.push(s.skill);
      }
      return { ...s, status: newStatus };
    }
    return s;
  });

  await updateConfirmedSkills(candidateId, newConfirmed);
  await updatePendingSkills(candidateId, newPending);
}

export async function addManualSkill(
  candidateId: string,
  skill: string,
  category: string
): Promise<void> {
  const sot = await findSoTByCandidateId(candidateId);
  
  if (!sot) {
    // Need to create a new SoT record with this manual skill
    await upsertSoT(candidateId, {
        confirmed_skills: [skill],
    });
    return;
  }

  if (!sot.confirmed_skills.includes(skill)) {
    const newConfirmed = [...sot.confirmed_skills, skill];
    await updateConfirmedSkills(candidateId, newConfirmed);
  }
}

export async function removeConfirmedSkill(
  candidateId: string,
  skill: string
): Promise<void> {
  const sot = await findSoTByCandidateId(candidateId);
  if (!sot) return;

  const newConfirmed = sot.confirmed_skills.filter(s => s !== skill);
  await updateConfirmedSkills(candidateId, newConfirmed);

  // Optional: Also mark it as rejected in pending if it was there?
  // User can re-parse to bring things back, but if they remove it from confirmed, maybe mark as rejected.
  let pendingChanged = false;
  const newPending = sot.pending_skills.map(s => {
      if (s.skill === skill && s.status === "accepted") {
          pendingChanged = true;
          return { ...s, status: "rejected" as const };
      }
      return s;
  });

  if (pendingChanged) {
      await updatePendingSkills(candidateId, newPending);
  }
}

export async function getSourceOfTruth(
  candidateId: string
): Promise<CandidateSoT | null> {
  const row = await findSoTByCandidateId(candidateId);
  if (!row) return null;

  let parsedFromResumeName: string | null = null;
  if (row.parsed_from_resume_id) {
    const baseResume = await queryOne<any>("SELECT name, filename FROM base_resumes WHERE id = $1", [row.parsed_from_resume_id]);
    if (baseResume) {
      parsedFromResumeName = baseResume.name || baseResume.filename;
    }
  }

  return {
    confirmedSkills: row.confirmed_skills,
    pendingSkills: row.pending_skills,
    lastParsedAt: row.last_parsed_at,
    parsedFromResumeName,
  };
}
