// src/lib/jobAgentRoleLibrary.ts
// Pure data module — no AI, no DB.
// Role titles organized by group (A–R) for the Apify Job Agent and OpenJobData pipeline.
//
// Groups A–L: Original OSP/CAD/GIS/Engineering disciplines.
// Groups M–R: Added 2026-08-06 — Data Center, ISP/Network, NOC, Solar/Energy Engineering,
//             Electrical/Field Service, Hardware/Chip Design, and Estimating tracks.

export interface RoleGroup {
  id: string;
  label: string;
  resumeFamily: string;
  /** Included in the automated nightly Apify search matrix. */
  nightlyDefault: boolean;
  titles: string[];
}

const ROLE_GROUPS: RoleGroup[] = [
  {
    id: "A",
    label: "OSP / Fiber",
    resumeFamily: "osp_fiber",
    nightlyDefault: true,
    titles: [
      "OSP Design Engineer", "Outside Plant Engineer", "OSP Engineer",
      "Fiber Design Engineer", "FTTH Design Engineer", "Fiber Optic Design Engineer",
      "Telecom Design Engineer", "Splice Engineer", "Fiber Splicing Engineer",
      "OSP Planning Engineer", "OSP CAD Designer", "Fiber Network Engineer",
      "Fiber Construction Engineer", "Outside Plant Designer",
      "Telecommunications Engineer", "Fiber Route Engineer",
      "Aerial Fiber Design Engineer", "Underground Fiber Design Engineer",
      "Joint Use Engineer", "Make Ready Engineer", "Fiber Permitting Engineer",
      "GIS Fiber Design Technician", "OSP Project Engineer",
      "Fiber Design Technician", "OSP Field Engineer",
      "Fiber Construction Manager", "OSP Estimator",
      "Telecom Infrastructure Engineer", "Broadband Design Engineer",
      "FTTx Design Engineer", "Fiber Network Planner", "OSP QC Engineer",
      "Fiber Splice Technician", "Broadband Network Engineer", "Fiber Engineer",
      // New additions
      "OSP CAD Drafter", "OSP Design Engineering Apprentice",
      "OSP Design Engineering Specialist", "OSP Engineering Technician",
      "Permit Design Engineer", "Permit Drafter",
    ],
  },
  {
    id: "B",
    label: "CAD / Drafting",
    resumeFamily: "autocad_drafting",
    nightlyDefault: true,
    titles: [
      "AutoCAD Drafter", "CAD Technician", "CAD Designer", "Drafter",
      "Drafter I", "Design Drafter", "Civil CAD Drafter",
      "Electrical CAD Drafter", "Mechanical CAD Drafter", "Structural Drafter",
      "CAD Operator", "Engineering Technician CAD", "Utility Drafter",
      "Land Surveying Drafter", "Piping Designer", "Site Design Technician",
      "BIM Technician", "Construction Drafter", "Telecom Drafter",
      "Drafting Technician",
      // New additions
      "CAD Drafter", "Civil CAD Technician", "Civil Drafter",
      "Architectural Drafter", "Geospatial Technician", "Mapping Technician",
      "Utility Drafter",
    ],
  },
  {
    id: "C",
    label: "GIS / Geospatial",
    resumeFamily: "gis_geospatial",
    nightlyDefault: true,
    titles: [
      "GIS Analyst", "GIS Technician", "GIS Specialist", "GIS Coordinator",
      "GIS Developer", "GIS Mapping Technician", "Geospatial Analyst",
      "GIS Data Analyst", "GIS Analyst I", "GIS Technician I",
      "Utility GIS Analyst", "Telecom GIS Analyst", "GIS Field Technician",
      "Cartographer", "Remote Sensing Analyst", "GIS Database Technician",
      "GIS QA/QC Analyst", "Land Records GIS Analyst",
      "Environmental GIS Analyst", "GIS Support Specialist",
      // New additions
      "GIS Automation Analyst", "Utility Mapping Technician",
    ],
  },
  {
    id: "D",
    label: "Mechanical / Manufacturing / Product CAD",
    resumeFamily: "mechanical_cad",
    nightlyDefault: true,
    titles: [
      "Mechanical Drafter", "Mechanical Designer", "Mechanical CAD Technician",
      "Product Design Drafter", "Product Development Designer",
      "Manufacturing Drafter", "Tool Design Drafter", "Tooling Designer",
      "Fixture Designer", "Jig and Fixture Designer", "Sheet Metal Drafter",
      "Weldment Drafter", "SolidWorks Drafter", "SolidWorks Designer",
      "Inventor Drafter", "3D CAD Modeler",
    ],
  },
  {
    id: "E",
    label: "Electrical / Controls / PCB CAD / Power Engineering",
    resumeFamily: "electrical_cad",
    nightlyDefault: true,
    titles: [
      "Electrical Drafter", "Electrical Designer", "Electrical Design Technician",
      "Controls Drafter", "Instrumentation Drafter",
      "Instrumentation Designer", "Wiring Harness Designer", "Harness Drafter",
      "Panel Designer", "Schematic Drafter", "Power Distribution Drafter",
      "PCB Designer", "PCB Layout Designer",
      "Electrical Engineer",
      // Power Engineering additions
      "Interdisciplinary Engineer", "Operations Engineer – MV Systems",
      "Medium Voltage Specialist",
    ],
  },
  {
    id: "F",
    label: "Civil / Land Development CAD",
    resumeFamily: "civil_cad",
    nightlyDefault: true,
    titles: [
      "Civil Drafter", "Civil Designer", "Civil 3D Technician",
      "Land Development Drafter", "Site Civil Drafter", "Roadway Drafter",
      "Highway Drafter", "Transportation Drafter", "Stormwater Drafter",
      "Grading Drafter", "Subdivision Drafter", "Municipal Drafter",
    ],
  },
  {
    id: "G",
    label: "Structural / Steel / Rebar Detailing",
    resumeFamily: "structural_cad",
    nightlyDefault: true,
    titles: [
      "Structural Steel Detailer", "Steel Detailer",
      "Miscellaneous Steel Detailer", "Rebar Detailer", "Concrete Detailer",
      "Precast Detailer", "Structural Designer", "Structural CAD Technician",
      "Tekla Detailer", "SDS2 Detailer",
    ],
  },
  {
    id: "H",
    label: "Architectural / Building / Interiors",
    resumeFamily: "architectural_cad",
    nightlyDefault: true,
    titles: [
      "Architectural Drafter", "Architectural Designer",
      "Architectural CAD Technician", "Revit Drafter", "Revit Technician",
      "Revit Designer", "Building Designer", "Residential Drafter",
      "Millwork Drafter", "Casework Designer", "Kitchen and Bath Designer",
      "Space Planner",
    ],
  },
  {
    id: "I",
    label: "MEP / HVAC / Plumbing / Fire Protection",
    resumeFamily: "mep_cad",
    nightlyDefault: true,
    titles: [
      "MEP Drafter", "MEP Designer", "HVAC Drafter", "HVAC Designer",
      "Plumbing Drafter", "Plumbing Designer", "Fire Protection Drafter",
      "Fire Sprinkler Designer", "Fire Sprinkler Drafter", "Ductwork Drafter",
    ],
  },
  {
    id: "J",
    label: "Piping / Process / Industrial Plant",
    resumeFamily: "piping_industrial_cad",
    nightlyDefault: true,
    titles: [
      "Piping Drafter", "Process Piping Drafter", "Plant Design Drafter",
      "Plant Layout Designer", "P&ID Drafter", "Industrial Drafter",
    ],
  },
  {
    id: "K",
    label: "Utility / Energy / Renewables",
    resumeFamily: "utility_energy",
    nightlyDefault: true,
    titles: [
      "Utility Designer", "Utility CAD Designer", "Substation Drafter",
      "Transmission Drafter", "Distribution Designer", "Solar Designer",
      "Solar Drafter", "Solar PV Designer", "Renewable Energy Drafter",
      // New additions
      "Renewable Energy Design Engineer",
      "Photovoltaic Design Engineer",
      "PV Design Engineer",
      "PV Systems Engineer",
      "Solar CAD Designer",
      "Solar Design Engineer",
      "Solar Electrical Design Engineer",
      "Solar Engineer",
      "Solar Project Engineer",
      "Solar PV Design Engineer",
      "Solar Applications Engineer",
      "C&I Solar Design Engineer",
      "Senior Applications Engineer – Solar PV & Battery Storage Systems",
    ],
  },
  {
    id: "L",
    label: "Cross-industry Entry-level",
    resumeFamily: "cross_industry_entry",
    nightlyDefault: true,
    titles: [
      "Junior Drafter", "Associate Designer", "Design Technician",
      "Detailing Technician", "Layout Designer", "Drafting Intern",
      "CAD Intern",
    ],
  },

  // ─── New Groups Added 2026-08-06 ───────────────────────────────────────────

  {
    id: "M",
    label: "Data Center / Colocation",
    resumeFamily: "data_center",
    nightlyDefault: true,
    titles: [
      "Data Center Technician",
      "Senior Data Center Technician",
      "Senior Data Technician",
      "Smart Hands Technician",
      "Remote Hands Technician",
      "Colocation Technician",
      "Colocation Engineer",
      "Data Center Operations Technician",
      "Data Center Operations Specialist",
      "Data Center Hardware Technician",
      "Data Center Network Engineer",
      "Field Service Technician",
      "Structured Cabling Technician",
      "Network Technician",
      "IT Infrastructure Technician",
      "Server Hardware Technician",
      "AI Accelerator Engineer",
    ],
  },
  {
    id: "N",
    label: "ISP / Network Operations",
    resumeFamily: "isp_network",
    nightlyDefault: true,
    titles: [
      "Network Engineer",
      "Senior Network Engineer",
      "Network Operations Engineer",
      "Senior Network Operations Engineer",
      "ISP Network Engineer",
      "IP Network Engineer",
      "Service Provider Network Engineer",
      "Core Network Engineer",
      "Broadband Network Engineer",
      "Network Support Engineer",
      "Network Support Specialist",
      "Telecom Network Engineer",
      "WAN Engineer",
      "Network Infrastructure Engineer",
      "Network Technician",
      "L2 Network Support",
      "CCIE",
      "Interconnection Engineer",
    ],
  },
  {
    id: "O",
    label: "NOC / Network Monitoring",
    resumeFamily: "noc_monitoring",
    nightlyDefault: true,
    titles: [
      "NOC Engineer",
      "Senior NOC Engineer",
      "24x7 NOC Engineer",
      "NOC Analyst",
      "Network Operations Center Engineer",
      "Network Monitoring Engineer",
      "Incident Response Engineer",
      "IT Operations Engineer",
      "Systems Monitoring Engineer",
      "Major Incident Engineer",
      "Operational Performance Engineer",
      "Operations Engineer 1",
    ],
  },
  {
    id: "P",
    label: "Solar PV / Battery Storage Engineering",
    resumeFamily: "solar_pv_storage",
    nightlyDefault: true,
    titles: [
      "Solar Applications Engineer",
      "Senior Applications Engineer – Solar PV & Battery Storage Systems",
      "Solar Design Engineer",
      "Solar Electrical Design Engineer",
      "Solar PV Design Engineer",
      "PV Design Engineer",
      "PV Systems Engineer",
      "Photovoltaic Design Engineer",
      "C&I Solar Design Engineer",
      "Solar Project Engineer",
      "Solar Engineer",
      "Renewable Energy Design Engineer",
      "Operational Performance Engineer",
    ],
  },
  {
    id: "Q",
    label: "Hardware / Chip / Embedded Design",
    resumeFamily: "hardware_chip_design",
    nightlyDefault: true,
    titles: [
      "FPGA Engineer",
      "FPGA Design Engineer",
      "FPGA & VLSI Design Engineer",
      "VLSI Design Engineer",
      "RTL Design Engineer",
      "ASIC Design Engineer",
      "SoC Design Engineer",
      "Digital Design Engineer",
      "Hardware Design Engineer",
      "Embedded Hardware Engineer",
      "Embedded Systems Engineer",
      "Electronics Engineer",
    ],
  },
  {
    id: "R",
    label: "Field Service / Maintenance / Estimating",
    resumeFamily: "field_service_estimating",
    nightlyDefault: true,
    titles: [
      "Field Service Technician",
      "Field Service Technician II",
      "Field Service Engineer",
      "Service Engineer",
      "Service Technician",
      "Cost Estimator",
      "Senior Cost Estimator",
    ],
  },
];

