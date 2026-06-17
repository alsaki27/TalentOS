export interface JobCategoryResult {
  job_category: string | null;
  category_tags: string[];
  category_relevance_score: number | null;
}

interface CategoryRule {
  label: string;
  keywords: string[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    label: "OSP",
    keywords: ["osp", "outside plant", "isp/osp", "fiber optic", "fiber", "telecommunications infrastructure", "structured cabling", "aerial", "underground duct", "splicing"],
  },
  {
    label: "Drafting",
    keywords: ["drafting", "drafter", "cad", "autocad", "microstation", "bluebeam", "design drawings", "as-built", "plans"],
  },
  {
    label: "GIS",
    keywords: ["gis", "geospatial", "arcgis", "qgis", "mapping", "esri", "spatial", "cartography"],
  },
  {
    label: "Civil",
    keywords: ["civil", "site design", "land development", "grading", "stormwater", "roadway", "utility design", "permitting"],
  },
  {
    label: "Telecom",
    keywords: ["telecom", "telecommunications", "low-voltage", "network infrastructure", "lan/wan", "voip", "data center"],
  },
  {
    label: "Utility",
    keywords: ["utility", "transmission", "distribution", "power", "electric", "substation", "plscadd", "pls-cadd"],
  },
  {
    label: "AV",
    keywords: ["av", "audio visual", "audiovisual", "crestron", "extron", "conference room"],
  },
  {
    label: "Project Management",
    keywords: ["project manager", "project management", "scheduling", "stakeholder", "coordination", "closeout"],
  },
];

function normalizeText(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function categorizeJob(parts: Array<string | null | undefined>): JobCategoryResult {
  const text = normalizeText(parts);
  if (!text) return { job_category: null, category_tags: [], category_relevance_score: null };

  const scored = CATEGORY_RULES
    .map((rule) => {
      const hits = rule.keywords.filter((keyword) => text.includes(keyword)).length;
      return { label: rule.label, hits };
    })
    .filter((rule) => rule.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label));

  if (scored.length === 0) {
    return { job_category: null, category_tags: [], category_relevance_score: null };
  }

  return {
    job_category: scored[0].label,
    category_tags: scored.map((rule) => rule.label),
    category_relevance_score: Math.min(100, 45 + scored[0].hits * 12 + Math.max(0, scored.length - 1) * 5),
  };
}
