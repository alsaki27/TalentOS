export interface JobCategoryResult {
  jobCategory: string | null;
  categoryTags: string[];
  categoryRelevanceScore: number | null;
}

const CATEGORY_RULES = [
  { label: "OSP", keywords: ["osp", "outside plant", "fiber optic", "fiber", "aerial", "splicing"] },
  { label: "Drafting", keywords: ["drafting", "drafter", "cad", "autocad", "microstation", "as-built"] },
  { label: "GIS", keywords: ["gis", "geospatial", "arcgis", "qgis", "mapping", "esri"] },
  { label: "Civil", keywords: ["civil", "site design", "land development", "grading", "stormwater", "permitting"] },
  { label: "Telecom", keywords: ["telecom", "telecommunications", "low-voltage", "network infrastructure"] },
  { label: "Utility", keywords: ["utility", "transmission", "distribution", "substation", "pls-cadd"] },
  { label: "AV", keywords: ["av", "audio visual", "audiovisual", "crestron", "extron"] },
  { label: "Project Management", keywords: ["project manager", "project management", "scheduling", "coordination"] },
];

export function categorizeJob(parts: Array<string | null | undefined>): JobCategoryResult {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text) return { jobCategory: null, categoryTags: [], categoryRelevanceScore: null };

  const scored = CATEGORY_RULES
    .map((rule) => ({ label: rule.label, hits: rule.keywords.filter((keyword) => text.includes(keyword)).length }))
    .filter((rule) => rule.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label));

  if (scored.length === 0) return { jobCategory: null, categoryTags: [], categoryRelevanceScore: null };
  return {
    jobCategory: scored[0].label,
    categoryTags: scored.map((rule) => rule.label),
    categoryRelevanceScore: Math.min(100, 45 + scored[0].hits * 12 + Math.max(0, scored.length - 1) * 5),
  };
}