const GROUP_BY_ID = new Map(ROLE_GROUPS.map((g) => [g.id, g]));
const GROUP_BY_TITLE = new Map<string, RoleGroup>();
for (const group of ROLE_GROUPS) {
  for (const title of group.titles) {
    const key = title.trim().toLowerCase();
    // Don't overwrite if already mapped (first group wins for duplicate titles)
    if (!GROUP_BY_TITLE.has(key)) {
      GROUP_BY_TITLE.set(key, group);
    }
  }
}

export function getAllGroups(): RoleGroup[] {
  return ROLE_GROUPS.map((g) => ({ ...g, titles: [...g.titles] }));
}

export function getGroupById(groupId: string): RoleGroup | undefined {
  const g = GROUP_BY_ID.get(groupId.toUpperCase());
  return g ? { ...g, titles: [...g.titles] } : undefined;
}

export function getNightlyDefaultGroups(): RoleGroup[] {
  return ROLE_GROUPS
    .filter((group) => group.nightlyDefault)
    .map((group) => ({ ...group, titles: [...group.titles] }));
}

export function getGroupForSearchQuery(query: string): RoleGroup | undefined {
  return GROUP_BY_TITLE.get(query.trim().toLowerCase());
}

function normalizeRoleTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Conservative fallback relevance check used when AI classification is unavailable. */
export function isTitleRelevantToGroup(title: string, groupId: string): boolean {
  const group = getGroupById(groupId);
  const normalizedTitle = normalizeRoleTitle(title);
  if (!group || !normalizedTitle) return false;
  const titleTokens = new Set(normalizedTitle.split(" "));

  return group.titles.some((configured) => {
    const normalizedConfigured = normalizeRoleTitle(configured);
    if (!normalizedConfigured) return false;
    if (
      normalizedTitle === normalizedConfigured ||
      normalizedTitle.includes(normalizedConfigured) ||
      normalizedConfigured.includes(normalizedTitle)
    ) {
      return true;
    }
    const configuredTokens = normalizedConfigured.split(" ");
    const overlap = configuredTokens.filter((token) => titleTokens.has(token)).length;
    return configuredTokens.length >= 2 && overlap >= 2 && overlap / configuredTokens.length >= 0.67;
  });
}

