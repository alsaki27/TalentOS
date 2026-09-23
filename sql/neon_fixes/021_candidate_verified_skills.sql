-- Candidate Truth Ledger: a curated, recruiter-confirmed skills list that
-- supplements candidate_evidence's narrative entries. Resume Forge only
-- claims a skill when it can find supporting evidence - if a candidate's
-- real skill isn't written into their base resume text or documented as a
-- candidate_evidence row, the pipeline has no way to know about it and will
-- correctly exclude it. verified_skills lets a recruiter directly confirm
-- "this candidate genuinely has skill X" as a fast-path source of truth,
-- without needing to write a full evidence narrative for every skill.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS verified_skills text[] NOT NULL DEFAULT '{}'::text[];