/** Infer the best matching group from a restricted shard snapshot. */
export function inferRoleGroupForTitle(
  title: string,
  candidateGroupIds: string[] = getGroupIds(),
): RoleGroup | undefined {
  const candidates = candidateGroupIds
    .map((id) => getGroupById(id))
    .filter((group): group is RoleGroup => Boolean(group))
    .filter((group) => isTitleRelevantToGroup(title, group.id));
  if (candidates.length === 0) return undefined;
  return candidates.sort((left, right) => {
    const bestLength = (group: RoleGroup) => Math.max(
      ...group.titles
        .filter((configured) => normalizeRoleTitle(title).includes(normalizeRoleTitle(configured)))
        .map((configured) => normalizeRoleTitle(configured).length),
      0,
    );
    return bestLength(right) - bestLength(left) || left.id.localeCompare(right.id);
  })[0];
}

export function getTitlesForGroups(groupIds: string[]): string[] {
  const ids = new Set(groupIds.map((id) => id.toUpperCase()));
  const titles: string[] = [];
  for (const group of ROLE_GROUPS) {
    if (ids.has(group.id)) titles.push(...group.titles);
  }
  return titles;
}

export function getGroupLabel(groupId: string): string {
  return getGroupById(groupId)?.label ?? groupId;
}

export function getResumeFamilyForGroup(groupId: string): string {
  return getGroupById(groupId)?.resumeFamily ?? "general";
}

export function getGroupIds(): string[] {
  return ROLE_GROUPS.map((g) => g.id);
}

export function getTotalTitleCount(): number {
  return ROLE_GROUPS.reduce((sum, g) => sum + g.titles.length, 0);
}

export function validateRoleGroups(groups: string[]): string[] {
  const valid = getGroupIds();
  return groups.map((g) => g.toUpperCase()).filter((g) => valid.includes(g));
}

// ── Combined groups for daily cron (3 mega-groups, each from 4 sub-groups) ──

export interface CombinedGroup {
  id: string;
  label: string;
  subGroupIds: string[];
  titles: string[];
  totalTitles: number;
}

const COMBINED_GROUPS: { id: string; label: string; subGroupIds: string[] }[] = [
  { id: "CA", label: "OSP & Infrastructure",      subGroupIds: ["A", "G", "J", "K"] },
  { id: "CB", label: "All CAD Disciplines",        subGroupIds: ["B", "D", "E", "F"] },
  { id: "CC", label: "GIS & Building Design",      subGroupIds: ["C", "H", "I", "L"] },
  // New combined groups for the new domains
  { id: "CD", label: "Data Center & Network Ops",  subGroupIds: ["M", "N", "O"] },
  { id: "CE", label: "Solar & Hardware Design",    subGroupIds: ["P", "Q", "R"] },
];

export function getCombinedGroups(): CombinedGroup[] {
  return COMBINED_GROUPS.map((cg) => {
    const titles = getTitlesForGroups(cg.subGroupIds);
    return { ...cg, subGroupIds: [...cg.subGroupIds], titles, totalTitles: titles.length };
  });
}

/**
 * Fail fast when the nightly combined-group configuration stops being a true
 * partition of the role groups marked `nightlyDefault`.
 */
export function assertNightlyCombinedGroupPartition(): void {
  const expectedIds = getNightlyDefaultGroups().map((group) => group.id);
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unexpected = new Set<string>();

  for (const combined of COMBINED_GROUPS) {
    for (const rawId of combined.subGroupIds) {
      const id = rawId.toUpperCase();
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
      if (!expected.has(id)) unexpected.add(id);
    }
  }

  const missing = expectedIds.filter((id) => !seen.has(id));
  if (missing.length || duplicates.size || unexpected.size) {
    const details = [
      missing.length ? `missing=${missing.join(",")}` : null,
      duplicates.size ? `duplicated=${Array.from(duplicates).sort().join(",")}` : null,
      unexpected.size ? `not-nightly=${Array.from(unexpected).sort().join(",")}` : null,
    ].filter(Boolean).join("; ");
    throw new Error(`Invalid nightly combined-role partition: ${details}`);
  }
}

export function getAllTitlesFromCombinedGroups(): string[] {
  const all = new Set<string>();
  for (const cg of COMBINED_GROUPS) {
    for (const title of getTitlesForGroups(cg.subGroupIds)) {
      all.add(title);
    }
  }
  return Array.from(all);
}

// Validate as soon as the role library is loaded, before a scheduler can launch
// an incomplete or duplicated nightly batch.
assertNightlyCombinedGroupPartition();
